import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import WaveformSeekbar from './WaveformSeekbar.jsx';
import { Cover } from './ui.jsx';
import { formatDuration } from '../format.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFavorites, isLikeable } from '../context/FavoritesContext.jsx';
import { isEpisode } from '../episodes.js';
import { useEpisodeSaveToggle } from '../hooks/useEpisodeActions.js';
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
    isLinked, videoMode, setVideoMode,
    currentTime, duration, shuffle, setShuffle, repeat, setRepeat, play, error
  } = usePlayer();

  const { toast } = useToast();
  const { isLiked, toggleLike } = useFavorites();
  const toggleEpisodeSave = useEpisodeSaveToggle();
  const { open: openAddToPlaylist, dialog: addDialog } = useAddToPlaylistDialog();

  const [previewTime, setPreviewTime] = useState(null);
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

  if (!open || !current) return null;

  const displayTime = previewTime != null ? previewTime : (Number.isFinite(currentTime) ? currentTime : 0);
  const isFav = isLiked(current);
  const isEp = isEpisode(current);
  const isLocal = current.kind === 'local';
  const isOfflineOnly = isLocal || !!current.offline_only;
  const epSaved = !!current.saved;
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
        {isOfflineOnly ? (
          <span className="np-local-label"><Icon name={isLocal ? 'headphones' : 'download'} size={15} /> {isLocal ? 'Device' : 'Offline'}</span>
        ) : isEp ? (
          <button
            className="icon-btn"
            onClick={() => toggleEpisodeSave(current)}
            aria-label={epSaved ? 'Remove from Your Episodes' : 'Save episode for later'}
            title={epSaved ? 'Remove from Your Episodes' : 'Save episode for later'}
          >
            <Icon name={epSaved ? 'checkCircle' : 'plus'} size={20} />
          </button>
        ) : (
          <button className="icon-btn" onClick={() => openAddToPlaylist(current)} aria-label="Add to playlist" title="Add to playlist">
            <Icon name="plus" size={20} />
          </button>
        )}
      </header>

      <div className="np-body">
        {/* A linked track has no artwork of ours to show: the video is the artwork.
            Its player floats above this sheet (see PlayerBar), so leave room for it. */}
        {isLinked ? (
          <div className="np-art np-art--linked">
            <div className="np-linked-inner">
              <Icon name="external" size={30} />
              <strong>Playing from YouTube</strong>
              <span>This track is linked, not uploaded. It plays in YouTube's own player and can't be downloaded for offline listening.</span>
              {videoMode !== 'theater' && (
                <button className="btn btn-primary btn-pill" onClick={() => setVideoMode('theater')}>
                  <Icon name="expand" size={16} /> Open the video
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="np-art">
            <Cover src={current.cover_url || current.album_cover} alt={current.title} size="100%" />
          </div>
        )}

        <div className="np-meta">
          <h2>{current.title}</h2>
          {isEp && current.podcast_id ? (
            <Link to={`/podcasts/${current.podcast_id}`} onClick={onClose}>{current.artist_name}</Link>
          ) : current.artist_id ? (
            <Link to={`/artists/${current.artist_id}`} onClick={onClose}>{current.artist_name}</Link>
          ) : (
            <span className="np-artist">{current.artist_name}</span>
          )}
        </div>

        <div className="np-progress">
          <div className="progress-row">
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
          {isOfflineOnly ? (
            <span className="tag tag-local"><Icon name={isLocal ? 'headphones' : 'download'} size={14} /> {isLocal ? 'Local file' : 'Saved offline'}</span>
          ) : (
            <>
              {isEp ? (
                <button className={`btn btn-sm ${epSaved ? 'btn-soft' : 'btn-ghost'}`} onClick={() => toggleEpisodeSave(current)}>
                  <Icon name={epSaved ? 'checkCircle' : 'plus'} size={16} />
                  {epSaved ? 'Saved' : 'Save episode'}
                </button>
              ) : isLikeable(current) && (
                <button
                  type="button"
                  className={`btn btn-sm ${isFav ? 'btn-soft' : 'btn-ghost'}`}
                  onClick={() => toggleLike(current)}
                  aria-pressed={isFav}
                >
                  <Icon name={isFav ? 'heartFill' : 'heart'} size={16} />
                  {isFav ? 'Liked' : 'Like'}
                </button>
              )}
              {isLinked ? (
                <a
                  className="btn btn-sm btn-ghost"
                  href={`https://www.youtube.com/watch?v=${current.external_id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Icon name="external" size={16} /> Watch on YouTube
                </a>
              ) : (
                <button className={`btn btn-sm ${downloaded ? 'btn-downloaded' : 'btn-ghost'}`} onClick={toggleOffline}>
                  <Icon name={downloaded ? 'checkCircle' : 'download'} size={16} />
                  {downloaded ? 'Downloaded' : 'Download'}
                </button>
              )}
            </>
          )}
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
