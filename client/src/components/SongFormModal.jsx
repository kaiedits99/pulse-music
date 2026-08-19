import { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { Spinner } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

const GENRES = ['Afrobeats', 'Afropop', 'R&B / Soul', 'Afro-fusion', 'Indie Rock', 'Indie Pop', 'Indie Folk', 'Synthpop', 'Alt Pop', 'Indie Dance', 'Electronic', 'Hip-Hop', 'Jazz', 'Gospel', 'Other'];

export default function SongFormModal({ open, onClose, onSaved, song, artists, albums, defaultArtistId }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', artist_id: '', album_id: '', genre: '', audio: null, cover: null
  });

  useEffect(() => {
    if (open) {
      setForm({
        title: song?.title || '',
        artist_id: song?.artist_id || defaultArtistId || '',
        album_id: song?.album_id || '',
        genre: song?.genre || '',
        audio: null,
        cover: null
      });
    }
  }, [open, song, defaultArtistId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast('Title is required', 'error'); return; }
    if (!song && !form.audio) { toast('Please choose an audio file', 'error'); return; }

    const fd = new FormData();
    fd.append('title', form.title.trim());
    if (form.artist_id) fd.append('artist_id', form.artist_id);
    if (form.album_id) fd.append('album_id', form.album_id);
    if (form.genre) fd.append('genre', form.genre);
    if (form.audio) fd.append('audio', form.audio);
    if (form.cover) fd.append('cover', form.cover);

    setSaving(true);
    try {
      const saved = song
        ? await api.uploadPut(`/api/songs/${song.id}`, fd)
        : await api.upload('/api/songs', fd);
      toast(song ? 'Track updated' : 'Track uploaded successfully');
      onSaved(saved);
      onClose();
    } catch (err) {
      toast(err.message || 'Failed to save track', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={song ? 'Edit Track' : 'Upload New Track'} width={560}>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Title *</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Midnight Drive" autoFocus />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Artist</span>
            <select value={form.artist_id} onChange={(e) => set('artist_id', e.target.value)}>
              <option value="">— Select artist —</option>
              {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Album (optional)</span>
            <select value={form.album_id} onChange={(e) => set('album_id', e.target.value)}>
              <option value="">— None —</option>
              {albums.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Genre</span>
          <select value={form.genre} onChange={(e) => set('genre', e.target.value)}>
            <option value="">— Select genre —</option>
            {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <div className="field-row">
          <label className="field file-field">
            <span>{song ? 'Replace audio (optional)' : 'Audio file *'}</span>
            <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac" onChange={(e) => set('audio', e.target.files[0])} />
            {form.audio && <em className="file-note">{form.audio.name}</em>}
          </label>
          <label className="field file-field">
            <span>Cover image (optional)</span>
            <input type="file" accept="image/*,.svg,.png,.jpg,.jpeg,.webp" onChange={(e) => set('cover', e.target.files[0])} />
            {form.cover && <em className="file-note">{form.cover.name}</em>}
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Spinner size={16} /> : song ? 'Save changes' : 'Upload track'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
