import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import { Spinner } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

export const PODCAST_CATEGORIES = [
  'Music', 'Technology', 'Culture', 'Business', 'Wellness',
  'Comedy', 'News', 'Sport', 'Education', 'Storytelling'
];

/** Create or edit a show. Cover art is optional; the API keeps the old one. */
export function PodcastFormModal({ open, onClose, onSaved, podcast }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [cover, setCover] = useState(null);
  const [form, setForm] = useState({ title: '', publisher: '', category: '', description: '' });

  useEffect(() => {
    if (!open) return;
    setCover(null);
    setForm({
      title: podcast?.title || '',
      publisher: podcast?.publisher || '',
      category: podcast?.category || '',
      description: podcast?.description || ''
    });
  }, [open, podcast]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast('Show title is required', 'error'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title.trim());
      fd.append('publisher', form.publisher.trim());
      fd.append('category', form.category.trim());
      fd.append('description', form.description.trim());
      if (cover) fd.append('cover', cover);
      const saved = podcast
        ? await api.uploadPut(`/api/podcasts/${podcast.id}`, fd)
        : await api.upload('/api/podcasts', fd);
      toast(podcast ? 'Show updated' : `“${saved.title}” created`);
      onSaved && onSaved(saved);
      onClose();
    } catch (err) {
      toast(err.message || 'Could not save this show', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={podcast ? 'Edit show' : 'Start a show'} width={520}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Show title *</span>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. The Signal Path"
            autoFocus
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Publisher</span>
            <input
              value={form.publisher}
              onChange={(e) => setForm((f) => ({ ...f, publisher: e.target.value }))}
              placeholder="Studio or network"
            />
          </label>
          <label className="field">
            <span>Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="">Choose…</option>
              {PODCAST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="What is this show about?"
          />
        </label>
        <label className="field file-field">
          <span>Cover art {podcast ? '(leave empty to keep current)' : '(optional)'}</span>
          <input type="file" accept="image/*" onChange={(e) => setCover(e.target.files?.[0] || null)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Spinner size={16} /> : podcast ? 'Save show' : 'Create show'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Publish an episode into a show you own. */
export function EpisodeFormModal({ open, onClose, onSaved, podcast }) {
  const { toast } = useToast();
  const fileRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [audio, setAudio] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', season: 1 });

  useEffect(() => {
    if (!open) return;
    setAudio(null);
    setForm({ title: '', description: '', season: 1 });
    if (fileRef.current) fileRef.current.value = '';
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast('Episode title is required', 'error'); return; }
    if (!audio) { toast('Choose an audio file for this episode', 'error'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title.trim());
      fd.append('description', form.description.trim());
      fd.append('season', String(form.season || 1));
      fd.append('audio', audio);
      const saved = await api.upload(`/api/podcasts/${podcast.id}/episodes`, fd);
      toast(`Published “${saved.title}”`);
      onSaved && onSaved(saved);
      onClose();
    } catch (err) {
      toast(err.message || 'Could not publish this episode', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`New episode — ${podcast?.title || ''}`} width={520}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Episode title *</span>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Latency Is a Design Problem"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Show notes</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="A short summary listeners will see in the feed"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Season</span>
            <input
              type="number"
              min="1"
              value={form.season}
              onChange={(e) => setForm((f) => ({ ...f, season: e.target.value }))}
            />
          </label>
          <label className="field file-field">
            <span>Audio file *</span>
            <input
              ref={fileRef}
              type="file"
              accept=".wav,.mp3,.m4a,.ogg,.flac,.aac,audio/*"
              onChange={(e) => setAudio(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        {audio && (
          <p className="field-hint ok">
            <Icon name="check" size={13} /> {audio.name} ready to upload
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Spinner size={16} /> : 'Publish episode'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default PodcastFormModal;
