import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { PlaylistCard, LibraryRow } from '../components/Cards.jsx';
import { PageHero, SectionHead, FilterChips, SortMenu, ViewToggle, EmptyState, GridSkeleton } from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { PlaylistFormModal } from '../components/Forms.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { isPlaylistDownloaded, OFFLINE_EVENT } from '../offline.js';

const FILTERS = [
  { id: 'all', label: 'All playlists' },
  { id: 'mine', label: 'Created by you' },
  { id: 'downloaded', label: 'Downloaded', icon: 'check', iconGreen: true }
];

const SORTS = [
  { id: 'recent', label: 'Recents' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'tracks', label: 'Most tracks' }
];

export default function Playlists() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { play } = usePlayer();

  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState('grid');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [, setOfflineTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPlaylists(await api.get('/api/playlists')); }
    catch (err) { toast(err.message || 'Could not load playlists', 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const cb = () => setOfflineTick((t) => t + 1);
    window.addEventListener(OFFLINE_EVENT, cb);
    return () => window.removeEventListener(OFFLINE_EVENT, cb);
  }, []);

  const playPlaylist = async (pl) => {
    try {
      const detail = await api.get(`/api/playlists/${pl.id}`);
      if (detail.songs?.length) { play(detail.songs, 0); toast(`Playing “${pl.name}”`); }
      else toast('This playlist is empty', 'info');
    } catch (err) { toast(err.message || 'Could not play playlist', 'error'); }
  };

  const canManage = (pl) => user && (user.role === 'admin' || pl.user_id === user.id);

  const handleDelete = async (pl) => {
    try {
      await api.del(`/api/playlists/${pl.id}`);
      setPlaylists((p) => p.filter((x) => x.id !== pl.id));
      window.dispatchEvent(new CustomEvent('pulse-playlists-changed'));
      toast('Playlist deleted');
    } catch (err) { toast(err.message || 'Could not delete playlist', 'error'); }
  };

  const shown = useMemo(() => {
    let list = playlists;
    if (filter === 'mine') list = playlists.filter((p) => user && p.user_id === user.id);
    else if (filter === 'downloaded') list = playlists.filter((p) => isPlaylistDownloaded(p.id));

    const sorted = [...list];
    if (sort === 'alpha') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'tracks') sorted.sort((a, b) => (b.track_count || 0) - (a.track_count || 0));
    else sorted.sort((a, b) => new Date(`${b.created_at}Z`) - new Date(`${a.created_at}Z`));
    return sorted;
  }, [playlists, filter, sort, user]);

  const totalTracks = playlists.reduce((t, p) => t + (p.track_count || 0), 0);

  return (
    <div className="page">
      <PageHero
        icon="playlist"
        title="Playlists"
        chip={`${playlists.length} collection${playlists.length === 1 ? '' : 's'}`}
        subtitle={`${totalTracks} track${totalTracks === 1 ? '' : 's'} curated across every playlist you can listen to.`}
        actions={(
          <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Icon name="plus" size={17} /> New playlist
          </button>
        )}
      />

      <div className="toolbar">
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Filter playlists" />
        <div className="toolbar-right">
          <SortMenu options={SORTS} value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      <section className="section">
        <SectionHead
          title="All playlists"
          note={loading ? 'Loading…' : `Showing ${shown.length} item${shown.length === 1 ? '' : 's'}`}
        />

        {loading ? (
          <GridSkeleton count={6} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="playlist"
            title={filter === 'all' ? 'No playlists yet' : 'Nothing matches this filter'}
            description={filter === 'downloaded'
              ? 'Open a playlist and press Download to make it available offline.'
              : 'Create a playlist to organise tracks into a set you can play on repeat.'}
            action={<button className="btn btn-primary" onClick={() => setFormOpen(true)}><Icon name="plus" size={16} /> New playlist</button>}
          />
        ) : view === 'grid' ? (
          <div className="collection-grid">
            {shown.map((pl) => (
              <PlaylistCard
                key={pl.id}
                playlist={pl}
                downloaded={isPlaylistDownloaded(pl.id)}
                onPlay={playPlaylist}
                onDelete={canManage(pl) ? (p) => setDeleting(p) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="library-list">
            {shown.map((pl) => (
              <LibraryRow
                key={pl.id}
                to={`/playlists/${pl.id}`}
                cover={pl.cover_url}
                title={pl.name}
                subtitle={pl.creator_name ? `By ${pl.creator_name} • ${pl.track_count ?? 0} songs` : `${pl.track_count ?? 0} songs`}
                meta={isPlaylistDownloaded(pl.id) ? 'Downloaded' : `${pl.track_count ?? 0} tracks`}
                metaTone={isPlaylistDownloaded(pl.id) ? 'green' : ''}
                onPlay={() => playPlaylist(pl)}
                actions={canManage(pl) && (
                  <>
                    <button className="icon-btn icon-btn-sm" onClick={(e) => { e.preventDefault(); setEditing(pl); setFormOpen(true); }} aria-label="Edit playlist">
                      <Icon name="edit" size={15} />
                    </button>
                    <button className="icon-btn icon-btn-sm danger" onClick={(e) => { e.preventDefault(); setDeleting(pl); }} aria-label="Delete playlist">
                      <Icon name="trash" size={15} />
                    </button>
                  </>
                )}
              />
            ))}
          </div>
        )}
      </section>

      <PlaylistFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { load(); window.dispatchEvent(new CustomEvent('pulse-playlists-changed')); }}
        playlist={editing}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && handleDelete(deleting)}
        title="Delete playlist"
        message={deleting ? `Delete “${deleting.name}”? This cannot be undone.` : ''}
      />
    </div>
  );
}
