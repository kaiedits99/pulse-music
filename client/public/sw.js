/* Pulse service worker — makes offline downloads work end-to-end:
   - /media/** (audio + covers): serve from the offline-download cache first,
     then a runtime cache (stale-while-revalidate); anything the app cached via
     the Cache API is instantly available here.
   - App shell (/ navigations + /assets/**): network-first, fall back to the
     last cached copy so the UI itself opens offline and can play downloads.
   - /api/** is NEVER cached — catalog data stays live; the offline UI reads
     its snapshot from localStorage instead. */
const OFFLINE_CACHE = 'pulse-offline-v1'; // shared with client/src/offline.js
const RUNTIME_CACHE = 'pulse-runtime-v1';
const SHELL_CACHE = 'pulse-shell-v1';
const SHELL_URL = '/index.html';

self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API

  if (url.pathname.startsWith('/media/')) {
    e.respondWith((async () => {
      const offline = await caches.open(OFFLINE_CACHE);
      const hit = await offline.match(url);
      if (hit) return hit;
      const runtime = await caches.open(RUNTIME_CACHE);
      const stale = await runtime.match(url);
      const fresh = fetch(url).then((res) => {
        if (res && res.ok) runtime.put(url, res.clone());
        return res;
      }).catch(() => null);
      if (stale) { fresh.catch(() => {}); return stale; }
      return (await fresh) || Response.error();
    })());
    return;
  }

  const isShell = req.mode === 'navigate' || url.pathname === '/' || url.pathname.startsWith('/assets/');
  if (isShell) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const shell = await caches.open(SHELL_CACHE);
        shell.put(url.pathname === '/' || req.mode === 'navigate' ? SHELL_URL : url, fresh.clone());
        return fresh;
      } catch {
        const shell = await caches.open(SHELL_CACHE);
        const hit = await shell.match(url);
        return hit || (req.mode === 'navigate' ? await shell.match(SHELL_URL) : null) || Response.error();
      }
    })());
  }
});
