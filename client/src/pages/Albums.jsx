import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { AlbumCard, LibraryRow } from '../components/Cards.jsx';
import { PageHero, SectionHead, SortMenu, ViewToggle, EmptyState, GridSkeleton } from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { AlbumFormModal } from '../components/Forms.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';

const SORTS = [
  { id: 'recent', label: 'Newest first' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'tracks', label: 'Most tracks' },
  { id: 'artist', label: 'By artist' }
];

export default function Albums() {
  const { user, artist } = useAuth();
  const { toast } = useToast();
  const { play } = usePlayer();

  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState('grid');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAlbums(await api.get('/api/albums')); }
    catch (err) { toast(err.message || 'Could not load albums', 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/artists').then(setArtists).catch(() => {}); }, []);

  const playAlbum = async (album) => {
    try {
      const detail = await api.get(`/api/albums/${album.id}`);
      if (detail.songs?.length) { play(detail.songs, 0); toast(`Playing “${album.title}”`); }
      else toast('This album has no tracks yet', 'info');
    } catch (err) { toast(err.message || 'Could not play album', 'error'); }
  };

  const canManage = (album) => user && (user.role === 'admin' || (artist && artist.id === album.artist_id));

  const handleDelete = async (album) => {
    try {
      await api.del(`/api/albums/${album.id}`);
      setAlbums((a) => a.filter((x) => x.id !== album.id));
      toast('Album deleted');
    } catch (err) { toast(err.message || 'Could not delete album', 'error'); }
  };

  const sorted = useMemo(() => {
    const list = [...albums];
    if (sort === 'alpha') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'tracks') list.sort((a, b) => (b.track_count || 0) - (a.track_count || 0));
    else if (sort === 'artist') list.sort((a, b) => (a.artist_name || '').localeCompare(b.artist_name || ''));
    else list.sort((a, b) => (b.release_year || 0) - (a.release_year || 0));
    return list;
  }, [albums, sort]);

  const totalTracks = albums.reduce((t, a) => t + (a.track_count || 0), 0);

  return (
    <div className="page">
      <PageHero
        icon="album"
        title="Albums"
        chip={`${albums.length} release${albums.length === 1 ? '' : 's'}`}
        subtitle={`${totalTracks} track${totalTracks === 1 ? '' : 's'} grouped across every release on Pulse.`}
        actions={(
          <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Icon name="plus" size={17} /> New album
          </button>
        )}
      />

      <div className="toolbar">
        <div className="chip-row">
          <Link className="chip" to="/library?filter=albums"><Icon name="library" size={14} /> In your library</Link>
          <Link className="chip" to="/artists"><Icon name="artist" size={14} /> Browse artists</Link>
        </div>
        <div className="toolbar-right">
          <SortMenu options={SORTS} value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      <section className="section">
        <SectionHead
          title="All albums"
          note={loading ? 'Loading…' : `Showing ${sorted.length} item${sorted.length === 1 ? '' : 's'}`}
        />

        {loading ? (
          <GridSkeleton count={8} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon="album"
            title="No albums yet"
            description="Create an album to group your tracks into a release listeners can browse."
            action={<button className="btn btn-primary" onClick={() => setFormOpen(true)}><Icon name="plus" size={16} /> New album</button>}
          />
        ) : view === 'grid' ? (
          <div className="collection-grid">
            {sorted.map((al) => (
              <AlbumCard
                key={al.id}
                album={al}
                onPlay={playAlbum}
                actions={canManage(al) && (
                  <>
                    <button className="icon-btn icon-btn-sm" onClick={(e) => { e.preventDefault(); setEditing(al); setFormOpen(true); }} aria-label="Edit album">
                      <Icon name="edit" size={15} />
                    </button>
                    <button className="icon-btn icon-btn-sm danger" onClick={(e) => { e.preventDefault(); setDeleting(al); }} aria-label="Delete album">
                      <Icon name="trash" size={15} />
                    </button>
                  </>
                )}
              />
            ))}
          </div>
        ) : (
          <div className="library-list">
            {sorted.map((al) => (
              <LibraryRow
                key={al.id}
                to={`/albums/${al.id}`}
                cover={al.cover_url}
                title={al.title}
                subtitle={`${al.artist_name || 'Unknown artist'} • ${al.release_year || '—'}`}
                meta={`${al.track_count || 0} tracks`}
                onPlay={() => playAlbum(al)}
                actions={canManage(al) && (
                  <>
                    <button className="icon-btn icon-btn-sm" onClick={(e) => { e.preventDefault(); setEditing(al); setFormOpen(true); }} aria-label="Edit album">
                      <Icon name="edit" size={15} />
                    </button>
                    <button className="icon-btn icon-btn-sm danger" onClick={(e) => { e.preventDefault(); setDeleting(al); }} aria-label="Delete album">
                      <Icon name="trash" size={15} />
                    </button>
                  </>
                )}
              />
            ))}
          </div>
        )}
      </section>

      <AlbumFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        album={editing}
        artists={artists}
        defaultArtistId={artist?.id}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && handleDelete(deleting)}
        title="Delete album"
        message={deleting ? `Delete “${deleting.title}”? Its tracks stay in the catalog but become ungrouped.` : ''}
      />
    </div>
  );
}
