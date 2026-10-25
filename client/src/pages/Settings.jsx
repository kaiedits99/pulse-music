import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import { APP_VERSION, checkForUpdate, RELEASES_PAGE } from '../appVersion.js';
import { isNative, openExternal } from '../native.js';

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
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const { canInstall, installed, promptInstall } = useInstallPrompt();

  const [form, setForm] = useState({ name: '', bio: '', genre: '', country: '' });
  const [savingArtist, setSavingArtist] = useState(false);

  // Username & preferences state
  const [usernameVal, setUsernameVal] = useState(user?.username || '');
  const [selectedGenres, setSelectedGenres] = useState(user?.favorite_genres || []);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [unameStatus, setUnameStatus] = useState({ checking: false, available: null, reason: '' });
  const checkTimerRef = useRef(null);

  // Storage
  const [storage, setStorage] = useState({ usage: 0, quota: 0 });
  const [offline, setOffline] = useState({ songs: 0, playlists: 0 });
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteStep, setDeleteStep] = useState(0); // 0 none, 1 confirm, 2 password
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

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

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await api.get('/api/account/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pulse-export-${user?.username || user?.id}-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Your data export has been downloaded');
    } catch (err) { toast(err.message || 'Could not export data', 'error'); }
    finally { setExporting(false); }
  };

  const doDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { apiUrl } = await import('../config.js');
      const token = localStorage.getItem('pulse_token');
      const res = await fetch(apiUrl('/api/account'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ password: deletePassword, confirm: deletePassword })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Delete failed (${res.status})`);
      localStorage.removeItem('pulse_token');
      toast('Account deleted — we have erased your Pulse data. You have been signed out.');
      window.location.href = '/';
    } catch (err) {
      toast(err.message || 'Could not delete account', 'error');
    } finally { setDeleting(false); }
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

      {/* ================================ Your data & privacy (GDPR) ==== */}
      <section className="panel" style={{ borderColor: 'rgba(139,92,246,0.18)' }}>
        <div className="panel-head"><h3><Icon name="shield" size={17} /> Your data &amp; privacy</h3></div>
        <p className="panel-desc">
          Pulse keeps only what it needs: your name, handle, email, 1–3 favourite genres, and the music you upload. No ads, no tracking, no payment data. Control your rights here.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Link className="btn btn-ghost btn-sm btn-pill" to="/privacy"><Icon name="shield" size={15} /> Privacy Policy</Link>
          <Link className="btn btn-ghost btn-sm btn-pill" to="/terms"><Icon name="info" size={15} /> Terms of Service</Link>
          <Link className="btn btn-ghost btn-sm btn-pill" to="/cookies"><Icon name="cookie" size={15} /> Cookie Policy</Link>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={exportData} disabled={exporting}>
              {exporting ? <><Spinner size={14} /> Exporting…</> : <><Icon name="download" size={15} /> Export your data (JSON)</>}
            </button>
            <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setDeleteStep(1)}>
              <Icon name="trash" size={15} /> Delete my account
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Export gives you a JSON file with your profile, uploads, playlists, favourites and follows. Deletion erases your account, handle, profile, follows and privately-owned content and logs you out. Public content may be kept briefly as “deleted user” where needed to avoid breaking other users’ playlists — we tell you if we must. Requests by email to <a href="mailto:privacy@pulse.music" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>privacy@pulse.music</a> are completed within 30 days.
          </p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            No unnecessary data collected. No marketing emails sent — so there is no newsletter to unsubscribe from. See <Link to="/terms" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Terms §12</Link> for every item we evaluated.
          </p>
        </div>
        {deleteStep > 0 && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: '1px solid rgba(244,63,94,0.22)', background: 'rgba(244,63,94,0.08)' }}>
            {deleteStep === 1 && (
              <>
                <p style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8, color: 'var(--danger)' }}>Are you sure?</p>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
                  This erases your Pulse account and your handle <strong>@{user?.username}</strong> forever. Your uploaded songs, owned playlists and favourites go with it. This cannot be undone.
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteStep(0)}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm danger" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setDeleteStep(2)}>Continue</button>
                </div>
              </>
            )}
            {deleteStep === 2 && (
              <>
                <p style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Type your password or <code>DELETE</code> to confirm</p>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Password or DELETE" className="input" style={{ flex: 1, minWidth: 180 }} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteStep(0)} disabled={deleting}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm danger" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={doDeleteAccount} disabled={deleting || !deletePassword}>
                    {deleting ? <><Spinner size={14} /> Deleting…</> : 'Delete forever'}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>You can also email <a href="mailto:privacy@pulse.music">privacy@pulse.music</a> from your account email.</p>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel muted-panel">
        <div className="panel-head">
          <h3><Icon name="info" size={17} /> About Pulse</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>Version {APP_VERSION}</span>
        </div>
        <p className="muted">
          Pulse is a full-stack music platform for artists — upload tracks, manage albums and playlists, stream your catalog,
          and download tracks for offline listening. Built with React, Node.js, Express and SQLite.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={checkingUpdate}
            onClick={async () => {
              setCheckingUpdate(true);
              const found = await checkForUpdate({ force: true });
              setCheckingUpdate(false);
              if (found) {
                toast(`Pulse ${found.version} is available — opening the download`, 'info');
                await openExternal(found.url);
              } else {
                toast(`You are on the newest version (${APP_VERSION})`);
              }
            }}
          >
            {checkingUpdate ? <><Spinner size={14} /> Checking…</> : <><Icon name="download" size={15} /> Check for updates</>}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openExternal(RELEASES_PAGE)}>
            <Icon name="external" size={15} /> All releases
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          {isNative()
            ? 'This app carries its own copy of the interface, so updates are installed from a new APK. '
              + 'Your account, catalog and messages always come from the server.'
            : 'The website is always the newest version — it is served straight from your Pulse server.'}
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
        onConfirm={() => { logout(); navigate('/'); }}
        title="Sign out"
        message="Sign out of Pulse on this device? Your downloads stay cached."
      />
    </div>
  );
}
