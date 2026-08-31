import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Cover, EmptyState } from './ui.jsx';

/* Horizontal, Spotify-style scrolling row of track cards. Reused on the Home
   page and on detail pages for "Recommended / More from artist" sections. */
export default function DiscoverRow({ title, songs, onPlay, seeAll }) {
  if (!songs || !songs.length) return null;
  return (
    <section className="discover-section">
      <div className="discover-head">
        <h2>{title}</h2>
        {seeAll && <Link to={seeAll} className="see-all">See all</Link>}
      </div>
      <div className="discover-row">
        {songs.slice(0, 10).map((song, i) => (
          <button key={song.id} className="discover-card" onClick={() => onPlay(songs, i)}>
            <div className="disc-card-cover">
              <Cover src={song.cover_url || song.album_cover} alt={song.title} size="100%" />
              <span className="disc-card-play"><Icon name="play" size={18} /></span>
            </div>
            <span className="disc-card-title">{song.title}</span>
            <span className="disc-card-artist">{song.artist_name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* Compact horizontal row used when a page already has its own grid */
export function MiniTrackList({ songs, onPlay }) {
  if (!songs || !songs.length) return null;
  return (
    <div className="mini-track-list">
      {songs.map((song, i) => (
        <button key={song.id} className="mini-track" onClick={() => onPlay(songs, i)}>
          <Cover src={song.cover_url || song.album_cover} alt={song.title} size={40} />
          <span className="mini-track-info">
            <span className="mini-track-title">{song.title}</span>
            <span className="mini-track-artist">{song.artist_name}</span>
          </span>
          <Icon name="play" size={15} className="mini-track-play" />
        </button>
      ))}
    </div>
  );
}
