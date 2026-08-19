import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import { PlaylistCard } from '../components/Cards.jsx';
import { Skeleton, EmptyState, PageHeader } from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { PlaylistFormModal } from '../components/Forms.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

export default function Playlists() {
  const { toast } = useToast();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPlaylists(await api.get('/api/playlists')); }
    catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (pl) => {
    try { await api.del(`/api/playlists/${pl.id}`); setPlaylists((p) => p.filter((x) => x.id !== pl.id)); toast('Playlist deleted'); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="page">
      <PageHeader
        title="Playlists"
        subtitle="Curated collections you can play on repeat."
        actions={<button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Icon name="plus" size={17} /> New playlist</button>}
      />

      {loading ? (
        <div className="media-grid">
          {[0, 1, 2].map((i) => <Skeleton key={i} h={230} />)}
        </div>
      ) : playlists.length === 0 ? (
        <EmptyState icon="playlist" title="No playlists yet" description="Create a playlist to organize your favorite tracks." action={<button className="btn btn-primary" onClick={() => setFormOpen(true)}><Icon name="plus" size={16} /> New playlist</button>} />
      ) : (
        <div className="media-grid">
          {playlists.map((pl) => (
            <PlaylistCard key={pl.id} playlist={pl} onDelete={(p) => setDeleting(p)} />
          ))}
        </div>
      )}

      <PlaylistFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} playlist={editing} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && handleDelete(deleting)} title="Delete playlist" message={deleting ? `Delete "${deleting.name}"?` : ''} />
    </div>
  );
}
