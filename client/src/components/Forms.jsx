import { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import { Spinner } from './ui.jsx';
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

export function AddToPlaylistModal({ open, onClose, song, playlists, onAdded }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(null);
  if (!song) return null;

  const add = async (pl) => {
    setBusy(pl.id);
    try {
      await api.post(`/api/playlists/${pl.id}/songs`, { song_id: song.id });
      toast(`Added to "${pl.name}"`);
      onAdded && onAdded();
      onClose();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
    finally { setBusy(null); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Add "${song.title}" to playlist`} width={420}>
      <div className="playlist-picker">
        {playlists.length === 0 && <p className="muted pad">No playlists yet — create one from the Playlists page.</p>}
        {playlists.map((pl) => (
          <button key={pl.id} className="playlist-pick" onClick={() => add(pl)} disabled={busy === pl.id}>
            <span className="playlist-pick-name">{pl.name}</span>
            <span className="playlist-pick-count">{pl.track_count} tracks</span>
            {busy === pl.id ? <Spinner size={15} /> : <IconPlus />}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function IconPlus() { return <Icon name="plus" size={16} />; }
