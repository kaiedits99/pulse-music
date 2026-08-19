import { useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Cover } from './ui.jsx';
import { formatDuration } from '../format.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFavoriteToggle, downloadSong } from './SongTable.jsx';

export default function PlayerBar() {
  const {
    current, isPlaying, togglePlay, next, prev, seek, currentTime, duration,
    volume, setVolume, shuffle, setShuffle, repeat, setRepeat
  } = usePlayer();
  const { toast } = useToast();
  const toggleFavorite = useFavoriteToggle();
  const barRef = useRef(null);

  if (!current) return null;

  const pct = duration ? (currentTime / duration) * 100 : 0;

  const seekFromEvent = (e) => {
    const rect = barRef.current.getBoundingClientRect();
    const p = (e.clientX - rect.left) / rect.width;
    seek(p * duration);
  };

  const onKey = (e) => {
    if (e.code === 'Space' && !e.target.closest('input,textarea,button,select')) {
      e.preventDefault();
      togglePlay();
    }
  };
  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div className="playerbar">
      <div className="player-left">
        <Cover src={current.cover_url || current.album_cover} alt={current.title} size={48} />
        <div className="player-meta">
          <span className="player-title">{current.title}</span>
          <Link to={`/artists/${current.artist_id}`} className="player-artist">{current.artist_name}</Link>
        </div>
        <button
          className={`icon-btn icon-btn-sm fav-btn ${current.is_favorite ? 'active' : ''}`}
          onClick={() => toggleFavorite(current)}
          aria-label="Favorite"
        >
          <Icon name={current.is_favorite ? 'heartFill' : 'heart'} size={18} />
        </button>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button className={`icon-btn ${shuffle ? 'active-ctl' : ''}`} onClick={() => setShuffle(!shuffle)} title="Shuffle"><Icon name="shuffle" size={18} /></button>
          <button className="icon-btn" onClick={prev} title="Previous"><Icon name="prev" size={20} /></button>
          <button className="play-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Icon name="pause" size={22} /> : <Icon name="play" size={22} />}
          </button>
          <button className="icon-btn" onClick={next} title="Next"><Icon name="next" size={20} /></button>
          <button className={`icon-btn ${repeat ? 'active-ctl' : ''}`} onClick={() => setRepeat(!repeat)} title="Repeat"><Icon name="clock" size={17} /></button>
        </div>
        <div className="progress-row">
          <span className="progress-time">{formatDuration(currentTime)}</span>
          <div className="progress-bar" ref={barRef} onMouseDown={seekFromEvent}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
            <div className="progress-thumb" style={{ left: `${pct}%` }} />
          </div>
          <span className="progress-time">{formatDuration(duration || current.duration_seconds)}</span>
        </div>
      </div>

      <div className="player-right">
        <button className="icon-btn icon-btn-sm" onClick={() => downloadSong(current, toast)} title="Download"><Icon name="download" size={18} /></button>
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
