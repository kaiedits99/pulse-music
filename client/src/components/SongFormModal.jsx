import { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { Spinner } from './ui.jsx';
import ArtistField from './ArtistField.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

const GENRES = ['Afrobeats', 'Afropop', 'R&B / Soul', 'Afro-fusion', 'Indie Rock', 'Indie Pop', 'Indie Folk', 'Synthpop', 'Alt Pop', 'Indie Dance', 'Electronic', 'Hip-Hop', 'Jazz', 'Gospel', 'Other'];

export default function SongFormModal({ open, onClose, onSaved, song, artists, albums, defaultArtistId }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', artist_id: '', album_id: '', artist_name: '', album_title: '', genre: '', audio: null, source_url: '', cover: null
  });

  useEffect(() => {
    if (open) {
      setForm({
        title: song?.title || '',
        artist_id: song?.artist_id || defaultArtistId || '',
        album_id: song?.album_id || '',
        artist_name: song?.artist_name || artists.find((a) => a.id === song?.artist_id)?.name || '',
        album_title: song?.album_title || albums.find((a) => a.id === song?.album_id)?.title || '',
        genre: song?.genre || '',
        audio: null,
        source_url: song?.source_url || '',
        cover: null
      });
    }
  }, [open, song, defaultArtistId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast('Title is required', 'error'); return; }
    if (!song && !form.audio && !form.source_url.trim()) { toast('Choose an audio file or provide a licensed HTTPS playback URL', 'error'); return; }

    const fd = new FormData();
    fd.append('title', form.title.trim());
    if (form.artist_id) fd.append('artist_id', form.artist_id);
    if (form.artist_name.trim()) fd.append('artist_name', form.artist_name.trim());
    if (form.album_id) fd.append('album_id', form.album_id);
    if (form.album_title.trim()) fd.append('album_title', form.album_title.trim());
    if (form.genre) fd.append('genre', form.genre);
    if (form.audio) fd.append('audio', form.audio);
    if (form.source_url.trim()) fd.append('source_url', form.source_url.trim());
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
            <ArtistField value={form.artist_name} onChange={(v) => setForm((f) => ({ ...f, artist_name: v, artist_id: '' }))} artists={artists} listId="song-artist-options" />
          </label>
          <label className="field">
            <span>Album (optional)</span>
            <input list="album-options" value={form.album_title} onChange={(e) => { const a = albums.find((x) => x.title === e.target.value); setForm((f) => ({ ...f, album_title: e.target.value, album_id: a?.id || '' })); }} placeholder="Type an album title" />
            <datalist id="album-options">{albums.map((a) => <option key={a.id} value={a.title} />)}</datalist>
          </label>
        </div>

        <label className="field">
          <span>Genre</span>
          <select value={form.genre} onChange={(e) => set('genre', e.target.value)}>
            <option value="">— Select genre —</option>
            {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <label className="field">
          <span>Licensed playback URL (optional)</span>
          <input type="url" value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://licensed-provider.example/track" />
          <small className="muted">Use an HTTPS audio URL supplied by a provider that authorizes playback. Pulse plays it directly and never copies or proxies it.</small>
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
