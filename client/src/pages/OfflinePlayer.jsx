import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Cover, EmptyState, PageHero, SectionHead } from '../components/ui.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatBytes, formatDuration } from '../format.js';
import {
  downloadedPlaylists,
  downloadedSongs,
  OFFLINE_EVENT
} from '../offline.js';
import {
  importLocalAudioFiles,
  isAudioFile,
  listLocalTracks,
  LOCAL_MUSIC_EVENT,
  removeLocalTrack
} from '../localMusic.js';

const FILE_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.wave,.ogg,.oga,.opus,.flac,.webm';
const FILTERS = [
  { id: 'all', label: 'All music' },
  { id: 'local', label: 'On this device' },
  { id: 'saved', label: 'Pulse downloads' }
];

function toSavedTrack(song) {
  const audioUrl = song.audioUrl || song.file_path || song.source_url || null;
  return {
    ...song,
    id: song.id,
    kind: song.kind === 'episode' ? 'episode' : 'song',
    file_path: audioUrl,
    source_url: null,
    duration_seconds: Number(song.duration_seconds) || 0,
    offline_only: true,
    source_type: 'saved'
  };
}

function getSavedTracks() {
  const tracks = new Map();
  for (const song of downloadedSongs()) {
    const track = toSavedTrack(song);
    tracks.set(String(track.id), track);
  }
  for (const playlist of downloadedPlaylists()) {
    for (const song of playlist.songs || []) {
      const track = toSavedTrack(song);
      if (!tracks.has(String(track.id))) tracks.set(String(track.id), track);
    }
  }
  return [...tracks.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

function folderEntries(directory, prefix = '') {
  return (async function* walk(dir, path) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') {
        yield* walk(entry, `${path}${entry.name}/`);
      } else if (entry.kind === 'file') {
        const file = await entry.getFile();
        if (isAudioFile(file)) yield { file, relativePath: `${path}${file.name}` };
      }
    }
  }(directory, prefix));
}

