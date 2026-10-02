import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Cover } from './ui.jsx';
import { formatNumber, timeAgo, plural } from '../format.js';

/**
 * The card from the Pulse design: square (or round) artwork with a type badge,
 * a hover play button, a title, a subtitle and a small uppercase meta line.
 *
 * Every card is a real link; the play button is a separate button so clicking
 * it starts playback without navigating.
 */
export function CollectionCard({
  to,
  type,
  typeTone = '',
  cover,
  round = false,
  title,
  subtitle,
  meta,              // { icon?, dot?, text, tone? } | null
  chip,              // string shown as a pill instead of / below the meta line
  onPlay,            // () => void — renders the hover play button when provided
  actions,           // optional node rendered top-right on hover
  playLabel = 'Play'
}) {
  const Wrapper = to ? Link : 'div';
  const wrapperProps = to ? { to } : {};

  return (
    <div className="collection-card">
      <Wrapper {...wrapperProps} className="cc-art-link" style={{ display: 'contents' }}>
        <div className={`cc-art ${round ? 'cc-art--round' : ''}`}>
          {type && <span className={`cc-type ${typeTone}`}>{type}</span>}
          <Cover src={cover} alt={title} size="100%" round={round} />
          {onPlay && (
            <button
              className="cc-play"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlay(); }}
              aria-label={playLabel}
              title={playLabel}
            >
              <Icon name="play" size={18} />
            </button>
          )}
        </div>
        <div className="cc-body">
          <span className="cc-title">{title}</span>
          {subtitle && <span className="cc-sub">{subtitle}</span>}
          {meta && (
            <span className={`cc-meta ${meta.tone || ''}`}>
              {meta.dot ? <span className="cc-meta-dot" /> : meta.icon ? <Icon name={meta.icon} size={12} /> : null}
              {meta.text}
            </span>
          )}
          {chip && <span className="cc-meta-chip">{chip}</span>}
        </div>
      </Wrapper>
      {actions && <div className="cc-actions">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ album */
export function AlbumCard({ album, onPlay, actions }) {
  return (
    <CollectionCard
      to={`/albums/${album.id}`}
      type="Album"
      cover={album.cover_url}
      title={album.title}
      subtitle={`${album.artist_name || 'Unknown artist'}${album.release_year ? ` • ${album.release_year}` : ''}`}
      meta={{ icon: 'disc', text: plural(album.track_count, 'track') }}
      onPlay={onPlay ? () => onPlay(album) : undefined}
      playLabel={`Play ${album.title}`}
      actions={actions}
    />
  );
}

/* ----------------------------------------------------------------- artist */
export function ArtistCard({ artist, onPlay, actions }) {
  return (
    <CollectionCard
      to={`/artists/${artist.id}`}
      type="Artist"
      cover={artist.avatar_url}
      round
      title={artist.name}
      subtitle={`${artist.genre || 'Artist'} • ${formatNumber(artist.followers)} listeners`}
      meta={{ icon: 'music', text: plural(artist.song_count, 'track') }}
      onPlay={onPlay ? () => onPlay(artist) : undefined}
      playLabel={`Play ${artist.name}`}
      actions={actions}
    />
  );
}

/* --------------------------------------------------------------- playlist */
export function PlaylistCard({ playlist, onPlay, onDelete, downloaded }) {
  return (
    <CollectionCard
      to={`/playlists/${playlist.id}`}
      type="Playlist"
      typeTone="accent"
      cover={playlist.cover_url}
      title={playlist.name}
      subtitle={playlist.creator_name ? `By ${playlist.creator_name} • ${plural(playlist.track_count, 'song')}` : plural(playlist.track_count, 'song')}
      meta={downloaded
        ? { icon: 'download', text: 'Downloaded', tone: 'green' }
        : { icon: 'clock', text: playlist.created_at ? timeAgo(playlist.created_at) : 'Playlist' }}
      onPlay={onPlay ? () => onPlay(playlist) : undefined}
      playLabel={`Play ${playlist.name}`}
      actions={onDelete && (
        <button className="icon-btn icon-btn-sm danger" onClick={(e) => { e.preventDefault(); onDelete(playlist); }} aria-label="Delete playlist">
          <Icon name="trash" size={15} />
        </button>
      )}
    />
  );
}

/* ------------------------------------------------------------------ track */
export function TrackCard({ song, onPlay, badge }) {
  return (
    <CollectionCard
      type={badge || 'Track'}
      cover={song.cover_url || song.album_cover}
      title={song.title}
      subtitle={song.artist_name}
      meta={song.genre ? { icon: 'wave', text: song.genre } : { icon: 'playCircle', text: `${formatNumber(song.plays)} plays` }}
      onPlay={onPlay}
      playLabel={`Play ${song.title}`}
    />
  );
}

/* ---------------------------------------------------------- list row view */
export function LibraryRow({ to, cover, round, title, subtitle, meta, metaTone, onPlay, actions }) {
  const Wrapper = to ? Link : 'div';
  const wrapperProps = to ? { to } : {};
  return (
    <Wrapper {...wrapperProps} className="library-row">
      <div className={`library-row-art ${round ? 'round' : ''}`}>
        <Cover src={cover} alt={title} size="100%" round={round} />
      </div>
      <div className="library-row-body">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      {meta && <span className={`library-row-meta ${metaTone || ''}`}>{meta}</span>}
      <div className="library-row-actions">
        {onPlay && (
          <button
            className="icon-btn"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlay(); }}
            aria-label={`Play ${title}`}
            title={`Play ${title}`}
          >
            <Icon name="play" size={17} />
          </button>
        )}
        {actions}
      </div>
    </Wrapper>
  );
}
