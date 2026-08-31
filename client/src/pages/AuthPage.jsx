import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { api } from '../api.js';
import { getRuntimeUrl, setRuntimeUrl } from '../config.js';

const GENRE_OPTIONS = [
  { id: 'Pop', name: 'Pop', desc: 'Vocal anthems & modern hooks', icon: 'music', color: 'from-pink-500' },
  { id: 'Indie', name: 'Indie', desc: 'Acoustic warmth & indie anthems', icon: 'wave', color: 'from-purple-500' },
  { id: 'Alternative Rock', name: 'Alternative Rock', desc: 'Electric energy & driving guitars', icon: 'sparkle', color: 'from-blue-500' },
  { id: 'Rock', name: 'Rock', desc: 'Stadium anthems & powerful riffs', icon: 'trending', color: 'from-amber-500' },
  { id: 'K-Pop', name: 'K-Pop', desc: 'Upbeat dance & melodic hooks', icon: 'heart', color: 'from-fuchsia-500' },
  { id: 'EDM', name: 'EDM', desc: 'Electronic euphoria & festival drops', icon: 'wave', color: 'from-cyan-500' },
  { id: 'Other', name: 'Other', desc: 'Afrobeats, R&B, Soul & Fusion', icon: 'sparkle', color: 'from-emerald-500' }
];

