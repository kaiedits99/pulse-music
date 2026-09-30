import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import DiscoverRow from '../components/DiscoverRow.jsx';
import { AlbumCard } from '../components/Cards.jsx';
import { Cover, Skeleton, EmptyState, SectionHead } from '../components/ui.jsx';
import { useAddToPlaylistDialog } from '../components/Forms.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatNumber, formatLongDuration } from '../format.js';

export default function ArtistDetail() {
  const { id } = useParams();
  const { play } = usePlayer();
  const { toast } = useToast();
  const { open: openAdd, dialog: addDialog } = useAddToPlaylistDialog();

  const [artist, setArtist] = useState(null);
  const [recommended, setRecommended] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/api/artists/${id}`)
      .then((d) => { if (alive) { setArtist(d); setLoading(false); } })
      .catch((e) => { if (alive) { toast(e.message, 'error'); setLoading(false); } });
    api.get('/api/songs/recommended')
      .then((d) => { if (alive) setRecommended(d?.recommendations || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id, toast]);

  const songs = useMemo(() => artist?.songs || [], [artist]);
  const totalDuration = useMemo(() => songs.reduce((t, s) => t + (s.duration_seconds || 0), 0), [songs]);

  const playAlbum = async (al) => {
    try {
      const d = await api.get(`/api/albums/${al.id}`);
      if (d.songs?.length) play(d.songs, 0);
      else toast('This album has no tracks yet', 'info');
    } catch (err) { toast(err.message || 'Could not play album', 'error'); }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="detail-hero">
          <Skeleton w={208} h={208} r={999} />
          <div className="stack" style={{ flex: 1 }}>
            <Skeleton w="50%" h={40} /><Skeleton w="40%" h={16} /><Skeleton w="60%" h={16} />
          </div>
        </div>
      </div>
    );
  }
  if (!artist) return <div className="page"><EmptyState icon="artist" title="Artist not found" action={<Link className="btn btn-primary" to="/artists">Back to artists</Link>} /></div>;

  return (
    <div className="page">
      <Link to="/artists" className="back-link"><Icon name="arrowLeft" size={16} /> Artists</Link>

      <div className="detail-hero">
        <div className="detail-hero-art round">
          <Cover src={artist.avatar_url} alt={artist.name} size="100%" round />
        </div>
        <div className="detail-hero-info">
          <span className="eyebrow"><Icon name="artist" size={13} /> Artist</span>
          <h1>{artist.name}</h1>
          <p className="detail-hero-sub">
            {artist.genre && <span className="tag tag-accent">{artist.genre}</span>}
            {artist.country && <><span className="cc-meta-dot" />{artist.country}</>}
            <span className="cc-meta-dot" />
            {formatNumber(artist.followers)} monthly listeners
            <span className="cc-meta-dot" />
            {songs.length} track{songs.length === 1 ? '' : 's'}
            {totalDuration > 0 && <><span className="cc-meta-dot" />{formatLongDuration(totalDuration)}</>}
          </p>
          {artist.bio && <p className="detail-hero-bio">{artist.bio}</p>}
          <div className="detail-actions">
            <button className="btn btn-play" onClick={() => songs.length && play(songs, 0)} disabled={!songs.length}>
              <Icon name="play" size={18} /> Play all
            </button>
            <button
              className="btn btn-ghost btn-pill"
              onClick={() => songs.length && play(songs, Math.floor(Math.random() * songs.length))}
              disabled={!songs.length}
            >
              <Icon name="shuffle" size={16} /> Shuffle
            </button>
            <Link className="btn btn-ghost btn-pill" to={`/search?artist=${artist.id}`}>
              <Icon name="search" size={16} /> Browse catalog
            </Link>
          </div>
        </div>
      </div>

      <section className="section">
        <SectionHead icon="album" title="Albums" note={`${artist.albums?.length || 0} release${(artist.albums?.length || 0) === 1 ? '' : 's'}`} />
        {artist.albums?.length ? (
          <div className="collection-grid">
            {artist.albums.map((al) => (
              <AlbumCard key={al.id} album={{ ...al, artist_name: artist.name }} onPlay={playAlbum} />
            ))}
          </div>
        ) : (
          <EmptyState icon="album" title="No albums yet" description={`${artist.name} hasn’t grouped any tracks into a release.`} />
        )}
      </section>

      <section className="section">
        <SectionHead icon="trending" title="Popular tracks" note={`${songs.length} track${songs.length === 1 ? '' : 's'}`} />
        <SongTable
          songs={songs}
          showAlbum
          onAddToPlaylist={openAdd}
          emptyFallback={<EmptyState icon="music" title="No tracks yet" description="Nothing has been published under this artist." />}
        />
      </section>

      {recommended.length > 0 && (
        <DiscoverRow title="Recommended for you" icon="sparkle" songs={recommended} onPlay={play} />
      )}

      {addDialog}
    </div>
  );
}
