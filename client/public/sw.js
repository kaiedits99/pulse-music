/* Pulse service worker — makes offline downloads work end-to-end:
   - /media/** (audio + covers): serve from the offline-download cache first;
     anything else goes straight to the network exactly as the page asked for it
     (same Range header, same request mode). Uploads may live in a bucket on
     another site, in which case /media answers with a redirect there, and
     re-issuing the request here with different options would break streaming.
   - App shell (/ navigations + /assets/**): network-first, fall back to the
     last cached copy so the UI itself opens offline and can play downloads.
   - /api/** is NEVER cached — catalog data stays live; the offline UI reads
     its snapshot from localStorage instead. */
const OFFLINE_CACHE = 'pulse-offline-v1'; // shared with client/src/offline.js
const SHELL_CACHE = 'pulse-shell-v1';
const SHELL_URL = '/index.html';

self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // Older versions kept a copy of every track and cover that was played. That doubled the data used
  // for each play and is no longer done, so drop what they stored. OFFLINE_CACHE (the user's own
  // downloads) and SHELL_CACHE are never touched.
  await Promise.all([caches.delete('pulse-runtime-v1'), caches.delete('pulse-runtime-v2')]);
  await self.clients.claim();
})()));

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
      return fetch(req);
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
