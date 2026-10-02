import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { purgeLegacyDemoDownloads } from './offline.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Drop any demo music an older version let this device save for offline listening (once per device).
purgeLegacyDemoDownloads().catch(() => { /* best effort */ });

// Register the offline-capable service worker (downloads + app shell).
// Same-origin only; silently skipped in unsupported/embedded contexts.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline stays best-effort */ });
  });
}
