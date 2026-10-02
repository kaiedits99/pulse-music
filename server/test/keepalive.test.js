// The self-ping that stops a free host from putting the app to sleep.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  keepAwakeTarget, keepAwakeConfig, startKeepAwake, parseWakeHours, inWakeHours, hourInZone
} from '../keepalive.js';
import { root, waitFor, sleep } from './helpers.js';

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

// --- awake hours ------------------------------------------------------------------------------
// Render's free plan gives a workspace 750 instance hours a month and a month is only ~730 hours, so
// an app kept awake around the clock spends the whole allowance and gets suspended until the 1st.
// These tests cover the narrowing that makes that impossible.

test('awake hours: "<start>-<end>", with anything unparseable meaning around the clock', () => {
  assert.deepEqual(parseWakeHours('6-24'), { start: 6, end: 24 });
  assert.deepEqual(parseWakeHours(' 22 - 6 '), { start: 22, end: 6 });
  for (const loose of ['', undefined, null, '0-24', 'all day', '6..24', '25-3', '-1-5', '6-6']) {
    assert.equal(parseWakeHours(loose), null, `${JSON.stringify(loose)} must mean "no restriction"`);
  }
});

test('awake hours: windows work, including one that wraps past midnight', () => {
  const day = { start: 6, end: 24 };
  assert.equal(inWakeHours(5, day), false);
  assert.equal(inWakeHours(6, day), true);
  assert.equal(inWakeHours(23, day), true);
  const night = { start: 22, end: 6 };
  assert.equal(inWakeHours(23, night), true);
  assert.equal(inWakeHours(3, night), true);
  assert.equal(inWakeHours(12, night), false);
  assert.equal(inWakeHours(12, null), true, 'no window means around the clock');
});

test('awake hours are read in PULSE_TIMEZONE, falling back to the host clock', () => {
  const at = new Date('2026-10-02T10:30:00Z');
  assert.equal(hourInZone(at, 'Africa/Lagos'), 11, 'Lagos is UTC+1');
  assert.equal(hourInZone(new Date('2026-10-01T23:30:00Z'), 'Africa/Lagos'), 0, 'midnight is 0, not 24');
  const local = hourInZone(at, null);
  assert.ok(local >= 0 && local < 24);
  assert.equal(hourInZone(at, 'Not/AZone'), local, 'a typo in the timezone falls back instead of throwing');
});

test('the config ties the address, the hours and the timezone together', () => {
  const url = 'https://pulse.onrender.com/api/health';
  assert.deepEqual(keepAwakeConfig({ KEEP_AWAKE: 'true', RENDER_EXTERNAL_URL: 'https://pulse.onrender.com' }), {
    url, hours: null, timeZone: null
  });
  assert.deepEqual(
    keepAwakeConfig({ KEEP_AWAKE: 'true', RENDER_EXTERNAL_URL: 'https://pulse.onrender.com', KEEP_AWAKE_HOURS: '6-24', PULSE_TIMEZONE: 'Africa/Lagos' }),
    { url, hours: { start: 6, end: 24 }, timeZone: 'Africa/Lagos' }
  );
  assert.equal(keepAwakeConfig({ KEEP_AWAKE: 'true', KEEP_AWAKE_HOURS: '6-24' }), null, 'still needs an address');
});

test('outside the awake hours it lets the app sleep; inside, it pings', async () => {
  const target = await listen(ok);
  const { lines, ...log } = quietLog();
  const hours = { start: 6, end: 24 };
  let clock = new Date('2026-10-02T03:00:00Z'); // 03:00 — outside
  const stop = startKeepAwake({ url: target.url, hours, intervalMs: 15, firstDelayMs: 5, log, now: () => clock });
  await sleep(200);
  assert.equal(target.hits.length, 0, 'no pings while it is meant to be asleep');
  assert.equal(lines.filter(([kind]) => kind === 'log').length, 1, 'the pause is explained exactly once');
  assert.match(lines[0][1], /outside 06:00\u201324:00/);
  clock = new Date('2026-10-02T09:00:00Z'); // 09:00 — inside
  await waitFor(() => target.hits.length >= 1, { what: 'pings once the day starts' });
  stop();
});

test('the shipped schedule leaves room in the free monthly allowance', () => {
  // 750 hours a month, and a month is ~730: a service kept awake 24/7 uses all of it and gets
  // suspended until the 1st. If running around the clock is ever a deliberate decision, change this
  // test — but change it knowing what it protects.
  const value = /key: KEEP_AWAKE_HOURS\s*\n\s*value: "?([^"\n]+)"?/.exec(fs.readFileSync(path.join(root, 'render.yaml'), 'utf8'))?.[1];
  assert.ok(value, 'render.yaml must set KEEP_AWAKE_HOURS');
  const window = parseWakeHours(value);
  assert.ok(window, `KEEP_AWAKE_HOURS is "${value}", which means around the clock — that spends the whole free allowance`);
  const perDay = window.start < window.end ? window.end - window.start : 24 - window.start + window.end;
  assert.ok(perDay <= 20, `${perDay}h a day is too much awake time to stay safely inside 750 instance hours a month`);
});
