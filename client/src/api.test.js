// A request that hangs is the one failure the UI cannot recover from on its own: boot stays on the
// spinner, sign-in stays on "Signing in…", and the app looks broken with no error to act on. These
// tests drive the real api.js against a fake fetch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, request, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' }
});

test('a request that never answers fails with a timeout instead of hanging forever', async () => {
  // Ignore the abort signal entirely: the worst case, a fetch that simply never settles.
  globalThis.fetch = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(request('GET', '/api/auth/me', undefined, false, 60), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.status, 0);
    assert.match(error.message, /too long/i);
    return true;
  });
  assert.ok(Date.now() - started < 5_000, 'the deadline is real, not the test timeout');
});

test('the deadline is applied through an abort signal the network layer also honours', async () => {
  let seenSignal = null;
  globalThis.fetch = (url, options) => {
    seenSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
  await assert.rejects(request('GET', '/api/stats', undefined, false, 60), (error) => error.code === 'TIMEOUT');
  assert.ok(seenSignal, 'an AbortSignal is passed to fetch');
  assert.equal(seenSignal.aborted, true, 'and it fires when the deadline passes');
});

test('a network failure is reported, not thrown out as a crash', async () => {
  globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(request('GET', '/api/songs'), (error) => {
    assert.equal(error.code, 'NETWORK');
    assert.equal(error.status, 0);
    assert.match(error.message, /reach the Pulse server/i);
    return true;
  });
});

test('a server error keeps its status and message so screens can react to it', async () => {
  globalThis.fetch = async () => jsonResponse({ error: 'Invalid username or password' }, 401);
  await assert.rejects(api.post('/api/auth/login', { email: 'a', password: 'b' }), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.message, 'Invalid username or password');
    return true;
  });
});

test('a successful response resolves with its JSON', async () => {
  globalThis.fetch = async () => jsonResponse({ user: { id: 1 }, artist: null });
  assert.deepEqual(await api.get('/api/auth/me'), { user: { id: 1 }, artist: null });
});

test('uploads are not cut off by the short request deadline', async () => {
  let captured = null;
  globalThis.fetch = (url, options) => {
    captured = options.signal;
    return Promise.resolve(jsonResponse({ ok: true }));
  };
  assert.deepEqual(await api.upload('/api/songs', new FormData()), { ok: true });
  assert.ok(captured, 'uploads carry their own signal');
  assert.ok(UPLOAD_TIMEOUT_MS >= REQUEST_TIMEOUT_MS * 3, 'an upload gets a generous deadline');
});
