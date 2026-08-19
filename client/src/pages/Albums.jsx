import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import { AlbumCard } from '../components/Cards.jsx';
import { Skeleton, EmptyState, PageHeader } from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { AlbumFormModal } from '../components/Forms.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';

export default function Albums() {
  const { user, artist } = useAuth();
  const { toast } = useToast();
  const { play } = usePlayer();
  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAlbums(await api.get('/api/albums')); }
    catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/artists').then(setArtists).catch(() => {}); }, []);

  const playAlbum = async (album) => {
    try {
      const detail = await api.get(`/api/albums/${album.id}`);
      if (detail.songs?.length) play(detail.songs, 0);
      else toast('This album has no tracks yet', 'info');
    } catch (err) { toast(err.message, 'error'); }
  };

  const canManage = (album) => user && (user.role === 'admin' || (artist && artist.id === album.artist_id));

  const handleDelete = async (album) => {
    try { await api.del(`/api/albums/${album.id}`); setAlbums((a) => a.filter((x) => x.id !== album.id)); toast('Album deleted'); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="page">
      <PageHeader
        title="Albums"
        subtitle="Collections of tracks organized by release."
        actions={<button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Icon name="plus" size={17} /> New album</button>}
      />

      {loading ? (
        <div className="media-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={230} />)}
        </div>
      ) : albums.length === 0 ? (
        <EmptyState icon="album" title="No albums yet" description="Create an album to group your tracks." action={<button className="btn btn-primary" onClick={() => setFormOpen(true)}><Icon name="plus" size={16} /> New album</button>} />
      ) : (
        <div className="media-grid">
          {albums.map((al) => (
            <div className="card-wrap" key={al.id}>
              <AlbumCard album={al} onPlay={playAlbum} />
              {canManage(al) && (
                <div className="card-actions">
                  <button className="icon-btn icon-btn-sm" onClick={() => { setEditing(al); setFormOpen(true); }} aria-label="Edit"><Icon name="edit" size={15} /></button>
                  <button className="icon-btn icon-btn-sm danger" onClick={() => setDeleting(al)} aria-label="Delete"><Icon name="trash" size={15} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AlbumFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} album={editing} artists={artists} defaultArtistId={artist?.id} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && handleDelete(deleting)} title="Delete album" message={deleting ? `Delete "${deleting.title}"? Its tracks will remain but become ungrouped.` : ''} />
    </div>
  );
}
