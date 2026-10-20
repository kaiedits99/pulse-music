// Writes client/capacitor.config.json before the Android project is generated.
//
// Two ways to ship the Android app, chosen by whether a website address was provided:
//
//   live    The app opens the Pulse website (server.url). Every web fix reaches installed phones
//           the moment the site is deployed — no new APK to download. What the phone shows is
//           exactly what the browser shows, which is the point of Pulse being one service.
//   bundled No address given: the app carries its own copy of the interface and asks for the server
//           address on first launch. Works offline out of the box, but needs a new APK for web fixes.
//
// The address comes from PULSE_APP_URL, or VITE_API_URL (the variable the rest of the build uses).
// Plain http is only accepted for localhost, because Android's WebView would block it anyway and the
// app would look broken rather than misconfigured.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(here, '..', 'capacitor.config.json');

const raw = String(process.env.PULSE_APP_URL || process.env.VITE_API_URL || '').trim();
const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(raw);

function normalize(value) {
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && !isLoopback) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

const base = {
  appId: 'com.pulse.music',
  appName: 'Pulse',
  webDir: 'dist',
  server: { androidScheme: 'https' }
};

const target = normalize(raw);

if (!target) {
  if (raw) {
    console.warn(
      `[capacitor] Ignoring "${raw}": the app needs an https:// address (http is only allowed for localhost). `
      + 'Building the bundled app, which asks for the address on first launch.'
    );
  } else {
    console.log('[capacitor] No PULSE_APP_URL/VITE_API_URL — building the bundled app (asks for a server address on first launch).');
  }
  fs.writeFileSync(configPath, `${JSON.stringify(base, null, 2)}\n`);
  process.exit(0);
}

const host = new URL(target).host;
const config = {
  ...base,
  server: {
    androidScheme: 'https',
    url: target,
    // The page is the site itself, so staying inside it (and handing anything else to the browser)
    // is exactly what the web app expects.
    allowNavigation: [host],
    // Kept inside the APK and shown when the site cannot be reached — a sleeping free instance, or
    // a phone with no signal — instead of a blank white window.
    errorPath: 'offline.html'
  }
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`[capacitor] Live mode: the app will open ${target} (updates arrive with every deploy).`);
