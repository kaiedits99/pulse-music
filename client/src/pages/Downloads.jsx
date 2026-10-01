import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import { CollectionCard, LibraryRow } from '../components/Cards.jsx';
import {
  PageHero, SectionHead, FilterChips, ViewToggle, EmptyState, SummaryPanel
} from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatBytes, formatLongDuration } from '../format.js';
import {
  downloadedPlaylists,
  downloadedSongs,
  removePlaylistDownloads,
  removeSong,
  clearAllDownloads,
  OFFLINE_EVENT
} from '../offline.js';

const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'playlists', label: 'Playlists', icon: 'playlist' },
  { id: 'songs', label: 'Tracks', icon: 'music' }
];

const VIEW_KEY = 'pulse_downloads_view';

/* Your Downloads — everything saved for offline.
   Reads only from the local store, so this page works with no network. */
export default function Downloads() {
  const { play } = usePlayer();
  const { toast } = useToast();

  const [playlists, setPlaylists] = useState([]);
  const [songs, setSongs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || 'grid'; } catch { return 'grid'; }
  });
  const [storage, setStorage] = useState({ usage: 0, quota: 0 });
  const [confirmClear, setConfirmClear] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  const load = useCallback(() => {
    setPlaylists(downloadedPlaylists());
    setSongs(downloadedSongs());
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(OFFLINE_EVENT, load);
    return () => window.removeEventListener(OFFLINE_EVENT, load);
  }, [load]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        if (alive && est) setStorage({ usage: est.usage || 0, quota: est.quota || 0 });
      } catch { /* not supported */ }
    };
    read();
    window.addEventListener(OFFLINE_EVENT, read);
    return () => { alive = false; window.removeEventListener(OFFLINE_EVENT, read); };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  const dropPlaylist = async (pl) => {
    await removePlaylistDownloads(pl.id);
    load();
    toast(`Removed “${pl.name}” from Downloads`);
  };

  const dropSong = async (song) => {
    await removeSong(song.id);
    load();
    toast('Removed from Downloads');
  };

  const clearAll = async () => {
    await clearAllDownloads();
    load();
    toast('Downloads cleared');
  };

  /* Downloaded single tracks, shaped for SongTable / the player. */
  const trackRows = useMemo(() => songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist_name: s.artist_name,
    cover_url: s.cover_url,
    duration_seconds: s.duration_seconds,
    file_path: s.audioUrl ? s.audioUrl.replace(window.location.origin, '') : null,
    // keep podcast episodes routable (play counts, resume, show links)
    kind: s.kind || 'song',
    offline_only: true,
    episode_id: s.episode_id ?? null,
    podcast_id: s.podcast_id ?? null,
    plays: 0,
    downloads: 0
  })), [songs]);

  const playDownloadedPlaylist = (playlist) => {
    if (!playlist.songs?.length) { toast('Nothing downloaded in this playlist', 'info'); return; }
    play(playlist.songs.map((song) => ({ ...song, offline_only: true })), 0);
  };

  const totalTracks = useMemo(
    () => playlists.reduce((t, p) => t + (p.songs?.length || 0), 0) + songs.length,
    [playlists, songs]
  );
  const totalDuration = useMemo(() => {
    const fromPlaylists = playlists.reduce(
      (t, p) => t + (p.songs || []).reduce((x, s) => x + (s.duration_seconds || 0), 0), 0
    );
    return fromPlaylists + songs.reduce((t, s) => t + (s.duration_seconds || 0), 0);
  }, [playlists, songs]);

  const total = playlists.length + songs.length;
  const storagePct = storage.quota ? (storage.usage / storage.quota) * 100 : Math.min(100, totalTracks * 4);

  const showPlaylists = filter === 'all' || filter === 'playlists';
  const showSongs = filter === 'all' || filter === 'songs';

  return (
    <div className="page">
      <PageHero
        icon="download"
        title="Downloads"
        chip={online ? 'On this device' : 'Offline mode'}
        chipTone={online ? '' : 'green'}
        subtitle={online
          ? `${totalTracks} track${totalTracks === 1 ? '' : 's'} saved locally${totalDuration ? ` • ${formatLongDuration(totalDuration)}` : ''} — playable with no internet.`
          : 'You are offline — this is your downloaded library.'}
        actions={(
          <>
            <Link className="btn btn-ghost btn-pill" to="/offline-player"><Icon name="headphones" size={16} /> Offline Player</Link>
            <Link className="btn btn-ghost btn-pill" to="/playlists"><Icon name="playlist" size={16} /> Browse playlists</Link>
            {total > 0 && (
              <button className="btn btn-ghost btn-pill danger" onClick={() => setConfirmClear(true)}>
                <Icon name="trash" size={16} /> Clear all
              </button>
            )}
          </>
        )}
      />

      {total === 0 ? (
        <EmptyState
          icon="download"
          title="No downloads yet"
          description='Hit "Download" on any playlist, or pick "Save to offline" from a track’s ⋮ menu. Downloaded items play anywhere — plane mode included.'
          action={<Link className="btn btn-primary" to="/playlists"><Icon name="playlist" size={16} /> Browse playlists</Link>}
        />
      ) : (
        <>
          <div className="toolbar">
            <FilterChips options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Filter downloads" />
            <div className="toolbar-right">
              <ViewToggle value={view} onChange={setView} />
            </div>
          </div>

          {showPlaylists && (
            <section className="section">
              <SectionHead
                icon="playlist"
                title="Downloaded playlists"
                note={`${playlists.length} saved`}
              />
              {playlists.length === 0 ? (
                <EmptyState icon="playlist" title="No playlists downloaded" description="Open a playlist and press Download to save it for offline." />
              ) : view === 'grid' ? (
                <div className="collection-grid">
                  {playlists.map((pl) => (
                    <CollectionCard
                      key={pl.id}
                      to={`/playlists/${pl.id}`}
                      type="Playlist"
                      typeTone="accent"
                      cover={pl.cover_url}
                      title={pl.name}
                      subtitle={`${pl.songs?.length || 0} tracks offline`}
                      meta={{ icon: 'checkCircle', text: `Saved ${new Date(pl.at).toLocaleDateString()}`, tone: 'green' }}
                      onPlay={() => playDownloadedPlaylist(pl)}
                      playLabel={`Play ${pl.name} offline`}
                      actions={(
                        <button className="icon-btn icon-btn-sm danger" onClick={(e) => { e.preventDefault(); dropPlaylist(pl); }} aria-label="Remove download" title="Remove from downloads">
                          <Icon name="close" size={15} />
                        </button>
                      )}
                    />
                  ))}
                </div>
              ) : (
                <div className="library-list">
                  {playlists.map((pl) => (
                    <LibraryRow
                      key={pl.id}
                      to={`/playlists/${pl.id}`}
                      cover={pl.cover_url}
                      title={pl.name}
                      subtitle={`${pl.songs?.length || 0} tracks • saved ${new Date(pl.at).toLocaleDateString()}`}
                      meta="Downloaded"
                      metaTone="green"
                      onPlay={() => playDownloadedPlaylist(pl)}
                      actions={(
                        <button className="icon-btn icon-btn-sm danger" onClick={(e) => { e.preventDefault(); dropPlaylist(pl); }} aria-label="Remove download">
                          <Icon name="close" size={15} />
                        </button>
                      )}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {showSongs && (
            <section className="section">
              <SectionHead icon="music" title="Downloaded tracks" note={`${songs.length} saved`} />
              <SongTable
                songs={trackRows}
                showPlays={false}
                showAlbum={false}
                emptyFallback={<EmptyState icon="music" title="No single tracks downloaded" description="Use “Save to offline” in a track’s ⋮ menu." />}
                onDelete={(s) => dropSong(s)}
              />
            </section>
          )}

          <SummaryPanel
            percent={storagePct}
            title="Offline Storage"
            subtitle={storage.quota
              ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} used`
              : `${totalTracks} track${totalTracks === 1 ? '' : 's'} cached on this device`}
            stats={[
              { value: playlists.length, label: 'Playlists' },
              { value: songs.length, label: 'Single tracks' },
              { value: totalTracks, label: 'Total tracks' },
              { value: formatLongDuration(totalDuration), label: 'Listening time' }
            ]}
            actions={(
              <>
                <Link className="btn btn-ghost btn-sm" to="/favorites"><Icon name="heart" size={15} /> Liked Songs</Link>
                <button className="btn btn-ghost btn-sm danger" onClick={() => setConfirmClear(true)}>
                  <Icon name="trash" size={15} /> Free up space
                </button>
              </>
            )}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        title="Clear all downloads"
        message="Remove every downloaded track and playlist from this device? You can download them again any time."
      />
    </div>
  );
}
