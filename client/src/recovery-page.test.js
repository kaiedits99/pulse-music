// The recovery screen is the last thing between someone and a phone app they cannot use. It is
// plain HTML with one inline script, so there is no bundler to catch a typo in it: a missing
// variable leaves the page painted and every control dead, which is exactly how it shipped once
// ("the button is there, but it doesn't do shit"). These tests execute the real generated page.
//
// The page has two lives:
//   native  — https://localhost/offline.html inside the app; its script runs, and the address it
//             was built with is inlined into it.
//   website — the same file served by Pulse; the server's CSP forbids inline scripts, so nothing
//             in the script may be required for the screen to be usable.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '..');
const SITE = 'https://pulse.example.com';
const htmlPath = path.join(clientDir, 'public', 'offline.html');
let original;

before(() => {
  original = fs.readFileSync(htmlPath, 'utf8');
  // Build the page exactly as a live-mode release does.
  const result = spawnSync(process.execPath, ['scripts/capacitor-config.mjs'], {
    cwd: clientDir,
    env: { ...process.env, PULSE_APP_URL: SITE, VITE_API_URL: '' },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return () => fs.writeFileSync(htmlPath, original);
});

/** Runs the generated page in a DOM without any external package. */
async function render(html, { url, scripted = true, fetch: fetchImpl } = {}) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(html, {
    url,
    runScripts: scripted ? 'dangerously' : 'outside-only',
    beforeParse(window) {
      window.fetch = fetchImpl || (() => Promise.reject(new Error('offline')));
      window.AbortController = globalThis.AbortController;
      const store = new Map();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k)
        },
        configurable: true
      });
      window.__store = store;
      // jsdom cannot cancel navigation; record it instead of crashing on it.
      window.addEventListener('error', (event) => {
        if (!/Not implemented: navigation/.test(String(event.message))) throw event.error;
      });
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  return dom.window;
}

const built = () => fs.readFileSync(htmlPath, 'utf8');

test('on the phone the settings control works and the address can be changed on the spot', async () => {
  const html = built();
  assert.match(html, new RegExp(`"remoteUrl":"${SITE}"`), 'the build inlines the configured address');

  const w = await render(html, { url: 'https://localhost/offline.html' });
  const { document } = w;
  const change = document.getElementById('change-server');
  const form = document.getElementById('server-form');
  const input = document.getElementById('server-url');

  assert.ok(change, 'the control exists');
  assert.equal(change.hidden, false, 'and is visible without anything else happening');
  assert.equal(change.tagName, 'BUTTON', 'it must not be a navigation: localhost cannot be reached in live mode');
  assert.equal(document.getElementById('retry').getAttribute('href'), SITE, 'Try again goes to the website');

  // Tapping it reveals a field, pre-filled and focused.
  change.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(form.hidden, false, 'the field is revealed');
  assert.equal(input.value, SITE, 'pre-filled with the address the app was built with');

  // A corrected address is saved for the app to use, and the page reconnects to it.
  input.value = 'mysite.example.com';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(w.__store.get('pulse_api_url'), 'https://mysite.example.com', 'a bare domain becomes https');
  assert.match(document.getElementById('server-status').textContent, /Reconnecting to https:\/\/mysite\.example\.com/);
});

test('a value that is not a web address is refused instead of saved', async () => {
  const w = await render(built(), { url: 'https://localhost/offline.html' });
  w.document.getElementById('change-server').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  w.document.getElementById('server-url').value = 'not a url';
  w.document.getElementById('server-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(w.__store.get('pulse_api_url'), undefined, 'nothing was stored');
  assert.match(w.document.getElementById('server-status').textContent, /does not look like a web address/);
});

test('with no script (the copy the website serves) the screen is still usable', async () => {
  // The server sends script-src 'self' with no 'unsafe-inline'. Run the page with every script
  // block removed — the same result — and require that nothing on screen needs one.
  const html = built().replace(/<script[\s\S]*?<\/script>/gi, '');
  for (const url of ['https://pulse.example.com/offline.html', 'https://localhost/offline.html']) {
    const w = await render(html, { url, scripted: false });
    const { document } = w;
    assert.match(document.body.textContent, /Check your connection/, 'the problem is still explained');
    const retry = document.getElementById('retry');
    assert.equal(retry.tagName, 'A', 'Try again is a plain link');
    assert.equal(retry.getAttribute('href'), '/', 'and reloads the page rather than an unreachable host');
    assert.notEqual(document.getElementById('change-server').hidden, false,
      'no control is shown that would need a script to work');
    assert.notEqual(document.getElementById('server-form').hidden, false);
  }
});
