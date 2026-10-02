import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import db, { dataDir, uploadsDir } from './db.js';
import { purgeLegacyDemoData } from './legacy-demo-cleanup.js';

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

// API
app.use('/api', routes);

// Serve built client if present
const dist = path.join(root, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    res.sendFile(path.join(dist, 'index.html'));
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[pulse] Server running at http://0.0.0.0:${PORT}`);
});
