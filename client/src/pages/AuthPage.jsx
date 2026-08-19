import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { getRuntimeUrl, setRuntimeUrl } from '../config.js';

export default function AuthPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(getRuntimeUrl() || '');
  const [form, setForm] = useState({ name: '', artistName: '', email: '', password: '' });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
      } else {
        await register({ name: form.name.trim(), artistName: form.artistName.trim(), email: form.email.trim(), password: form.password });
      }
      toast(mode === 'login' ? 'Welcome back!' : 'Welcome to Pulse!');
      navigate('/');
    } catch (err) {
      toast(err.message || 'Something went wrong', 'error');
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
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="brand-logo big"><Icon name="wave" size={26} /></div>
          <span className="brand-name">Pulse</span>
        </div>
        <h1 className="auth-title">{mode === 'login' ? 'Welcome back' : 'Create your artist account'}</h1>
        <p className="auth-sub">
          {mode === 'login'
            ? 'Sign in to manage your catalog, upload music, and track your streams.'
            : 'Join Pulse to upload your music, build playlists, and grow your audience.'}
        </p>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>Sign in</button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>Sign up</button>
        </div>

        <form onSubmit={submit} className="form auth-form">
          {mode === 'register' && (
            <>
              <label className="field"><span>Full name</span>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Chidera Obi" />
              </label>
              <label className="field"><span>Artist / stage name (optional)</span>
                <input value={form.artistName} onChange={(e) => set('artistName', e.target.value)} placeholder="e.g. Chy Dee" />
              </label>
            </>
          )}
          <label className="field"><span>Email</span>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" required />
          </label>
          <label className="field"><span>Password</span>
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Minimum 6 characters" required minLength={6} />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner size={18} /> : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="auth-divider"><span>or</span></div>
        <button className="btn btn-ghost btn-block" onClick={demoLogin} disabled={busy}>
          <Icon name="sparkle" size={16} /> Try the demo account
        </button>
        <p className="auth-hint">Demo: <code>admin@pulse.app</code> / <code>demo123</code></p>

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
      </div>
    </div>
  );
}
