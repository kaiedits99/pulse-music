import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Cover } from './ui.jsx';
import { formatDuration, initials } from '../format.js';
import { mediaUrl } from '../config.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFavoriteToggle, downloadSong } from './SongTable.jsx';
import { downloadSong as saveToOffline, isSongDownloaded } from '../offline.js';

/* Equalizer bar heights are driven purely by CSS animation; these tweaks give
   each bar a slightly different rhythm so the pattern never looks uniform. */
const EQ_BARS = 21;

/**
 * Full-screen "Now Playing" view (opened by tapping the player bar).
 * Teal canvas, spinning vinyl with the cover art as the centre label,
 * big title / artist / View Lyrics, action row, seek bar with times,
 * and large transport controls with skip back/forward.
 */
export default function NowPlaying({ open, onClose }) {
  const {
    current, isPlaying, togglePlay, next, prev, seek, seekRelative, currentTime, duration,
    shuffle, setShuffle, repeat, setRepeat, queue, index, play, error
  } = usePlayer();
  const { toast } = useToast();
  const toggleFavorite = useFavoriteToggle();
  const navigate = useNavigate();

  const [closing, setClosing] = useState(false);
  const [eqOn, setEqOn] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  const trackRef = useRef(null);
  const touchYRef = useRef(null);
  const closeTimer = useRef(null);

  /* ---- Close with a slide-down exit animation, then unmount ---- */
  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => { setClosing(false); onClose(); }, 260);
  }, [closing, onClose]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  /* ---- Reset transient state whenever the view (re)opens ---- */
  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);

  /* ---- Cover art can break on one track without being broken on the next ---- */
  const songId = current?.id ?? null;
  useEffect(() => { setCoverBroken(false); }, [songId]);

  /* ---- Escape closes; body scroll is locked while open ---- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  const safeDuration = (Number.isFinite(duration) && duration > 0)
    ? duration
    : (Number.isFinite(current?.duration_seconds) && current.duration_seconds > 0 ? current.duration_seconds : 0);

  /* ---- Calculate seek position from pointer event ---- */
  const calculateTimeFromPointer = useCallback((e) => {
    const el = trackRef.current;
    if (!el || !safeDuration) return 0;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return 0;
    const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return p * safeDuration;
  }, [safeDuration]);

  /* ---- Drag / tap to seek with Pointer Events ---- */
  const onTrackPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (!safeDuration) return;
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const target = calculateTimeFromPointer(e);
    setIsDragging(true);
    setDragTime(target);
    seek(target);
  };

  const onTrackPointerMove = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    const target = calculateTimeFromPointer(e);
    setDragTime(target);
  };

  const onTrackPointerUp = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const target = calculateTimeFromPointer(e);
    setIsDragging(false);
    seek(target);
  };

  const onTrackPointerCancel = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    setIsDragging(false);
  };

  const onTrackKeyDown = (e) => {
    if (!safeDuration) return;
    const curr = isDragging ? dragTime : (Number.isFinite(currentTime) ? currentTime : 0);
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      seek(Math.max(0, curr - 5));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      seek(Math.min(safeDuration, curr + 5));
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      seek(safeDuration);
    }
  };

  /* ---- Swipe down anywhere (except interactive controls) to close ---- */
  const onTouchStart = (e) => {
    if (e.target.closest('button, a, input, .np-progress-block, .np-progress, .np-queue, .np-menu, .np-controls, .np-actions')) {
      touchYRef.current = null;
      return;
    }
    touchYRef.current = e.touches[0].clientY;
  };

  const onTouchEnd = (e) => {
    if (touchYRef.current == null) return;
    const dy = e.changedTouches[0].clientY - touchYRef.current;
    touchYRef.current = null;
    if (dy > 90) close();
  };

  /* ---- Share (native sheet when available, clipboard fallback) ---- */
  const share = async () => {
    const text = `Listen to ${current.title} by ${current.artist_name} on Pulse`;
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title: current.title, text, url }); return; }
      await navigator.clipboard.writeText(`${text} — ${url}`);
      toast('Link copied to clipboard');
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Could not share this track', 'error');
    }
  };

  const gotoArtist = () => {
    if (!current.artist_id) { toast('This track has no artist page', 'info'); return; }
    close();
    setTimeout(() => navigate(`/artists/${current.artist_id}`), 200);
  };

  if (!open || !current) return null;

  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
  const displayTime = isDragging ? dragTime : safeCurrentTime;
  const pct = safeDuration > 0 ? Math.max(0, Math.min(100, (displayTime / safeDuration) * 100)) : 0;

  const title = current.title || 'Unknown Track';
  const artistName = current.artist_name || 'Unknown Artist';
  const coverSrc = current.cover_url || current.album_cover || null;
  const isFav = !!current.is_favorite;
  const upNext = queue.slice(index + 1, index + 30);

  /* Portal to <body>: the player bar has its own low z-index stacking context,
     so rendering inside it would let the mobile nav / drawer paint on top of
     this full-screen view. */
  return createPortal(
    <div
      className={`np-overlay ${closing ? 'np-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="np-top">
        <button className="np-iconbtn" onClick={close} aria-label="Close Now Playing">
          <Icon name="chevronDown" size={26} />
        </button>
        <div className="np-top-right">
          <button className="np-avatar" onClick={gotoArtist} aria-label={`Go to ${artistName}`} title={artistName}>
            {initials(artistName)}
          </button>
          <button className="np-iconbtn" onClick={share} aria-label="Share" title="Share">
            <Icon name="share" size={21} />
          </button>
        </div>
      </div>

      <div className="np-main">
        {/* ---- Vinyl disc ---- */}
        <div className="np-disc-wrap">
          <div className="np-disc-halo" aria-hidden="true" />
          <div className={`np-disc ${isPlaying ? 'spinning' : ''}`} aria-hidden="true">
            <div className={`np-disc-label ${!coverSrc || coverBroken ? 'fallback' : ''}`}>
              {coverSrc && !coverBroken ? (
                <img src={mediaUrl(coverSrc)} alt="" onError={() => setCoverBroken(true)} />
              ) : (
                <Icon name="music" size={64} strokeWidth={1.5} />
              )}
            </div>
            <span className="np-disc-dot" />
          </div>
          {eqOn && isPlaying && (
            <div className="np-eq" aria-hidden="true">
              {Array.from({ length: EQ_BARS }).map((_, i) => (
                <span key={i} style={{ animationDelay: `${(i % 7) * 0.11}s`, animationDuration: `${0.7 + (i % 5) * 0.13}s` }} />
              ))}
            </div>
          )}
        </div>

        {/* ---- Title / artist / lyrics ---- */}
        <div className="np-info">
          <h2 className="np-title" title={title}>{title}</h2>
          {current.artist_id ? (
            <button className="np-artist" onClick={gotoArtist}>{artistName}</button>
          ) : (
            <span className="np-artist">{artistName}</span>
          )}
          <button
            className="np-lyrics"
            onClick={() => toast('Lyrics are not available for this track yet', 'info')}
          >
            View Lyrics <Icon name="chevronRight" size={15} />
          </button>
          {error && <div className="np-error" role="status">{error}</div>}
        </div>

        {/* ---- Action row ---- */}
        <div className="np-actions">
          <div className="np-actions-l">
            <button
              className={`np-iconbtn ${isFav ? 'on' : ''}`}
              onClick={() => { try { toggleFavorite(current); } catch { /* ignore */ } }}
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Icon name={isFav ? 'heartFill' : 'heart'} size={22} />
            </button>
            <button className="np-iconbtn" onClick={() => toast('Add to playlist is coming soon', 'info')} aria-label="Add to playlist">
              <Icon name="plus" size={22} />
            </button>
            <button className="np-iconbtn" onClick={() => { try { downloadSong(current, toast); } catch { /* ignore */ } }} aria-label="Download">
              <Icon name="download" size={22} />
            </button>
          </div>
          <div className="np-actions-r">
            <button
              className={`np-iconbtn ${eqOn ? 'on' : ''}`}
              onClick={() => setEqOn((v) => !v)}
              aria-label="Toggle visualizer"
              title="Visualizer"
            >
              <Icon name="wave" size={22} />
            </button>
            <button
              className={`np-iconbtn ${queueOpen ? 'on' : ''}`}
              onClick={() => setQueueOpen((v) => !v)}
              aria-label="Up next"
              title="Up next"
            >
              <Icon name="playlist" size={22} />
            </button>
            <div className="np-more-wrap">
              <button className="np-iconbtn" onClick={() => setMenuOpen((v) => !v)} aria-label="More options">
                <Icon name="more" size={22} />
              </button>
              {menuOpen && (
                <>
                  <div className="np-menu-backdrop" onClick={() => setMenuOpen(false)} />
                  <div className="np-menu">
                    <button onClick={() => { setMenuOpen(false); share(); }}><Icon name="share" size={17} /> Share</button>
                    <button onClick={() => { setMenuOpen(false); try { downloadSong(current, toast); } catch { /* ignore */ } }}><Icon name="download" size={17} /> Download</button>
            <button onClick={() => { setMenuOpen(false); saveToOffline(current).then((r) => toast(r === 'no-audio' ? 'No playable audio to download yet' : r === 'failed' ? 'Download failed' : 'Saved for offline', r === 'added' || r === 'cached' ? 'success' : 'error')); }}><Icon name="download" size={17} /> Save to offline</button>
                    <button onClick={() => { setMenuOpen(false); gotoArtist(); }}><Icon name="artist" size={17} /> Go to artist</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ---- Seek bar + times ---- */}
        <div className="np-progress-block">
          <div
            className={`np-progress ${isDragging ? 'is-dragging' : ''}`}
            ref={trackRef}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={onTrackPointerUp}
            onPointerCancel={onTrackPointerCancel}
            onKeyDown={onTrackKeyDown}
            role="slider"
            tabIndex={0}
            aria-label="Seek track position"
            aria-valuemin={0}
            aria-valuemax={Math.round(safeDuration)}
            aria-valuenow={Math.round(displayTime)}
            aria-valuetext={`${formatDuration(displayTime)} of ${formatDuration(safeDuration)}`}
          >
            <div className="np-progress-fill" style={{ width: `${pct}%` }} />
            <div className="np-progress-thumb" style={{ left: `${pct}%` }} />
          </div>
          <div className="np-times">
            <span>{formatDuration(displayTime)}</span>
            <span>{formatDuration(safeDuration)}</span>
          </div>
        </div>

        {/* ---- Transport controls ---- */}
        <div className="np-controls">
          <button className={`np-iconbtn ${shuffle ? 'on' : ''}`} onClick={() => setShuffle(!shuffle)} aria-label="Shuffle" title="Shuffle">
            <Icon name="shuffle" size={22} />
          </button>
          <button className="np-iconbtn" onClick={() => { try { prev(); } catch { /* ignore */ } }} aria-label="Previous" title="Previous">
            <Icon name="prev" size={24} />
          </button>
          <button className="np-iconbtn" onClick={() => seekRelative(-10)} aria-label="Rewind 10 seconds" title="Rewind 10 seconds">
            <Icon name="skipBack10" size={24} />
          </button>
          <button className="np-play" onClick={() => { try { togglePlay(); } catch { /* ignore */ } }} aria-label={isPlaying ? 'Pause' : 'Play'}>
            <Icon name={isPlaying ? 'pause' : 'play'} size={30} />
          </button>
          <button className="np-iconbtn" onClick={() => seekRelative(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds">
            <Icon name="skipForward10" size={24} />
          </button>
          <button className="np-iconbtn" onClick={() => { try { next(); } catch { /* ignore */ } }} aria-label="Next" title="Next">
            <Icon name="next" size={24} />
          </button>
          <button className={`np-iconbtn ${repeat ? 'on' : ''}`} onClick={() => setRepeat(!repeat)} aria-label="Repeat" title="Repeat">
            <Icon name="repeat" size={22} />
          </button>
        </div>
      </div>

      {/* ---- Up-next queue sheet ---- */}
      {queueOpen && (
        <>
          <div className="np-sheet-backdrop" onClick={() => setQueueOpen(false)} />
          <div className="np-queue">
            <div className="np-queue-head">
              <h3>Up next</h3>
              <button className="np-iconbtn" onClick={() => setQueueOpen(false)} aria-label="Close queue">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="np-queue-list">
              {upNext.length === 0 && <p className="np-queue-empty">Nothing else in the queue.</p>}
              {upNext.map((song, i) => {
                const qi = index + 1 + i;
                return (
                  <button key={`${song.id ?? 'q'}-${qi}`} className="np-queue-item" onClick={() => play(queue, qi)}>
                    <Cover src={song.cover_url || song.album_cover} alt={song.title} size={40} />
                    <span className="np-queue-meta">
                      <span className="np-queue-title">{song.title}</span>
                      <span className="np-queue-artist">{song.artist_name}</span>
                    </span>
                    <span className="np-queue-dur">{formatDuration(song.duration_seconds)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
