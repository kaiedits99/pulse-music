// The service worker sits between the phone and the app. If it answers a script or stylesheet
// request with the HTML shell, the WebView refuses to run it — the site loads perfectly in a
// browser, and the Android app shows a blank screen. That is the class of bug these tests pin:
// the worker runs here in a sandbox with fake caches and a fake network, and every request is
// checked for the *kind* of response it gets back, not just that something came back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = fs.readFileSync(path.join(here, '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://pulse.test';
const HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const JS = 'export const answer = 42;';
const CSS = 'body{color:#fff}';

const htmlResponse = () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const jsResponse = () => new Response(JS, { status: 200, headers: { 'content-type': 'text/javascript' } });
const cssResponse = () => new Response(CSS, { status: 200, headers: { 'content-type': 'text/css' } });

/** A Cache API stand-in that keys entries by pathname, exactly like the real one keys by URL. */
function fakeCache(store) {
  const key = (input) => {
    const raw = typeof input === 'string' ? input : (input && input.url) || String(input);
    try {
      return new URL(raw, ORIGIN).pathname;
    } catch {
      return String(raw);
    }
  };
  return {
    store,
    async match(input) {
      const hit = store.get(key(input));
      return hit ? hit.clone() : undefined;
    },
    async put(input, response) {
      store.set(key(input), response.clone());
    },
    async add() {
      throw new Error('cache.add is not used by this worker');
    }
  };
}

/**
 * Loads the real sw.js into a VM context with fake platform APIs.
 * `responses` maps a pathname to either a Response, an Error (thrown), or a function.
 */
