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
import { keepAwakeConfig, formatWakeHours, startKeepAwake } from './keepalive.js';
import { installGracefulShutdown } from './shutdown.js';
import { ensureClientBuild, clientDir, isClientBuilt } from '../scripts/ensure-client-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploaded audio and artwork, with Range support for streaming. Only the uploads
// folder is exposed — the data directory also holds the SQLite database, which must
// never be downloadable.
app.use('/media/uploads', express.static(uploadsDir, { maxAge: '1d' }));
// With a bucket configured, uploads live there instead: anything not on local disk is sent to the
// bucket (see media.js), so playback bandwidth never passes through this server.
if (storage.remote) app.get('/media/uploads/:name', redirectToBucket);

// Messaging: its own store and its own cleanup clock (see server/chat.js).
app.use('/api/chat', chatRoutes);

// API
app.use('/api', routes);

// Serve the web app. The build (client/dist) is generated, not committed, so it is made here if
// this machine has never built it — otherwise the server would answer every page with a bare 404
// and look exactly like the site being down. See scripts/ensure-client-build.mjs.
const dist = clientDir();
const build = ensureClientBuild();

if (isClientBuilt()) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
  console.log(`[pulse] Serving the web app from ${path.relative(root, dist)}.`);
} else {
  // The API still works; only the pages are missing. Say exactly what to do instead of
  // "Cannot GET /".
  console.warn(
    `[pulse] The web app is NOT built${build.reason ? ` (${build.reason})` : ''}, so pages cannot be served yet. `
    + 'Build it with: cd client && npm install && npm run build — then restart. Requests to /api and /media work meanwhile.'
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    res.status(503).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pulse — the web app has not been built yet</title>
<style>
  body { margin: 0; background: #08080a; color: #f4f4f5; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 620px; margin: 12vh auto; padding: 0 24px; }
  h1 { font-size: 26px; margin: 0 0 12px; }
  p { color: #d4d4d8; }
  code { background: #1a1a20; border: 1px solid rgba(255,255,255,.12); border-radius: 6px; padding: 2px 7px; }
  pre { background: #141418; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 14px 16px; overflow-x: auto; }
</style></head>
<body><main>
  <h1>The API is running — the web app just hasn’t been built yet.</h1>
  <p>Pulse serves its React front end from <code>client/dist</code>, which is generated on this machine.
  Build it once and reload this page:</p>
  <pre>cd client &amp;&amp; npm install &amp;&amp; npm run build</pre>
  <p>Or just run <code>npm start</code> from the project root, which builds it automatically the first time.</p>
  <p>The API is available meanwhile: <a style="color:#a78bfa" href="/api/health">/api/health</a>.</p>
</main></body></html>`);
  });
}

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
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
if (!storage.remote && process.env.RENDER) {
  console.warn(
    '[pulse] WARNING: running on Render without a bucket. The database and every upload live on this '
    + "instance's temporary disk and are lost on each restart, redeploy or sleep. Set S3_ENDPOINT, S3_BUCKET, "
    + 'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (see DEPLOY.md), or ignore this if you attached a Render Disk.'
  );
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
