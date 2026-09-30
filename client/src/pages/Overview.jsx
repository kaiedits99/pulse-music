import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import DiscoverRow from '../components/DiscoverRow.jsx';
import { AlbumCard, ArtistCard, CollectionCard } from '../components/Cards.jsx';
import { SectionHead, GridSkeleton, StatTile, EmptyState } from '../components/ui.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatNumber } from '../format.js';
import { episodesToTracks, resumeAt } from '../episodes.js';

const MOOD_COLORS = [
  ['#5b21b6', '#a855f7'], ['#065f46', '#22c55e'], ['#9f1239', '#fb7185'],
  ['#075985', '#38bdf8'], ['#6b21a8', '#d946ef'], ['#92400e', '#f59e0b'],
  ['#9d174d', '#ec4899'], ['#166534', '#4ade80'], ['#3730a3', '#818cf8']
];

export default function Overview() {
  const { play } = usePlayer();
  const { user, artist } = useAuth();
  const { toast } = useToast();

  const [stats, setStats] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [podcasts, setPodcasts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/api/stats').catch(() => null),
      api.get('/api/albums').catch(() => []),
      api.get('/api/artists').catch(() => []),
      api.get('/api/playlists').catch(() => []),
      api.get('/api/podcasts?sort=popular').catch(() => ({ podcasts: [] }))
    ]).then(([s, al, ar, pl, pods]) => {
      if (!alive) return;
      setStats(s);
      setAlbums(al || []);
      setArtists(ar || []);
      setPlaylists(pl || []);
      setPodcasts(pods?.podcasts || []);
      setLoading(false);
    });
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
  const myUploads = stats?.my_uploads || [];
  const communityUploads = stats?.community_uploads || [];

  const shuffleAll = () => {
    const pool = recommended.length ? recommended : top;
    if (!pool.length) { toast('Nothing to play yet — upload a track first', 'info'); return; }
    const start = Math.floor(Math.random() * pool.length);
    play(pool, start);
    toast('Shuffling your mix');
  };

  const playPlaylist = async (pl) => {
    try {
      const detail = await api.get(`/api/playlists/${pl.id}`);
      if (detail.songs?.length) play(detail.songs, 0);
      else toast('This playlist is empty', 'info');
    } catch (err) { toast(err.message || 'Could not play playlist', 'error'); }
  };

  const playAlbum = async (album) => {
    try {
      const detail = await api.get(`/api/albums/${album.id}`);
      if (detail.songs?.length) play(detail.songs, 0);
      else toast('This album has no tracks yet', 'info');
    } catch (err) { toast(err.message || 'Could not play album', 'error'); }
  };

  const playArtist = async (a) => {
    try {
      const detail = await api.get(`/api/artists/${a.id}`);
      if (detail.songs?.length) play(detail.songs, 0);
      else toast('This artist has no tracks yet', 'info');
    } catch (err) { toast(err.message || 'Could not play artist', 'error'); }
  };

  return (
    <div className="page">
      {/* ============================= HERO ============================= */}
      <div className="home-hero">
        <div className="home-hero-content">
          <div>
            <span className="eyebrow"><Icon name="wave" size={13} /> Pulse · Made for you</span>
            <h1>{greeting}, {firstName}</h1>
            <p>
              {user?.username ? `@${user.username} · ` : ''}
              {artist ? `${artist.name} · ` : ''}
              Your catalog, playlists and downloads — all in one place.
            </p>
          </div>
          <div className="home-hero-actions">
            <button className="btn btn-play btn-lg btn-pill" onClick={shuffleAll}>
              <Icon name="shuffle" size={18} /> Shuffle play
            </button>
            <Link className="btn btn-ghost btn-lg btn-pill" to="/upload">
              <Icon name="upload" size={18} /> Upload
            </Link>
          </div>
        </div>
      </div>

      {loading && <GridSkeleton count={6} height={210} />}

      {/* ========================== MADE FOR YOU ======================== */}
      <DiscoverRow
        title="Made for you"
        icon="sparkle"
        songs={recommended}
        onPlay={play}
        seeAll="/search"
        note={stats?.user_genres?.length ? stats.user_genres.join(' · ') : undefined}
      />

      {/* ========================== YOUR UPLOADS ======================== */}
      {myUploads.length > 0 && (
        <DiscoverRow
          title="Your Uploads"
          icon="upload"
          songs={myUploads}
          onPlay={play}
          seeAll="/library?filter=uploads"
          note={`${myUploads.length} uploaded track${myUploads.length === 1 ? '' : 's'} · private & public`}
        />
      )}

      {/* =========================== PLAYLISTS ========================== */}
      {playlists.length > 0 && (
        <section className="section">
          <SectionHead
            icon="playlist"
            title="Your playlists"
            action={<Link to="/library?filter=playlists" className="see-all">Show all</Link>}
          />
          <div className="collection-grid">
            {playlists.slice(0, 6).map((pl) => (
              <CollectionCard
                key={pl.id}
                to={`/playlists/${pl.id}`}
                type="Playlist"
                typeTone="accent"
                cover={pl.cover_url}
                title={pl.name}
                subtitle={`${pl.track_count ?? 0} songs`}
                meta={{ icon: 'clock', text: pl.creator_name ? `By ${pl.creator_name}` : 'Playlist' }}
                onPlay={() => playPlaylist(pl)}
              />
            ))}
          </div>
        </section>
      )}

      {/* =========================== BROWSE ALL ========================= */}
      {genres.length > 0 && (
        <section className="section">
          <SectionHead title="Browse all" action={<Link to="/search" className="see-all">Show all</Link>} />
          <div className="genre-tile-grid">
            {genres.slice(0, 9).map((g, i) => {
              const c = MOOD_COLORS[i % MOOD_COLORS.length];
              return (
                <Link
                  key={g.genre}
                  to={`/search?genre=${encodeURIComponent(g.genre)}`}
                  className="genre-tile"
                  style={{ background: `linear-gradient(135deg, ${c[0]} 0%, ${c[1]} 100%)` }}
                >
                  <span className="genre-tile-name">{g.genre}</span>
                  <span className="genre-tile-count">{g.c} tracks</span>
                  <Icon name="music" size={44} className="genre-tile-art" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <DiscoverRow title="Recently added" icon="clock" songs={recent} onPlay={play} seeAll="/search" />
      {communityUploads.length > 0 && (
        <DiscoverRow
          title="Community &amp; Public Uploads"
          icon="globe"
          songs={communityUploads}
          onPlay={play}
          seeAll="/search?visibility=public"
          note="Published for everyone on Pulse"
        />
      )}
      <DiscoverRow title="Top tracks this week" icon="trending" songs={top} onPlay={play} seeAll="/search?sort=plays" />

      {/* ============================ ALBUMS ============================ */}
      {albums.length > 0 && (
        <section className="section">
          <SectionHead icon="album" title="Albums you might like" action={<Link to="/albums" className="see-all">Show all</Link>} />
          <div className="collection-grid">
            {albums.slice(0, 6).map((al) => <AlbumCard key={al.id} album={al} onPlay={playAlbum} />)}
          </div>
        </section>
      )}

      {/* ============================ ARTISTS =========================== */}
      {artists.length > 0 && (
        <section className="section">
          <SectionHead icon="artist" title="Popular artists" action={<Link to="/artists" className="see-all">Show all</Link>} />
          <div className="collection-grid">
            {artists.slice(0, 6).map((a) => <ArtistCard key={a.id} artist={a} onPlay={playArtist} />)}
          </div>
        </section>
      )}

      {/* =========================== PODCASTS =========================== */}
      {podcasts.length > 0 && (
        <section className="section">
          <SectionHead
            icon="podcast"
            title="Podcasts for you"
            action={<Link to="/podcasts" className="see-all">Show all</Link>}
          />
          <div className="collection-grid">
            {podcasts.slice(0, 6).map((p) => (
              <CollectionCard
                key={p.id}
                to={`/podcasts/${p.id}`}
                type="Podcast"
                typeTone="accent"
                cover={p.cover_url}
                title={p.title}
                subtitle={`${p.publisher || 'Independent'}${p.category ? ` • ${p.category}` : ''}`}
                meta={{ icon: 'mic', text: `${p.episode_count || 0} episode${p.episode_count === 1 ? '' : 's'}` }}
                chip={p.subscribed ? 'FOLLOWING' : undefined}
                onPlay={() => playPodcast(p)}
                playLabel={`Play ${p.title}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* ============================= STATS ============================ */}
      <section className="section">
        <SectionHead icon="trending" title="Platform stats" action={<Link to="/library" className="see-all">Manage library</Link>} />
        <div className="stat-grid">
          <StatTile icon="music" value={loading ? '—' : stats?.songs ?? 0} label="Tracks" />
          <StatTile icon="playCircle" value={loading ? '—' : formatNumber(stats?.plays ?? 0)} label="Total plays" tone="c2" />
          <StatTile icon="download" value={loading ? '—' : formatNumber(stats?.downloads ?? 0)} label="Downloads" tone="c3" />
          <StatTile icon="artist" value={loading ? '—' : stats?.artists ?? 0} label="Artists" tone="c4" />
          <StatTile icon="album" value={loading ? '—' : stats?.albums ?? 0} label="Albums" tone="c5" />
          <StatTile icon="playlist" value={loading ? '—' : stats?.playlists ?? 0} label="Playlists" tone="c6" />
        </div>
      </section>

      {!loading && !recommended.length && !top.length && (
        <EmptyState
          icon="music"
          title="Your catalog is empty"
          description="Upload your first track and Pulse will start building recommendations, stats and mixes around it."
          action={<Link className="btn btn-primary" to="/upload"><Icon name="upload" size={16} /> Upload music</Link>}
        />
      )}
    </div>
  );
}
