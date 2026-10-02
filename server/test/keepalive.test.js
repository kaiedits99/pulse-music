// The self-ping that stops a free host from putting the app to sleep.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { keepAwakeTarget, startKeepAwake } from '../keepalive.js';
import { waitFor, sleep } from './helpers.js';

const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

/** A little HTTP server whose answer to each request is decided by `respond(hitNumber, res)`. */
async function listen(respond) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, agent: req.headers['user-agent'] });
    respond(hits.length, res);
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { hits, url: `http://127.0.0.1:${server.address().port}/api/health` };
}
const ok = (_n, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); };
const quietLog = () => { const lines = []; return { lines, log: (m) => lines.push(['log', m]), warn: (m) => lines.push(['warn', m]) }; };

test('it is off unless asked for, and needs a public address to ping', () => {
  assert.equal(keepAwakeTarget({}), null);
  assert.equal(keepAwakeTarget({ RENDER_EXTERNAL_URL: 'https://pulse.onrender.com' }), null, 'not enabled');
  assert.equal(keepAwakeTarget({ KEEP_AWAKE: 'false', RENDER_EXTERNAL_URL: 'https://pulse.onrender.com' }), null);
  assert.equal(keepAwakeTarget({ KEEP_AWAKE: 'true' }), null, 'enabled but nowhere to ping');
  assert.equal(keepAwakeTarget({ KEEP_AWAKE: 'true', RENDER_EXTERNAL_URL: 'not-a-url' }), null);
});

test('it pings /api/health on the host Render reports, or on an address you choose', () => {
  assert.equal(
    keepAwakeTarget({ KEEP_AWAKE: 'true', RENDER_EXTERNAL_URL: 'https://pulse.onrender.com' }),
    'https://pulse.onrender.com/api/health'
  );
  assert.equal(
    keepAwakeTarget({ KEEP_AWAKE: ' TRUE ', RENDER_EXTERNAL_URL: 'https://pulse.onrender.com/', KEEP_AWAKE_URL: 'https://music.example.com//' }),
    'https://music.example.com/api/health',
    'a custom address wins, and stray slashes are tidied'
  );
});

test('it pings repeatedly, identifies itself, and stops when told to', async () => {
  const target = await listen(ok);
  const { lines, ...log } = quietLog();
  const stop = startKeepAwake({ url: target.url, intervalMs: 30, firstDelayMs: 10, log });
  await waitFor(() => target.hits.length >= 3, { what: 'three pings' });
  assert.equal(target.hits[0].url, '/api/health');
  assert.equal(target.hits[0].agent, 'pulse-keep-awake');
  stop();
  await sleep(60);
  const seen = target.hits.length;
  await sleep(150);
  assert.equal(target.hits.length, seen, 'no more pings after stop()');
  assert.deepEqual(lines, [], 'quiet while everything works');
});

test('a failing ping is reported once, recovery is noted, and pinging carries on', async () => {
  const target = await listen((n, res) => {
    if (n <= 3) { res.writeHead(503); res.end('waking up'); } else ok(n, res);
  });
  const { lines, ...log } = quietLog();
  const stop = startKeepAwake({ url: target.url, intervalMs: 25, firstDelayMs: 5, log });
  await waitFor(() => target.hits.length >= 6, { what: 'pings after recovery' });
  stop();
  const warnings = lines.filter(([kind]) => kind === 'warn');
  assert.equal(warnings.length, 1, 'three failures in a row produce a single warning');
  assert.match(warnings[0][1], /Keep-awake ping .* failed \(HTTP 503\)/);
  assert.equal(lines.filter(([kind, m]) => kind === 'log' && /working again/.test(m)).length, 1);
});

test('a server that never answers cannot stall the loop', async () => {
  const target = await listen(() => { /* never respond */ });
  const { lines, ...log } = quietLog();
  const stop = startKeepAwake({ url: target.url, intervalMs: 20, firstDelayMs: 5, timeoutMs: 40, log });
  await waitFor(() => target.hits.length >= 3, { what: 'later pings after timeouts' });
  stop();
  assert.ok(lines.some(([kind]) => kind === 'warn'));
});

test('an unreachable address is reported, not thrown', async () => {
  const { lines, ...log } = quietLog();
  const stop = startKeepAwake({ url: 'http://127.0.0.1:1/api/health', intervalMs: 20, firstDelayMs: 5, log });
  await waitFor(() => lines.length > 0, { what: 'a warning' });
  stop();
  assert.equal(lines[0][0], 'warn');
});

test('the timer never keeps the process alive on its own', async () => {
  const { spawnSync } = await import('node:child_process');
  const run = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { startKeepAwake } from './server/keepalive.js'; startKeepAwake({ url: 'http://127.0.0.1:1/x', intervalMs: 600000, firstDelayMs: 600000 });"
  ], { cwd: new URL('../..', import.meta.url).pathname, timeout: 5000 });
  assert.equal(run.status, 0, 'exits immediately instead of waiting for the next ping');
});
