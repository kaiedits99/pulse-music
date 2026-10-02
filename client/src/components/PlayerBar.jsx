import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import NowPlaying from './NowPlaying.jsx';
import WaveformSeekbar from './WaveformSeekbar.jsx';
import { Cover } from './ui.jsx';
import { formatDuration } from '../format.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFavorites, isLikeable } from '../context/FavoritesContext.jsx';
import { useAddToPlaylistDialog } from './Forms.jsx';
import { isEpisode } from '../episodes.js';
import { useEpisodeSaveToggle } from '../hooks/useEpisodeActions.js';
import {
  downloadSong as saveOffline,
  removeSong as removeOffline,
  isSongDownloaded,
  hasPlayableAudio,
  OFFLINE_EVENT
} from '../offline.js';

/* `e.target` can be the document (keyboard events with nothing focused), which
   has no `closest` — guard so global shortcuts never throw. */
function matches(target, selector) {
  return !!(target && typeof target.closest === 'function' && target.closest(selector));
}
const inField = (target) => matches(target, 'input, textarea, select, [contenteditable="true"]');

export default function PlayerBar() {
  const {
    current, queue, isPlaying, togglePlay, next, prev, seek, seekRelative,
    currentTime, duration, volume, setVolume, shuffle, setShuffle,
    repeat, setRepeat, error
  } = usePlayer();

  const { toast } = useToast();
  const { isLiked, toggleLike } = useFavorites();
  const toggleEpisodeSave = useEpisodeSaveToggle();
  const { open: openAddToPlaylist, dialog: addDialog } = useAddToPlaylistDialog();

  const swipeStartY = useRef(null);
  const lastVolume = useRef(volume || 0.9);

  const [expanded, setExpanded] = useState(false);
  const [previewTime, setPreviewTime] = useState(null);
  const [likePop, setLikePop] = useState(false); // one-off "pop" when the person likes a track
  const [, setOfflineTick] = useState(0);

  useEffect(() => {
    const cb = () => setOfflineTick((t) => t + 1);
    window.addEventListener(OFFLINE_EVENT, cb);
    return () => window.removeEventListener(OFFLINE_EVENT, cb);
  }, []);

  const openExpanded = useCallback(() => setExpanded(true), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);

  /* ------------------------------------------------ keyboard shortcuts -- */
  const onKey = useCallback((e) => {
    if (inField(e.target)) return;
    switch (e.code) {
      case 'Space': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); seekRelative(-5); break;
      case 'ArrowRight': e.preventDefault(); seekRelative(5); break;
      default:
        if (e.key === 'j' || e.key === 'J') { e.preventDefault(); seekRelative(-10); }
        else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); seekRelative(10); }
        else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); togglePlay(); }
    }
  }, [togglePlay, seekRelative]);

  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  /* ------------------------------------------------------- interactions -- */
  const onBarClick = useCallback((e) => {
    if (matches(e.target, 'button, a, input, .progress-row, .waveform-seekbar, .volume-wrap, .player-error')) return;
    openExpanded();
  }, [openExpanded]);

  const onBarTouchStart = useCallback((e) => {
    if (matches(e.target, 'button, a, input, .progress-row, .waveform-seekbar')) { swipeStartY.current = null; return; }
    swipeStartY.current = e.touches[0].clientY;
  }, []);

  const onBarTouchEnd = useCallback((e) => {
    if (swipeStartY.current == null) return;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    swipeStartY.current = null;
    if (dy < -45) openExpanded();
  }, [openExpanded]);

  /* ----------------------------------------------------- timeline range -- */
  const safeDuration = Number.isFinite(duration) && duration > 0
    ? duration
    : (Number.isFinite(current?.duration_seconds) && current.duration_seconds > 0 ? current.duration_seconds : 0);

  /* ----------------------------------------------------------- actions -- */
  const toggleOffline = async () => {
    if (!current) return;
    if (isSongDownloaded(current.id)) {
      await removeOffline(current.id);
      toast('Removed from Downloads', 'info');
      return;
    }
    if (!hasPlayableAudio(current)) { toast('This track has no audio file to download yet', 'error'); return; }
    const res = await saveOffline(current);
    if (res === 'failed') toast('Download failed — check your connection', 'error');
    else toast(`Saved “${current.title}” for offline`);
  };

  const shareTrack = async () => {
    if (!current) return;
    const url = isEpisode(current) && current.podcast_id
      ? `${window.location.origin}/podcasts/${current.podcast_id}`
      : `${window.location.origin}/search?q=${encodeURIComponent(current.title)}`;
    const data = { title: current.title, text: `${current.title} — ${current.artist_name} on Pulse`, url };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    } catch {
      toast('Could not share this track', 'error');
    }
  };

  const toggleMute = () => {
    if (volume > 0) { lastVolume.current = volume; setVolume(0); }
    else setVolume(lastVolume.current || 0.9);
  };

  const cycleRepeat = () => setRepeat(!repeat);

  if (!current) return <div className="playerbar playerbar--empty" aria-hidden="true" />;

  const displayTime = previewTime != null ? previewTime : (Number.isFinite(currentTime) ? currentTime : 0);
  const isFav = isLiked(current);
  const isEp = isEpisode(current);
  const isLocal = current.kind === 'local';
  const isOfflineOnly = isLocal || !!current.offline_only;
  const epSaved = !!current.saved;
  const downloaded = isSongDownloaded(current.id);
  const volIcon = volume === 0 ? 'volumeMute' : volume < 0.45 ? 'volumeLow' : 'volume';

  return (
    <>
      <div
        className="playerbar playerbar--tappable"
        onClick={onBarClick}
        onTouchStart={onBarTouchStart}
        onTouchEnd={onBarTouchEnd}
      >
        {/* ---------------- left : track ---------------- */}
        <div className="player-left">
          <Cover src={current.cover_url || current.album_cover} alt={current.title} size={54} className="pl-art" />
          <div className="pl-meta">
            <span className="pl-title">
              {isEp && <span className="pl-kind">Episode</span>}
              {isLocal && <span className="pl-kind pl-kind--local">Device</span>}
              {!isLocal && isOfflineOnly && <span className="pl-kind pl-kind--local">Offline</span>}
              {current.title}
            </span>
            {isEp && current.podcast_id ? (
              <Link to={`/podcasts/${current.podcast_id}`} className="pl-artist" onClick={(e) => e.stopPropagation()}>
                {current.artist_name}
              </Link>
            ) : current.artist_id ? (
              <Link to={`/artists/${current.artist_id}`} className="pl-artist" onClick={(e) => e.stopPropagation()}>
                {current.artist_name}
              </Link>
            ) : (
              <span className="pl-artist">{current.artist_name}</span>
            )}
          </div>
          {isEp && !isOfflineOnly ? (
            <button
              className={`pl-mini-btn ${epSaved ? 'on-green' : ''}`}
              onClick={() => toggleEpisodeSave(current)}
              title={epSaved ? 'Remove from Your Episodes' : 'Save episode for later'}
              aria-label={epSaved ? 'Remove from Your Episodes' : 'Save episode for later'}
            >
              <Icon name={epSaved ? 'checkCircle' : 'plus'} size={18} />
            </button>
          ) : !isOfflineOnly ? (
            <>
              {isLikeable(current) && (
                <button
                  type="button"
                  className={`pl-mini-btn pl-like ${isFav ? 'on' : ''} ${likePop ? 'pop' : ''}`}
                  onClick={() => { if (!isFav) setLikePop(true); toggleLike(current); }}
                  onAnimationEnd={() => setLikePop(false)}
                  title={isFav ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                  aria-label="Like"
                  aria-pressed={isFav}
                >
                  <Icon name={isFav ? 'heartFill' : 'heart'} size={18} />
                </button>
              )}
              <button
                className="pl-mini-btn mobile-hide"
                onClick={() => openAddToPlaylist(current)}
                title="Add to playlist"
                aria-label="Add to playlist"
              >
                <Icon name="plus" size={18} />
              </button>
            </>
          ) : null}
        </div>

        {/* ---------------- center : transport ---------------- */}
        <div className="player-center">
          <div className="player-controls">
            <button
              className={`ctl-btn ${shuffle ? 'on' : ''}`}
              onClick={() => { setShuffle(!shuffle); toast(shuffle ? 'Shuffle off' : 'Shuffle on', 'info'); }}
              title="Shuffle"
              aria-label="Shuffle"
              aria-pressed={shuffle}
            >
              <Icon name="shuffle" size={18} />
            </button>
            <button
              className="ctl-btn"
              onClick={() => (isEp ? seekRelative(-15) : prev())}
              title={isEp ? 'Back 15 seconds' : 'Previous track'}
              aria-label={isEp ? 'Back 15 seconds' : 'Previous track'}
            >
              <Icon name={isEp ? 'skipBack15' : 'prev'} size={19} />
            </button>
            <button
              className="play-btn-lg"
              onClick={togglePlay}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} size={20} />
            </button>
            <button
              className="ctl-btn"
              onClick={() => (isEp ? seekRelative(30) : next())}
              title={isEp ? 'Forward 30 seconds' : 'Next track'}
              aria-label={isEp ? 'Forward 30 seconds' : 'Next track'}
            >
              <Icon name={isEp ? 'skipForward30' : 'next'} size={19} />
            </button>
            <button
              className={`ctl-btn ${repeat ? 'on' : ''}`}
              onClick={cycleRepeat}
              title="Repeat current track"
              aria-label="Repeat current track"
              aria-pressed={repeat}
            >
              <Icon name={repeat ? 'repeatOne' : 'repeat'} size={18} />
            </button>
          </div>

          {error && <div className="player-error" role="status">{error}</div>}

          <div className="progress-row" onClick={(e) => e.stopPropagation()}>
            <span className="progress-time">{formatDuration(displayTime)}</span>
            <WaveformSeekbar
              duration={safeDuration}
              currentTime={currentTime}
              onSeek={seek}
              onPreviewChange={setPreviewTime}
              seed={`${current.kind}:${current.id ?? current.title}`}
            />
            <span className="progress-time">{formatDuration(safeDuration)}</span>
          </div>
        </div>

        {/* ---------------- right : output ---------------- */}
        <div className="player-right" onClick={(e) => e.stopPropagation()}>
          <button
            className="player-mobile-play"
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={17} />
          </button>
          <button
            className="pl-mini-btn mobile-hide"
            onClick={openExpanded}
            title={`Queue — ${queue.length} track${queue.length === 1 ? '' : 's'}`}
            aria-label="Open queue"
          >
            <Icon name="queue" size={18} />
          </button>
          {!isOfflineOnly && (
            <button
              className={`pl-mini-btn ${downloaded ? 'on-green' : ''}`}
              onClick={toggleOffline}
              title={downloaded ? 'Remove download' : 'Download for offline'}
              aria-label={downloaded ? 'Remove download' : 'Download for offline'}
            >
              <Icon name={downloaded ? 'checkCircle' : 'download'} size={18} />
            </button>
          )}
          {!isOfflineOnly && (
            <button className="pl-mini-btn mobile-hide" onClick={shareTrack} title="Share track" aria-label="Share track">
              <Icon name="share" size={17} />
            </button>
          )}

          <div className="volume-wrap">
            <button className="pl-mini-btn" onClick={toggleMute} title={volume === 0 ? 'Unmute' : 'Mute'} aria-label={volume === 0 ? 'Unmute' : 'Mute'}>
              <Icon name={volIcon} size={17} />
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="volume-slider"
              style={{ '--vol': `${volume * 100}%` }}
              aria-label="Volume"
            />
          </div>

          <button className="pl-mini-btn" onClick={openExpanded} title="Full screen player" aria-label="Full screen player">
            <Icon name="expand" size={17} />
          </button>
        </div>
      </div>

      <NowPlaying open={expanded} onClose={closeExpanded} />
      {addDialog}
    </>
  );
}
