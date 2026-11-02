// How the Android app loads Pulse decides whether a web fix reaches an installed phone without a
// new APK. These tests run the real config generator and inspect what Capacitor would be given.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '..');
const configPath = path.join(clientDir, 'capacitor.config.json');
const runtimePath = path.join(clientDir, 'public', 'capacitor-runtime.js');
const original = fs.readFileSync(configPath, 'utf8');
const originalRuntime = fs.readFileSync(runtimePath, 'utf8');

after(() => {
  fs.writeFileSync(configPath, original);
  fs.writeFileSync(runtimePath, originalRuntime);
});

function generate(env = {}) {
  const base = { ...process.env };
  for (const key of ['PULSE_APP_URL', 'VITE_API_URL']) delete base[key];
  const result = spawnSync(process.execPath, ['scripts/capacitor-config.mjs'], {
    cwd: clientDir,
    env: { ...base, ...env },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const runtimeText = fs.readFileSync(runtimePath, 'utf8');
  const runtimeMatch = runtimeText.match(/window\.PULSE_CAPACITOR_RUNTIME = (.+);/);
  assert.ok(runtimeMatch, 'the offline page receives generated runtime connection settings');
  return {
    config: JSON.parse(fs.readFileSync(configPath, 'utf8')),
    runtime: JSON.parse(runtimeMatch[1]),
    output: `${result.stdout}${result.stderr}`
  };
}

test('with a website address the app loads the live site, so web fixes need no new APK', () => {
  const { config, runtime, output } = generate({ PULSE_APP_URL: 'https://pulse-music.onrender.com' });
  assert.equal(config.server.url, 'https://pulse-music.onrender.com');
  assert.equal(runtime.remoteUrl, 'https://pulse-music.onrender.com', 'offline retry targets the live site rather than reloading itself');
  assert.deepEqual(config.server.allowNavigation, ['pulse-music.onrender.com', 'localhost']);
  assert.equal(config.server.errorPath, 'offline.html', 'a failed load shows the bundled page');
  assert.equal(config.webDir, 'dist');
  assert.match(output, /Live mode/);
});

test('VITE_API_URL is accepted too, so one variable configures the whole build', () => {
  const { config } = generate({ VITE_API_URL: 'https://pulse.example.com/' });
  assert.equal(config.server.url, 'https://pulse.example.com');
});

test('a bare domain is treated as https', () => {
  const { config } = generate({ PULSE_APP_URL: 'pulse.example.com' });
  assert.equal(config.server.url, 'https://pulse.example.com');
});

test('without an address the bundled app is built, and asks on first launch', () => {
  const { config, runtime, output } = generate();
  assert.equal(config.server.url, undefined);
  assert.equal(runtime.remoteUrl, '');
  assert.equal(config.server.androidScheme, 'https');
  assert.match(output, /bundled app/);
});

test('the bundled mobile recovery page wakes and retries the configured website', () => {
  const page = fs.readFileSync(path.join(clientDir, 'public', 'offline.html'), 'utf8');
  const script = fs.readFileSync(path.join(clientDir, 'public', 'offline.js'), 'utf8');
  assert.match(page, /src="\.\/offline\.js"/, 'the page loads its logic from a file the CSP allows');
  assert.match(script, /PULSE_CAPACITOR_RUNTIME/);
  assert.match(script, /fetch\(health, \{ method: 'GET', cache: 'no-store'/);
  assert.match(script, /window\.location\.replace\(target\)/);
  assert.match(script, /login\?settings=server/);
});

test('no page under public/ relies on an inline script the server CSP would block', () => {
  // server/index.js sends `script-src 'self' https://accounts.google.com` with no 'unsafe-inline'.
  // An inline script therefore never runs: the recovery page painted but "Try again" did nothing.
  const dir = path.join(clientDir, 'public');
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const hasSrc = /\bsrc\s*=/i.test(match[1]);
      if (!hasSrc || match[2].trim()) offenders.push(`${name}: inline script`);
    }
  }
  assert.deepEqual(offenders, [], `these would be blocked by the app's own CSP:\n${offenders.join('\n')}`);
});

test('plain http is refused for a real host, but allowed for localhost', () => {
  const remote = generate({ PULSE_APP_URL: 'http://pulse.example.com' });
  assert.equal(remote.config.server.url, undefined, 'http would be blocked by the WebView anyway');
  assert.match(remote.output, /https/);

  const local = generate({ PULSE_APP_URL: 'http://localhost:8080' });
  assert.equal(local.config.server.url, 'http://localhost:8080');
});