export default function AuthPage() {
  const { login, register } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [regStep, setRegStep] = useState(1); // 1: Account, 2: Username, 3: Genres
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(getRuntimeUrl() || '');

  // Form state
  const [form, setForm] = useState({
    name: '',
    artistName: '',
    email: '',
    password: '',
    username: '',
    identifier: ''
  });

  const [selectedGenres, setSelectedGenres] = useState([]);
  const [usernameStatus, setUsernameStatus] = useState({
    checking: false,
    available: null,
    reason: ''
  });

  const checkTimerRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /* ---- Live Username Availability Check ---- */
  const checkUsernameAvailability = (uname) => {
    const clean = String(uname || '').trim();
    if (!clean) {
      setUsernameStatus({ checking: false, available: null, reason: '' });
      return;
    }
    if (clean.length < 3) {
      setUsernameStatus({ checking: false, available: false, reason: 'Username must be at least 3 characters' });
      return;
    }
    if (clean.length > 30) {
      setUsernameStatus({ checking: false, available: false, reason: 'Username cannot exceed 30 characters' });
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(clean)) {
      setUsernameStatus({ checking: false, available: false, reason: 'Only letters, numbers, and underscores allowed' });
      return;
    }

    setUsernameStatus((prev) => ({ ...prev, checking: true }));
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);

    checkTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/auth/check-username?username=${encodeURIComponent(clean)}`);
        setUsernameStatus({
          checking: false,
          available: res.available,
          reason: res.reason || ''
        });
      } catch {
        setUsernameStatus({ checking: false, available: null, reason: '' });
      }
    }, 280);
  };

  const onUsernameChange = (val) => {
    // Sanitize to valid username characters as user types
    const sanitized = val.replace(/[^a-zA-Z0-9_]/g, '');
    set('username', sanitized);
    checkUsernameAvailability(sanitized);
  };

  /* ---- Step Navigation for Signup ---- */
  const goToUsernameStep = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast('Please enter your full name', 'error');
    if (!form.email.trim() || !form.email.includes('@')) return toast('Please enter a valid email address', 'error');
    if (!form.password || form.password.length < 6) return toast('Password must be at least 6 characters', 'error');

    // Auto-suggest username if empty
    if (!form.username.trim()) {
      const suggested = form.name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
      if (suggested) {
        set('username', suggested);
        checkUsernameAvailability(suggested);
      }
    } else {
      checkUsernameAvailability(form.username);
    }
    setRegStep(2);
  };

  const goToGenreStep = (e) => {
    e.preventDefault();
    const cleanUname = form.username.trim();
    if (!cleanUname) return toast('Username is required', 'error');
    if (usernameStatus.available === false) {
      return toast(usernameStatus.reason || 'Please choose a different username', 'error');
    }
    if (cleanUname.length < 3 || cleanUname.length > 30) {
      return toast('Username must be between 3 and 30 characters', 'error');
    }
    setRegStep(3);
  };

  /* ---- Genre selection handler (min 1, max 3) ---- */
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

  /* ---- Login Submit ---- */
  const submitLogin = async (e) => {
    e.preventDefault();
    const id = form.identifier || form.email;
    if (!id.trim()) return toast('Please enter your username or email', 'error');
    if (!form.password) return toast('Please enter your password', 'error');

    setBusy(true);
    try {
      await login(id.trim(), form.password);
      toast('Welcome back!');
      navigate('/');
    } catch (err) {
      toast(err.message || 'Invalid credentials', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ---- Registration Submit (at Step 3) ---- */
  const submitRegister = async (e) => {
    if (e) e.preventDefault();
    if (!selectedGenres.length) {
      return toast('Please select at least 1 genre to personalize your music', 'info');
    }

    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        artistName: form.artistName.trim() || form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        favoriteGenres: selectedGenres
      };
      await register(payload);
      toast(`Welcome to Pulse, @${form.username.trim()}! Here are your recommended songs.`);
      navigate('/');
    } catch (err) {
      toast(err.message || 'Could not complete registration', 'error');
      // If error is about username, go back to step 2
      if (err.message && err.message.toLowerCase().includes('username')) {
        setRegStep(2);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveServer = () => {
    setRuntimeUrl(serverUrl);
    toast('Backend URL saved');
    setTimeout(() => window.location.reload(), 600);
  };

  const demoLogin = async () => {
    setBusy(true);
    try {
      await login('admin@pulse.app', 'demo123');
      toast('Signed in with demo account');
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m) => {
    setMode(m);
    setRegStep(1);
  };

  const isDark = theme === 'dark';

  return (
    <div className="auth-wrap">
      <div className="auth-top-actions">
        <button
          className="icon-btn theme-toggle-btn"
          onClick={toggleTheme}
          title={`Switch to ${isDark ? 'light (white & purple)' : 'dark'} mode`}
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          <Icon name={isDark ? 'sun' : 'moon'} size={19} />
        </button>
      </div>

      <div className={`auth-panel ${mode === 'register' && regStep === 3 ? 'auth-panel-wide' : ''}`}>
        <div className="auth-brand">
          <div className="brand-logo big"><Icon name="wave" size={26} /></div>
          <span className="brand-name">Pulse</span>
        </div>

        {mode === 'login' && (
          <>
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-sub">Sign in with your username or email to stream and manage your music.</p>

            <div className="auth-tabs">
              <button className="tab active" onClick={() => switchMode('login')}>Sign in</button>
              <button className="tab" onClick={() => switchMode('register')}>Sign up</button>
            </div>

            <form onSubmit={submitLogin} className="form auth-form">
              <label className="field">
                <span>Username or Email</span>
                <input
                  type="text"
                  value={form.identifier || form.email}
                  onChange={(e) => { set('identifier', e.target.value); set('email', e.target.value); }}
                  placeholder="e.g. adebayo or you@example.com"
                  autoFocus
                  required
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  placeholder="Your password"
                  required
                />
              </label>
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? <Spinner size={18} /> : 'Sign in to Pulse'}
              </button>
            </form>
          </>
        )}

        {mode === 'register' && (
          <>
            <h1 className="auth-title">Sign up free to start listening</h1>
            <p className="auth-sub">Create a Pulse account and discover music tailored to your taste.</p>

            {/* Step Progress Bar */}
            <div className="auth-step-header">
              <div className="auth-step-pills">
                <span className={`step-pill ${regStep >= 1 ? 'active' : ''}`}>1. Account</span>
                <span className="step-arrow">→</span>
                <span className={`step-pill ${regStep >= 2 ? 'active' : ''}`}>2. Username</span>
                <span className="step-arrow">→</span>
                <span className={`step-pill ${regStep >= 3 ? 'active' : ''}`}>3. Music Taste</span>
              </div>
            </div>

            <div className="auth-tabs">
              <button className="tab" onClick={() => switchMode('login')}>Sign in</button>
              <button className="tab active" onClick={() => switchMode('register')}>Sign up</button>
            </div>

            {/* STEP 1: Basic Account Details */}
            {regStep === 1 && (
              <form onSubmit={goToUsernameStep} className="form auth-form">
                <h2 className="step-title">Create your account</h2>
                <p className="step-desc">Enter your email and credentials to get started.</p>

                <label className="field">
                  <span>Full name</span>
                  <input
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Chidera Obi"
                    autoFocus
                    required
                  />
                </label>
                <label className="field">
                  <span>Email address</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="Minimum 6 characters"
                    required
                    minLength={6}
                  />
                </label>

                <button type="submit" className="btn btn-primary btn-block btn-lg">
                  Next <Icon name="chevronRight" size={17} />
                </button>
                <p className="auth-terms">By proceeding, you agree to Pulse's <a href="#terms">Terms of Use</a> and <a href="#privacy">Privacy Policy</a>.</p>
              </form>
            )}

            {/* STEP 2: Username Dialogue Box */}
            {regStep === 2 && (
              <form onSubmit={goToGenreStep} className="form auth-form">
                <div className="username-dialog-box">
                  <div className="dialog-icon">
                    <Icon name="artist" size={24} />
                  </div>
                  <h2 className="step-title">Choose your username</h2>
                  <p className="step-desc">
                    Usernames are unique identifiers that make it easier to track your profile, catalog, and plays.
                  </p>

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
                  </label>

                  {/* Availability feedback */}
                  <div className="username-status-row">
                    {usernameStatus.checking && (
                      <span className="uname-feedback checking">
                        <Spinner size={13} /> Checking availability…
                      </span>
                    )}
                    {!usernameStatus.checking && usernameStatus.available === true && (
                      <span className="uname-feedback ok">
                        <Icon name="check" size={14} /> @{form.username} is available!
                      </span>
                    )}
                    {!usernameStatus.checking && usernameStatus.available === false && (
                      <span className="uname-feedback err">
                        ✕ {usernameStatus.reason || 'This username is already taken'}
                      </span>
                    )}
                    {!usernameStatus.checking && usernameStatus.available === null && form.username.length === 0 && (
                      <span className="uname-feedback neutral">
                        Only letters, numbers, and underscores (3-30 chars).
                      </span>
                    )}
                  </div>
                </div>

                <div className="step-btn-row">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setRegStep(1)}
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary flex-1"
                    disabled={!form.username || usernameStatus.available === false || usernameStatus.checking}
                  >
                    Continue to Music Taste <Icon name="chevronRight" size={17} />
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: Genre Selection Screen */}
            {regStep === 3 && (
              <div className="genre-selection-step">
                <div className="genre-step-header">
                  <h2 className="step-title">Pick your music taste</h2>
                  <p className="step-desc">
                    Select <strong>1 to 3 genres</strong> you love. We'll tailor your feed and recommend the best tracks in these categories!
                  </p>
                  <div className="genre-counter-pill">
                    <span>Selected: <strong>{selectedGenres.length} / 3</strong></span>
                    {selectedGenres.length >= 3 && <span className="counter-max-badge">Max reached</span>}
                  </div>
                </div>

                <div className="genre-picker-grid">
                  {GENRE_OPTIONS.map((g) => {
                    const isSelected = selectedGenres.includes(g.id);
                    const isMaxAndNotSelected = selectedGenres.length >= 3 && !isSelected;

                    return (
                      <button
                        key={g.id}
                        type="button"
                        className={`genre-card ${isSelected ? 'selected' : ''} ${isMaxAndNotSelected ? 'dimmed' : ''}`}
                        onClick={() => toggleGenre(g.id)}
                      >
                        <div className="gc-header">
                          <span className="gc-icon-badge">
                            <Icon name={g.icon} size={18} />
                          </span>
                          <span className={`gc-check-circle ${isSelected ? 'checked' : ''}`}>
                            {isSelected && <Icon name="check" size={14} />}
                          </span>
                        </div>
                        <div className="gc-content">
                          <span className="gc-name">{g.name}</span>
                          <span className="gc-desc">{g.desc}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="step-btn-row" style={{ marginTop: 24 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setRegStep(2)}
                    disabled={busy}
                  >
                    ← Back to Username
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary flex-1 btn-lg"
                    onClick={submitRegister}
                    disabled={busy || selectedGenres.length === 0}
                  >
                    {busy ? <Spinner size={18} /> : (
                      <>Sign up <Icon name="sparkle" size={17} /></>
                    )}
                  </button>
                </div>
                <p className="auth-terms" style={{ textAlign: 'center' }}>
                  By signing up, you agree to Pulse's <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.
                </p>
              </div>
            )}
          </>
        )}

        {mode === 'login' && (
          <>
            <div className="auth-divider"><span>or</span></div>
            <button className="btn btn-ghost btn-block" onClick={demoLogin} disabled={busy}>
              <Icon name="sparkle" size={16} /> Try the demo account
            </button>
            <p className="auth-hint">Demo: <code>admin</code> / <code>demo123</code></p>

            <div className="server-box">
              <button className="server-toggle" onClick={() => setShowServer(!showServer)}>
                <Icon name="settings" size={15} /> Backend server URL {showServer ? '▾' : '▸'}
              </button>
              {showServer && (
                <div className="server-fields">
                  <p className="server-help">The Android app connects to your hosted backend. Paste its URL (e.g. <code>https://your-project.glitch.me</code>) then save.</p>
                  <div className="server-row">
                    <input
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
      </div>
    </div>
  );
}
