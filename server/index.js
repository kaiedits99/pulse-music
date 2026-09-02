import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import { seedFeaturedCatalog } from './catalog.js';
import db, { dataDir, audioDir, coverDir, uploadsDir } from './db.js';
import { ensureSeedAssets, seedDatabase } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

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

// ---------------------------------------------------------------------------
// Boot-time data readiness.
//
// Render's free tier (and any container host without an attached disk) restarts
// with a **wiped filesystem**: data/pulse.db, the synthesized demo audio and the
// generated cover art can all vanish — and they can vanish independently, e.g. a
// redeploy keeps the DB but loses data/audio, leaving every seeded track pointing
// at a file that 404s. So instead of "seed once when the users table is empty" we
// reconcile three things on every start:
//
//   1. the database (users/artists/albums/songs/playlists demo data),
//   2. the featured-artist catalogs (metadata, already idempotent),
//   3. the generated media those rows reference (audio + covers).
//
// All of it is deterministic and idempotent, so a cold boot converges on the same
// state every time. A failure here is logged but never blocks the server from
// listening — an app that serves is better than a crash-looping deploy.
// ---------------------------------------------------------------------------
async function prepareData() {
  for (const dir of [dataDir, audioDir, coverDir, uploadsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Opt out of demo data (see render.yaml) without losing the self-heal below.
  const seedDemo = String(process.env.SEED_DEMO_DATA ?? 'true').toLowerCase() !== 'false';
  if (process.env.PULSE_TEST_FAIL_SEED === '1') {
    throw new Error('simulated seeding failure (PULSE_TEST_FAIL_SEED=1)');
  }
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  if (userCount === 0 && seedDemo) {
    console.log('[pulse] Empty database detected — seeding demo data…');
    seedDatabase();
  } else if (userCount === 0) {
    console.log('[pulse] SEED_DEMO_DATA=false — starting with an empty database.');
  }

  // Featured artist catalogs: idempotent, backfills missing tracks only.
  seedFeaturedCatalog();

  // Repair generated media whose rows survived in the database but whose files did
  // not. This covers the seeded demo WAVs *and* the cover art for artists/albums/
  // playlists — including featured artists, which the catalog seeder skips because
  // they already exist. Cheap and idempotent when nothing is missing.
  const restored = ensureSeedAssets();
  if (!restored.audio && !restored.covers) {
    console.log(`[pulse] Generated media intact (${restored.tracks} seeded track(s) verified).`);
  }
}

try {
  await prepareData();
} catch (err) {
  console.error('[pulse] Data seeding/self-healing failed — starting anyway:', err.message);
  console.error(err.stack);
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[pulse] Server running at http://0.0.0.0:${PORT}`);
});
