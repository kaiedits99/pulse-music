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
const original = fs.readFileSync(configPath, 'utf8');

after(() => fs.writeFileSync(configPath, original));

function generate(env = {}) {
  const base = { ...process.env };
  for (const key of ['PULSE_APP_URL', 'VITE_API_URL']) delete base[key];
  const result = spawnSync(process.execPath, ['scripts/capacitor-config.mjs'], {
    cwd: clientDir,
    env: { ...base, ...env },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return { config: JSON.parse(fs.readFileSync(configPath, 'utf8')), output: `${result.stdout}${result.stderr}` };
}

test('with a website address the app loads the live site, so web fixes need no new APK', () => {
  const { config, output } = generate({ PULSE_APP_URL: 'https://pulse-music.onrender.com' });
  assert.equal(config.server.url, 'https://pulse-music.onrender.com');
  assert.deepEqual(config.server.allowNavigation, ['pulse-music.onrender.com']);
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
  const { config, output } = generate();
  assert.equal(config.server.url, undefined);
  assert.equal(config.server.androidScheme, 'https');
  assert.match(output, /bundled app/);
});

test('plain http is refused for a real host, but allowed for localhost', () => {
  const remote = generate({ PULSE_APP_URL: 'http://pulse.example.com' });
  assert.equal(remote.config.server.url, undefined, 'http would be blocked by the WebView anyway');
  assert.match(remote.output, /https/);

  const local = generate({ PULSE_APP_URL: 'http://localhost:8080' });
  assert.equal(local.config.server.url, 'http://localhost:8080');
});
