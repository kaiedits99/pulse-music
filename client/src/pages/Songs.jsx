import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import { Skeleton, EmptyState, PageHeader } from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import SongFormModal from '../components/SongFormModal.jsx';
import { AddToPlaylistModal } from '../components/Forms.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Songs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const { user, artist } = useAuth();
  const { toast } = useToast();

  const [songs, setSongs] = useState([]);
  const [artists, setArtists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState('recent');
  const [mineOnly, setMineOnly] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [addTarget, setAddTarget] = useState(null);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (genre) params.set('genre', genre);
      if (sort !== 'recent') params.set('sort', sort);
      let data = await api.get(`/api/songs?${params.toString()}`);
      if (mineOnly && artist) data = data.filter((s) => s.artist_id === artist.id);
      setSongs(data);
    } catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  }, [q, genre, sort, mineOnly, artist, toast]);

  useEffect(() => { loadSongs(); }, [loadSongs]);

  useEffect(() => {
    api.get('/api/artists').then(setArtists).catch(() => {});
    api.get('/api/albums').then(setAlbums).catch(() => {});
    api.get('/api/playlists').then(setPlaylists).catch(() => {});
  }, []);

  const canEdit = (song) => user && (user.role === 'admin' || (artist && artist.id === song.artist_id));

  const handleDelete = async (song) => {
    try {
      await api.del(`/api/songs/${song.id}`);
      setSongs((s) => s.filter((x) => x.id !== song.id));
      toast('Track deleted');
    } catch (err) { toast(err.message, 'error'); }
  };

  const genres = ['Afrobeats', 'Afropop', 'R&B / Soul', 'Afro-fusion', 'Indie Rock', 'Indie Pop', 'Indie Folk', 'Synthpop', 'Alt Pop', 'Indie Dance', 'Electronic', 'Hip-Hop'];

  return (
    <div className="page">
      <PageHeader
        title="Songs"
        subtitle="Browse, play, download and manage the full catalog."
        actions={<button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Icon name="plus" size={17} /> Add track</button>}
      />

      <div className="filter-bar">
        <div className="filter-left">
          {q && (
            <span className="filter-chip">
              Search: “{q}”
              <button onClick={() => setSearchParams({})} aria-label="Clear search"><Icon name="close" size={14} /></button>
            </span>
          )}
          {artist && (
            <button className={`filter-tab ${mineOnly ? 'active' : ''}`} onClick={() => setMineOnly(!mineOnly)}>
              <Icon name="artist" size={15} /> My music
            </button>
          )}
        </div>
        <div className="filter-right">
          <select className="select" value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="">All genres</option>
            {genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Recently added</option>
            <option value="plays">Most played</option>
            <option value="downloads">Most downloaded</option>
            <option value="title">A–Z</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="stack">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} h={60} />)}
        </div>
      ) : (
        <SongTable
          songs={songs}
          onEdit={(s) => { setEditing(s); setFormOpen(true); }}
          onDelete={(s) => setDeleting(s)}
          onAddToPlaylist={(s) => setAddTarget(s)}
          canManage={canEdit}
          emptyFallback={
            <EmptyState
              icon="music"
              title={q || genre || mineOnly ? 'No tracks match' : 'No tracks yet'}
              description={q || genre || mineOnly ? 'Try adjusting your search or filters.' : 'Upload your first track to get started.'}
              action={<button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Icon name="upload" size={16} /> Upload a track</button>}
            />
          }
        />
      )}

      <SongFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => loadSongs()}
        song={editing}
        artists={artists}
        albums={albums}
        defaultArtistId={artist?.id}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && handleDelete(deleting)}
        title="Delete track"
        message={deleting ? `Are you sure you want to delete "${deleting.title}"? This cannot be undone.` : ''}
      />

      <AddToPlaylistModal
        open={!!addTarget}
        onClose={() => setAddTarget(null)}
        song={addTarget}
        playlists={playlists}
      />
    </div>
  );
}
