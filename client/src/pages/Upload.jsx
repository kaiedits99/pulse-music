import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Spinner, PageHeader } from '../components/ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const GENRES = ['Afrobeats', 'Afropop', 'R&B / Soul', 'Afro-fusion', 'Indie Rock', 'Indie Pop', 'Indie Folk', 'Synthpop', 'Alt Pop', 'Indie Dance', 'Electronic', 'Hip-Hop', 'Jazz', 'Gospel', 'Other'];

export default function Upload() {
  const { artist } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [artists, setArtists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [saving, setSaving] = useState(false);
  const [audio, setAudio] = useState(null);
  const [cover, setCover] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState({ title: '', artist_id: '', album_id: '', genre: '' });
  const audioPreview = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    api.get('/api/artists').then(setArtists).catch(() => {});
    api.get('/api/albums').then(setAlbums).catch(() => {});
  }, []);

  useEffect(() => {
    if (artist && !form.artist_id) setForm((f) => ({ ...f, artist_id: artist.id }));
  }, [artist]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const pickAudio = (file) => {
    if (!file) return;
    if (!/\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(file.name)) { toast('Unsupported audio format', 'error'); return; }
    setAudio(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    if (!form.title) setForm((f) => ({ ...f, title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast('Title is required', 'error'); return; }
    if (!audio) { toast('Please choose an audio file', 'error'); return; }
    const fd = new FormData();
    fd.append('title', form.title.trim());
    if (form.artist_id) fd.append('artist_id', form.artist_id);
    if (form.album_id) fd.append('album_id', form.album_id);
    if (form.genre) fd.append('genre', form.genre);
    fd.append('audio', audio);
    if (cover) fd.append('cover', cover);
    setSaving(true);
    try {
      await api.upload('/api/songs', fd);
      toast('Track uploaded successfully 🎉');
      navigate('/songs');
    } catch (err) { toast(err.message || 'Upload failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="page">
      <PageHeader title="Upload Music" subtitle="Share a new track with your listeners." />

      <form onSubmit={submit} className="upload-layout">
        <div className="upload-main">
          <label
            className={`dropzone ${dragging ? 'dragging' : ''} ${audio ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pickAudio(e.dataTransfer.files[0]); }}
          >
            <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac" onChange={(e) => pickAudio(e.target.files[0])} style={{ display: 'none' }} id="audio-input" />
            {audio ? (
              <div className="dropzone-file">
                <div className="dropzone-icon done"><Icon name="check" size={26} /></div>
                <div className="dz-title">{audio.name}</div>
                <div className="dz-sub">{(audio.size / 1024 / 1024).toFixed(1)} MB — ready to upload</div>
                {previewUrl && <audio controls src={previewUrl} className="audio-preview" />}
                <span className="btn btn-ghost btn-sm" onClick={() => { setAudio(null); setPreviewUrl(null); }}>Choose different file</span>
              </div>
            ) : (
              <div className="dropzone-empty">
                <div className="dropzone-icon"><Icon name="upload" size={26} /></div>
                <div className="dz-title">Drag & drop your audio here</div>
                <div className="dz-sub">or click to browse — WAV, MP3, M4A, OGG, FLAC (max 60MB)</div>
                <span className="btn btn-primary btn-sm">Browse files</span>
              </div>
            )}
          </label>

          <div className="panel upload-fields">
            <div className="field">
              <span>Track title *</span>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Midnight Drive" />
            </div>
            <div className="field-row">
              <label className="field">
                <span>Artist</span>
                <select value={form.artist_id} onChange={(e) => setForm((f) => ({ ...f, artist_id: e.target.value }))}>
                  <option value="">— Select artist —</option>
                  {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Album (optional)</span>
                <select value={form.album_id} onChange={(e) => setForm((f) => ({ ...f, album_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {albums.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Genre</span>
              <select value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}>
                <option value="">— Select genre —</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          </div>
        </div>

        <aside className="upload-side">
          <div className="panel">
            <h3 className="panel-title-sm">Cover art</h3>
            <label className="cover-picker">
              <input type="file" accept="image/*,.svg,.png,.jpg,.jpeg,.webp" onChange={(e) => setCover(e.target.files[0])} style={{ display: 'none' }} />
              {cover ? (
                <img src={URL.createObjectURL(cover)} alt="cover" className="cover-preview" />
              ) : (
                <div className="cover-placeholder"><Icon name="album" size={30} /><span>Add image</span></div>
              )}
            </label>
            {cover && <div className="cover-note">{cover.name}</div>}
          </div>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={saving || !audio}>
            {saving ? <Spinner size={18} /> : <>Publish track</>}
          </button>
        </aside>
      </form>
    </div>
  );
}
