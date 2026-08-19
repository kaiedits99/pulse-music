import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Skeleton, EmptyState } from '../components/ui.jsx';
import { Cover } from '../components/ui.jsx';
import { api } from '../api.js';
import { formatNumber, formatDuration } from '../format.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

function StatCard({ icon, label, value, accent, loading }) {
  return (
    <div className={`stat-card ${accent || ''}`}>
      <div className="stat-icon"><Icon name={icon} size={20} /></div>
      {loading ? <Skeleton w={70} h={26} /> : <div className="stat-value">{value}</div>}
      <div className="stat-label">{label}</div>
    </div>
  );
}

function TopTrack({ song, i, onPlay }) {
  return (
    <button className="top-track" onClick={onPlay}>
      <span className="top-rank">{i + 1}</span>
      <Cover src={song.cover_url} alt={song.title} size={44} />
      <span className="top-track-info">
        <span className="top-track-title">{song.title}</span>
        <span className="top-track-artist">{song.artist_name}</span>
      </span>
      <span className="top-track-plays"><Icon name="playCircle" size={15} /> {formatNumber(song.plays)}</span>
    </button>
  );
}

export default function Overview() {
  const { play } = usePlayer();
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get('/api/stats').then((d) => { if (alive) { setStats(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className="page">
      <div className="welcome">
        <div>
          <h1>{greeting}, {user ? user.name.split(' ')[0] : 'there'} 👋</h1>
          <p>Here's what's happening across your music platform today.</p>
        </div>
        <Link to="/upload" className="btn btn-primary"><Icon name="upload" size={17} /> Upload music</Link>
      </div>

      <div className="stats-grid">
        <StatCard icon="music" label="Tracks" value={stats ? stats.songs : null} loading={loading} accent="c1" />
        <StatCard icon="playCircle" label="Total plays" value={stats ? formatNumber(stats.plays) : null} loading={loading} accent="c2" />
        <StatCard icon="download" label="Downloads" value={stats ? formatNumber(stats.downloads) : null} loading={loading} accent="c3" />
        <StatCard icon="artist" label="Artists" value={stats ? stats.artists : null} loading={loading} accent="c4" />
        <StatCard icon="album" label="Albums" value={stats ? stats.albums : null} loading={loading} accent="c5" />
        <StatCard icon="playlist" label="Playlists" value={stats ? stats.playlists : null} loading={loading} accent="c6" />
      </div>

      <div className="overview-cols">
        <section className="panel">
          <div className="panel-head">
            <h3>Top tracks</h3>
            <Link to="/songs" className="link-more">View all</Link>
          </div>
          {loading ? (
            <div className="stack">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={52} />)}
            </div>
          ) : (
            <div className="top-list">
              {(stats?.top || []).map((s, i) => (
                <TopTrack key={s.id} song={s} i={i} onPlay={() => play(stats.top, i)} />
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Recently added</h3>
            <Link to="/songs" className="link-more">View all</Link>
          </div>
          {loading ? (
            <div className="stack">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={52} />)}
            </div>
          ) : (
            <div className="recent-list">
              {(stats?.recent || []).map((s, i) => (
                <button className="recent-row" key={s.id} onClick={() => play(stats.recent, i)}>
                  <Cover src={s.cover_url} alt={s.title} size={44} />
                  <span className="recent-info">
                    <span className="top-track-title">{s.title}</span>
                    <span className="top-track-artist">{s.artist_name} · {s.genre}</span>
                  </span>
                  <Icon name="play" size={16} className="recent-play" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Genres</h3>
        </div>
        {loading ? (
          <div className="genre-row"><Skeleton w="100%" h={90} /></div>
        ) : stats && stats.genres.length ? (
          <div className="genre-row">
            {stats.genres.map((g, i) => (
              <div className="genre-pill" key={g.genre} style={{ '--i': i }}>
                <span className="genre-name">{g.genre}</span>
                <span className="genre-count">{g.c} tracks</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No genres yet" description="Upload tracks to see genre insights." />
        )}
      </section>
    </div>
  );
}
