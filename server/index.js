import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import chatRoutes from './chat-routes.js';
import { startChatCleanup } from './chat.js';
import db, { dataDir, uploadsDir } from './db.js';
import { purgeLegacyDemoData } from './legacy-demo-cleanup.js';
import { storage, redirectToBucket } from './media.js';
import { dataSafety, describeDataSafety } from './persistence.js';
import { keepAwakeConfig, formatWakeHours, startKeepAwake } from './keepalive.js';
import { installGracefulShutdown } from './shutdown.js';
import { assertEmailConfiguration } from './email.js';
import { ensureClientBuild, isClientBuilt, clientDir, missingBuildPage } from '../scripts/ensure-client-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
if (String(process.env.NODE_ENV).toLowerCase() === 'production' || process.env.RENDER) {
  assertEmailConfiguration();
}

const app = express();
const trustProxySetting = process.env.PULSE_TRUST_PROXY;
if (trustProxySetting !== undefined) {
  app.set('trust proxy', /^(true|1)$/i.test(trustProxySetting) ? 1 : false);
} else {
  app.set('trust proxy', process.env.RENDER ? 1 : false);
}
// Same-origin web requests need no CORS permission. Cross-origin access is limited to
// the native WebView origins plus explicitly configured deployment origins.
const configuredOrigins = String(process.env.PULSE_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const allowedCorsOrigins = new Set([
  'capacitor://localhost', 'https://localhost', 'http://localhost',
  ...configuredOrigins
]);
app.use(cors({
  origin(origin, cb) { cb(null, !origin || allowedCorsOrigins.has(origin)); },
  credentials: true,
  maxAge: 600
}));

// Cookie-based sessions are ambient authority, so unsafe methods must come from
// the same origin or a native/configured origin. Bearer-only clients are not
// affected (their token is an explicit Authorization header).
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const hasCookie = /(?:^|;\s*)pulse_session=/.test(String(req.headers.cookie || ''));
  if (!hasCookie || req.headers.authorization) return next();
  const origin = req.headers.origin;
  let sameOrigin = false;
  try {
    const scheme = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
    sameOrigin = Boolean(origin) && origin === `${scheme}://${req.get('host')}`;
  } catch { /* invalid origin */ }
  if (!sameOrigin && !allowedCorsOrigins.has(origin)) {
    return res.status(403).json({ error: 'Request origin is not allowed' });
  }
  return next();
});
// Minimal security headers without adding a dependency (helmet equivalent).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self' https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https: wss:",
    "frame-src https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com",
    "worker-src 'self' blob:"
  ].join('; '));
  // HSTS only makes sense behind TLS; Render terminates TLS in front of us,
  // so advertise it and let the proxy strip it if the request was plain http.
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  next();
});
// Body parsers with explicit limits — qs DoS (GHSA) feeds on deeply nested
// urlencoded bodies, so keep the limit small and the nesting shallow.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb', parameterLimit: 100 }));

// Uploaded audio and artwork, with Range support for streaming. Only the uploads
// folder is exposed — the data directory also holds the SQLite database, which must
// never be downloadable.
app.use('/media/uploads', express.static(uploadsDir, {
  maxAge: '1d',
  setHeaders(res, filePath) {
    // Old releases allowed uploaded SVGs. Isolate them if any remain on disk so a direct
    // navigation cannot run embedded script with the Pulse origin's authority.
    if (path.extname(filePath).toLowerCase() === '.svg') {
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    }
  }
}));
// With a bucket configured, uploads live there instead: anything not on local disk is sent to the
// bucket (see media.js), so playback bandwidth never passes through this server.
if (storage.remote) app.get('/media/uploads/:name', redirectToBucket);

// Messaging: its own store and its own cleanup clock (see server/chat.js).
app.use('/api/chat', chatRoutes);

// API
app.use('/api', routes);

