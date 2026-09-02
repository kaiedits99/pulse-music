import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import Icon from './Icon.jsx';
import { Cover } from './ui.jsx';
import { formatDuration, formatNumber } from '../format.js';
import { api } from '../api.js';
import { apiUrl } from '../config.js';
import { openExternal } from '../native.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { downloadSong as saveOffline, removeSong as removeOffline, isSongDownloaded, hasPlayableAudio, OFFLINE_EVENT } from '../offline.js';

/* Re-render whenever the offline store changes (download/remove). */
function useOfflineTick() {
  return useSyncExternalStore(
    (cb) => { window.addEventListener(OFFLINE_EVENT, cb); return () => window.removeEventListener(OFFLINE_EVENT, cb); },
    () => offlineVersion,
    () => offlineVersion
  );
}
let offlineVersion = 0;
window.addEventListener(OFFLINE_EVENT, () => { offlineVersion += 1; });

function Dropdown({ open, onClose, items }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dropdown" ref={ref}>
      {items.map((it, i) => (
        <button key={i} className="dropdown-item" disabled={it.disabled} onClick={() => { if (it.disabled) return; it.onClick(); onClose(); }}>
          <Icon name={it.icon} size={16} /> {it.label}
        </button>
      ))}
    </div>
  );
}

export function useFavoriteToggle() {
  const { markFavorite } = usePlayer();
  const { toast } = useToast();

  const toggleFavorite = async (song) => {
    const nextVal = song.is_favorite ? 0 : 1;
    // optimistic update
    song.is_favorite = nextVal;
    markFavorite(song.id, nextVal);
    try {
      if (nextVal) await api.post(`/api/favorites/${song.id}`);
      else await api.del(`/api/favorites/${song.id}`);
      toast(nextVal ? 'Added to favorites' : 'Removed from favorites', nextVal ? 'success' : 'info');
    } catch {
      song.is_favorite = nextVal ? 0 : 1;
      markFavorite(song.id, nextVal ? 0 : 1);
      toast('Could not update favorite', 'error');
    }
  };
  return toggleFavorite;
}

export function downloadFile(song, toast) {
  if (!song.file_path) { toast('No audio file for this track', 'error'); return; }
  openExternal(apiUrl(`/api/songs/${song.id}/download`));
  song.downloads = (song.downloads || 0) + 1;
  toast(`Downloading "${song.title}"`);
}
// legacy name kept for existing callers (PlayerBar / NowPlaying)
export const downloadSong = downloadFile;

export default function SongTable({ songs, showAlbum = true, showIndex = true, showPlays = true, onEdit, onDelete, onAddToPlaylist, canManage, emptyFallback, showOfflineActions = true }) {
  const { play, current, isPlaying, togglePlay } = usePlayer();
  const { toast } = useToast();
  const toggleFavorite = useFavoriteToggle();
  useOfflineTick();
  const [menuFor, setMenuFor] = useState(null);

  const saveToOffline = async (song) => {
    const res = await saveOffline(song);
    if (res === 'no-audio') toast('This track has no playable audio to download yet', 'error');
    else if (res === 'failed') toast('Download failed — check your connection', 'error');
    else toast(`Saved "${song.title}" for offline`);
  };

  const dropOffline = async (song) => {
    await removeOffline(song.id);
    toast('Removed from Downloads');
  };

  if (!songs || !songs.length) {
    return emptyFallback || null;
  }

  const handleRowPlay = (song, i) => {
    if (current && current.id === song.id) togglePlay();
    else play(songs, i);
  };

  return (
    <div className="song-table-wrap">
      <table className="song-table">
        <thead>
          <tr>
            {showIndex && <th className="col-index">#</th>}
            <th>Title</th>
            {showAlbum && <th className="col-album">Album</th>}
            <th className="col-genre">Genre</th>
            {showPlays && <th className="col-num">Plays</th>}
            <th className="col-num col-downloads">Downloads</th>
            <th className="col-dur"><Icon name="clock" size={15} /></th>
            <th className="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {songs.map((song, i) => {
            const isCurrent = current && current.id === song.id;
            const playing = isCurrent && isPlaying;
            const showEdit = onEdit && (!canManage || canManage(song));
            const showDelete = onDelete && (!canManage || canManage(song));
            return (
              <tr key={song.id} className={isCurrent ? 'row-current' : ''} onDoubleClick={() => handleRowPlay(song, i)}>
                {showIndex && (
                  <td className="col-index">
                    <button className={`row-play ${isCurrent ? 'visible' : ''}`} onClick={() => handleRowPlay(song, i)} aria-label="Play">
                      {playing ? <Icon name="pause" size={16} /> : <Icon name="play" size={16} />}
                    </button>
                    <span className={`row-num ${isCurrent ? 'hidden' : ''}`}>{i + 1}</span>
                  </td>
                )}
                <td>
                  <div className="cell-title">
                    <Cover src={song.cover_url || song.album_cover} alt={song.title} size={42} />
                    <div className="cell-title-text">
                      <span className={`t-title ${isCurrent ? 'accent' : ''}`}>
                        {song.title}
                        {showOfflineActions && isSongDownloaded(song.id) && (
                          <span className="offline-badge" title="Available offline"><Icon name="download" size={12} /></span>
                        )}
                      </span>
                      <span className="t-artist">{song.artist_name}</span>
                    </div>
                  </div>
                </td>
                {showAlbum && <td className="col-album"><span className="t-album">{song.album_title || '—'}</span></td>}
                <td className="col-genre">{song.genre ? <span className="tag">{song.genre}</span> : <span className="muted">—</span>}</td>
                {showPlays && <td className="col-num muted">{formatNumber(song.plays)}</td>}
                <td className="col-num col-downloads muted">{formatNumber(song.downloads)}</td>
                <td className="col-dur muted">{formatDuration(song.duration_seconds)}</td>
                <td className="col-actions">
                  <div className="row-actions">
                    <button
                      className={`icon-btn icon-btn-sm fav-btn ${song.is_favorite ? 'active' : ''}`}
                      onClick={() => toggleFavorite(song)}
                      aria-label="Favorite"
                    >
                      <Icon name={song.is_favorite ? 'heartFill' : 'heart'} size={17} />
                    </button>
                    <button className="icon-btn icon-btn-sm" onClick={() => downloadFile(song, toast)} aria-label="Download">
                      <Icon name="download" size={17} />
                    </button>
                    {(onAddToPlaylist || showEdit || showDelete) && (
                      <div className="menu-wrap">
                        <button className="icon-btn icon-btn-sm" onClick={() => setMenuFor(menuFor === song.id ? null : song.id)} aria-label="More">
                          <Icon name="more" size={18} />
                        </button>
                        <Dropdown
                          open={menuFor === song.id}
                          onClose={() => setMenuFor(null)}
                          items={[
                            ...(onAddToPlaylist ? [{ icon: 'playlist', label: 'Add to playlist', onClick: () => onAddToPlaylist(song) }] : []),
                            ...(showOfflineActions
                              ? isSongDownloaded(song.id)
                                ? [{ icon: 'close', label: 'Remove download', onClick: () => dropOffline(song) }]
                                : [{ icon: 'download', label: 'Save to offline', disabled: !hasPlayableAudio(song), onClick: () => saveToOffline(song) }]
                              : []),
                            ...(showEdit ? [{ icon: 'edit', label: 'Edit', onClick: () => onEdit(song) }] : []),
                            ...(showDelete ? [{ icon: 'trash', label: 'Delete', onClick: () => onDelete(song) }] : [])
                          ]}
                        />
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
