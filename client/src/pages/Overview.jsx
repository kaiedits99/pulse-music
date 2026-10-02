import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import DiscoverRow from '../components/DiscoverRow.jsx';
import { AlbumCard, ArtistCard, CollectionCard } from '../components/Cards.jsx';
import { SectionHead, GridSkeleton, StatTile, EmptyState } from '../components/ui.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatNumber, plural } from '../format.js';
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
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
  }, [attempt]);

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

  // Only things with music in them are worth showing on Home: a sign-up creates an artist
  // profile, and a user can create an empty album, but neither is something to listen to yet.
  const albumsWithMusic = useMemo(() => albums.filter((al) => (al.track_count || 0) > 0), [albums]);
  const artistsWithMusic = useMemo(() => artists.filter((a) => (a.song_count || 0) > 0), [artists]);

  const hasMusic = (stats?.songs ?? 0) > 0;
  const hasContent = hasMusic || albumsWithMusic.length > 0 || playlists.length > 0 || podcasts.length > 0;

  /* Arrange the track rows. The catalog is shared and starts empty, so early on there are only
     a handful of tracks — without this the same card would repeat in every row. A row is shown
     only if it holds at least one track that is not already on the page above it.
     Order: your uploads → what is new → picked for you → community → popular. */
  const rows = useMemo(() => {
    const seen = new Set();
    const shown = {};
    const take = (key, songs) => {
      if (!songs.some((s) => !seen.has(s.id))) return;
      songs.forEach((s) => seen.add(s.id));
      shown[key] = songs;
    };
    take('mine', myUploads);
    take('recent', recent);
    take('recommended', recommended);
    take('community', communityUploads);
    take('top', top);
    return shown;
  }, [myUploads, recent, recommended, communityUploads, top]);

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

  const playPodcast = async (show) => {
    try {
      const detail = await api.get(`/api/podcasts/${show.id}`);
      const episodes = detail.episodes || [];
      if (!episodes.length) { toast('This show has no episodes yet', 'info'); return; }
      play(episodesToTracks(episodes, detail), 0, resumeAt(episodes[0]));
      toast(`Playing “${show.title}”`);
    } catch (err) { toast(err.message || 'Could not play this show', 'error'); }
  };

  /* ------------------------------------------------------------ states */
  if (loading) {
    return (
      <div className="page">
        <GridSkeleton count={6} height={210} />
      </div>
    );
  }

  // The request itself failed — say so instead of pretending the catalog is empty.
  if (!stats) {
    return (
      <div className="page">
        <div className="home-empty">
          <EmptyState
            icon="cloud"
            title="Can’t reach Pulse"
            description="The catalog could not be loaded. Check your connection and try again — downloaded tracks still play offline."
            action={(
              <div className="row">
                <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
                <Link className="btn btn-ghost" to="/offline-player"><Icon name="headphones" size={16} /> Offline player</Link>
              </div>
            )}
          />
        </div>
      </div>
    );
  }

  // Nothing has been uploaded yet: the page is intentionally blank except for the way forward.
  // The first public upload lands here for every user who signs in afterwards.
  if (!hasContent) {
    return (
      <div className="page">
        <div className="home-empty">
          <EmptyState
            icon="upload"
            title="Nothing here yet"
            description="No music has been uploaded to Pulse yet. Upload the first track and it will show up right here — for you and for everyone who signs in after you."
            action={(
              <Link className="btn btn-primary btn-lg btn-pill" to="/upload">
                <Icon name="upload" size={18} /> Upload the first track
              </Link>
            )}
          />
        </div>
      </div>
    );
  }

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

      {/* ========================== YOUR UPLOADS ======================== */}
      {rows.mine && (
        <DiscoverRow
          title="Your Uploads"
          icon="upload"
          songs={rows.mine}
          onPlay={play}
          seeAll="/library?filter=uploads"
          note={`${rows.mine.length} uploaded track${rows.mine.length === 1 ? '' : 's'} · private & public`}
        />
      )}

      {/* ========================= RECENTLY ADDED ======================= */}
      {rows.recent && (
        <DiscoverRow
          title="Recently added"
          icon="clock"
          songs={rows.recent}
          onPlay={play}
          seeAll="/search"
          note="Newest uploads first"
        />
      )}

      {/* ========================== MADE FOR YOU ======================== */}
      {rows.recommended && (
        <DiscoverRow
          title="Made for you"
          icon="sparkle"
          songs={rows.recommended}
          onPlay={play}
          seeAll="/search"
          note={stats?.user_genres?.length ? stats.user_genres.join(' · ') : undefined}
        />
      )}

      {/* ===================== COMMUNITY & PUBLIC UPLOADS =============== */}
      {rows.community && (
        <DiscoverRow
          title="Community & Public Uploads"
          icon="globe"
          songs={rows.community}
          onPlay={play}
          seeAll="/search?visibility=public"
          note="Published for everyone on Pulse"
        />
      )}

      {rows.top && (
        <DiscoverRow title="Top tracks this week" icon="trending" songs={rows.top} onPlay={play} seeAll="/search?sort=plays" />
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
                subtitle={plural(pl.track_count, 'song')}
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
                  <span className="genre-tile-count">{g.c} track{g.c === 1 ? '' : 's'}</span>
                  <Icon name="music" size={44} className="genre-tile-art" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ============================ ALBUMS ============================ */}
      {albumsWithMusic.length > 0 && (
        <section className="section">
          <SectionHead icon="album" title="Albums you might like" action={<Link to="/albums" className="see-all">Show all</Link>} />
          <div className="collection-grid">
            {albumsWithMusic.slice(0, 6).map((al) => <AlbumCard key={al.id} album={al} onPlay={playAlbum} />)}
          </div>
        </section>
      )}

      {/* ============================ ARTISTS =========================== */}
      {artistsWithMusic.length > 0 && (
        <section className="section">
          <SectionHead icon="artist" title="Popular artists" action={<Link to="/artists" className="see-all">Show all</Link>} />
          <div className="collection-grid">
            {artistsWithMusic.slice(0, 6).map((a) => <ArtistCard key={a.id} artist={a} onPlay={playArtist} />)}
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
          <StatTile icon="music" value={stats.songs ?? 0} label="Tracks" />
          <StatTile icon="playCircle" value={formatNumber(stats.plays ?? 0)} label="Total plays" tone="c2" />
          <StatTile icon="download" value={formatNumber(stats.downloads ?? 0)} label="Downloads" tone="c3" />
          <StatTile icon="artist" value={stats.artists ?? 0} label="Artists" tone="c4" />
          <StatTile icon="album" value={stats.albums ?? 0} label="Albums" tone="c5" />
          <StatTile icon="playlist" value={stats.playlists ?? 0} label="Playlists" tone="c6" />
        </div>
      </section>
    </div>
  );
}
