// The web app is the part people actually open, and the server is the only thing that serves it.
// These two paths used to be able to fail silently:
//
//   1. nothing was built, so every page answered a bare "Cannot GET /" — indistinguishable from
//      the site being down, while /api/health still said everything was fine;
//   2. once a build existed it had to be served correctly for deep links and assets too.
//
// These tests pin both, using a throw-away dist folder so they never depend on (or trigger) a
// real Vite build.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, call } from './helpers.js';
import { ensureClientBuild, isClientBuilt, clientDir, clientIndexPath, repoRoot } from '../../scripts/ensure-client-build.mjs';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-client-'));
const builtDir = path.join(work, 'built');
const missingDir = path.join(work, 'never-built');

const APP_HTML = '<!doctype html><html><head><title>Pulse — test build</title></head><body><div id="root">app</div></body></html>';

before(() => {
  fs.mkdirSync(path.join(builtDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(builtDir, 'index.html'), APP_HTML);
  fs.writeFileSync(path.join(builtDir, 'assets', 'index-test.js'), 'console.log("pulse test asset");');
});

after(() => fs.rmSync(work, { recursive: true, force: true }));

const start = (dataName, extra = {}) =>
  startServer(fs.mkdtempSync(path.join(work, dataName)), { PULSE_CLIENT_DIR: builtDir, ...extra });

test('the built web app is served, including deep links and its assets', async () => {
  const server = await start('data-built-');
  try {
    const api = call(server);

    // the front door
    const home = await api('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /Pulse — test build/);

    // every inner route is the same app shell (the client router takes it from there)
    for (const route of ['/albums/7', '/artists/3', '/playlists/12', '/settings', '/offline-player']) {
      const page = await api('GET', route);
      assert.equal(page.status, 200, route);
      assert.match(page.body, /id="root"/, route);
    }

    // hashed build assets, with the type the browser needs for a module
    const asset = await api('GET', '/assets/index-test.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') || '', /javascript/);

    // the API is untouched by the SPA fallback
    const health = await api('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal((await api('GET', '/api/songs')).status, 200);

    // a missing upload answers 404, it is not swallowed by the fallback
    assert.equal((await api('GET', '/media/uploads/nope.wav')).status, 404);

    // and the boot log says where the app came from
    assert.match(server.logs(), /Serving the web app from/);
  } finally {
    server.stop();
  }
});

test('with no build, pages explain how to build instead of 404-ing like a dead site', async () => {
  const server = await startServer(fs.mkdtempSync(path.join(work, 'data-empty-')), {
    PULSE_CLIENT_DIR: missingDir,
    PULSE_SKIP_CLIENT_BUILD: 'true'
  });
  try {
    const api = call(server);

    const home = await api('GET', '/');
    assert.equal(home.status, 503);
    assert.match(home.body, /npm run build/);
    assert.match(home.headers.get('content-type') || '', /html/);

    // deep links get the same explanation, not a bare 404
    assert.equal((await api('GET', '/albums/1')).status, 503);

    // the API still works — only the pages are missing
    assert.equal((await api('GET', '/api/health')).status, 200);

    // and the log says what happened, so a host's log is enough to diagnose it
    assert.match(server.logs(), /The web app is NOT built/);
  } finally {
    server.stop();
  }
});

test('the build helper only builds when there is something to build', () => {
  const quiet = { log() {}, warn() {} };

  // already built: nothing happens, and no command is run
  let ran = [];
  const present = ensureClientBuild({ env: { PULSE_CLIENT_DIR: builtDir }, log: quiet, run: (...a) => { ran.push(a); return true; } });
  assert.deepEqual(present, { ok: true, built: false });
  assert.deepEqual(ran, []);

  // switched off on purpose (what a host that builds the client itself, or the tests, do)
  const skipped = ensureClientBuild({ env: { PULSE_CLIENT_DIR: missingDir, PULSE_SKIP_CLIENT_BUILD: 'true' }, log: quiet });
  assert.deepEqual(skipped, { ok: true, built: false, skipped: true });

  // a failing install/build is reported, never thrown, and never claims success
  const warnings = [];
  const failed = ensureClientBuild({
    env: { PULSE_CLIENT_DIR: missingDir },
    log: { log() {}, warn: (m) => warnings.push(m) },
    run: () => false
  });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /dependencies|build/);
  assert.equal(warnings.length, 1);
  assert.equal(isClientBuilt({ PULSE_CLIENT_DIR: missingDir }), false);

  // the defaults point at the real checkout
  assert.equal(clientDir({}), path.join(repoRoot, 'client', 'dist'));
  assert.equal(clientIndexPath({}), path.join(repoRoot, 'client', 'dist', 'index.html'));
});
