import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import Drawer from './Drawer.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { api } from '../api.js';
import { initials } from '../format.js';

export default function AccountDrawer({ open, onClose }) {
  const { user, artist, logout, refreshArtist } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', bio: '', genre: '', country: '' });

  useEffect(() => {
    if (artist) setForm({ name: artist.name || '', bio: artist.bio || '', genre: artist.genre || '', country: artist.country || '' });
  }, [artist]);

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast('Artist name is required', 'error');
    setSaving(true);
    try {
      await api.put(`/api/artists/${artist.id}`, form);
      await refreshArtist();
      setEditing(false);
      toast('Artist profile updated');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const signOut = () => {
    logout();
    onClose();
    navigate('/login');
  };

  return (
    <Drawer open={open} onClose={onClose} title="Your account">
      <section className="drawer-profile">
        <div className="avatar avatar-lg">{initials(user?.name)}</div>
        <div>
          <h3>{user?.name}</h3>
          <p>{user?.email}</p>
          <span className="tag">{user?.role === 'admin' ? 'Admin' : 'Artist'}</span>
        </div>
      </section>

      <section className="drawer-section">
        <h4>Appearance</h4>
        <div className="drawer-theme-toggle">
          <button
            type="button"
            className={`drawer-theme-btn ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
          >
            <Icon name="moon" size={16} /> Dark Mode
          </button>
          <button
            type="button"
            className={`drawer-theme-btn ${theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}
          >
            <Icon name="sun" size={16} /> Light (White & Purple)
          </button>
        </div>
      </section>

      <nav className="drawer-section" aria-label="Account navigation">
        <h4>Quick access</h4>
        {[
          ['settings', 'Settings', 'Manage your profile & theme', 'settings'],
          ['upload', 'Upload music', 'Add a new track', 'upload'],
          ['favorites', 'Favorites', 'Your saved music', 'heart']
        ].map(([to, label, sub, icon]) => (
          <Link className="drawer-link" to={`/${to}`} onClick={onClose} key={to}>
            <Icon name={icon} size={18} />
            <span>
              <strong>{label}</strong>
              <small>{sub}</small>
            </span>
            <Icon name="arrowLeft" size={15} className="drawer-arrow" />
          </Link>
        ))}
      </nav>

      {artist && (
        <section className="drawer-section">
          <div className="drawer-section-head">
            <h4>Artist profile</h4>
            <button className="link-btn" onClick={() => setEditing(!editing)}>
              {editing ? 'Cancel' : 'Edit'}
            </button>
          </div>
          {editing ? (
            <form className="form" onSubmit={save}>
              <label className="field">
                <span>Stage name</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="field">
                <span>Genre</span>
                <input value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} />
              </label>
              <label className="field">
                <span>Bio</span>
                <textarea rows="3" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
              </label>
              <button className="btn btn-primary btn-block" disabled={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </button>
            </form>
          ) : (
            <>
              <div className="drawer-artist-name">{artist.name}</div>
              <p className="muted">{artist.genre || 'Artist'}{artist.country ? ` · ${artist.country}` : ''}</p>
            </>
          )}
        </section>
      )}

      <div className="drawer-footer">
        <button className="btn btn-ghost btn-block" onClick={signOut}>
          <Icon name="logout" size={17} /> Sign out
        </button>
      </div>
    </Drawer>
  );
}
