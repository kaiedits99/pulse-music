import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { purgeLegacyDemoDownloads } from './offline.js';
import './styles.css';

// Old releases kept JWTs in localStorage. Remove the legacy copy now that the API
// session is HttpOnly, and require one sign-in if no session cookie exists.
try { localStorage.removeItem('pulse_token'); } catch { /* storage may be disabled */ }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Drop any demo music an older version let this device save for offline listening (once per device).
purgeLegacyDemoDownloads().catch(() => { /* best effort */ });

// A deploy replaces the hashed script files. A page that was already open — or a phone whose
// cache still points at the previous build — then asks for a chunk that no longer exists, and the
// lazy route it belongs to never renders. Reload once to pick up the new index.html instead of
// leaving a blank screen behind. (Vite fires this when a dynamic import fails to load.)
if (typeof window !== 'undefined') {
  const RELOAD_KEY = 'pulse_chunk_reload_v1';
  window.addEventListener('vite:preloadError', (event) => {
    try {
      if (sessionStorage.getItem(RELOAD_KEY) === '1') return; // the reload did not help: don't loop
      sessionStorage.setItem(RELOAD_KEY, '1');
    } catch { /* storage disabled — still worth one reload */ }
    event.preventDefault();
    window.location.reload();
  });
}

// Register the offline-capable service worker (downloads + app shell).
// Same-origin only; silently skipped in unsupported/embedded contexts.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline stays best-effort */ });
  });
}
