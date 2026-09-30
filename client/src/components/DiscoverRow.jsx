import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Cover, SectionHead } from './ui.jsx';
import { CollectionCard } from './Cards.jsx';
import { formatNumber } from '../format.js';

/** Horizontal, snap-scrolling row of track cards. */
export default function DiscoverRow({ title, icon, songs, onPlay, seeAll, note }) {
  if (!songs || !songs.length) return null;

  return (
    <section className="section">
      <SectionHead
        icon={icon}
        title={title}
        note={note}
        action={seeAll && <Link to={seeAll} className="see-all">Show all</Link>}
      />
      <div className="discover-row scroll-thin">
        {songs.slice(0, 12).map((song, i) => (
          <CollectionCard
            key={song.id ?? i}
            type="Track"
            cover={song.cover_url || song.album_cover}
            title={song.title}
            subtitle={song.artist_name}
            meta={{ icon: 'playCircle', text: `${formatNumber(song.plays)} plays` }}
            onPlay={() => onPlay(songs, i)}
            playLabel={`Play ${song.title}`}
          />
        ))}
      </div>
    </section>
  );
}

/** Compact vertical list used where a full grid would be too heavy. */
export function MiniTrackList({ songs, onPlay }) {
  if (!songs || !songs.length) return null;
  return (
    <div className="library-list">
      {songs.map((song, i) => (
        <button key={song.id} className="library-row" onClick={() => onPlay(songs, i)}>
          <div className="library-row-art">
            <Cover src={song.cover_url || song.album_cover} alt={song.title} size="100%" />
          </div>
          <div className="library-row-body">
            <strong>{song.title}</strong>
            <small>{song.artist_name}</small>
          </div>
          <span className="library-row-actions">
            <Icon name="play" size={16} />
          </span>
        </button>
      ))}
    </div>
  );
}
