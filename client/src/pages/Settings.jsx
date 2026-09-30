import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Spinner, PageHero } from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { initials, formatBytes } from '../format.js';
import { clearAllDownloads, downloadedSongs, downloadedPlaylists, OFFLINE_EVENT } from '../offline.js';

const GENRE_OPTIONS = [
  { id: 'Pop', name: 'Pop', desc: 'Vocal anthems & modern hooks', icon: 'music' },
  { id: 'Indie', name: 'Indie', desc: 'Acoustic warmth & indie anthems', icon: 'wave' },
  { id: 'Alternative Rock', name: 'Alternative Rock', desc: 'Electric energy & driving guitars', icon: 'sparkle' },
  { id: 'Rock', name: 'Rock', desc: 'Stadium anthems & powerful riffs', icon: 'trending' },
  { id: 'K-Pop', name: 'K-Pop', desc: 'Upbeat dance & melodic hooks', icon: 'heart' },
  { id: 'EDM', name: 'EDM', desc: 'Electronic euphoria & festival drops', icon: 'wave' },
  { id: 'Other', name: 'Other', desc: 'Afrobeats, R&B, Soul & Fusion', icon: 'sparkle' }
];

export default function Settings() {
  const { user, artist, refreshArtist, updatePreferences, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const { canInstall, installed, promptInstall } = useInstallPrompt();

  const [form, setForm] = useState({ name: '', bio: '', genre: '', country: '' });
  const [savingArtist, setSavingArtist] = useState(false);

  // Username & preferences state
  const [usernameVal, setUsernameVal] = useState(user?.username || '');
  const [selectedGenres, setSelectedGenres] = useState(user?.favorite_genres || []);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [unameStatus, setUnameStatus] = useState({ checking: false, available: null, reason: '' });
  const checkTimerRef = useRef(null);

  // Storage
  const [storage, setStorage] = useState({ usage: 0, quota: 0 });
  const [offline, setOffline] = useState({ songs: 0, playlists: 0 });
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (artist) {
      setForm({
        name: artist.name || '',
        bio: artist.bio || '',
        genre: artist.genre || '',
        country: artist.country || ''
      });
    }
  }, [artist]);

  useEffect(() => {
    if (user) {
      setUsernameVal(user.username || '');
      setSelectedGenres(user.favorite_genres || []);
    }
  }, [user]);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      setOffline({ songs: downloadedSongs().length, playlists: downloadedPlaylists().length });
      try {
        const est = await navigator.storage?.estimate?.();
        if (alive && est) setStorage({ usage: est.usage || 0, quota: est.quota || 0 });
      } catch { /* unsupported */ }
    };
    read();
    window.addEventListener(OFFLINE_EVENT, read);
    return () => { alive = false; window.removeEventListener(OFFLINE_EVENT, read); };
  }, []);

  const onUnameChange = (val) => {
    const clean = val.replace(/[^a-zA-Z0-9_]/g, '');
    setUsernameVal(clean);
    if (!clean || clean === user?.username) {
      setUnameStatus({ checking: false, available: null, reason: '' });
      return;
    }
    if (clean.length < 3) {
      setUnameStatus({ checking: false, available: false, reason: 'At least 3 characters' });
      return;
    }
    setUnameStatus((prev) => ({ ...prev, checking: true }));
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/auth/check-username?username=${encodeURIComponent(clean)}`);
        setUnameStatus({ checking: false, available: res.available, reason: res.reason || '' });
      } catch {
        setUnameStatus({ checking: false, available: null, reason: '' });
      }
    }, 280);
  };

  const toggleGenre = (genreId) => {
    if (selectedGenres.includes(genreId)) {
      setSelectedGenres(selectedGenres.filter((g) => g !== genreId));
    } else {
      if (selectedGenres.length >= 3) {
        toast('You can pick up to 3 favorite genres', 'info');
        return;
      }
      setSelectedGenres([...selectedGenres, genreId]);
    }
  };

  const savePreferences = async (e) => {
    e.preventDefault();
    if (unameStatus.available === false && usernameVal !== user?.username) {
      return toast('Please select an available username', 'error');
    }
    if (!selectedGenres.length) {
      return toast('Select at least 1 genre for your recommendations', 'error');
    }
    setSavingPrefs(true);
    try {
      await updatePreferences({
        username: usernameVal.trim() !== user?.username ? usernameVal.trim() : undefined,
        favoriteGenres: selectedGenres
      });
      toast('Music preferences updated! Recommendations refreshed.');
    } catch (err) {
      toast(err.message || 'Could not save preferences', 'error');
    } finally {
      setSavingPrefs(false);
    }
  };

  const saveArtist = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast('Artist name is required', 'error'); return; }
    setSavingArtist(true);
    try {
      await api.put(`/api/artists/${artist.id}`, form);
      await refreshArtist();
      toast('Artist profile updated');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSavingArtist(false); }
  };

  const doInstall = async () => {
    const res = await promptInstall();
    if (res === 'accepted') toast('Installing Pulse…');
    else if (res === 'dismissed') toast('Install dismissed', 'info');
    else toast('Use your browser menu → “Add to Home Screen” to install Pulse', 'info');
  };

  const clearDownloads = async () => {
    await clearAllDownloads();
    toast('All downloads cleared');
  };

  return (
    <div className="page page-narrow">
      <PageHero
        icon="settings"
        title="Settings"
        chip={theme === 'dark' ? 'Dark mode' : 'Light mode'}
        subtitle="Manage your account, music taste, offline storage and how Pulse looks."
        actions={<Link className="btn btn-ghost btn-pill" to="/library"><Icon name="library" size={16} /> Your Library</Link>}
      />

      {/* ====================================== Appearance & Theme ======= */}
      <section className="panel">
        <div className="panel-head"><h3><Icon name="sun" size={17} /> Appearance &amp; Theme</h3></div>
        <p className="panel-desc">Dark midnight keeps the neon purple vibe; light mode blends a clean white canvas with purple gradients and green play accents.</p>
        <div className="theme-grid">
          <button type="button" className={`theme-card ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>
            <div className="theme-card-preview dark-preview">
              <div className="tcp-header"><span className="tcp-dot" /><span className="tcp-bar" /></div>
              <div className="tcp-body">
                <div className="tcp-sidebar" />
                <div className="tcp-content"><div className="tcp-line accent" /><div className="tcp-line" /></div>
              </div>
            </div>
            <div className="theme-card-title"><Icon name="moon" size={17} /><span>Dark Mode</span></div>
            <p className="theme-card-desc">Deep midnight canvas with vivid neon purple accents</p>
            {theme === 'dark' && <span className="theme-badge"><Icon name="check" size={13} /> Active</span>}
          </button>

          <button type="button" className={`theme-card ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>
            <div className="theme-card-preview light-preview">
              <div className="tcp-header"><span className="tcp-dot" /><span className="tcp-bar" /></div>
              <div className="tcp-body">
                <div className="tcp-sidebar" />
                <div className="tcp-content"><div className="tcp-line accent" /><div className="tcp-line" /></div>
              </div>
            </div>
            <div className="theme-card-title"><Icon name="sun" size={17} /><span>Light Mode</span></div>
            <p className="theme-card-desc">Clean white canvas with purple primary actions and green play buttons</p>
            {theme === 'light' && <span className="theme-badge"><Icon name="check" size={13} /> Active</span>}
          </button>
        </div>
      </section>

      {/* ================================ Music taste & recommendations == */}
      <section className="panel">
        <div className="panel-head">
          <h3><Icon name="sparkle" size={17} /> Your music taste</h3>
          <span className="section-note">{selectedGenres.length}/3 selected</span>
        </div>
        <p className="panel-desc">Choose <strong>1 to 3 favorite genres</strong> to customise the music recommended to you across Pulse.</p>

        <form onSubmit={savePreferences} className="form">
          <div className="genre-picker-grid">
            {GENRE_OPTIONS.map((g) => {
              const isSelected = selectedGenres.includes(g.id);
              const isMaxAndNotSelected = selectedGenres.length >= 3 && !isSelected;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={isSelected}
                  className={`genre-card ${isSelected ? 'selected' : ''} ${isMaxAndNotSelected ? 'dimmed' : ''}`}
                  onClick={() => toggleGenre(g.id)}
                >
                  <div className="gc-header">
                    <span className="gc-icon-badge"><Icon name={g.icon} size={18} /></span>
                    <span className={`gc-check-circle ${isSelected ? 'checked' : ''}`}>
                      {isSelected && <Icon name="check" size={14} />}
                    </span>
                  </div>
                  <span className="gc-name">{g.name}</span>
                  <span className="gc-desc">{g.desc}</span>
                </button>
              );
            })}
          </div>

          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={savingPrefs || selectedGenres.length === 0}>
              {savingPrefs ? <><Spinner size={16} /> Saving…</> : <><Icon name="check" size={16} /> Save preferences</>}
            </button>
          </div>
        </form>
      </section>

      {/* ============================================ Account & identity == */}
      <section className="panel">
        <div className="panel-head"><h3><Icon name="users" size={17} /> Account &amp; identity</h3></div>
        <div className="profile-row" style={{ marginBottom: 18 }}>
          <div className="avatar avatar-lg">{user ? initials(user.name) : '?'}</div>
          <div>
            <div className="profile-name">{user?.name}</div>
            <div className="profile-email">{user?.username ? `@${user.username} · ` : ''}{user?.email}</div>
            <span className="tag tag-accent">{user?.role === 'admin' ? 'Admin' : 'Artist'}</span>
          </div>
        </div>

        <form onSubmit={savePreferences} className="form">
          <label className="field">
            <span>Username handle</span>
            <div className="username-input-wrap">
              <span className="username-prefix">@</span>
              <input
                type="text"
                value={usernameVal}
                onChange={(e) => onUnameChange(e.target.value)}
                placeholder="your_unique_handle"
                className="username-input"
              />
            </div>
            {unameStatus.checking && <span className="field-hint"><Spinner size={12} /> Checking availability…</span>}
            {!unameStatus.checking && unameStatus.available === true && <span className="field-hint ok">✓ @{usernameVal} is available</span>}
            {!unameStatus.checking && unameStatus.available === false && (
              <span className="field-hint" style={{ color: 'var(--danger)' }}>✕ {unameStatus.reason}</span>
            )}
          </label>

          <div className="modal-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={savingPrefs || unameStatus.available === false || usernameVal === user?.username}
            >
              {savingPrefs ? <Spinner size={14} /> : 'Update username'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setConfirmLogout(true)}>
              <Icon name="logout" size={15} /> Sign out
            </button>
          </div>
        </form>
      </section>

      {/* ================================================ Artist profile == */}
      {artist && (
        <section className="panel">
          <div className="panel-head"><h3><Icon name="artist" size={17} /> Artist profile</h3></div>
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
              <button type="submit" className="btn btn-primary" disabled={savingArtist}>
                {savingArtist ? <><Spinner size={16} /> Saving…</> : 'Save profile changes'}
              </button>
              <Link className="btn btn-ghost" to={`/artists/${artist.id}`}>View public page</Link>
            </div>
          </form>
        </section>
      )}

      {/* =============================================== App & storage ==== */}
      <section className="panel">
        <div className="panel-head">
          <h3><Icon name="storage" size={17} /> App &amp; offline storage</h3>
          <span className="section-note">
            {storage.quota ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)}` : `${offline.songs} tracks cached`}
          </span>
        </div>
        <p className="panel-desc">
          {offline.playlists} playlist{offline.playlists === 1 ? '' : 's'} and {offline.songs} track{offline.songs === 1 ? '' : 's'} saved on this device.
          Install Pulse to launch it from your home screen and keep downloads between sessions.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={doInstall} disabled={installed}>
            <Icon name="download" size={15} /> {installed ? 'App installed' : canInstall ? 'Install app' : 'How to install'}
          </button>
          <Link className="btn btn-ghost btn-sm" to="/downloads"><Icon name="folder" size={15} /> Manage downloads</Link>
          <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setConfirmClear(true)} disabled={!offline.songs && !offline.playlists}>
            <Icon name="trash" size={15} /> Clear all downloads
          </button>
        </div>
      </section>

      <section className="panel muted-panel">
        <div className="panel-head"><h3><Icon name="info" size={17} /> About Pulse</h3></div>
        <p className="muted">
          Pulse is a full-stack music platform for artists — upload tracks, manage albums and playlists, stream your catalog,
          and download tracks for offline listening. Built with React, Node.js, Express and SQLite.
        </p>
      </section>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearDownloads}
        title="Clear all downloads"
        message="Remove every downloaded track and playlist from this device?"
      />
      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={logout}
        title="Sign out"
        message="Sign out of Pulse on this device? Your downloads stay cached."
      />
    </div>
  );
}
