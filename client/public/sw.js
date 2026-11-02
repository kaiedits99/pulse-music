/* Pulse service worker — makes offline downloads work end-to-end:
   - /media/** (audio + covers): serve from the offline-download cache first;
     anything else goes straight to the network exactly as the page asked for it
     (same Range header, same request mode). Uploads may live in a bucket on
     another site, in which case /media answers with a redirect there, and
     re-issuing the request here with different options would break streaming.
   - App shell (/ navigations + /assets/** + static files): network-first, fall
     back to the last cached copy so the UI itself opens offline and can play
     downloads.
   - /api/** is NEVER cached — catalog data stays live; the offline UI reads
     its snapshot from localStorage instead.

   One rule matters more than the rest: a script or stylesheet request is never
   answered with an HTML page. A single-page host answers a missing file with
   index.html and status 200, and an offline /assets/*.js request has no network
   at all. Storing either of those under a script's URL, or falling back to the
   shell for it, makes the WebView refuse to run the app — the site works and the
   phone shows a blank screen. Every fallback below is typed for that reason. */
const OFFLINE_CACHE = 'pulse-offline-v1'; // shared with client/src/offline.js
// v2: v1 could hold an HTML page under a script URL (see above). A new name makes every
// installed copy start from a clean cache instead of serving the damage it already has.
const SHELL_CACHE = 'pulse-shell-v2';
const LEGACY_SHELL_CACHES = ['pulse-shell-v1'];
const SHELL_URL = '/index.html';
const OFFLINE_URL = '/offline.html';

const CODE_PATH = /\.(?:m?js|css|map)$/i;
const ASSET_PATH = /\.(?:woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|webmanifest)$/i;

/** What the URL promises, decided from the path — never from the response that arrived. */
function kindOf(pathname) {
  if (/\.html?$/i.test(pathname)) return 'html';
  if (CODE_PATH.test(pathname)) return 'code';
  if (ASSET_PATH.test(pathname)) return 'asset';
  return 'other';
}

function isHtml(response) {
  return (response.headers.get('content-type') || '').toLowerCase().includes('text/html');
}

/**
 * Can this successful response be stored under `pathname`?
 * Only when it is what the URL promises. A page for a page, and never a page for a
 * script, stylesheet or image — that is exactly the poisoning this worker avoids.
 */
function storable(pathname, response) {
  if (!response.ok) return false;
  const kind = kindOf(pathname);
  const html = isHtml(response);
  if (kind === 'html') return html;
  return !html;
}

function isShellRequest(request, url) {
  if (request.mode === 'navigate') return true;
  if (url.pathname === '/' || url.pathname === SHELL_URL || url.pathname === OFFLINE_URL) return true;
  if (url.pathname.startsWith('/assets/')) return true;
  if (url.pathname === '/sw.js') return false; // the browser manages the worker script itself
  return kindOf(url.pathname) !== 'other';
}

self.addEventListener('install', (e) => e.waitUntil((async () => {
  await self.skipWaiting();
  // Warm the shell cache so offline navigations work immediately after install.
  try {
    const shell = await caches.open(SHELL_CACHE);
    for (const url of [SHELL_URL, OFFLINE_URL]) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (storable(url, res)) await shell.put(url, res);
      } catch {}
    }
  } catch {}
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // Older versions kept a copy of every track and cover that was played. That doubled the data used
  // for each play and is no longer done, so drop what they stored. OFFLINE_CACHE (the user's own
  // downloads) and SHELL_CACHE are never touched. The v1 shell cache is dropped because it may hold
  // HTML pages stored under script URLs, which is what a blank app looked like.
  await Promise.all([
    caches.delete('pulse-runtime-v1'),
    caches.delete('pulse-runtime-v2'),
    ...LEGACY_SHELL_CACHES.map((name) => caches.delete(name))
  ]);
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

  if (!isShellRequest(req, url)) return;

  e.respondWith((async () => {
    const navigation = req.mode === 'navigate' || url.pathname === '/' || url.pathname === SHELL_URL;
    const shell = await caches.open(SHELL_CACHE);
    const key = navigation ? SHELL_URL : url.pathname;

    try {
      const fresh = await fetch(req);
      // Store under what was asked for (every navigation shares the one shell entry).
      if (storable(key, fresh)) await shell.put(key, fresh.clone());
      return fresh;
    } catch {
      // Network is gone. Answer with the same kind of thing that was asked for.
      const hit = await shell.match(key);
      if (hit) return hit;

      if (navigation) {
        // A page was asked for: the shell, then the dedicated offline page. Both are HTML.
        const fallback = await shell.match(SHELL_URL);
        if (fallback) return fallback;
        const offline = await shell.match(OFFLINE_URL);
        if (offline) return offline;
        try {
          const offlineFetch = await fetch(OFFLINE_URL);
          if (offlineFetch.ok && isHtml(offlineFetch)) return offlineFetch;
        } catch {}
      }
      // A script, stylesheet or image with no cached copy is a failed load — never a web page.
      return Response.error();
    }
  })());
});
