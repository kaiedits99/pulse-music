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

/* Equalizer bar heights are driven purely by CSS animation; these tweaks give
   each bar a slightly different rhythm so the pattern never looks uniform. */
const EQ_BARS = 21;

/**
 * Full-screen "Now Playing" view (opened by tapping the player bar).
 * Layout mirrors the reference design: teal canvas, spinning vinyl with the
 * cover art as the centre label, big title / artist / View Lyrics, action row,
 * thin seek bar with times, and large transport controls.
 */
export default function NowPlaying({ open, onClose }) {
  const {
    current, isPlaying, togglePlay, next, prev, seek, currentTime, duration,
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

  const trackRef = useRef(null);
  const draggingRef = useRef(false);
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
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  /* ---- Drag / tap to seek (pointer events cover mouse + touch) ---- */
  const seekFromPointer = useCallback((e) => {
    const el = trackRef.current;
    if (!el || !duration) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(p * duration);
  }, [duration, seek]);

  const onTrackDown = (e) => {
    if (!duration) return;
    draggingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    seekFromPointer(e);
  };
  const onTrackMove = (e) => { if (draggingRef.current) seekFromPointer(e); };
  const onTrackUp = () => { draggingRef.current = false; };

  /* ---- Swipe down anywhere (except interactive controls) to close ---- */
  const onTouchStart = (e) => {
    if (e.target.closest('button, a, input, .np-progress, .np-queue, .np-menu')) { touchYRef.current = null; return; }
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

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : (Number.isFinite(current.duration_seconds) ? current.duration_seconds : 0);
  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
  const pct = safeDuration ? Math.max(0, Math.min(100, (safeCurrentTime / safeDuration) * 100)) : 0;

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
            className="np-progress"
            ref={trackRef}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
          >
            <div className="np-progress-fill" style={{ width: `${pct}%` }} />
            <div className="np-progress-thumb" style={{ left: `${pct}%` }} />
          </div>
          <div className="np-times">
            <span>{formatDuration(safeCurrentTime)}</span>
            <span>{formatDuration(safeDuration)}</span>
          </div>
        </div>

        {/* ---- Transport controls ---- */}
        <div className="np-controls">
          <button className={`np-iconbtn ${shuffle ? 'on' : ''}`} onClick={() => setShuffle(!shuffle)} aria-label="Shuffle">
            <Icon name="shuffle" size={24} />
          </button>
          <button className="np-iconbtn" onClick={() => { try { prev(); } catch { /* ignore */ } }} aria-label="Previous">
            <Icon name="prev" size={28} />
          </button>
          <button className="np-play" onClick={() => { try { togglePlay(); } catch { /* ignore */ } }} aria-label={isPlaying ? 'Pause' : 'Play'}>
            <Icon name={isPlaying ? 'pause' : 'play'} size={30} />
          </button>
          <button className="np-iconbtn" onClick={() => { try { next(); } catch { /* ignore */ } }} aria-label="Next">
            <Icon name="next" size={28} />
          </button>
          <button className={`np-iconbtn ${repeat ? 'on' : ''}`} onClick={() => setRepeat(!repeat)} aria-label="Repeat">
            <Icon name="repeat" size={24} />
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