// Serve the built web app — the same service that serves the API, so the website and the mobile
// app read and write exactly the same data. A fresh checkout has no build yet: build it now
// rather than answering every page with a bare "Cannot GET /". PULSE_SKIP_CLIENT_BUILD turns
// this off for hosts that build the client themselves, and for the test suite.
const build = ensureClientBuild();
const dist = clientDir();

if (isClientBuilt()) {
  console.log(`[pulse] Serving the web app from ${dist}`);
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  console.warn(`[pulse] No web app to serve: ${build.reason || 'client/dist/index.html is missing'}. `
    + 'The API still works; / explains how to build the site.');
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    res.status(503).type('html').send(missingBuildPage(build.reason));
  });
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) ? err.status
    : err.code === 'LIMIT_FILE_SIZE' ? 413
      : err.name === 'MulterError' ? 400 : 500;
  // Do not echo/log SQL errors, URLs, tokens, or submitted field values.
  if (status >= 500) console.error('[pulse] Request failed', { method: req.method, path: req.path, code: err.code || err.name || 'Error' });
  const message = status >= 500 ? 'Server error' : (err.message || 'Invalid request');
  return res.status(status).json({ error: message });
});

// ---------------------------------------------------------------------------
// Boot.
//
// Pulse starts EMPTY: nothing is seeded, generated or imported. The catalog is made
// of what people upload, and every public upload is visible to everyone who signs
// in afterwards. The only thing done here is clearing out demo content that an
// older version of Pulse may have left in an existing database (see
// legacy-demo-cleanup.js) — a no-op on a fresh install.
//
// A failure is logged but never stops the server from listening.
// ---------------------------------------------------------------------------
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const removed = purgeLegacyDemoData(db, dataDir);
  if (removed.total > 0) {
    console.log(
      `[pulse] Removed leftover demo content: ${removed.songs} track(s), ${removed.albums} album(s), `
      + `${removed.artists} artist(s), ${removed.playlists} playlist(s), ${removed.podcasts} podcast show(s) `
      + `(${removed.episodes} episode(s)), ${removed.accounts} demo account(s), ${removed.files} generated file(s).`
    );
  }
  for (const email of removed.keptAccounts) {
    console.warn(`[pulse] Kept legacy demo account ${email} because it owns real data. `
      + 'Its old demo password still works — delete the account if it is not yours.');
  }
} catch (err) {
  console.error('[pulse] Legacy demo cleanup failed — starting anyway:', err.message);
}

console.log(`[pulse] Uploads are kept on ${storage.describe()}.`);
{
  const safety = dataSafety({ remote: storage.remote });
  // Two lines, always: where the files are, where the database is. They are kept by different
  // mechanisms, and reporting only the first is what made a wiped database look like a healthy
  // deployment.
  console.log(`[pulse] Uploads:  ${safety.uploads.message}`);
  console.log(`[pulse] Database: ${safety.database.message}`);
  const line = describeDataSafety(safety);
  if (safety.persistent) console.log(line); else console.warn(line);
}

// Everything with a deadline: expired messages, their attachments, and old report copies.
// Reads already hide lapsed messages, so this only reclaims space — it never gates access.
startChatCleanup();

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[pulse] Server running at http://0.0.0.0:${PORT}`);
  const keepAwake = keepAwakeConfig();
  if (keepAwake) {
    startKeepAwake(keepAwake);
    // Say the hours out loud: whether the app is awake around the clock (nearly the whole free monthly
    // allowance) or only during the hours people use it decides if the instance hours ever run out.
    const schedule = formatWakeHours(keepAwake.hours);
    const zone = keepAwake.hours && keepAwake.timeZone ? ` ${keepAwake.timeZone}` : '';
    console.log(`[pulse] Keep-awake ping enabled (${keepAwake.url}, ${schedule}${zone}).`);
  }
});
installGracefulShutdown(server, { delaySeconds: process.env.PULSE_SHUTDOWN_DELAY_SECONDS });
