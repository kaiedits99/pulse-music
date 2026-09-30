import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Cover } from './ui.jsx';
import { formatDuration, formatNumber, timeAgo } from '../format.js';
import { progressPercent, resumeAt } from '../episodes.js';

/**
 * One podcast episode. Used by the Podcasts hub, a show page and the saved
 * "Your Episodes" list, so every affordance is optional and driven by props.
 */
export default function EpisodeRow({
  episode,
  isCurrent = false,
  isPlaying = false,
  onPlay,
  onToggleSave,
  onDownload,
  onDelete,
  canManage = false,
  showLink = true
}) {
  if (!episode) return null;

  const pct = progressPercent(episode);
  const resume = resumeAt(episode);
  const remaining = Math.max(0, (episode.duration_seconds || 0) - (episode.position_seconds || 0));
  const playing = isCurrent && isPlaying;

  const playLabel = playing ? 'Playing'
    : episode.completed ? 'Play again'
      : resume > 0 ? `${formatDuration(remaining)} left`
        : 'Play';

  return (
    <article className={`episode-row ${isCurrent ? 'is-current' : ''}`}>
      <button
        type="button"
        className="ep-art"
        onClick={() => onPlay && onPlay(episode)}
        aria-label={playing ? `Pause ${episode.title}` : `Play ${episode.title}`}
      >
        <Cover src={episode.cover_url} alt={episode.title} size="100%" />
        <span className="ep-art-play"><Icon name={playing ? 'pause' : 'play'} size={18} /></span>
      </button>

      <div className="ep-main">
        <div className="ep-eyebrow">
          {showLink && episode.podcast_id ? (
            <Link to={`/podcasts/${episode.podcast_id}`}>{episode.podcast_title || 'Podcast'}</Link>
          ) : (
            <span>{episode.episode_number ? `Episode ${episode.episode_number}` : 'Episode'}</span>
          )}
          {episode.published_at && (
            <><span className="cc-meta-dot" />{timeAgo(episode.published_at) || 'Recently'}</>
          )}
          {showLink && episode.episode_number ? (
            <><span className="cc-meta-dot" />Ep {episode.episode_number}</>
          ) : null}
        </div>

        <h4 className="ep-title">{episode.title}</h4>
        {episode.description && <p className="ep-desc">{episode.description}</p>}

        <div className="ep-foot">
          <button
            type="button"
            className={`ep-play-btn ${playing ? 'is-playing' : ''}`}
            onClick={() => onPlay && onPlay(episode)}
          >
            <Icon name={playing ? 'pause' : 'play'} size={15} />
            <span>{playLabel}</span>
          </button>

          <span className="ep-time">
            <Icon name="clock" size={13} /> {formatDuration(episode.duration_seconds || 0)}
          </span>

          {pct > 0 && !episode.completed && (
            <span className="ep-progress" title={`${Math.round(pct)}% played`} aria-hidden="true">
              <span className="ep-progress-fill" style={{ width: `${pct}%` }} />
            </span>
          )}
          {episode.completed ? <span className="tag tag-green">Played</span> : null}
          {episode.plays > 0 && <span className="ep-plays">{formatNumber(episode.plays)} plays</span>}

          <span className="ep-actions">
            {onToggleSave && (
              <button
                type="button"
                className={`icon-btn icon-btn-sm ${episode.saved ? 'on-green' : ''}`}
                onClick={() => onToggleSave(episode)}
                title={episode.saved ? 'Remove from Your Episodes' : 'Save for later'}
                aria-label={episode.saved ? 'Remove from Your Episodes' : 'Save for later'}
              >
                <Icon name={episode.saved ? 'checkCircle' : 'plus'} size={16} />
              </button>
            )}
            {onDownload && (
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => onDownload(episode)}
                title="Download episode"
                aria-label={`Download ${episode.title}`}
              >
                <Icon name="download" size={16} />
              </button>
            )}
            {canManage && onDelete && (
              <button
                type="button"
                className="icon-btn icon-btn-sm danger"
                onClick={() => onDelete(episode)}
                title="Delete episode"
                aria-label={`Delete ${episode.title}`}
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