function loadWorker({ responses = {}, cached = {} } = {}) {
  const stores = new Map();
  for (const [cacheName, entries] of Object.entries(cached)) {
    stores.set(cacheName, new Map(Object.entries(entries)));
  }
  const handlers = new Map();
  const requested = [];

  const context = {
    self: {
      addEventListener(type, handler) { handlers.set(type, handler); },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
      location: new URL(`${ORIGIN}/sw.js`)
    },
    caches: {
      async open(name) {
        if (!stores.has(name)) stores.set(name, new Map());
        return fakeCache(stores.get(name));
      },
      async keys() {
        return [...stores.keys()];
      },
      async delete(name) {
        return stores.delete(name);
      },
      async match(input) {
        for (const store of stores.values()) {
          const cache = fakeCache(store);
          const hit = await cache.match(input);
          if (hit) return hit;
        }
        return undefined;
      }
    },
    async fetch(input) {
      const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
      requested.push(url.pathname);
      const entry = responses[url.pathname];
      if (entry === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      if (entry instanceof Error) throw entry;
      if (typeof entry === 'function') return entry(url);
      return entry;
    },
    Response,
    Request,
    Headers,
    URL,
    console,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SW_SOURCE, context, { filename: 'sw.js' });
  return { handlers, stores, requested, context };
}

async function runInstall(worker) {
  const handler = worker.handlers.get('install');
  assert.ok(handler, 'the worker registers an install handler');
  const pending = [];
  handler({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
}

async function runActivate(worker) {
  const handler = worker.handlers.get('activate');
  assert.ok(handler, 'the worker registers an activate handler');
  const pending = [];
  handler({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
}

/** Fires a fetch event and returns the response the worker decided on (or the rejection). */
async function fetchThrough(worker, pathname, { mode = 'no-cors', method = 'GET' } = {}) {
  const captured = [];
  worker.handlers.get('fetch')({
    request: { method, url: `${ORIGIN}${pathname}`, mode },
    respondWith: (promise) => captured.push(promise)
  });
  if (!captured.length) return { passthrough: true };
  return { response: await captured[0] };
}

const cacheNameHolding = (stores, pathname) => [...stores.entries()].find(([, entries]) => entries.has(pathname))?.[0];

const isHtml = (response) => (response.headers.get('content-type') || '').includes('text/html');

/** Installs the worker into a shell cache warmed from a healthy site, returning that cache name. */
async function installedWorker({ responses } = {}) {
  const worker = loadWorker({
    responses: {
      '/index.html': htmlResponse(),
      '/offline.html': htmlResponse(),
      ...responses
    }
  });
  await runInstall(worker);
  const shellCache = cacheNameHolding(worker.stores, '/index.html');
  assert.ok(shellCache, 'install warms the shell cache with the app shell');
  return { worker, shellCache };
}

test('a script request that cannot reach the network is never answered with the HTML shell', async () => {
  // The regression: with only index.html cached, an offline /assets/*.js request fell back to the
  // shell. A browser that receives HTML where it asked for a module refuses to execute it and the
  // app never mounts — a blank screen on the phone while the website is fine.
  const { worker, shellCache } = await installedWorker();

  const seeded = loadWorker({
    responses: { '/assets/index-abc123.js': new Error('offline') },
    cached: { [shellCache]: { '/index.html': htmlResponse(), '/offline.html': htmlResponse() } }
  });
  const { response } = await fetchThrough(seeded, '/assets/index-abc123.js');
  assert.ok(response, 'the worker answers the request instead of leaving it to chance');
  assert.equal(isHtml(response), false, 'HTML must never be served in place of JavaScript');
  assert.equal(response.type, 'error', 'the page should see a failed script load, not a fake document');

  // The same rule holds for stylesheets.
  const css = loadWorker({
    responses: { '/assets/index-abc123.css': new Error('offline') },
    cached: { [shellCache]: { '/index.html': htmlResponse(), '/offline.html': htmlResponse() } }
  });
  const { response: cssResponseResult } = await fetchThrough(css, '/assets/index-abc123.css');
  assert.equal(isHtml(cssResponseResult), false, 'HTML must never be served in place of CSS');
});

test('a cached copy of a real script is still used offline', async () => {
  const { worker, shellCache } = await installedWorker({
    responses: { '/assets/index-abc123.js': jsResponse() }
  });
  // Warm it: one successful load caches the script under its own URL.
  await fetchThrough(worker, '/assets/index-abc123.js');

  const offline = loadWorker({
    responses: { '/assets/index-abc123.js': new Error('offline') },
    cached: { [shellCache]: Object.fromEntries(worker.stores.get(shellCache)) }
  });
  const { response } = await fetchThrough(offline, '/assets/index-abc123.js');
  assert.match(response.headers.get('content-type') || '', /javascript/);
  assert.equal(await response.text(), JS, 'the cached script is returned unchanged');
});

test('a 200 HTML answer for an asset path is not cached as if it were that asset', async () => {
  // A single-page host answers a missing file with index.html and status 200. Caching that under
  // /assets/… poisons the cache: every later load of that chunk gets HTML, on the phone and off.
  const { worker } = await installedWorker({
    responses: {
      '/assets/missing-chunk.js': htmlResponse(),
      '/assets/index-abc123.css': cssResponse()
    }
  });

  await fetchThrough(worker, '/assets/missing-chunk.js', { mode: 'cors' });

  const poisoned = [...worker.stores.entries()].flatMap(([, entries]) => [...entries.entries()]);
  const assetEntry = poisoned.find(([key]) => key === '/assets/missing-chunk.js');
  assert.equal(assetEntry, undefined, 'HTML served under an asset URL must not be stored at all');

  // A genuine stylesheet is stored, so the app can open offline.
  await fetchThrough(worker, '/assets/index-abc123.css', { mode: 'cors' });
  const cssEntry = [...worker.stores.values()].map((entries) => entries.get('/assets/index-abc123.css')).find(Boolean);
  assert.ok(cssEntry, 'a successful asset is cached for offline use');
  assert.match(cssEntry.headers.get('content-type') || '', /text\/css/);
});

test('going offline still opens the app: navigations get the cached shell', async () => {
  const { shellCache } = await installedWorker();
  const offline = loadWorker({
    responses: { '/': new Error('offline'), '/library': new Error('offline') },
    cached: { [shellCache]: { '/index.html': htmlResponse(), '/offline.html': htmlResponse() } }
  });

  const home = await fetchThrough(offline, '/', { mode: 'navigate' });
  assert.equal(isHtml(home.response), true);
  assert.match(await home.response.text(), /id="root"/);

  const deep = await fetchThrough(offline, '/library', { mode: 'navigate' });
  assert.equal(isHtml(deep.response), true, 'a deep link falls back to the same shell');
});

test('a navigation with no cached shell lands on the offline page, not a blank window', async () => {
  const offline = loadWorker({
    responses: {
      '/': new Error('offline'),
      '/index.html': new Error('offline'),
      '/offline.html': new Error('offline')
    },
    cached: { 'pulse-shell-v2': { '/offline.html': htmlResponse() } }
  });
  const { response } = await fetchThrough(offline, '/', { mode: 'navigate' });
  assert.equal(isHtml(response), true);
});

test('a downloaded track plays from the cache without touching the network', async () => {
  const audio = new Response('ID3-audio-bytes', { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  const worker = loadWorker({
    responses: { '/media/uploads/song.mp3': new Error('must not be fetched') },
    cached: { 'pulse-offline-v1': { '/media/uploads/song.mp3': audio } }
  });
  const { response } = await fetchThrough(worker, '/media/uploads/song.mp3');
  assert.equal(await response.text(), 'ID3-audio-bytes');
  assert.deepEqual(worker.requested, [], 'the saved copy is served without a network request');
});

test('API responses are never cached by the worker', async () => {
  const worker = loadWorker({ responses: { '/api/songs': new Response('[]', { headers: { 'content-type': 'application/json' } }) } });
  const result = await fetchThrough(worker, '/api/songs', { mode: 'cors' });
  assert.equal(result.passthrough, true, 'the worker stays out of API traffic entirely');
});

test('activating a new worker drops caches that may already hold poisoned entries', async () => {
  const worker = loadWorker({
    cached: { 'pulse-shell-v1': { '/index.html': htmlResponse(), '/assets/app.js': htmlResponse() } }
  });
  await runActivate(worker);
  assert.equal(worker.stores.has('pulse-shell-v1'), false, 'the old shell cache is replaced, not reused');
});
