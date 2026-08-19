import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Cover } from './ui.jsx';
import { formatNumber } from '../format.js';

export function AlbumCard({ album, onPlay }) {
  return (
    <div className="media-card">
      <Link to={`/albums/${album.id}`} className="media-cover">
        <Cover src={album.cover_url} alt={album.title} size="100%" />
        <button className="cover-play" onClick={(e) => { e.preventDefault(); onPlay && onPlay(album); }} aria-label="Play">
          <Icon name="play" size={20} />
        </button>
      </Link>
      <Link to={`/albums/${album.id}`} className="media-title">{album.title}</Link>
      <Link to={`/artists/${album.artist_id}`} className="media-sub">{album.artist_name}</Link>
      <div className="media-meta">{album.release_year} · {album.track_count || 0} tracks</div>
    </div>
  );
}

export function ArtistCard({ artist }) {
  return (
    <div className="media-card artist-card">
      <Link to={`/artists/${artist.id}`} className="media-cover cover-round-wrap">
        <Cover src={artist.avatar_url} alt={artist.name} size="100%" round />
      </Link>
      <Link to={`/artists/${artist.id}`} className="media-title">{artist.name}</Link>
      <div className="media-sub">{artist.genre}</div>
      <div className="media-meta">{formatNumber(artist.followers)} followers</div>
    </div>
  );
}

export function PlaylistCard({ playlist, onDelete }) {
  return (
    <div className="media-card">
      <Link to={`/playlists/${playlist.id}`} className="media-cover">
        <Cover src={playlist.cover_url} alt={playlist.name} size="100%" />
        <div className="cover-count"><Icon name="playlist" size={14} />{playlist.track_count}</div>
      </Link>
      <div className="media-title-row">
        <Link to={`/playlists/${playlist.id}`} className="media-title">{playlist.name}</Link>
        {onDelete && (
          <button className="icon-btn icon-btn-sm" onClick={() => onDelete(playlist)} aria-label="Delete playlist">
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
      <div className="media-sub">{playlist.track_count} tracks</div>
    </div>
  );
}
