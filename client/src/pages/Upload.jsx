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
  const [audioFiles, setAudioFiles] = useState([]);
  const [trackMetadata, setTrackMetadata] = useState([]);
  const [cover, setCover] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState({ title: '', artist_name: '', album_id: '', genre: '' });
  const audioPreview = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    api.get('/api/artists').then(setArtists).catch(() => {});
    api.get('/api/albums').then(setAlbums).catch(() => {});
  }, []);

  useEffect(() => {
    if (artist && !form.artist_name) setForm((f) => ({ ...f, artist_name: artist.name }));
  }, [artist]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const pickAudio = (selected) => {
    const allFiles = Array.from(selected || []);
    if (!allFiles.length) return;
    if (allFiles.length > 10) { toast('You can import up to 10 tracks at once', 'error'); return; }
    const files = allFiles;
    if (files.some((file) => !/\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(file.name))) { toast('Use MP3, M4A, WAV, OGG, FLAC, or AAC files', 'error'); return; }
    setAudioFiles(files);
    setTrackMetadata(files.map((file) => ({
      title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim(),
      genre: form.genre || ''
    })));
    setAudio(files[0]);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(files.length === 1 ? URL.createObjectURL(files[0]) : null);
    if (files.length === 1 && !form.title) setForm((f) => ({ ...f, title: files[0].name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (audioFiles.length <= 1 && !form.title.trim()) { toast('Title is required', 'error'); return; }
    if (!audioFiles.length) { toast('Please choose an audio file', 'error'); return; }
    const fd = new FormData();
    if (form.artist_name.trim()) fd.append('artist_name', form.artist_name.trim());
    if (form.album_id) fd.append('album_id', form.album_id);
    if (form.genre) fd.append('genre', form.genre);
    const isBulk = audioFiles.length > 1;
    if (isBulk) {
      audioFiles.forEach((file) => fd.append('audio', file));
      fd.append('metadata', JSON.stringify(trackMetadata));
    } else {
      fd.append('title', form.title.trim());
      fd.append('audio', audioFiles[0]);
      if (cover) fd.append('cover', cover);
    }
    setSaving(true);
    try {
      await api.upload(isBulk ? '/api/songs/import' : '/api/songs', fd);
      toast(isBulk ? `${audioFiles.length} tracks imported successfully 🎉` : 'Track uploaded successfully 🎉');
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
            onDrop={(e) => { e.preventDefault(); setDragging(false); pickAudio(e.dataTransfer.files); }}
          >
            <input type="file" multiple accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac" onChange={(e) => pickAudio(e.target.files)} style={{ display: 'none' }} id="audio-input" />
            {audio ? (
              <div className="dropzone-file">
                <div className="dropzone-icon done"><Icon name="check" size={26} /></div>
                <div className="dz-title">{audioFiles.length > 1 ? `${audioFiles.length} tracks selected` : audio.name}</div>
                <div className="dz-sub">{audioFiles.length > 1 ? 'Track titles will be created from file names' : `${(audio.size / 1024 / 1024).toFixed(1)} MB — ready to upload`}</div>
                {audioFiles.length > 1 && <div className="file-note">{audioFiles.map((file) => file.name).join(' · ')}</div>}
                {previewUrl && <audio controls src={previewUrl} className="audio-preview" />}
                <span className="btn btn-ghost btn-sm" onClick={() => { setAudio(null); setAudioFiles([]); setPreviewUrl(null); }}>Choose different file</span>
              </div>
            ) : (
              <div className="dropzone-empty">
                <div className="dropzone-icon"><Icon name="upload" size={26} /></div>
                <div className="dz-title">Drag & drop your audio here</div>
                <div className="dz-sub">or click to browse — up to 10 MP3, M4A, WAV, OGG, FLAC, or AAC files (60MB each)</div>
                <span className="btn btn-primary btn-sm">Browse files</span>
              </div>
            )}
          </label>

          {audioFiles.length > 1 && (
          <section className="panel upload-fields bulk-metadata">
            <h3 className="panel-title-sm">Track metadata</h3>
            <p className="muted">Review the titles and set a genre for each track before importing.</p>
            {trackMetadata.map((meta, index) => (
              <div className="field-row" key={`${audioFiles[index].name}-${index}`}>
                <label className="field"><span>Title</span><input value={meta.title} onChange={(e) => setTrackMetadata((items) => items.map((item, i) => i === index ? { ...item, title: e.target.value } : item))} /></label>
                <label className="field"><span>Genre</span><select value={meta.genre} onChange={(e) => setTrackMetadata((items) => items.map((item, i) => i === index ? { ...item, genre: e.target.value } : item))}><option value="">Use common genre</option>{GENRES.map((genre) => <option key={genre} value={genre}>{genre}</option>)}</select></label>
              </div>
            ))}
          </section>
        )}

        <div className="panel upload-fields">
            <div className="field">
              <span>Track title *</span>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Midnight Drive" />
            </div>
            <div className="field-row">
              <label className="field">
                <span>Artist (song owner)</span>
                <input
                  list="upload-artist-options"
                  value={form.artist_name}
                  onChange={(e) => setForm((f) => ({ ...f, artist_name: e.target.value }))}
                  placeholder="Type the artist's name — existing or new"
                  autoComplete="off"
                />
                <datalist id="upload-artist-options">
                  {artists.map((a) => <option key={a.id} value={a.name} />)}
                </datalist>
                <ArtistHint name={form.artist_name} artists={artists} ownArtist={artist} />
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

/** Live hint under the artist input explaining what will happen on upload. */
function ArtistHint({ name, artists, ownArtist }) {
  const typed = name.trim();
  if (!typed) {
    return (
      <small className="field-hint">
        {ownArtist
          ? `Defaults to your artist profile — ${ownArtist.name}. Type any name to change the owner.`
          : 'Type the artist who owns this track — a new profile is created if the name is new.'}
      </small>
    );
  }
  const match = artists.find((a) => a.name.toLowerCase() === typed.toLowerCase());
  if (match) {
    return <small className="field-hint ok">Links to the existing artist profile — {match.name}.</small>;
  }
  return <small className="field-hint new">“{typed}” will be created as a new artist profile.</small>;
}
