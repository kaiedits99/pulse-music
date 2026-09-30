import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Cover } from './ui.jsx';
import { formatDuration } from '../format.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFavoriteToggle } from './SongTable.jsx';
import { useAddToPlaylistDialog } from './Forms.jsx';
import {
  downloadSong as saveOffline,
  removeSong as removeOffline,
  isSongDownloaded,
  hasPlayableAudio,
  OFFLINE_EVENT
} from '../offline.js';

/** Full-screen "Now Playing" view — art, transport, and the live queue. */
export default function NowPlaying({ open, onClose }) {
  const {
    current, queue, index, isPlaying, togglePlay, next, prev, seek, seekRelative,
    currentTime, duration, shuffle, setShuffle, repeat, setRepeat, play, error
  } = usePlayer();

  const { toast } = useToast();
  const toggleFavorite = useFavoriteToggle();
  const { open: openAddToPlaylist, dialog: addDialog } = useAddToPlaylistDialog();

  const barRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const [, setOfflineTick] = useState(0);

  useEffect(() => {
    const cb = () => setOfflineTick((t) => t + 1);
    window.addEventListener(OFFLINE_EVENT, cb);
    return () => window.removeEventListener(OFFLINE_EVENT, cb);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const safeDuration = Number.isFinite(duration) && duration > 0
    ? duration
    : (Number.isFinite(current?.duration_seconds) && current.duration_seconds > 0 ? current.duration_seconds : 0);

  const timeFromEvent = useCallback((e) => {
    if (!barRef.current || !safeDuration) return 0;
    const rect = barRef.current.getBoundingClientRect();
    if (!rect.width) return 0;
    const clientX = e.clientX ?? (e.touches?.[0]?.clientX ?? 0);
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * safeDuration;
  }, [safeDuration]);

  if (!open || !current) return null;

  const displayTime = isDragging ? dragTime : (Number.isFinite(currentTime) ? currentTime : 0);
  const pct = safeDuration > 0 ? Math.max(0, Math.min(100, (displayTime / safeDuration) * 100)) : 0;
  const isFav = !!current.is_favorite;
  const downloaded = isSongDownloaded(current.id);

  const toggleOffline = async () => {
    if (downloaded) { await removeOffline(current.id); toast('Removed from Downloads', 'info'); return; }
    if (!hasPlayableAudio(current)) { toast('This track has no audio file to download yet', 'error'); return; }
    const res = await saveOffline(current);
    toast(res === 'failed' ? 'Download failed' : `Saved “${current.title}” for offline`, res === 'failed' ? 'error' : 'success');
  };

  return (
    <div className="np-overlay" role="dialog" aria-modal="true" aria-label="Now playing">
      <div className="np-bg" aria-hidden="true" />

      <header className="np-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close now playing">
          <Icon name="chevronDown" size={22} />
        </button>
        <div className="np-head-label">
          Playing from queue
          <strong>{queue.length} track{queue.length === 1 ? '' : 's'}</strong>
        </div>
        <button className="icon-btn" onClick={() => openAddToPlaylist(current)} aria-label="Add to playlist" title="Add to playlist">
          <Icon name="plus" size={20} />
        </button>
      </header>

      <div className="np-body">
        <div className="np-art">
          <Cover src={current.cover_url || current.album_cover} alt={current.title} size="100%" />
        </div>

        <div className="np-meta">
          <h2>{current.title}</h2>
          {current.artist_id ? (
            <Link to={`/artists/${current.artist_id}`} onClick={onClose}>{current.artist_name}</Link>
          ) : (
            <span className="np-artist">{current.artist_name}</span>
          )}
        </div>

        <div className="np-progress">
          <div className="progress-row">
            <span className="progress-time">{formatDuration(displayTime)}</span>
            <div
              ref={barRef}
              className={`progress-bar ${isDragging ? 'is-dragging' : ''}`}
              onPointerDown={(e) => {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                const t = timeFromEvent(e); setIsDragging(true); setDragTime(t); seek(t);
              }}
              onPointerMove={(e) => { if (isDragging) setDragTime(timeFromEvent(e)); }}
              onPointerUp={(e) => { if (!isDragging) return; setIsDragging(false); seek(timeFromEvent(e)); }}
              onPointerCancel={() => setIsDragging(false)}
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(safeDuration)}
              aria-valuenow={Math.round(displayTime)}
            >
              <div className="progress-fill" style={{ width: `${pct}%` }} />
              <div className="progress-thumb" style={{ left: `${pct}%` }} />
            </div>
            <span className="progress-time">{formatDuration(safeDuration)}</span>
          </div>
          {error && <div className="player-error" role="status">{error}</div>}
        </div>

        <div className="np-controls">
          <button className={`ctl-btn ${shuffle ? 'on' : ''}`} onClick={() => setShuffle(!shuffle)} aria-label="Shuffle" aria-pressed={shuffle}>
            <Icon name="shuffle" size={21} />
          </button>
          <button className="ctl-btn" onClick={() => seekRelative(-10)} aria-label="Rewind 10 seconds">
            <Icon name="skipBack10" size={21} />
          </button>
          <button className="ctl-btn" onClick={prev} aria-label="Previous track">
            <Icon name="prev" size={24} />
          </button>
          <button className="np-play" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            <Icon name={isPlaying ? 'pause' : 'play'} size={28} />
          </button>
          <button className="ctl-btn" onClick={next} aria-label="Next track">
            <Icon name="next" size={24} />
          </button>
          <button className="ctl-btn" onClick={() => seekRelative(10)} aria-label="Forward 10 seconds">
            <Icon name="skipForward10" size={21} />
          </button>
          <button className={`ctl-btn ${repeat ? 'on' : ''}`} onClick={() => setRepeat(!repeat)} aria-label="Repeat" aria-pressed={repeat}>
            <Icon name={repeat ? 'repeatOne' : 'repeat'} size={21} />
          </button>
        </div>

        <div className="np-extra">
          <button className={`btn btn-sm ${isFav ? 'btn-soft' : 'btn-ghost'}`} onClick={() => toggleFavorite(current)}>
            <Icon name={isFav ? 'heartFill' : 'heart'} size={16} />
            {isFav ? 'Liked' : 'Like'}
          </button>
          <button className={`btn btn-sm ${downloaded ? 'btn-downloaded' : 'btn-ghost'}`} onClick={toggleOffline}>
            <Icon name={downloaded ? 'checkCircle' : 'download'} size={16} />
            {downloaded ? 'Downloaded' : 'Download'}
          </button>
          {current.album_title && <span className="tag">{current.album_title}</span>}
          {current.genre && <span className="tag tag-accent">{current.genre}</span>}
        </div>

        {queue.length > 1 && (
          <div className="np-queue">
            <h4>Next in queue</h4>
            {queue.map((song, i) => (
              <button
                key={`${song.id}-${i}`}
                className={`np-queue-item ${i === index ? 'current' : ''}`}
                onClick={() => play(queue, i)}
              >
                <Cover src={song.cover_url || song.album_cover} alt={song.title} size={40} />
                <span className="np-queue-item-text">
                  <strong>{song.title}</strong>
                  <small>{song.artist_name}</small>
                </span>
                {i === index
                  ? <span className="eq" aria-label="Now playing"><i /><i /><i /><i /></span>
                  : <span className="progress-time">{formatDuration(song.duration_seconds)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {addDialog}
    </div>
  );
}
