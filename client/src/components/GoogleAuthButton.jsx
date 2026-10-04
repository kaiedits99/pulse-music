// "Sign in with Google" via Google Identity Services (GIS) credential flow.
// The backend advertises its public OAuth client ID at GET /api/auth/google/status.
// The browser gets an ID token ("credential") and POSTs it to the backend, which
// verifies the audience before creating a Pulse session. The client ID must be
// configured on the backend and the app's origin must be authorized in Google Cloud.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { api } from '../api.js';

let gsiPromise = null;
function loadGsi() {
  if (typeof window !== 'undefined' && window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        if (window.google?.accounts?.id) resolve(window.google);
        else {
          gsiPromise = null;
          reject(new Error("Google's sign-in service didn't load correctly. Please try again."));
        }
      };
      script.onerror = () => {
        gsiPromise = null;
        reject(new Error("Couldn't reach Google's sign-in service. Check your connection and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return gsiPromise;
}

function inAppDestination(location) {
  const from = location.state?.from;
  return typeof from === 'string' && /^\/(?!\/)/.test(from) ? from : '/';
}

export default function GoogleAuthButton() {
  const [status, setStatus] = useState({ state: 'loading' });
  const [providerError, setProviderError] = useState('');
  const { loginWithGoogle } = useAuth();
  const { toast } = useToast();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const mountRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    api
      .get('/api/auth/google/status')
      .then((result) => {
        if (!alive) return;
        setStatus(result?.enabled && result?.clientId
          ? { state: 'enabled', clientId: result.clientId }
          : { state: 'disabled' });
      })
      .catch(() => {
        if (alive) setStatus({ state: 'unavailable' });
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (status.state !== 'enabled') return undefined;
    let cancelled = false;
    let resizeObserver;
    let resizeFallback;

    const onCredential = async (response) => {
      if (busyRef.current) return;
      if (!response?.credential) {
        const message = 'Google did not return a sign-in credential. Please try again.';
        setProviderError(message);
        toast(message, 'error');
        return;
      }
      busyRef.current = true;
      setProviderError('');
      try {
        const user = await loginWithGoogle(response.credential);
        toast(`Welcome to Pulse${user?.name ? `, ${user.name.split(' ')[0]}` : ''}!`);
        navigate(inAppDestination(location), { replace: true });
      } catch (error) {
        const message = error.message || 'Google sign-in failed. Please try again.';
        setProviderError(message);
        toast(message, 'error');
      } finally {
        busyRef.current = false;
      }
    };

    loadGsi()
      .then((google) => {
        if (cancelled || !google?.accounts?.id || !mountRef.current) return;
        google.accounts.id.initialize({ client_id: status.clientId, callback: onCredential });

        const renderButton = () => {
          const mount = mountRef.current;
          if (cancelled || !mount) return;
          // GIS uses a fixed pixel width. Match the available form width so the
          // button remains fully visible and tappable on narrow phones.
          const availableWidth = Math.floor(mount.getBoundingClientRect().width || 300);
          const width = Math.max(200, Math.min(400, availableWidth));
          mount.replaceChildren();
          google.accounts.id.renderButton(mount, {
            theme: theme === 'dark' ? 'filled_black' : 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            logo_alignment: 'left',
            width
          });
        };

        renderButton();
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(renderButton);
          resizeObserver.observe(mountRef.current);
        } else {
          resizeFallback = renderButton;
          window.addEventListener('resize', resizeFallback);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProviderError(error.message || 'Google sign-in could not be loaded.');
          toast(error.message || 'Google sign-in could not be loaded.', 'error');
        }
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (resizeFallback) window.removeEventListener('resize', resizeFallback);
      mountRef.current?.replaceChildren();
    };
  }, [status, theme, loginWithGoogle, navigate, location, toast]);

  if (status.state === 'loading') return null;
  if (status.state === 'disabled') {
    return (
      <div className="auth-provider-note" role="status">
        <strong>Google sign-in isn’t enabled for this app yet.</strong>
        <span>The app administrator needs to configure a Google OAuth client ID and authorize this site’s URL.</span>
      </div>
    );
  }
  if (status.state === 'unavailable') {
    return (
      <div className="auth-provider-note" role="status">
        <strong>Google sign-in is unavailable right now.</strong>
        <span>Couldn’t reach the sign-in service. Check your connection and backend URL, then try again.</span>
      </div>
    );
  }

  return (
    <>
      <div className="auth-divider">or continue with</div>
      <div className="google-btn-wrap" ref={mountRef} aria-label="Sign in with Google" />
      {providerError && <p className="auth-provider-error" role="alert">{providerError}</p>}
    </>
  );
}
