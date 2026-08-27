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
    current, isPlaying, togglePlay, next, prev, seek, currentTime, duration,
    volume, setVolume, shuffle, setShuffle, repeat, setRepeat, error
  } = usePlayer();
  const { toast } = useToast();
  const toggleFavorite = useFavoriteToggle();
  const barRef = useRef(null);
  const swipeStartY = useRef(null);
  const [expanded, setExpanded] = useState(false);

  const openExpanded = useCallback(() => setExpanded(true), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);

  /* ---- Tap anywhere on the bar (except real controls) to expand ---- */
  const onBarClick = useCallback((e) => {
    if (e.target.closest('button, a, input, .progress-bar, .player-error')) return;
    openExpanded();
  }, [openExpanded]);

  /* ---- Swipe up on the bar to expand (mobile) ---- */
  const onBarTouchStart = useCallback((e) => { swipeStartY.current = e.touches[0].clientY; }, []);
  const onBarTouchEnd = useCallback((e) => {
    if (swipeStartY.current == null) return;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    swipeStartY.current = null;
    if (dy < -45) openExpanded();
  }, [openExpanded]);

  /* ---- Keyboard shortcut (space to toggle play) ---- */
  const onKey = useCallback((e) => {
    if (e.code === 'Space' && !e.target.closest('input,textarea,button,select')) {
      e.preventDefault();
      togglePlay();
    }
  }, [togglePlay]);

  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  /* ---- Seek from click on progress bar ---- */
  const seekFromEvent = useCallback((e) => {
    if (!barRef.current || !duration) return;
    const rect = barRef.current.getBoundingClientRect();
    if (!rect.width) return;
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(p * duration);
  }, [duration, seek]);

  /* ---- Always render the bar shell so the layout is stable.
         When no song is selected, render an invisible placeholder. ---- */
  if (!current) {
    return <div className="playerbar playerbar--empty" aria-hidden="true" />;
  }

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
  const pct = safeDuration ? (safeCurrentTime / safeDuration) * 100 : 0;

  const title = current.title || 'Unknown Track';
  const artistName = current.artist_name || 'Unknown Artist';
  const artistId = current.artist_id;
  const coverSrc = current.cover_url || current.album_cover || null;
  const isFav = !!current.is_favorite;
  const fallbackDur = Number.isFinite(current.duration_seconds) ? current.duration_seconds : 0;

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
          <button className={`icon-btn ${shuffle ? 'active-ctl' : ''}`} onClick={() => setShuffle(!shuffle)} title="Shuffle"><Icon name="shuffle" size={18} /></button>
          <button className="icon-btn" onClick={() => { try { prev(); } catch { /* ignore */ } }} title="Previous"><Icon name="prev" size={20} /></button>
          <button className="play-btn" onClick={() => { try { togglePlay(); } catch { /* ignore */ } }} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Icon name="pause" size={22} /> : <Icon name="play" size={22} />}
          </button>
          <button className="icon-btn" onClick={() => { try { next(); } catch { /* ignore */ } }} title="Next"><Icon name="next" size={20} /></button>
          <button className={`icon-btn ${repeat ? 'active-ctl' : ''}`} onClick={() => setRepeat(!repeat)} title="Repeat"><Icon name="repeat" size={18} /></button>
        </div>
        {error && <div className="player-error" role="status">{error}</div>}
        <div className="progress-row">
          <span className="progress-time">{formatDuration(safeCurrentTime)}</span>
          <div className="progress-bar" ref={barRef} onMouseDown={seekFromEvent}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
            <div className="progress-thumb" style={{ left: `${pct}%` }} />
          </div>
          <span className="progress-time">{formatDuration(safeDuration || fallbackDur)}</span>
        </div>
      </div>

      <div className="player-right">
        <button className="icon-btn icon-btn-sm" onClick={() => { try { downloadSong(current, toast); } catch { /* ignore */ } }} title="Download"><Icon name="download" size={18} /></button>
        <Icon name="volume" size={17} className="vol-icon" />
        <input
          type="range" min="0" max="1" step="0.01" value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="volume-slider"
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
