import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import DiscoverRow from '../components/DiscoverRow.jsx';
import { Cover, Skeleton, EmptyState } from '../components/ui.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAddToPlaylistDialog } from '../components/Forms.jsx';

export default function AlbumDetail() {
  const { id } = useParams();
  const { play } = usePlayer();
  const { toast } = useToast();
  const { open: openAdd, dialog: addDialog } = useAddToPlaylistDialog();
  const [album, setAlbum] = useState(null);
  const [moreFrom, setMoreFrom] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/api/albums/${id}`).then((d) => {
      if (alive) {
        setAlbum(d);
        setLoading(false);
        // "More from artist" — their other tracks, excluding this album's tracks
        if (d.artist_id) {
          api.get(`/api/songs?artist_id=${d.artist_id}`).then((songs) => {
            if (!alive) return;
            const albumIds = new Set((d.songs || []).map((s) => s.id));
            setMoreFrom((songs || []).filter((s) => !albumIds.has(s.id)));
          }).catch(() => {});
        }
      }
    }).catch((e) => { if (alive) { toast(e.message, 'error'); setLoading(false); } });
    api.get('/api/songs/recommended').then((d) => { if (alive) setRecommended(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, [id, toast]);

  if (loading) {
    return <div className="page"><div className="detail-head"><Skeleton w={180} h={180} /><div className="stack" style={{ flex: 1 }}><Skeleton w="60%" h={30} /><Skeleton w="40%" h={16} /><Skeleton w="50%" h={16} /></div></div></div>;
  }
  if (!album) return <EmptyState title="Album not found" />;

  return (
    <div className="page">
      <Link to="/albums" className="back-link"><Icon name="arrowLeft" size={16} /> Albums</Link>
      <div className="detail-head">
        <Cover src={album.cover_url} alt={album.title} size={180} />
        <div className="detail-info">
          <span className="eyebrow">Album</span>
          <h1>{album.title}</h1>
          <p className="detail-sub">
            <Link to={`/artists/${album.artist_id}`}>{album.artist_name}</Link>
            {' · '}{album.release_year}{album.genre ? ` · ${album.genre}` : ''}
          </p>
          <p className="detail-count">{album.songs?.length || 0} tracks</p>
          <div className="detail-actions">
            <button className="btn btn-primary" onClick={() => album.songs?.length && play(album.songs, 0)} disabled={!album.songs?.length}>
              <Icon name="play" size={17} /> Play
            </button>
          </div>
        </div>
      </div>

      <SongTable
        songs={album.songs}
        showAlbum={false}
        onAddToPlaylist={openAdd}
        emptyFallback={<EmptyState icon="music" title="No tracks in this album yet" />}
      />

      {addDialog}

      {moreFrom.length > 0 && (
        <DiscoverRow title={`More from ${album.artist_name}`} songs={moreFrom} onPlay={play} />
      )}
      {recommended.length > 0 && (
        <DiscoverRow title="Recommended for you" songs={recommended} onPlay={play} />
      )}
    </div>
  );
}
