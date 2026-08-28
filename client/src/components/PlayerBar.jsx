import { useRef, useEffect, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import NowPlaying from './NowPlaying.jsx';
import { Cover } from './ui.jsx';
import { formatDuration } from '../format.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFavoriteToggle, downloadSong } from './SongTable.jsx';

export default function PlayerBar() {
  const {
    current, isPlaying, togglePlay, next, prev, seek, seekRelative, currentTime, duration,
    volume, setVolume, shuffle, setShuffle, repeat, setRepeat, error
  } = usePlayer();
  const { toast } = useToast();
  const toggleFavorite = useFavoriteToggle();
  const barRef = useRef(null);
  const swipeStartY = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  const openExpanded = useCallback(() => setExpanded(true), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);

  /* ---- Tap anywhere on the bar (except real controls) to expand ---- */
  const onBarClick = useCallback((e) => {
    if (e.target.closest('button, a, input, .progress-row, .progress-bar, .player-error, .vol-slider-wrap')) return;
    openExpanded();
  }, [openExpanded]);

  /* ---- Swipe up on the bar to expand (mobile) ---- */
  const onBarTouchStart = useCallback((e) => {
    if (e.target.closest('button, a, input, .progress-row, .progress-bar')) {
      swipeStartY.current = null;
      return;
    }
    swipeStartY.current = e.touches[0].clientY;
  }, []);

  const onBarTouchEnd = useCallback((e) => {
    if (swipeStartY.current == null) return;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    swipeStartY.current = null;
    if (dy < -45) openExpanded();
  }, [openExpanded]);

  /* ---- Keyboard shortcuts (Space to toggle play, Arrow keys to seek) ---- */
  const onKey = useCallback((e) => {
    if (e.target.closest('input,textarea,select,[contenteditable="true"]')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      seekRelative(-5);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      seekRelative(5);
    } else if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      seekRelative(-10);
    } else if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      seekRelative(10);
    } else if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      togglePlay();
    }
  }, [togglePlay, seekRelative]);

  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  /* ---- Calculate seek position from pointer event ---- */
  const safeDuration = (Number.isFinite(duration) && duration > 0)
    ? duration
    : (Number.isFinite(current?.duration_seconds) && current.duration_seconds > 0 ? current.duration_seconds : 0);

  const calculateTimeFromEvent = useCallback((e) => {
    if (!barRef.current || !safeDuration) return 0;
    const rect = barRef.current.getBoundingClientRect();
    if (!rect.width) return 0;
    const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return p * safeDuration;
  }, [safeDuration]);

  /* ---- Pointer scrubbing for progress bar ---- */
  const onProgressPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* ignore */ }

    const target = calculateTimeFromEvent(e);
    setIsDragging(true);
    setDragTime(target);
    seek(target);
  };

  const onProgressPointerMove = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    const target = calculateTimeFromEvent(e);
    setDragTime(target);
  };

  const onProgressPointerUp = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    const target = calculateTimeFromEvent(e);
    setIsDragging(false);
    seek(target);
  };

  const onProgressPointerCancel = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    setIsDragging(false);
  };

  const onProgressKeyDown = (e) => {
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

  /* ---- Always render the bar shell so the layout is stable.
         When no song is selected, render an invisible placeholder. ---- */
  if (!current) {
    return <div className="playerbar playerbar--empty" aria-hidden="true" />;
  }

  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
  const displayTime = isDragging ? dragTime : safeCurrentTime;
  const pct = safeDuration > 0 ? Math.max(0, Math.min(100, (displayTime / safeDuration) * 100)) : 0;

  const title = current.title || 'Unknown Track';
  const artistName = current.artist_name || 'Unknown Artist';
  const artistId = current.artist_id;
  const coverSrc = current.cover_url || current.album_cover || null;
  const isFav = !!current.is_favorite;

  return (
    <div
      className="playerbar playerbar--tappable"
      onClick={onBarClick}
      onTouchStart={onBarTouchStart}
      onTouchEnd={onBarTouchEnd}
      title="Open Now Playing"
    >
      <NowPlaying open={expanded} onClose={closeExpanded} />
      <div className="player-left">
        <span className="expand-hint" aria-hidden="true"><Icon name="chevronDown" size={16} className="flip-up" /></span>
        <Cover src={coverSrc} alt={title} size={48} />
        <div className="player-meta">
          <span className="player-title">{title}</span>
          {artistId ? (
            <Link to={`/artists/${artistId}`} className="player-artist">{artistName}</Link>
          ) : (
            <span className="player-artist">{artistName}</span>
          )}
        </div>
        <button
          className={`icon-btn icon-btn-sm fav-btn ${isFav ? 'active' : ''}`}
          onClick={() => { try { toggleFavorite(current); } catch { /* ignore */ } }}
          aria-label="Favorite"
        >
          <Icon name={isFav ? 'heartFill' : 'heart'} size={18} />
        </button>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button
            className={`icon-btn ${shuffle ? 'active-ctl' : ''}`}
            onClick={() => setShuffle(!shuffle)}
            title="Shuffle"
            aria-label="Shuffle"
          >
            <Icon name="shuffle" size={18} />
          </button>
          <button
            className="icon-btn"
            onClick={() => { try { prev(); } catch { /* ignore */ } }}
            title="Previous"
            aria-label="Previous"
          >
            <Icon name="prev" size={20} />
          </button>
          <button
            className="icon-btn"
            onClick={() => seekRelative(-10)}
            title="Rewind 10 seconds"
            aria-label="Rewind 10 seconds"
          >
            <Icon name="skipBack10" size={18} />
          </button>
          <button
            className="play-btn"
            onClick={() => { try { togglePlay(); } catch { /* ignore */ } }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Icon name="pause" size={22} /> : <Icon name="play" size={22} />}
          </button>
          <button
            className="icon-btn"
            onClick={() => seekRelative(10)}
            title="Forward 10 seconds"
            aria-label="Forward 10 seconds"
          >
            <Icon name="skipForward10" size={18} />
          </button>
          <button
            className="icon-btn"
            onClick={() => { try { next(); } catch { /* ignore */ } }}
            title="Next"
            aria-label="Next"
          >
            <Icon name="next" size={20} />
          </button>
          <button
            className={`icon-btn ${repeat ? 'active-ctl' : ''}`}
            onClick={() => setRepeat(!repeat)}
            title="Repeat"
            aria-label="Repeat"
          >
            <Icon name="repeat" size={18} />
          </button>
        </div>
        {error && <div className="player-error" role="status">{error}</div>}
        <div className="progress-row" onClick={(e) => e.stopPropagation()}>
          <span className="progress-time">{formatDuration(displayTime)}</span>
          <div
            className={`progress-bar ${isDragging ? 'is-dragging' : ''}`}
            ref={barRef}
            onPointerDown={onProgressPointerDown}
            onPointerMove={onProgressPointerMove}
            onPointerUp={onProgressPointerUp}
            onPointerCancel={onProgressPointerCancel}
            onKeyDown={onProgressKeyDown}
            role="slider"
            tabIndex={0}
            aria-label="Seek track position"
            aria-valuemin={0}
            aria-valuemax={Math.round(safeDuration)}
            aria-valuenow={Math.round(displayTime)}
            aria-valuetext={`${formatDuration(displayTime)} of ${formatDuration(safeDuration)}`}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
            <div className="progress-thumb" style={{ left: `${pct}%` }} />
          </div>
          <span className="progress-time">{formatDuration(safeDuration)}</span>
        </div>
      </div>

      <div className="player-right">
        <button
          className="icon-btn icon-btn-sm"
          onClick={() => { try { downloadSong(current, toast); } catch { /* ignore */ } }}
          title="Download"
          aria-label="Download"
        >
          <Icon name="download" size={18} />
        </button>
        <div className="vol-slider-wrap">
          <Icon name="volume" size={17} className="vol-icon" />
          <input
            type="range" min="0" max="1" step="0.01" value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="volume-slider"
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}
