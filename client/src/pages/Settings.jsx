import { useState, useEffect } from 'react';
import Icon from '../components/Icon.jsx';
import { Spinner, PageHeader } from '../components/ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { initials } from '../format.js';

export default function Settings() {
  const { user, artist, refreshArtist } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: '', bio: '', genre: '', country: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (artist) setForm({ name: artist.name || '', bio: artist.bio || '', genre: artist.genre || '', country: artist.country || '' });
  }, [artist]);

  const saveArtist = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast('Artist name is required', 'error'); return; }
    setSaving(true);
    try {
      await api.put(`/api/artists/${artist.id}`, form);
      await refreshArtist();
      toast('Artist profile updated');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" subtitle="Manage your account and artist profile." />

      <section className="panel">
        <div className="panel-head"><h3>Account</h3></div>
        <div className="profile-row">
          <div className="avatar avatar-lg">{user ? initials(user.name) : '?'}</div>
          <div className="profile-info">
            <div className="profile-name">{user?.name}</div>
            <div className="profile-email">{user?.email}</div>
            <span className="tag">{user?.role === 'admin' ? 'Admin' : 'Artist'}</span>
          </div>
        </div>
      </section>

      {artist && (
        <section className="panel">
          <div className="panel-head"><h3>Artist profile</h3></div>
          <form onSubmit={saveArtist} className="form">
            <div className="field-row">
              <label className="field"><span>Artist / stage name</span>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="field"><span>Genre</span>
                <input value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))} placeholder="Afrobeats" />
              </label>
            </div>
            <label className="field"><span>Country</span>
              <input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} placeholder="Nigeria" />
            </label>
            <label className="field"><span>Bio</span>
              <textarea rows={4} value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} placeholder="Tell listeners about yourself…" />
            </label>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Spinner size={16} /> : 'Save changes'}</button>
            </div>
          </form>
        </section>
      )}

      <section className="panel muted-panel">
        <div className="panel-head"><h3>About Pulse</h3></div>
        <p className="muted">Pulse is a full-stack music platform for artists — upload tracks, manage albums and playlists, stream your catalog, and download tracks for offline listening. Built with React, Node.js, Express and SQLite.</p>
      </section>
    </div>
  );
}