export default function OfflinePlayer() {
  const { play } = usePlayer();
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [localTracks, setLocalTracks] = useState([]);
  const [savedTracks, setSavedTracks] = useState(() => getSavedTracks());
  const [filter, setFilter] = useState('all');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storage, setStorage] = useState({ usage: 0, quota: 0 });
  const [folderPickerSupported] = useState(() => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function');
  const [folderInputSupported] = useState(() => typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input'));

  const refresh = useCallback(async () => {
    try {
      const [local, estimate] = await Promise.all([
        listLocalTracks(),
        navigator.storage?.estimate?.().catch?.(() => null) || Promise.resolve(null)
      ]);
      setLocalTracks(local);
      setError('');
      if (estimate) setStorage({ usage: estimate.usage || 0, quota: estimate.quota || 0 });
    } catch (err) {
      setError(err.message || 'Could not open the local music library in this browser.');
    } finally {
      setLoading(false);
    }
    setSavedTracks(getSavedTracks());
  }, []);

  useEffect(() => {
    refresh();
    const refreshAll = () => refresh();
    const setOnlineState = () => setOnline(true);
    const setOfflineState = () => setOnline(false);
    window.addEventListener(LOCAL_MUSIC_EVENT, refreshAll);
    window.addEventListener(OFFLINE_EVENT, refreshAll);
    window.addEventListener('online', setOnlineState);
    window.addEventListener('offline', setOfflineState);
    return () => {
      window.removeEventListener(LOCAL_MUSIC_EVENT, refreshAll);
      window.removeEventListener(OFFLINE_EVENT, refreshAll);
      window.removeEventListener('online', setOnlineState);
      window.removeEventListener('offline', setOfflineState);
    };
  }, [refresh]);

  const localRows = useMemo(() => localTracks.map((track) => ({
    ...track,
    kind: 'local',
    local_id: track.id,
    file_path: null,
    source_url: null,
    source_type: 'local'
  })), [localTracks]);

  const allTracks = useMemo(
    () => [...savedTracks, ...localRows].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [savedTracks, localRows]
  );
  const visibleTracks = useMemo(() => {
    if (filter === 'local') return localRows;
    if (filter === 'saved') return savedTracks;
    return allTracks;
  }, [allTracks, filter, localRows, savedTracks]);

  const importFiles = useCallback(async (entries) => {
    const files = Array.from(entries || []);
    if (!files.length) { toast('No audio files found in that selection.', 'info'); return; }
    setImporting(true);
    setError('');
    try {
      try { await navigator.storage?.persist?.(); } catch { /* persistence is best-effort */ }
      const result = await importLocalAudioFiles(files);
      await refresh();
      if (!result.imported) toast('No supported audio files found in that selection.', 'info');
      else toast(`Added ${result.imported} local track${result.imported === 1 ? '' : 's'} for offline playback.`);
    } catch (err) {
      setError(err.message || 'Could not import those files.');
      toast(err.message || 'Could not import those files.', 'error');
    } finally {
      setImporting(false);
    }
  }, [refresh, toast]);

  const onFilesSelected = (event) => {
    const files = Array.from(event.target.files || []).map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name
    }));
    event.target.value = '';
    importFiles(files);
  };

  const chooseFolder = async () => {
    if (folderPickerSupported) {
      try {
        const directory = await window.showDirectoryPicker({ mode: 'read' });
        const entries = [];
        for await (const entry of folderEntries(directory)) entries.push(entry);
        await importFiles(entries);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          setError(err.message || 'Could not read that folder.');
          toast(err.message || 'Could not read that folder.', 'error');
        }
      }
      return;
    }
    if (folderInputSupported) folderInputRef.current?.click();
    else fileInputRef.current?.click();
  };

  const removeLocal = async (track) => {
    try {
      await removeLocalTrack(track.local_id || track.id);
      toast(`Removed “${track.title}” from this device.`);
    } catch (err) {
      toast(err.message || 'Could not remove that local track.', 'error');
    }
  };

  const playAll = () => {
    if (!visibleTracks.length) return;
    play(visibleTracks, 0);
  };

  const subtitle = online
    ? 'A music player for files and Pulse downloads stored on this device. This mode never streams.'
    : 'You are offline. Play your imported music together with tracks and playlists saved from Pulse.';

  return (
    <div className="page offline-player-page">
      <PageHero
        icon="headphones"
        title="Offline Player"
        chip={online ? 'Ready for offline' : 'Offline mode'}
        chipTone="green"
        subtitle={subtitle}
        actions={(
          <>
            {visibleTracks.length > 0 && (
              <button className="btn btn-primary btn-pill" onClick={playAll}>
                <Icon name="play" size={15} /> Play {filter === 'all' ? 'offline mix' : 'all'}
              </button>
            )}
            <Link className="btn btn-ghost btn-pill" to="/downloads">
              <Icon name="download" size={15} /> Manage downloads
            </Link>
          </>
        )}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        className="sr-only"
        onChange={onFilesSelected}
        aria-label="Choose audio files"
      />
      {folderInputSupported && (
        <input
          ref={folderInputRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          className="sr-only"
          onChange={onFilesSelected}
          aria-label="Choose a music folder"
          {...{ webkitdirectory: '' }}
        />
      )}

      <section className="offline-import-panel" aria-label="Import music from this device">
        <div className="offline-import-icon"><Icon name="folderPlus" size={22} /></div>
        <div className="offline-import-copy">
          <h2>Add music from your device</h2>
          <p>Choose a music folder where supported, or select audio files from your phone. Files are copied into this browser’s private storage and are never uploaded.</p>
        </div>
        <div className="offline-import-actions">
          <button className="btn btn-primary" onClick={chooseFolder} disabled={importing}>
            <Icon name="folder" size={16} />
            {importing ? 'Importing…' : folderPickerSupported || folderInputSupported ? 'Choose a folder' : 'Browse audio files'}
          </button>
          <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            <Icon name="music" size={16} /> Choose files
          </button>
        </div>
      </section>

      <div className="offline-info-banner">
        <Icon name="info" size={17} />
        <p>Browsers require you to pick the music you want to use. Folder access depends on your browser; on phones, selecting multiple audio files is the most reliable option. Imported files stay on this device.</p>
      </div>

      {error && <div className="offline-library-error" role="status">{error}</div>}

      <section className="section offline-library-section">
        <SectionHead
          icon="wave"
          title="Your offline mix"
          note={`${allTracks.length} track${allTracks.length === 1 ? '' : 's'} on this device`}
        />

        <div className="toolbar offline-library-toolbar">
          <div className="chip-row" role="tablist" aria-label="Filter offline music">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                className={`chip ${filter === option.id ? 'active' : ''}`}
                onClick={() => setFilter(option.id)}
                role="tab"
                aria-selected={filter === option.id}
              >
                {option.label}
                {option.id === 'local' && <span className="offline-filter-count">{localRows.length}</span>}
                {option.id === 'saved' && <span className="offline-filter-count">{savedTracks.length}</span>}
              </button>
            ))}
          </div>
          <span className="offline-storage-label">
            <Icon name="storage" size={14} />
            {storage.usage ? `${formatBytes(storage.usage)} stored` : 'Stored on this device'}
          </span>
        </div>

        {loading ? (
          <div className="offline-list-loading" aria-live="polite">Loading music stored on this device…</div>
        ) : visibleTracks.length === 0 ? (
          <EmptyState
            icon={filter === 'saved' ? 'download' : 'music'}
            title={filter === 'saved' ? 'No Pulse downloads yet' : filter === 'local' ? 'No local music added yet' : 'Your offline mix is empty'}
            description={filter === 'saved'
              ? 'Save tracks or playlists from Pulse Downloads and they will appear here beside your local music.'
              : 'Import songs from your device above, or save music from Pulse Downloads. Both sources will play in one offline queue.'}
            action={filter === 'saved'
              ? <Link className="btn btn-ghost" to="/downloads"><Icon name="download" size={15} /> Open Downloads</Link>
              : null}
          />
        ) : (
          <div className="offline-track-list">
            {visibleTracks.map((track, index) => (
              <div className="offline-track-row" key={`${track.source_type}:${track.id}`}>
                <button
                  className="offline-track-main"
                  onClick={() => play(visibleTracks, index)}
                  title={`Play ${track.title}`}
                >
                  <Cover src={track.cover_url} alt={track.title} size={48} className="offline-track-art" />
                  <span className="offline-track-copy">
                    <strong>{track.title}</strong>
                    <small>{track.artist_name || 'Unknown artist'}</small>
                  </span>
                </button>
                <span className={`offline-track-source ${track.source_type}`}>
                  <Icon name={track.source_type === 'local' ? 'headphones' : 'download'} size={13} />
                  {track.source_type === 'local' ? 'Device' : 'Pulse'}
                </span>
                <span className="offline-track-duration">
                  {track.duration_seconds > 0 ? formatDuration(track.duration_seconds) : '--:--'}
                </span>
                {track.source_type === 'local' ? (
                  <button className="offline-track-remove" onClick={() => removeLocal(track)} aria-label={`Remove ${track.title}`} title="Remove from this device">
                    <Icon name="close" size={16} />
                  </button>
                ) : (
                  <span className="offline-track-check" title="Saved for offline"><Icon name="checkCircle" size={16} /></span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="offline-player-footnote">
        {storage.quota
          ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} browser storage used. Browser storage can be cleared by your device; keep original files as a backup.`
          : 'Keep original files as a backup. Browser storage may be cleared by your device.'}
      </p>
    </div>
  );
}
