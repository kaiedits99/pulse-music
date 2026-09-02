// "Sign in with Google" via Google Identity Services (GIS) credential flow.
// Renders nothing unless the backend advertises GOOGLE_CLIENT_ID (GET
// /api/auth/google/status), so a server without Google configured is unaffected.
// The browser asks Google for an ID token ("credential"); the backend verifies
// it at POST /api/auth/google and returns the same { token, user } shape as
// password login. No client secret, no redirect URI.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { api } from '../api.js';

let gsiPromise = null;
function loadGsi() {
  if (typeof window !== 'undefined' && window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://accounts.google.com/gsi/client';
      el.async = true;
      el.onload = () => resolve(window.google);
      el.onerror = () => {
        gsiPromise = null;
        reject(new Error('Could not reach Google — check your connection.'));
      };
      document.head.appendChild(el);
    });
  }
  return gsiPromise;
}

export default function GoogleAuthButton() {
  const [status, setStatus] = useState(null); // null = unknown, {enabled, clientId}
  const { loginWithGoogle } = useAuth();
  const { toast } = useToast();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const mountRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    api
      .get('/api/auth/google/status')
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus({ enabled: false }));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!status?.enabled || !status.clientId) return undefined;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !mountRef.current) return;
        window.google.accounts.id.initialize({
          client_id: status.clientId,
          callback: async (resp) => {
            if (busyRef.current) return;
            busyRef.current = true;
            try {
              const user = await loginWithGoogle(resp.credential);
              toast(`Welcome to Pulse${user?.name ? `, ${user.name.split(' ')[0]}` : ''}!`);
              navigate('/');
            } catch (err) {
              toast(err.message || 'Google sign-in failed', 'error');
            } finally {
              busyRef.current = false;
            }
          }
        });
        window.google.accounts.id.renderButton(mountRef.current, {
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width: 300
        });
      })
      .catch((err) => {
        if (!cancelled) toast(err.message, 'error');
      });
    return () => { cancelled = true; };
  }, [status, theme, loginWithGoogle, navigate, toast]);

  if (!status?.enabled) return null;
  return (
    <div className="google-auth-block">
      <div className="auth-divider"><span>or</span></div>
      <div className="google-auth-wrap" ref={mountRef} aria-label="Sign in with Google" />
    </div>
  );
}
