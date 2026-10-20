// The website has to exist before it can be visited. These tests cover the hole that made a
// healthy instance answer every page with "Cannot GET /": the built client is generated, so a
// checkout that never built it had nothing to serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import {
  ensureClientBuild,
  isClientBuilt,
  clientIndexPath,
  missingBuildPage
} from '../../scripts/ensure-client-build.mjs';

const tempClient = (indexHtml = null) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-client-'));
  if (indexHtml !== null) fs.writeFileSync(path.join(dir, 'index.html'), indexHtml);
  return dir;
};

test('a built client is left alone — no second build', () => {
  const dir = tempClient('<!doctype html><div id="root"></div>');
  const calls = [];
  const result = ensureClientBuild({
    env: { PULSE_CLIENT_DIR: dir },
    log: { log() {}, warn() {} },
    run: (args) => { calls.push(args); return true; }
  });
  assert.deepEqual(result, { ok: true, built: false });
  assert.deepEqual(calls, [], 'nothing should be installed or built');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the build can be switched off, and says so', () => {
  const dir = tempClient();
  const result = ensureClientBuild({
    env: { PULSE_CLIENT_DIR: dir, PULSE_SKIP_CLIENT_BUILD: 'true' },
    log: { log() {}, warn() {} },
    run: () => { throw new Error('must not run'); }
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(isClientBuilt({ PULSE_CLIENT_DIR: dir }), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty folder is not a build, and points at index.html', () => {
  const dir = tempClient();
  assert.equal(isClientBuilt({ PULSE_CLIENT_DIR: dir }), false);
  assert.equal(clientIndexPath({ PULSE_CLIENT_DIR: dir }), path.join(dir, 'index.html'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the fallback page explains how to build the site', () => {
  const page = missingBuildPage('client/dist/index.html is missing');
  assert.match(page, /npm run build/);
  assert.match(page, /client\/dist\/index\.html is missing/);
  assert.match(page, /\/api\/health/);
});

test('with no build, every page answers with an actionable 503 instead of a bare 404', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-data-'));
  const clientDir = tempClient();
  const server = await startServer(dataDir, { PULSE_CLIENT_DIR: clientDir });
  try {
    const page = await fetch(`${server.url}/`);
    assert.equal(page.status, 503);
    assert.match(page.headers.get('content-type') || '', /text\/html/);
    assert.match(await page.text(), /npm run build/);

    // A deep link gets the same explanation — not a JSON 404 that looks like a broken route.
    const deep = await fetch(`${server.url}/messages/@someone`);
    assert.equal(deep.status, 503);

    // The API is untouched by a missing front end, so the failure is diagnosable from a browser.
    const health = await fetch(`${server.url}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
  } finally {
    server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
});

test('with a build, the site and every deep link are served — and the API is still the API', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-data-'));
  const clientDir = tempClient('<!doctype html><html><body><div id="root">Pulse site</div></body></html>');
  const server = await startServer(dataDir, { PULSE_CLIENT_DIR: clientDir });
  try {
    const home = await fetch(`${server.url}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Pulse site/);

    // The client is a single-page app: /albums/12 must return index.html, not 404.
    const deep = await fetch(`${server.url}/albums/12`);
    assert.equal(deep.status, 200);
    assert.match(await deep.text(), /Pulse site/);

    const health = await fetch(`${server.url}/api/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get('content-type') || '', /application\/json/);
    assert.equal((await health.json()).status, 'ok');
  } finally {
    server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
});
