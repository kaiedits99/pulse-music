import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Spinner, PageHero, SectionHead } from '../components/ui.jsx';
import ArtistField from '../components/ArtistField.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes } from '../format.js';

const GENRES = ['Afrobeats', 'Afropop', 'R&B / Soul', 'Afro-fusion', 'Indie Rock', 'Indie Pop', 'Indie Folk', 'Synthpop', 'Alt Pop', 'Indie Dance', 'Electronic', 'Hip-Hop', 'Jazz', 'Gospel', 'Other'];
const AUDIO_RE = /\.(wav|mp3|m4a|ogg|flac|aac)$/i;

export default function Upload() {
  const { artist } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [artists, setArtists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [saving, setSaving] = useState(false);
  const [audioFiles, setAudioFiles] = useState([]);
  const [trackMetadata, setTrackMetadata] = useState([]);
  const [cover, setCover] = useState(null);
  const [coverUrl, setCoverUrl] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState({ title: '', artist_name: '', album_id: '', genre: '' });
  const [previewUrl, setPreviewUrl] = useState(null);

  const audio = audioFiles[0] || null;
  const isBulk = audioFiles.length > 1;

  useEffect(() => {
    api.get('/api/artists').then(setArtists).catch(() => {});
    api.get('/api/albums').then(setAlbums).catch(() => {});
  }, []);

  useEffect(() => {
    if (artist && !form.artist_name) setForm((f) => ({ ...f, artist_name: artist.name }));
  }, [artist]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { if (coverUrl) URL.revokeObjectURL(coverUrl); }, [coverUrl]);

  const totalSize = useMemo(() => audioFiles.reduce((t, f) => t + f.size, 0), [audioFiles]);

  const pickAudio = (selected) => {
    const files = Array.from(selected || []);
    if (!files.length) return;
    if (files.length > 10) { toast('You can import up to 10 tracks at once', 'error'); return; }
    if (files.some((file) => !AUDIO_RE.test(file.name))) { toast('Use MP3, M4A, WAV, OGG, FLAC, or AAC files', 'error'); return; }

    setAudioFiles(files);
    setTrackMetadata(files.map((file) => ({
      title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim(),
      genre: form.genre || ''
    })));
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(files.length === 1 ? URL.createObjectURL(files[0]) : null);
    if (files.length === 1 && !form.title) {
      setForm((f) => ({ ...f, title: files[0].name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') }));
    }
  };

  const clearAudio = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setAudioFiles([]);
    setTrackMetadata([]);
  };

  const pickCover = (file) => {
    if (!file) return;
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setCover(file);
    setCoverUrl(URL.createObjectURL(file));
  };

  const clearCover = () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setCover(null);
    setCoverUrl(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!audioFiles.length) { toast('Please choose an audio file', 'error'); return; }
    if (!isBulk && !form.title.trim()) { toast('Title is required', 'error'); return; }

    const fd = new FormData();
    if (form.artist_name.trim()) fd.append('artist_name', form.artist_name.trim());
    if (form.album_id) fd.append('album_id', form.album_id);
    if (form.genre) fd.append('genre', form.genre);

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
      navigate('/search?mine=1');
    } catch (err) { toast(err.message || 'Upload failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="page">
      <PageHero
        icon="upload"
        title="Upload Music"
        chip={audioFiles.length ? `${audioFiles.length} file${audioFiles.length === 1 ? '' : 's'} ready` : 'Lossless friendly'}
        chipTone={audioFiles.length ? 'green' : ''}
        subtitle="Drop up to 10 tracks at once — Pulse generates artwork, duration and waveform data automatically."
        actions={<Link className="btn btn-ghost btn-pill" to="/search?mine=1"><Icon name="music" size={16} /> Your uploads</Link>}
      />

      <form onSubmit={submit} className="upload-layout">
        <div className="upload-main">
          <label
            className={`dropzone ${dragging ? 'dragging' : ''} ${audio ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pickAudio(e.dataTransfer.files); }}
          >
            <input
              type="file"
              multiple
              accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac"
              onChange={(e) => pickAudio(e.target.files)}
              style={{ display: 'none' }}
              id="audio-input"
            />
            {audio ? (
              <div className="dropzone-file">
                <div className="dropzone-icon done"><Icon name="checkCircle" size={26} /></div>
                <div className="dz-title">{isBulk ? `${audioFiles.length} tracks selected` : audio.name}</div>
                <div className="dz-sub">
                  {isBulk
                    ? `${formatBytes(totalSize)} total — titles are taken from file names`
                    : `${formatBytes(audio.size)} — ready to upload`}
                </div>
                {isBulk && <div className="file-note">{audioFiles.map((file) => file.name).join(' · ')}</div>}
                {previewUrl && <audio controls src={previewUrl} className="audio-preview" />}
                <span
                  className="btn btn-ghost btn-sm btn-pill"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearAudio(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clearAudio(); } }}
                >
                  <Icon name="refresh" size={15} /> Choose different file
                </span>
              </div>
            ) : (
              <div className="dropzone-empty">
                <div className="dropzone-icon"><Icon name="upload" size={26} /></div>
                <div className="dz-title">Drag &amp; drop your audio here</div>
                <div className="dz-sub">or click to browse — up to 10 MP3, M4A, WAV, OGG, FLAC or AAC files (60&nbsp;MB each)</div>
                <span className="btn btn-primary btn-sm btn-pill"><Icon name="folder" size={15} /> Browse files</span>
              </div>
            )}
          </label>

          {isBulk && (
            <section className="panel upload-fields bulk-metadata">
              <div className="panel-head">
                <h3><Icon name="list" size={17} /> Track metadata</h3>
                <span className="section-note">{audioFiles.length} tracks</span>
              </div>
              <p className="panel-desc">Review the titles and set a genre for each track before importing.</p>
              {trackMetadata.map((meta, index) => (
                <div className="field-row" key={`${audioFiles[index].name}-${index}`}>
                  <label className="field">
                    <span>Title</span>
                    <input
                      value={meta.title}
                      onChange={(e) => setTrackMetadata((items) => items.map((item, i) => (i === index ? { ...item, title: e.target.value } : item)))}
                    />
                  </label>
                  <label className="field">
                    <span>Genre</span>
                    <select
                      value={meta.genre}
                      onChange={(e) => setTrackMetadata((items) => items.map((item, i) => (i === index ? { ...item, genre: e.target.value } : item)))}
                    >
                      <option value="">Use common genre</option>
                      {GENRES.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </section>
          )}

          <section className="panel upload-fields">
            <div className="panel-head">
              <h3><Icon name="edit" size={17} /> Track details</h3>
            </div>

            {!isBulk && (
              <label className="field">
                <span>Track title *</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Midnight Drive"
                />
              </label>
            )}

            <div className="field-row">
              <label className="field">
                <span>Artist (song owner)</span>
                <ArtistField
                  value={form.artist_name}
                  onChange={(v) => setForm((f) => ({ ...f, artist_name: v }))}
                  artists={artists}
                  listId="upload-artist-options"
                />
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
              <span>{isBulk ? 'Common genre' : 'Genre'}</span>
              <select value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}>
                <option value="">— Select genre —</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <p className="field-hint">Genre powers your recommendations and the Browse grid on Home.</p>
          </section>
        </div>

        <aside className="upload-side">
          <div className="panel">
            <h3 className="panel-title-sm">Cover art</h3>
            <label className="cover-picker">
              <input
                type="file"
                accept="image/*,.svg,.png,.jpg,.jpeg,.webp"
                onChange={(e) => pickCover(e.target.files[0])}
                style={{ display: 'none' }}
                disabled={isBulk}
              />
              {coverUrl ? (
                <img src={coverUrl} alt="cover" className="cover-preview" />
              ) : (
                <div className="cover-placeholder">
                  <Icon name="folderImage" size={30} />
                  <span>{isBulk ? 'Auto-generated' : 'Add image'}</span>
                </div>
              )}
            </label>
            {cover
              ? <div className="cover-note">{cover.name} · <button type="button" className="link-btn" onClick={clearCover}>remove</button></div>
              : <div className="cover-note">{isBulk ? 'Bulk imports get generated artwork' : 'Square JPG or PNG works best'}</div>}
          </div>

          <div className="panel muted-panel">
            <h3 className="panel-title-sm">Ready to publish</h3>
            <div className="stack">
              <div className="spread"><span className="muted">Files</span><strong>{audioFiles.length || '—'}</strong></div>
              <div className="spread"><span className="muted">Total size</span><strong>{totalSize ? formatBytes(totalSize) : '—'}</strong></div>
              <div className="spread"><span className="muted">Mode</span><strong>{isBulk ? 'Bulk import' : 'Single track'}</strong></div>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={saving || !audio}>
            {saving ? <><Spinner size={18} /> Publishing…</> : <><Icon name="upload" size={17} /> {isBulk ? `Import ${audioFiles.length} tracks` : 'Publish track'}</>}
          </button>
          {audio && (
            <button type="button" className="btn btn-ghost btn-block" onClick={clearAudio} disabled={saving}>
              Reset selection
            </button>
          )}
        </aside>
      </form>
    </div>
  );
}
