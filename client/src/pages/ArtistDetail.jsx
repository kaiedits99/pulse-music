import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import DiscoverRow from '../components/DiscoverRow.jsx';
import { AlbumCard } from '../components/Cards.jsx';
import { Cover, Skeleton, EmptyState } from '../components/ui.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatNumber } from '../format.js';

export default function ArtistDetail() {
  const { id } = useParams();
  const { play } = usePlayer();
  const { toast } = useToast();
  const [artist, setArtist] = useState(null);
  const [recommended, setRecommended] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get(`/api/artists/${id}`).then((d) => { if (alive) { setArtist(d); setLoading(false); } })
      .catch((e) => { if (alive) { toast(e.message, 'error'); setLoading(false); } });
    api.get('/api/songs/recommended').then((d) => { if (alive) setRecommended(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, [id, toast]);

  if (loading) return <div className="page"><div className="detail-head"><Skeleton w={180} h={180} round /><div className="stack" style={{ flex: 1 }}><Skeleton w="50%" h={30} /><Skeleton w="40%" h={16} /></div></div></div>;
  if (!artist) return <EmptyState title="Artist not found" />;

  return (
    <div className="page">
      <Link to="/artists" className="back-link"><Icon name="arrowLeft" size={16} /> Artists</Link>
      <div className="detail-head">
        <Cover src={artist.avatar_url} alt={artist.name} size={180} round />
        <div className="detail-info">
          <span className="eyebrow">Artist</span>
          <h1>{artist.name}</h1>
          <p className="detail-sub">{artist.genre}{artist.country ? ` · ${artist.country}` : ''}</p>
          <p className="detail-count">{formatNumber(artist.followers)} followers · {artist.song_count} tracks</p>
          {artist.bio && <p className="detail-bio">{artist.bio}</p>}
          <div className="detail-actions">
            <button className="btn btn-primary" onClick={() => artist.songs?.length && play(artist.songs, 0)} disabled={!artist.songs?.length}>
              <Icon name="play" size={17} /> Play all
            </button>
          </div>
        </div>
      </div>

      <h3 className="section-title">Albums</h3>
      {artist.albums?.length ? (
        <div className="media-grid">
          {artist.albums.map((al) => <AlbumCard key={al.id} album={{ ...al, artist_name: artist.name }} onPlay={async () => { const d = await api.get(`/api/albums/${al.id}`); d.songs?.length && play(d.songs, 0); }} />)}
        </div>
      ) : <EmptyState icon="album" title="No albums yet" />}

      <h3 className="section-title">Popular tracks</h3>
      <SongTable songs={artist.songs} showAlbum emptyFallback={<EmptyState icon="music" title="No tracks yet" />} />

      {recommended.length > 0 && (
        <DiscoverRow title="Recommended for you" songs={recommended} onPlay={play} />
      )}
    </div>
  );
}
