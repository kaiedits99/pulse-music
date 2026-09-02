import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import { Skeleton, EmptyState, PageHeader } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAddToPlaylistDialog } from '../components/Forms.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Favorites() {
  const { toast } = useToast();
  const { open: openAdd, dialog: addDialog } = useAddToPlaylistDialog();
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSongs(await api.get('/api/favorites')); }
    catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <PageHeader title="Favorites" subtitle="Tracks you've liked." />
      {loading ? (
        <div className="stack">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={60} />)}</div>
      ) : (
        <SongTable
          songs={songs}
          onAddToPlaylist={openAdd}
          emptyFallback={<EmptyState icon="heart" title="No favorites yet" description="Tap the ♥ on any track to save it here." action={<a className="btn btn-primary" href="/songs"><Icon name="music" size={16} /> Browse songs</a>} />}
        />
      )}
          {addDialog}
    </div>
  );
}
