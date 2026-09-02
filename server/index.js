import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import { seedFeaturedCatalog } from './catalog.js';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// static media (audio, covers, uploads) with Range support for streaming
app.use('/media', express.static(dataDir, { maxAge: '1d' }));

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

// Auto-seed demo data on first run (empty database) so the app feels alive out of the box.
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  console.log('[pulse] Empty database detected — seeding demo data…');
  await import('./seed.js');
}

// Auto-seed the featured artist catalogs on every start (idempotent — existing
// artists are left untouched, only missing tracks are backfilled). Metadata
// only; audio must be uploaded separately.
seedFeaturedCatalog();

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[pulse] Server running at http://0.0.0.0:${PORT}`);
});
