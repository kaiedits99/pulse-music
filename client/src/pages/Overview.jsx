import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Skeleton } from '../components/ui.jsx';
import { AlbumCard, ArtistCard } from '../components/Cards.jsx';
import DiscoverRow from '../components/DiscoverRow.jsx';
import { api } from '../api.js';
import { formatNumber } from '../format.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/* Spotify-style colorful mood tiles for the "Browse all" grid */
const MOOD_COLORS = [
  ['#1e3a8a', '#7c3aed'], ['#064e3b', '#10b981'], ['#7f1d1d', '#f43f5e'],
  ['#0c4a6e', '#0ea5e9'], ['#581c87', '#d946ef'], ['#78350f', '#f59e0b'],
  ['#831843', '#ec4899'], ['#14532d', '#22c55e'], ['#1e293b', '#64748b']
];

function GenreTile({ genre, color, count }) {
  return (
    <Link to={`/songs?genre=${encodeURIComponent(genre)}`} className="genre-tile" style={{ background: `linear-gradient(135deg, ${color[0]} 0%, ${color[1]} 100%)` }}>
      <span className="genre-tile-name">{genre}</span>
      <Icon name="music" size={40} className="genre-tile-art" />
      {count != null && <span className="genre-tile-count">{count} tracks</span>}
    </Link>
  );
}

/* Compact stat pill used in the stats strip */
function StatPill({ icon, value, label, accent }) {
  return (
    <div className="stat-pill">
      <span className={`stat-pill-icon ${accent || ''}`}><Icon name={icon} size={16} /></span>
      <span className="stat-pill-meta">
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

export default function Overview() {
  const { play } = usePlayer();
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get('/api/stats').then((d) => {
      if (alive) {
        setStats(d);
        setLoading(false);
      }
    }).catch(() => { if (alive) setLoading(false); });
    api.get('/api/albums').then((d) => { if (alive) setAlbums(d || []); }).catch(() => {});
    api.get('/api/artists').then((d) => { if (alive) setArtists(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const firstName = user?.name ? user.name.split(' ')[0] : 'there';
  const recommended = stats?.recommended || [];
  const top = stats?.top || [];
  const recent = stats?.recent || [];
  const genres = stats?.genres || [];
  const genreTiles = genres.slice(0, 9);

  return (
    <div className="page home-page">
      {/* ============ Hero greeting banner ============ */}
      <div className="home-hero">
        <div className="home-hero-glow" aria-hidden="true" />
        <div className="home-hero-content">
          <div>
            <span className="hero-eyebrow"><Icon name="wave" size={14} /> Pulse · Made for you</span>
            <h1>{greeting}, {firstName}</h1>
            <p>{user?.username ? `@${user.username} · ` : ''}Here's your music universe for today.</p>
          </div>
          {recommended.length > 0 && (
            <button className="btn hero-play-btn" onClick={() => play(recommended, 0)}>
              <Icon name="play" size={18} /> Shuffle
            </button>
          )}
        </div>
      </div>

      {/* ============ Made for you ============ */}
      <DiscoverRow title="Made for you" songs={recommended} onPlay={play} />

      {/* ============ Quick picks ============ */}
      {genreTiles.length > 0 && (
        <section className="discover-section">
          <div className="discover-head">
            <h2>Browse all</h2>
            <Link to="/songs" className="see-all">See all</Link>
          </div>
          <div className="genre-tile-grid">
            {genreTiles.map((g, i) => (
              <GenreTile key={g.genre} genre={g.genre} color={MOOD_COLORS[i % MOOD_COLORS.length]} count={g.c} />
            ))}
          </div>
        </section>
      )}

      {/* ============ Recently played ============ */}
      <DiscoverRow title="Recently played" songs={recent} onPlay={play} />

      {/* ============ Top tracks ============ */}
      <DiscoverRow title="Top tracks this week" songs={top} onPlay={play} />

      {/* ============ Albums & artists ============ */}
      {albums.length > 0 && (
        <section className="discover-section">
          <div className="discover-head"><h2>Albums you might like</h2><Link to="/albums" className="see-all">See all</Link></div>
          <div className="discover-row">
            {albums.slice(0, 8).map((album) => <AlbumCard key={album.id} album={album} />)}
          </div>
        </section>
      )}
      {artists.length > 0 && (
        <section className="discover-section">
          <div className="discover-head"><h2>Popular artists</h2><Link to="/artists" className="see-all">See all</Link></div>
          <div className="discover-row">
            {artists.slice(0, 8).map((artist) => <ArtistCard key={artist.id} artist={artist} />)}
          </div>
        </section>
      )}

      {/* ============ Your stats (kept — compact) ============ */}
      <section className="panel home-stats-panel">
        <div className="panel-head">
          <h3><Icon name="trending" size={16} /> Your platform stats</h3>
          <Link to="/songs" className="link-more">Manage library</Link>
        </div>
        <div className="stats-strip">
          <StatPill icon="music" value={loading ? '—' : (stats?.songs ?? 0)} label="Tracks" accent="c1" />
          <StatPill icon="playCircle" value={loading ? '—' : formatNumber(stats?.plays ?? 0)} label="Total plays" accent="c2" />
          <StatPill icon="download" value={loading ? '—' : formatNumber(stats?.downloads ?? 0)} label="Downloads" accent="c3" />
          <StatPill icon="artist" value={loading ? '—' : (stats?.artists ?? 0)} label="Artists" accent="c4" />
          <StatPill icon="album" value={loading ? '—' : (stats?.albums ?? 0)} label="Albums" accent="c5" />
          <StatPill icon="playlist" value={loading ? '—' : (stats?.playlists ?? 0)} label="Playlists" accent="c6" />
        </div>
      </section>

      {/* loading skeleton for rows */}
      {loading && (
        <div className="stack">
          <Skeleton h={90} />
          <Skeleton h={200} />
        </div>
      )}
    </div>
  );
}
