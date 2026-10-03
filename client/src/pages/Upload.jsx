import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Spinner, PageHero, SectionHead } from '../components/ui.jsx';
import ArtistField from '../components/ArtistField.jsx';
import LinkedTrackField from '../components/LinkedTrackField.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes } from '../format.js';
import { AUDIO_ACCEPT, takeFiles } from '../uploadHandoff.js';

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
  const [form, setForm] = useState({ title: '', artist_name: '', album_id: '', genre: '', is_public: 1 });
  const [previewUrl, setPreviewUrl] = useState(null);
  // Adding a YouTube link is a different kind of "upload": no file, no bulk import.
  const [mode, setMode] = useState('files'); // 'files' | 'link'
  const [linked, setLinked] = useState(null);

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

  // Files chosen in the "share your music" prompt right after signing in arrive here ready to publish.
  useEffect(() => {
    const handedOver = takeFiles();
    if (handedOver.length) pickAudio(handedOver);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (mode === 'link' && !linked) { toast('Check a YouTube link first', 'error'); return; }
    if (mode === 'files' && !audioFiles.length) { toast('Please choose an audio file', 'error'); return; }
    if (mode === 'files' && !isBulk && !form.title.trim()) { toast('Title is required', 'error'); return; }
    if (mode === 'link' && !form.title.trim() && !linked.title) { toast('Title is required', 'error'); return; }

    const fd = new FormData();
    fd.append('title', (form.title.trim() || linked?.title || 'Untitled track'));
    if (form.artist_name.trim()) fd.append('artist_name', form.artist_name.trim());
    else if (mode === 'link' && linked?.artist) fd.append('artist_name', linked.artist);
    if (form.album_id) fd.append('album_id', form.album_id);
    if (form.genre) fd.append('genre', form.genre);
    fd.append('is_public', form.is_public ? '1' : '0');

    if (mode === 'link') {
      fd.append('provider', linked.provider);
      fd.append('external_id', linked.external_id);
      if (linked.cover_url) fd.append('cover_url', linked.cover_url);
    } else if (isBulk) {
      audioFiles.forEach((file) => fd.append('audio', file));
      fd.append('metadata', JSON.stringify(trackMetadata.map((meta) => ({
        ...meta,
        is_public: meta.is_public !== undefined ? meta.is_public : form.is_public
      }))));
    } else {
      fd.append('audio', audioFiles[0]);
      if (cover) fd.append('cover', cover);
    }

    setSaving(true);
    try {
      await api.upload(isBulk ? '/api/songs/import' : '/api/songs', fd);
      toast(
        isBulk
          ? `${audioFiles.length} tracks imported successfully 🎉`
          : form.is_public
            ? 'Track published publicly for everyone! 🎉'
            : 'Track saved privately to your library 🔒'
      );
      navigate('/library?filter=uploads');
    } catch (err) { toast(err.message || 'Upload failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="page">
      <PageHero
        icon="upload"
        title="Upload Music"
        chip={mode === 'link'
          ? (linked ? 'Link ready' : 'Plays via YouTube')
          : audioFiles.length ? `${audioFiles.length} file${audioFiles.length === 1 ? '' : 's'} ready` : 'Lossless friendly'}
        chipTone={(mode === 'link' ? linked : audioFiles.length) ? 'green' : ''}
        subtitle={mode === 'link'
          ? 'Link a YouTube video and Pulse plays it in YouTube’s own player — no download, no re-hosting.'
          : 'Drop up to 10 tracks at once — Pulse generates artwork, duration and waveform data automatically.'}
        actions={<Link className="btn btn-ghost btn-pill" to="/search?mine=1"><Icon name="music" size={16} /> Your uploads</Link>}
      />

      <form onSubmit={submit} className="upload-layout">
        <div className="upload-main">
          <div className="upload-modes" role="tablist" aria-label="How to add music">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'files'}
              className={`upload-mode ${mode === 'files' ? 'active' : ''}`}
              onClick={() => setMode('files')}
            >
              <Icon name="upload" size={16} /> Upload files
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'link'}
              className={`upload-mode ${mode === 'link' ? 'active' : ''}`}
              onClick={() => setMode('link')}
            >
              <Icon name="playCircle" size={16} /> Link a YouTube track
            </button>
          </div>

          {mode === 'link' ? (
            <section className="panel upload-fields">
              <div className="panel-head">
                <h3><Icon name="playCircle" size={17} /> YouTube link</h3>
                <span className="section-note">Plays in YouTube's player</span>
              </div>
              <p className="panel-desc">
                Paste a YouTube video link. Pulse keeps the link and plays it through YouTube's embedded
                player — nothing is downloaded or re-hosted. Linked tracks can't be saved for offline listening.
              </p>
              <LinkedTrackField
                linked={linked}
                onClear={() => setLinked(null)}
                onResolved={(preview) => {
                  setLinked(preview);
                  setForm((f) => ({
                    ...f,
                    title: f.title || preview.title || '',
                    artist_name: f.artist_name || preview.artist || ''
                  }));
                  toast('Link added — ready to publish 🎥', 'success');
                }}
              />
            </section>
          ) : (
            <label
            className={`dropzone ${dragging ? 'dragging' : ''} ${audio ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pickAudio(e.dataTransfer.files); }}
          >
            <input
              type="file"
              multiple
              accept={AUDIO_ACCEPT}
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
          )}

          {mode === 'files' && isBulk && (
            <section className="panel upload-fields bulk-metadata">
              <div className="panel-head">
                <h3><Icon name="list" size={17} /> Track metadata &amp; visibility</h3>
                <span className="section-note">{audioFiles.length} tracks</span>
              </div>
              <p className="panel-desc">Review the titles, genres, and individual privacy settings for each track before importing.</p>
              {trackMetadata.map((meta, index) => (
                <div className="field-row field-row-3" key={`${audioFiles[index].name}-${index}`}>
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
                  <label className="field">
                    <span>Visibility</span>
                    <select
                      value={meta.is_public !== undefined ? meta.is_public : form.is_public}
                      onChange={(e) => setTrackMetadata((items) => items.map((item, i) => (i === index ? { ...item, is_public: Number(e.target.value) } : item)))}
                    >
                      <option value={1}>🌐 Public</option>
                      <option value={0}>🔒 Private</option>
                    </select>
                  </label>
                </div>
              ))}
            </section>
          )}

          <section className="panel upload-fields">
            <div className="panel-head">
              <h3><Icon name={form.is_public ? 'globe' : 'lock'} size={17} /> Privacy &amp; Visibility</h3>
              <span className={`tag ${form.is_public ? 'tag-green' : 'tag-accent'}`}>
                {form.is_public ? 'Public' : 'Private'}
              </span>
            </div>
            <p className="panel-desc">
              Choose whether your music is published for everyone or kept private to your account.
            </p>
            <div className="visibility-grid">
              <div
                className={`visibility-option ${form.is_public ? 'active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, is_public: 1 }))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setForm((f) => ({ ...f, is_public: 1 })); } }}
              >
                <div className="vis-radio">
                  <span className={`vis-dot ${form.is_public ? 'checked' : ''}`} />
                </div>
                <div className="vis-icon-wrap vis-icon-public">
                  <Icon name="globe" size={24} />
                </div>
                <div className="vis-content">
                  <div className="vis-header">
                    <strong>Public Upload</strong>
                    <span className="vis-badge public">Published to everyone</span>
                  </div>
                  <p>
                    Published for everyone on Pulse. Appears in search, home discover rows, community uploads, artist profiles, and public recommendations.
                  </p>
                </div>
              </div>

              <div
                className={`visibility-option ${!form.is_public ? 'active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, is_public: 0 }))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setForm((f) => ({ ...f, is_public: 0 })); } }}
              >
                <div className="vis-radio">
                  <span className={`vis-dot ${!form.is_public ? 'checked' : ''}`} />
                </div>
                <div className="vis-icon-wrap vis-icon-private">
                  <Icon name="lock" size={24} />
                </div>
                <div className="vis-content">
                  <div className="vis-header">
                    <strong>Private Upload</strong>
                    <span className="vis-badge private">Only for you</span>
                  </div>
                  <p>
                    Kept completely private in your personal library. Only you can access, stream, and download it whenever you log in.
                  </p>
                </div>
              </div>
            </div>
          </section>

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
              <div className="spread">
                <span className="muted">{mode === 'link' ? 'Source' : 'Files'}</span>
                <strong>{mode === 'link' ? (linked ? 'YouTube link' : '—') : (audioFiles.length || '—')}</strong>
              </div>
              <div className="spread"><span className="muted">Total size</span><strong>{mode === 'link' ? '—' : totalSize ? formatBytes(totalSize) : '—'}</strong></div>
              <div className="spread"><span className="muted">Mode</span><strong>{mode === 'link' ? 'Embedded track' : isBulk ? 'Bulk import' : 'Single track'}</strong></div>
              <div className="spread">
                <span className="muted">Visibility</span>
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon name={form.is_public ? 'globe' : 'lock'} size={14} />
                  {form.is_public ? 'Public' : 'Private'}
                </strong>
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={saving || (mode === 'link' ? !linked : !audio)}
          >
            {saving ? (
              <><Spinner size={18} /> {form.is_public ? 'Publishing…' : 'Saving…'}</>
            ) : (
              <>
                <Icon name={form.is_public ? 'globe' : 'lock'} size={17} />
                {mode === 'link'
                  ? form.is_public ? 'Publish linked track' : 'Save linked track privately'
                  : isBulk
                    ? `Import ${audioFiles.length} tracks (${form.is_public ? 'Public' : 'Private'})`
                    : form.is_public ? 'Publish public track' : 'Save private track'}
              </>
            )}
          </button>
          {mode === 'files' && audio && (
            <button type="button" className="btn btn-ghost btn-block" onClick={clearAudio} disabled={saving}>
              Reset selection
            </button>
          )}
        </aside>
      </form>
    </div>
  );
}
