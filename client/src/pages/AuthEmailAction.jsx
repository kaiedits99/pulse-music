import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { Spinner } from '../components/ui.jsx';

export default function AuthEmailAction({ action = 'request' }) {
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get('token') || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!['verify', 'reset'].includes(action)) return;
    const params = new URLSearchParams(location.search);
    const linkToken = params.get('token') || '';
    setToken(linkToken);
    // Keep the one-time credential out of browser history and referrer-bearing URLs once captured.
    if (linkToken) window.history.replaceState(window.history.state, '', location.pathname);
    if (action === 'verify' && linkToken) {
      let active = true;
      setBusy(true);
      api.post('/api/auth/verify-email', { token: linkToken })
        .then((result) => { if (active) { setMessage(result.message || 'Email verified. You can now sign in.'); setComplete(true); } })
        .catch((err) => { if (active) setError(err.message || 'This verification link is invalid or expired.'); })
        .finally(() => { if (active) setBusy(false); });
      return () => { active = false; };
    }
    return undefined;
  }, [action, location.pathname, location.search]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (action === 'request') {
        const result = await api.post('/api/auth/password-reset/request', { email: email.trim() });
        setMessage(result.message || 'If an account exists for that address, instructions will arrive shortly.');
        setComplete(true);
      } else {
        if (!token) throw new Error('This reset link is missing or expired. Request a new one.');
        if (password !== confirm) throw new Error('The passwords do not match.');
        const result = await api.post('/api/auth/password-reset/confirm', { token, password });
        setMessage(result.message || 'Password changed. Sign in with your new password.');
        setToken('');
        setPassword('');
        setConfirm('');
        setComplete(true);
      }
    } catch (err) {
      if (action === 'reset' && err.status === 400) setToken('');
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const title = action === 'verify' ? 'Verify your email' : action === 'reset' ? 'Choose a new password' : 'Reset your password';
  const intro = action === 'verify'
    ? 'We are checking your one-time verification link.'
    : action === 'reset'
      ? 'Choose a new password for your Pulse account.'
      : 'Enter your account email. If it is registered, we will send a secure reset link.';

  return (
    <main className="email-action-page">
      <section className="email-action-card" aria-labelledby="email-action-title">
        <Link className="email-action-brand" to="/login" aria-label="Pulse sign in">Pulse</Link>
        <h1 id="email-action-title">{title}</h1>
        <p className="auth-lead">{intro}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {message && <div className="email-action-message" role="status">{busy && <Spinner size={15} />} {message}</div>}

        {action === 'request' && !complete && (
          <form className="form" onSubmit={submit}>
            <label className="field">
              <span>Email address</span>
              <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? <><Spinner size={16} /> Sending…</> : 'Send reset link'}
            </button>
          </form>
        )}

        {action === 'reset' && !complete && (
          token ? (
            <form className="form" onSubmit={submit}>
              <label className="field">
                <span>New password</span>
                <input type="password" autoComplete="new-password" minLength={6} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input type="password" autoComplete="new-password" minLength={6} maxLength={72} required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </label>
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
                {busy ? <><Spinner size={16} /> Updating…</> : 'Change password'}
              </button>
            </form>
          ) : (
            <p className="auth-foot"><Link className="link-btn" to="/forgot-password">Request a fresh reset link</Link></p>
          )
        )}

        {action === 'verify' && busy && !message && <div className="email-action-loading"><Spinner size={20} /> Verifying…</div>}
        {(complete || action === 'verify') && (
          <p className="auth-foot">
            <Link className="link-btn" to="/login">{complete ? 'Continue to sign in' : 'Back to sign in'}</Link>
          </p>
        )}
        {action !== 'verify' && !complete && <p className="auth-foot"><Link className="link-btn" to="/login">Back to sign in</Link></p>}
      </section>
    </main>
  );
}
