import { useState, useEffect, useCallback } from 'react';
import { ArtistCard } from '../components/Cards.jsx';
import { Skeleton, EmptyState, PageHeader } from '../components/ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

export default function Artists() {
  const { toast } = useToast();
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setArtists(await api.get('/api/artists')); }
    catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <PageHeader title="Artists" subtitle="The voices and producers on Pulse." />
      {loading ? (
        <div className="media-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={230} />)}
        </div>
      ) : artists.length === 0 ? (
        <EmptyState icon="artist" title="No artists yet" />
      ) : (
        <div className="media-grid">
          {artists.map((a) => <ArtistCard key={a.id} artist={a} />)}
        </div>
      )}
    </div>
  );
}
