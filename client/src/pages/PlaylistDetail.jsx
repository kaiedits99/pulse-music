import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import { Cover, Skeleton, EmptyState } from '../components/ui.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function PlaylistDetail() {
  const { id } = useParams();
  const { play } = usePlayer();
  const { toast } = useToast();
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setPlaylist(await api.get(`/api/playlists/${id}`)); }
    catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const removeSong = async (song) => {
    try {
      await api.del(`/api/playlists/${id}/songs/${song.id}`);
      setPlaylist((p) => ({ ...p, songs: p.songs.filter((s) => s.id !== song.id) }));
      toast('Removed from playlist');
    } catch (err) { toast(err.message, 'error'); }
  };

  if (loading) return <div className="page"><div className="detail-head"><Skeleton w={180} h={180} /><div className="stack" style={{ flex: 1 }}><Skeleton w="50%" h={30} /><Skeleton w="40%" h={16} /></div></div></div>;
  if (!playlist) return <EmptyState title="Playlist not found" />;

  return (
    <div className="page">
      <Link to="/playlists" className="back-link"><Icon name="arrowLeft" size={16} /> Playlists</Link>
      <div className="detail-head">
        <Cover src={playlist.cover_url} alt={playlist.name} size={180} />
        <div className="detail-info">
          <span className="eyebrow">Playlist</span>
          <h1>{playlist.name}</h1>
          {playlist.description && <p className="detail-sub">{playlist.description}</p>}
          <p className="detail-count">{playlist.songs?.length || 0} tracks</p>
          <div className="detail-actions">
            <button className="btn btn-primary" onClick={() => playlist.songs?.length && play(playlist.songs, 0)} disabled={!playlist.songs?.length}>
              <Icon name="play" size={17} /> Play
            </button>
          </div>
        </div>
      </div>

      <SongTable
        songs={playlist.songs}
        showAlbum
        showPlays={false}
        onDelete={(s) => removeSong(s)}
        emptyFallback={<EmptyState icon="playlist" title="This playlist is empty" description="Add tracks from the Songs page using the ⋮ menu." />}
      />
    </div>
  );
}
