import { useState, useEffect, useCallback } from 'react';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import { Spinner, Cover } from './ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import ArtistField from './ArtistField.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

export function AlbumFormModal({ open, onClose, onSaved, album, artists, defaultArtistId }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', artist_name: '', release_year: new Date().getFullYear(), genre: '' });

  useEffect(() => {
    if (open) setForm({
      title: album?.title || '',
      artist_name: album?.artist_name
        || artists.find((a) => a.id === (album?.artist_id || defaultArtistId))?.name
        || '',
      release_year: album?.release_year || new Date().getFullYear(),
      genre: album?.genre || ''
    });
  }, [open, album, defaultArtistId, artists]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast('Title is required', 'error'); return; }
    setSaving(true);
    try {
      const payload = { title: form.title.trim(), release_year: form.release_year, genre: form.genre || undefined };
      if (form.artist_name.trim()) payload.artist_name = form.artist_name.trim();
      const saved = album
        ? await api.put(`/api/albums/${album.id}`, payload)
        : await api.post('/api/albums', payload);
      toast(album ? 'Album updated' : 'Album created');
      onSaved(saved);
      onClose();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={album ? 'Edit Album' : 'New Album'} width={480}>
      <form onSubmit={submit} className="form">
        <label className="field"><span>Album title *</span>
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Golden Hour" autoFocus />
        </label>
        <div className="field-row">
          <label className="field"><span>Artist (album owner)</span>
            <ArtistField value={form.artist_name} onChange={(v) => setForm((f) => ({ ...f, artist_name: v }))} artists={artists} listId="album-artist-options" />
          </label>
          <label className="field"><span>Release year</span>
            <input type="number" min="1950" max="2100" value={form.release_year} onChange={(e) => setForm((f) => ({ ...f, release_year: e.target.value }))} />
          </label>
        </div>
        <label className="field"><span>Genre</span>
          <input value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))} placeholder="e.g. Afrobeats" />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Spinner size={16} /> : album ? 'Save' : 'Create album'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function PlaylistFormModal({ open, onClose, onSaved, playlist }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  useEffect(() => {
    if (open) setForm({ name: playlist?.name || '', description: playlist?.description || '' });
  }, [open, playlist]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      const saved = playlist
        ? await api.put(`/api/playlists/${playlist.id}`, { name: form.name.trim(), description: form.description })
        : await api.post('/api/playlists', { name: form.name.trim(), description: form.description });
      toast(playlist ? 'Playlist updated' : 'Playlist created');
      onSaved(saved);
      onClose();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={playlist ? 'Edit Playlist' : 'New Playlist'} width={440}>
      <form onSubmit={submit} className="form">
        <label className="field"><span>Name *</span>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Road Trip" autoFocus />
        </label>
        <label className="field"><span>Description</span>
          <textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What's this playlist about?" />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Spinner size={16} /> : playlist ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------- Add-to-playlist (Spotify-style) ------------------- */
/* One dialog for the whole app: pick any of YOUR playlists (check = in it,
   uncheck to remove) or type a name to create a new one on the spot with the
   track already added. Stays open while you toggle, like Spotify. */
export function useAddToPlaylistDialog(onChanged) {
  const [target, setTarget] = useState(null);
  const [lists, setLists] = useState([]);

  const refresh = useCallback(async () => {
    try { setLists(await api.get('/api/playlists?mine=1&with_songs=1')); }
    catch { setLists([]); }
  }, []);

  const open = useCallback((song) => { setTarget(song); refresh(); }, [refresh]);
  const close = useCallback(() => { setTarget(null); onChanged && onChanged(); }, [onChanged]);

  const dialog = (
    <AddToPlaylistModal
      open={!!target}
      onClose={close}
      song={target}
      playlists={lists}
      onPlaylistsChanged={refresh}
    />
  );
  return { open, dialog };
}

export function AddToPlaylistModal({ open, onClose, song, playlists = [], onPlaylistsChanged }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [localOverrides, setLocalOverrides] = useState({});

  useEffect(() => {
    if (open) { setQuery(''); setCreating(false); setNewName(''); setLocalOverrides({}); }
  }, [open]);

  if (!song) return null;

  const isIn = (pl) => (pl.song_ids || []).includes(song.id);

  const toggle = async (pl) => {
    const added = isIn(pl);
    setBusy(pl.id);
    try {
      if (added) await api.del(`/api/playlists/${pl.id}/songs/${song.id}`);
      else await api.post(`/api/playlists/${pl.id}/songs`, { song_id: song.id });
      toast(added ? `Removed from "${pl.name}"` : `Added to "${pl.name}"`);
      setPlaylistsLocal(pl.id, !added);
      onPlaylistsChanged && onPlaylistsChanged();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
    finally { setBusy(null); }
  };

  // optimistic local flip so the checkmark animates without a refetch
  const setPlaylistsLocal = (id, val) => setLocalOverrides((o) => ({ ...o, [id]: val }));
  const isEffective = (pl) => (pl.id in localOverrides ? localOverrides[pl.id] : isIn(pl));

  const createAndAdd = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) { toast('Name the playlist first', 'error'); return; }
    setCreatingBusy(true);
    try {
      const created = await api.post('/api/playlists', { name });
      await api.post(`/api/playlists/${created.id}/songs`, { song_id: song.id });
      toast(`Created "${name}" and added the song`);
      setNewName(''); setCreating(false);
      setLocalOverrides({});
      onPlaylistsChanged && onPlaylistsChanged();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
    finally { setCreatingBusy(false); }
  };

  const filtered = playlists.filter((pl) => !query || String(pl.name).toLowerCase().includes(query.toLowerCase()));

  return (
    <Modal open={open} onClose={onClose} title="Add to this playlist?" width={440}>
      <div className="atp-song">
        <Cover src={song.cover_url || song.album_cover} alt={song.title} size={48} />
        <div className="atp-song-text">
          <strong>{song.title}</strong>
          <span>{song.artist_name}</span>
        </div>
      </div>

      <div className="atp-search">
        <Icon name="search" size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your playlists"
          aria-label="Search playlists"
        />
      </div>

      {creating ? (
        <form className="atp-create" onSubmit={createAndAdd}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="My Playlist #1"
            aria-label="New playlist name"
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={creatingBusy}>
            {creatingBusy ? <Spinner size={14} /> : 'Create'}
          </button>
        </form>
      ) : (
        <button className="atp-new" onClick={() => setCreating(true)}>
          <span className="atp-new-icon"><Icon name="plus" size={16} /></span>
          New playlist
        </button>
      )}

      <div className="atp-list">
        {filtered.length === 0 && playlists.length === 0 && (
          <p className="muted pad">You have no playlists yet — create your first above.</p>
        )}
        {filtered.map((pl) => {
          const on = isEffective(pl);
          return (
            <button
              key={pl.id}
              className={`atp-row ${on ? 'on' : ''}`}
              onClick={() => toggle(pl)}
              disabled={busy === pl.id}
            >
              <span className="atp-check">{busy === pl.id ? <Spinner size={14} /> : on && <Icon name="check" size={15} />}</span>
              <span className="atp-name">{pl.name}</span>
              <span className="atp-count">{pl.track_count} songs</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function IconPlus() { return <Icon name="plus" size={16} />; }
