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
// The generator writes public/offline.html from scripts/templates/offline.html; restore the
// generated copy so the repository keeps whichever one it had.
const originalOffline = fs.readFileSync(path.join(clientDir, 'public', 'offline.html'), 'utf8');

after(() => {
  fs.writeFileSync(configPath, original);
  fs.writeFileSync(runtimePath, originalRuntime);
  fs.writeFileSync(path.join(clientDir, 'public', 'offline.html'), originalOffline);
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

const templatePath = path.join(clientDir, 'scripts', 'templates', 'offline.html');

test('the bundled mobile recovery page wakes and retries the configured website', () => {
  const page = fs.readFileSync(templatePath, 'utf8');
  assert.match(page, /PULSE_CAPACITOR_RUNTIME/);
  assert.match(page, /healthUrl/);
  assert.match(page, /\/api\/health/);
  assert.match(page, /location\.replace\(target\)/);
  assert.match(page, /\/login\?settings=server/);
});

test('the recovery page carries its own settings, with no external file to lose', () => {
  // Capacitor serves this page from the local origin but proxies its sub-resources to the network
  // in live mode, where "localhost" does not exist. A page that loaded ./capacitor-runtime.js or
  // ./offline.js painted its styles and then had no address, a dead retry and no settings button.
  // Everything it needs must be inline; the only external reference is the marker the build
  // replaces with the address.
  const page = fs.readFileSync(templatePath, 'utf8');
  const external = [...page.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((url) => !/^#/.test(url));
  assert.deepEqual(external, ['./capacitor-runtime.js'], 'no stylesheet, font or script is fetched at runtime');
  assert.equal(fs.existsSync(path.join(clientDir, 'public', 'offline.html')) === false, false, 'the built page exists');
  assert.equal(fs.existsSync(path.join(clientDir, 'public', 'offline.js')), false, 'the external logic file is gone');

  // "Try again" is a real link, so it works without JS.
  assert.match(page, /<a[^>]+id="retry"/);
});

test('the address can be changed on the recovery screen itself', () => {
  // "Open app settings" navigated to /login?settings=server on the app's local origin. In live mode
  // Capacitor proxies that host to the network, nothing answers, the navigation fails and the error
  // page is shown again — so the button looked dead and there was no way to correct a wrong
  // address. The field must live on this page, which needs no navigation at all.
  const page = fs.readFileSync(templatePath, 'utf8');
  assert.match(page, /<form[^>]+id="server-form"/);
  assert.match(page, /<input[^>]+id="server-url"[^>]+type="url"/);
  assert.match(page, /<button[^>]+id="server-save"[^>]+type="submit"/);
  assert.match(page, /localStorage\.setItem\('pulse_api_url'/);
  assert.match(page, /location\.replace\(clean\)/, 'saving reconnects to the new address');

  // No <a> may offer to reach the app's local settings screen: that navigation cannot resolve in
  // live mode, which is what made the old button dead.
  const settingsLinks = [...page.matchAll(/<a[^>]*id="change-server"[^>]*>/g)];
  assert.deepEqual(settingsLinks, [], 'the settings escape hatch is a control on this page, not a link');
  // The plain fallback for "Try again" is the page's own origin (always safe), never a host that
  // needs JavaScript to be known: the script rewrites it before anyone can tap it.
  assert.match(page, /<a id="retry"[^>]+href="\/"/);
});

test('the build inlines the website address into the recovery page', () => {
  const live = generate({ PULSE_APP_URL: 'https://pulse.example.com' });
  const page = fs.readFileSync(path.join(clientDir, 'public', 'offline.html'), 'utf8');
  assert.match(page, /window\.PULSE_CAPACITOR_RUNTIME = \{"remoteUrl":"https:\/\/pulse\.example\.com"\}/);
  assert.doesNotMatch(page, /src="\.\/capacitor-runtime\.js"/, 'the built copy loads nothing external');
  assert.equal(live.config.server.errorPath, 'offline.html');

  const bundled = generate({});
  assert.match(fs.readFileSync(path.join(clientDir, 'public', 'offline.html'), 'utf8'),
    /window\.PULSE_CAPACITOR_RUNTIME = \{"remoteUrl":""\}/, 'the bundled app inlines an empty address');
  assert.equal(bundled.config.server.url, undefined);
});

test('no page under public/ relies on an inline script the server CSP would block when served', () => {
  // The recovery page is shown by two servers. The website's CSP forbids inline scripts, so the
  // copy the site serves runs no script at all — which is why every control on it is a plain link
  // that works with JavaScript switched off. Once the build inlines its settings, that is the only
  // way both copies can behave. Inline scripts are therefore allowed only for that one settings
  // assignment, and no page may load a script from a path the proxy would drop.
  const dir = path.join(clientDir, 'public');
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const hasSrc = /\bsrc\s*=/i.test(match[1]);
      if (!hasSrc) continue;
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1] || '';
      // A relative sub-resource of the recovery page dies under Capacitor's proxy.
      if (name === 'offline.html' && !/^https?:/i.test(src)) offenders.push(`${name}: loads ${src}`);
    }
  }
  assert.deepEqual(offenders, [], `these would not load in the app:\n${offenders.join('\n')}`);
});

test('plain http is refused for a real host, but allowed for localhost', () => {
  const remote = generate({ PULSE_APP_URL: 'http://pulse.example.com' });
  assert.equal(remote.config.server.url, undefined, 'http would be blocked by the WebView anyway');
  assert.match(remote.output, /https/);

  const local = generate({ PULSE_APP_URL: 'http://localhost:8080' });
  assert.equal(local.config.server.url, 'http://localhost:8080');
});
