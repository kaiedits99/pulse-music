import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import GoogleAuthButton from '../components/GoogleAuthButton.jsx';
import { Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { api } from '../api.js';
import { getRuntimeUrl, setRuntimeUrl } from '../config.js';
import { formatNumber } from '../format.js';

const GENRE_OPTIONS = [
  { id: 'Pop', name: 'Pop', desc: 'Vocal anthems & modern hooks', icon: 'music' },
  { id: 'Indie', name: 'Indie', desc: 'Acoustic warmth & indie anthems', icon: 'wave' },
  { id: 'Alternative Rock', name: 'Alternative Rock', desc: 'Electric energy & driving guitars', icon: 'sparkle' },
  { id: 'Rock', name: 'Rock', desc: 'Stadium anthems & powerful riffs', icon: 'trending' },
  { id: 'K-Pop', name: 'K-Pop', desc: 'Upbeat dance & melodic hooks', icon: 'heart' },
  { id: 'EDM', name: 'EDM', desc: 'Electronic euphoria & festival drops', icon: 'wave' },
  { id: 'Other', name: 'Other', desc: 'Afrobeats, R&B, Soul & Fusion', icon: 'sparkle' }
];

const STEPS = [
  { id: 1, label: 'Account' },
  { id: 2, label: 'Username' },
  { id: 3, label: 'Music taste' }
];

export default function AuthPage() {
  const { login, register } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [regStep, setRegStep] = useState(1); // 1: account, 2: username, 3: genres
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(getRuntimeUrl() || '');
  const [stats, setStats] = useState(null);

  const [form, setForm] = useState({
    name: '', artistName: '', email: '', password: '', username: '', identifier: ''
  });
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [usernameStatus, setUsernameStatus] = useState({ checking: false, available: null, reason: '' });
  const checkTimerRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get('/api/stats').then(setStats).catch(() => {});
  }, []);

  /* ------------------------------------------- live username availability */
  const checkUsernameAvailability = (uname) => {
    const clean = String(uname || '').trim();
    if (!clean) { setUsernameStatus({ checking: false, available: null, reason: '' }); return; }
    if (clean.length < 3) { setUsernameStatus({ checking: false, available: false, reason: 'Username must be at least 3 characters' }); return; }
    if (clean.length > 30) { setUsernameStatus({ checking: false, available: false, reason: 'Username cannot exceed 30 characters' }); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(clean)) { setUsernameStatus({ checking: false, available: false, reason: 'Only letters, numbers and underscores allowed' }); return; }

    setUsernameStatus((prev) => ({ ...prev, checking: true }));
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/auth/check-username?username=${encodeURIComponent(clean)}`);
        setUsernameStatus({ checking: false, available: res.available, reason: res.reason || '' });
      } catch {
        setUsernameStatus({ checking: false, available: null, reason: '' });
      }
    }, 280);
  };

  const onUsernameChange = (val) => {
    const sanitized = val.replace(/[^a-zA-Z0-9_]/g, '');
    set('username', sanitized);
    checkUsernameAvailability(sanitized);
  };

  /* ---------------------------------------------------- step navigation  */
  const goToUsernameStep = (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Please enter your full name');
    if (!form.email.trim() || !form.email.includes('@')) return setError('Please enter a valid email address');
    if (!form.password || form.password.length < 6) return setError('Password must be at least 6 characters');

    if (!form.username.trim()) {
      const suggested = form.name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
      if (suggested) { set('username', suggested); checkUsernameAvailability(suggested); }
    } else {
      checkUsernameAvailability(form.username);
    }
    setRegStep(2);
    return undefined;
  };

  const goToGenreStep = (e) => {
    e.preventDefault();
    setError('');
    const cleanUname = form.username.trim();
    if (!cleanUname) return setError('Username is required');
    if (usernameStatus.available === false) return setError(usernameStatus.reason || 'Please choose a different username');
    if (cleanUname.length < 3 || cleanUname.length > 30) return setError('Username must be between 3 and 30 characters');
    setRegStep(3);
    return undefined;
  };

  const toggleGenre = (genreId) => {
    if (selectedGenres.includes(genreId)) {
      setSelectedGenres(selectedGenres.filter((g) => g !== genreId));
    } else {
      if (selectedGenres.length >= 3) { toast('You can pick up to 3 favorite genres', 'info'); return; }
      setSelectedGenres([...selectedGenres, genreId]);
    }
  };

  /* ------------------------------------------------------------- submits */
  const submitLogin = async (e) => {
    e.preventDefault();
    setError('');
    const id = form.identifier || form.email;
    if (!id.trim()) return setError('Please enter your username or email');
    if (!form.password) return setError('Please enter your password');

    setBusy(true);
    try {
      await login(id.trim(), form.password);
      toast('Welcome back!');
      navigate('/');
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const submitRegister = async (e) => {
    if (e) e.preventDefault();
    setError('');
    if (!selectedGenres.length) return setError('Please select at least 1 genre to personalise your music');

    setBusy(true);
    try {
      await register({
        name: form.name.trim(),
        artistName: form.artistName.trim() || form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        favoriteGenres: selectedGenres
      });
      toast(`Welcome to Pulse, @${form.username.trim()}!`);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Could not complete registration');
      if (err.message && err.message.toLowerCase().includes('username')) setRegStep(2);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const saveServer = () => {
    setRuntimeUrl(serverUrl);
    toast('Backend URL saved');
    setTimeout(() => window.location.reload(), 600);
  };

  const switchMode = (m) => { setMode(m); setRegStep(1); setError(''); };
  const isDark = theme === 'dark';

  const fillDemo = () => {
    setMode('login');
    setForm((f) => ({ ...f, identifier: 'amara@pulse.app', email: 'amara@pulse.app', password: 'demo123' }));
    setError('');
    toast('Demo credentials filled — press Sign in', 'info');
  };

  return (
    <div className="auth-screen">
      {/* ================================================= LEFT / VISUAL == */}
      <aside className="auth-visual">
        <div className="auth-brand">
          <div className="brand-logo big"><Icon name="wave" size={26} /></div>
          <span>Pulse</span>
        </div>

        <div>
          <h1>Your catalog.<br />Your sound. <em>Everywhere.</em></h1>
          <p>Upload, organise and stream your music — with offline downloads, smart recommendations and a player built for artists.</p>

          <div className="auth-feature-list">
            <div className="auth-feature">
              <span className="auth-feature-icon"><Icon name="upload" size={18} /></span>
              Bulk-import up to 10 tracks with auto artwork and metadata
            </div>
            <div className="auth-feature">
              <span className="auth-feature-icon"><Icon name="download" size={18} /></span>
              Download playlists for true offline listening
            </div>
            <div className="auth-feature">
              <span className="auth-feature-icon"><Icon name="sparkle" size={18} /></span>
              Recommendations tuned to the genres you pick
            </div>
          </div>
        </div>

        <div className="auth-stats">
          <div className="auth-stat"><strong>{stats ? formatNumber(stats.songs) : '—'}</strong><small>Tracks</small></div>
          <div className="auth-stat"><strong>{stats ? formatNumber(stats.artists) : '—'}</strong><small>Artists</small></div>
          <div className="auth-stat"><strong>{stats ? formatNumber(stats.plays) : '—'}</strong><small>Plays</small></div>
        </div>
      </aside>

      {/* =================================================== RIGHT / FORM == */}
      <main className="auth-form-side">
        <div className="auth-card">
          <div className="spread" style={{ marginBottom: 22 }}>
            <div className="auth-tabs" style={{ flex: 1, marginBottom: 0 }}>
              <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => switchMode('login')}>Sign in</button>
              <button className={`tab ${mode === 'register' ? 'active' : ''}`} onClick={() => switchMode('register')}>Sign up</button>
            </div>
            <button
              className="icon-btn"
              onClick={toggleTheme}
              title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              style={{ marginLeft: 10 }}
            >
              <Icon name={isDark ? 'sun' : 'moon'} size={19} />
            </button>
          </div>

          {error && <div className="auth-error"><Icon name="info" size={16} /> {error}</div>}

          {/* ------------------------------------------------------ LOGIN -- */}
          {mode === 'login' && (
            <>
              <h2>Welcome back</h2>
              <p className="auth-lead">Sign in with your username or email to stream and manage your music.</p>

              <form onSubmit={submitLogin} className="form">
                <label className="field">
                  <span>Username or email</span>
                  <input
                    type="text"
                    value={form.identifier || form.email}
                    onChange={(e) => { set('identifier', e.target.value); set('email', e.target.value); }}
                    placeholder="e.g. amara or you@example.com"
                    autoFocus
                    required
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <div className="password-wrap">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      placeholder="Your password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPass((s) => !s)}
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                    >
                      <Icon name={showPass ? 'eyeOff' : 'eye'} size={17} />
                    </button>
                  </div>
                </label>
                <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
                  {busy ? <><Spinner size={18} /> Signing in…</> : 'Sign in to Pulse'}
                </button>
              </form>

              <GoogleAuthButton />

              <p className="auth-foot">
                New to Pulse? <button className="link-btn" onClick={() => switchMode('register')}>Create an account</button>
                {' · '}
                <button className="link-btn" onClick={fillDemo}>Use demo account</button>
              </p>

              <div style={{ marginTop: 18 }}>
                <button className="link-btn" onClick={() => setShowServer((s) => !s)}>
                  <Icon name="settings" size={14} /> Backend server URL {showServer ? '▾' : '▸'}
                </button>
                {showServer && (
                  <div className="stack" style={{ marginTop: 10 }}>
                    <p className="auth-note">The mobile app connects to your hosted backend. Paste its URL (e.g. <code>https://your-project.glitch.me</code>) then save.</p>
                    <div className="row">
                      <input
                        className="input grow"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        placeholder="https://your-backend.glitch.me"
                      />
                      <button className="btn btn-primary btn-sm" onClick={saveServer}>Save</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* --------------------------------------------------- REGISTER -- */}
          {mode === 'register' && (
            <>
              <h2>Sign up free to start listening</h2>
              <p className="auth-lead">Create a Pulse account and discover music tailored to your taste.</p>

              <div className="chip-row" style={{ marginBottom: 22 }}>
                {STEPS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip ${regStep >= s.id ? 'active' : ''}`}
                    onClick={() => s.id < regStep && setRegStep(s.id)}
                    disabled={s.id > regStep}
                  >
                    {regStep > s.id ? <Icon name="check" size={13} /> : `${s.id}.`} {s.label}
                  </button>
                ))}
              </div>

              {regStep === 1 && (
                <form onSubmit={goToUsernameStep} className="form">
                  <label className="field">
                    <span>Full name</span>
                    <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Chidera Obi" autoFocus required />
                  </label>
                  <label className="field">
                    <span>Artist / stage name (optional)</span>
                    <input value={form.artistName} onChange={(e) => set('artistName', e.target.value)} placeholder="Defaults to your full name" />
                  </label>
                  <label className="field">
                    <span>Email address</span>
                    <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" required />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <div className="password-wrap">
                      <input
                        type={showPass ? 'text' : 'password'}
                        value={form.password}
                        onChange={(e) => set('password', e.target.value)}
                        placeholder="Minimum 6 characters"
                        required
                        minLength={6}
                      />
                      <button type="button" className="password-toggle" onClick={() => setShowPass((s) => !s)} aria-label={showPass ? 'Hide password' : 'Show password'}>
                        <Icon name={showPass ? 'eyeOff' : 'eye'} size={17} />
                      </button>
                    </div>
                  </label>
                  <button type="submit" className="btn btn-primary btn-block btn-lg">
                    Next <Icon name="chevronRight" size={17} />
                  </button>
                  <p className="auth-note">By proceeding you agree to Pulse’s Terms of Use and Privacy Policy.</p>
                </form>
              )}

              {regStep === 2 && (
                <form onSubmit={goToGenreStep} className="form">
                  <label className="field">
                    <span>Username handle</span>
                    <div className="username-input-wrap">
                      <span className="username-prefix">@</span>
                      <input
                        type="text"
                        value={form.username}
                        onChange={(e) => onUsernameChange(e.target.value)}
                        placeholder="your_unique_handle"
                        autoFocus
                        required
                        className="username-input"
                        autoComplete="off"
                        spellCheck="false"
                      />
                    </div>
                    {usernameStatus.checking && <span className="field-hint"><Spinner size={12} /> Checking availability…</span>}
                    {!usernameStatus.checking && usernameStatus.available === true && (
                      <span className="field-hint ok"><Icon name="check" size={13} /> @{form.username} is available</span>
                    )}
                    {!usernameStatus.checking && usernameStatus.available === false && (
                      <span className="field-hint" style={{ color: 'var(--danger)' }}>✕ {usernameStatus.reason || 'This username is already taken'}</span>
                    )}
                    {!usernameStatus.checking && usernameStatus.available === null && (
                      <span className="field-hint">Letters, numbers and underscores only (3–30 characters).</span>
                    )}
                  </label>

                  <div className="row">
                    <button type="button" className="btn btn-ghost" onClick={() => setRegStep(1)}>
                      <Icon name="arrowLeft" size={16} /> Back
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary grow"
                      disabled={!form.username || usernameStatus.available === false || usernameStatus.checking}
                    >
                      Continue <Icon name="chevronRight" size={17} />
                    </button>
                  </div>
                </form>
              )}

              {regStep === 3 && (
                <div className="form">
                  <div className="spread">
                    <p className="auth-lead" style={{ marginBottom: 0 }}>Select <strong>1 to 3 genres</strong> you love.</p>
                    <span className="hero-chip">{selectedGenres.length} / 3</span>
                  </div>

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

                  <div className="row">
                    <button type="button" className="btn btn-ghost" onClick={() => setRegStep(2)} disabled={busy}>
                      <Icon name="arrowLeft" size={16} /> Back
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary grow btn-lg"
                      onClick={submitRegister}
                      disabled={busy || selectedGenres.length === 0}
                    >
                      {busy ? <><Spinner size={18} /> Creating account…</> : <>Sign up <Icon name="sparkle" size={17} /></>}
                    </button>
                  </div>
                  <p className="auth-note" style={{ textAlign: 'center' }}>
                    By signing up you agree to Pulse’s Terms and Privacy Policy.
                  </p>
                </div>
              )}

              <p className="auth-foot">
                Already have an account? <button className="link-btn" onClick={() => switchMode('login')}>Sign in</button>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
