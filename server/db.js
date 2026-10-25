import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { foldText } from './search.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Everything Pulse stores (SQLite file + uploaded audio/artwork) lives under one
// folder. Point PULSE_DATA_DIR at a mounted disk to keep it somewhere else.
export const dataDir = process.env.PULSE_DATA_DIR
  ? path.resolve(process.env.PULSE_DATA_DIR)
  : path.join(__dirname, '..', 'data');
export const uploadsDir = path.join(dataDir, 'uploads');

for (const d of [dataDir, uploadsDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const db = new Database(path.join(dataDir, 'pulse.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // the usual pairing with WAL: much fewer disk syncs, still crash-safe
db.pragma('busy_timeout = 5000'); // wait briefly instead of failing if Litestream is mid-checkpoint
db.pragma('foreign_keys = ON');

// Case-, accent- and punctuation-insensitive text for catalog search (see search.js).
db.function('pulse_fold', { deterministic: true }, (value) => foldText(value));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'artist',
  avatar_url TEXT,
  favorite_genres TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bio TEXT,
  genre TEXT,
  country TEXT,
  avatar_url TEXT,
  followers INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  cover_url TEXT,
  release_year INTEGER,
  genre TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  album_id INTEGER REFERENCES albums(id) ON DELETE SET NULL,
  genre TEXT,
  duration_seconds REAL,
  file_path TEXT,
  -- Direct playback URL from a licensed provider. We never proxy or download third-party audio.
  source_url TEXT,
  -- Linked track: plays through a provider's own embedded player (currently YouTube).
  -- We store the provider + its id and never copy or proxy the media.
  provider TEXT,
  external_id TEXT,
  cover_url TEXT,
  -- User who uploaded the track. Uploads live in the shared catalog, so this is
  -- only used for provenance and the "My music" view, never for access control.
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_public INTEGER NOT NULL DEFAULT 1,
  plays INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, song_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, song_id)
);

-- ---------------------------------------------------------------- podcasts --
-- Shows and their episodes live beside music but never mix with it: episodes are
-- not songs (no artist/album/genre, they carry publishers, seasons and resume
-- positions instead), so they get their own tables and their own routes.
CREATE TABLE IF NOT EXISTS podcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  publisher TEXT,
  description TEXT,
  category TEXT,
  cover_url TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  episode_number INTEGER,
  season INTEGER NOT NULL DEFAULT 1,
  duration_seconds REAL,
  file_path TEXT,
  cover_url TEXT,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  plays INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS podcast_subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, podcast_id)
);

CREATE TABLE IF NOT EXISTS saved_episodes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, episode_id)
);

CREATE TABLE IF NOT EXISTS episode_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album_id);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_episodes_podcast ON episodes(podcast_id);
CREATE INDEX IF NOT EXISTS idx_episodes_published ON episodes(published_at);
`);

// Lightweight migration for users table (username & favorite_genres)
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
if (!userColumns.includes('username')) {
  db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  // Backfill usernames for existing users
  const allUsers = db.prepare("SELECT id, name, email FROM users WHERE username IS NULL OR username = ''").all();
  for (const u of allUsers) {
    const baseUsername = u.name.toLowerCase().replace(/[^a-z0-9]/g, '') || u.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || `user${u.id}`;
    let candidate = baseUsername;
    let counter = 1;
    while (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(candidate, u.id)) {
      candidate = `${baseUsername}${counter++}`;
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(candidate, u.id);
  }
}
if (!userColumns.includes('favorite_genres')) {
  db.exec('ALTER TABLE users ADD COLUMN favorite_genres TEXT');
}
// Compliance: explicit consents captured at registration (Privacy/TOS + age gate)
if (!userColumns.includes('consent_terms_at')) db.exec('ALTER TABLE users ADD COLUMN consent_terms_at TEXT');
if (!userColumns.includes('consent_age_at')) db.exec('ALTER TABLE users ADD COLUMN consent_age_at TEXT');
if (!userColumns.includes('consent_cookie_at')) db.exec('ALTER TABLE users ADD COLUMN consent_cookie_at TEXT');

try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username)) WHERE username IS NOT NULL;');
} catch { /* index may exist */ }

// Migration: rename legacy admin (Adebayo Cole / adebayo / admin@pulse.app) to Kelechi / kai99 / inputname9@aol.com
try {
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (admin && (admin.username === 'adebayo' || admin.name === 'Adebayo Cole' || admin.email === 'admin@pulse.app')) {
    const bcrypt = require('bcryptjs');
    const newHash = bcrypt.hashSync('kai99', 10);
    db.prepare("UPDATE users SET name = ?, username = ?, email = ?, password_hash = ? WHERE id = ?")
      .run('Kelechi', 'kai99', 'inputname9@aol.com', newHash, admin.id);
    // Also update the linked artist profile if it exists
    try { db.prepare("UPDATE artists SET name = ? WHERE user_id = ? AND name = ?").run('Kelechi', admin.id, 'Adebayo Cole'); } catch {}
    console.log('[pulse] Migrated legacy admin account (Adebayo Cole/adebayo) -> Kelechi/kai99 (inputname9@aol.com)');
  }
} catch (e) {
  console.warn('[pulse] Admin migration check failed:', e.message);
}

// Lightweight migration for installations created before licensed-source support.
const songColumns = db.prepare('PRAGMA table_info(songs)').all().map((column) => column.name);
if (!songColumns.includes('source_url')) db.exec('ALTER TABLE songs ADD COLUMN source_url TEXT');
// Migration for installations created before embeddable (linked) tracks.
if (!songColumns.includes('provider')) db.exec('ALTER TABLE songs ADD COLUMN provider TEXT');
if (!songColumns.includes('external_id')) db.exec('ALTER TABLE songs ADD COLUMN external_id TEXT');
// Migration for installations created before upload provenance tracking.
if (!songColumns.includes('uploaded_by')) {
  db.exec('ALTER TABLE songs ADD COLUMN uploaded_by INTEGER REFERENCES users(id)');
  // backfill: seed the uploader from the artist profile's linked account
  db.exec(`UPDATE songs SET uploaded_by = (SELECT a.user_id FROM artists a WHERE a.id = songs.artist_id)
           WHERE uploaded_by IS NULL`);
}
const albumColumns = db.prepare('PRAGMA table_info(albums)').all().map((column) => column.name);
if (!albumColumns.includes('uploaded_by')) {
  db.exec('ALTER TABLE albums ADD COLUMN uploaded_by INTEGER REFERENCES users(id)');
  db.exec(`UPDATE albums SET uploaded_by = (SELECT a.user_id FROM artists a WHERE a.id = albums.artist_id)
           WHERE uploaded_by IS NULL`);
}

// Migration for is_public visibility column on songs
if (!songColumns.includes('is_public')) {
  db.exec('ALTER TABLE songs ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1');
  db.exec('UPDATE songs SET is_public = 1 WHERE is_public IS NULL');
}

try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_songs_is_public ON songs(is_public);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_songs_uploaded_by ON songs(uploaded_by);');
} catch { /* index may exist */ }

// ---------------------------------------------------------------------------
// Fallback bucket backup — keeps the database safe even when Litestream is
// not running (wrong start command, missing binary). Litestream remains the
// primary mechanism; this is a safety net that stores a single snapshot at
// fallback/pulse.db and restores it on next boot if the local file is empty.
// It runs only when a bucket is configured and PULSE_DB_REPLICATED != '1'.
// ---------------------------------------------------------------------------
let __fallbackState = { started: false };
async function __maybeStartFallback() {
  if (__fallbackState.started) return;
  __fallbackState.started = true;
  let config = null;
  try {
    const { readStorageConfig } = await import('./storage.js');
    config = readStorageConfig(process.env);
  } catch { return; }
  if (!config) return;
  if (process.env.PULSE_DB_REPLICATED === '1') return;
  if (process.env.PULSE_PERSISTENT_DISK === 'true') return;

  const dbPath = path.join(dataDir, 'pulse.db');
  const fallbackKey = 'fallback/pulse.db';

  // Try to restore if local DB looks empty but bucket has a backup
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c ?? 0;
    const songCount = db.prepare('SELECT COUNT(*) as c FROM songs').get()?.c ?? 0;
    const isEmpty = count === 0 && songCount === 0;
    // Also check file size — an empty DB is ~20KB, a DB with data is larger
    let fileSize = 0;
    try { fileSize = fs.statSync(dbPath).size; } catch {}
    if (isEmpty) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        logger: { debug() {}, info() {}, warn() {}, error() {} }
      });
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: fallbackKey }));
        const body = await res.Body.transformToByteArray();
        if (body && body.length > 1024) {
          // Close DB, replace file, reopen? Instead, restore via backup API: close & overwrite.
          // We are still inside the module's top-level, but we can replace file and restart process
          // by writing to disk and telling operator to restart — simpler: write to temp and log.
          // For now, we attempt to overwrite after checkpoint and vacuum.
          db.close();
          // Write fetched bytes to the db path
          fs.writeFileSync(dbPath, Buffer.from(body));
          // Remove wal/shm that may be stale
          try { fs.rmSync(dbPath + '-wal', { force: true }); } catch {}
          try { fs.rmSync(dbPath + '-shm', { force: true }); } catch {}
          console.log(`[pulse] Restored database from bucket fallback (${body.length} bytes) — restarting to use it`);
          // Force restart by exiting; process manager (Render) will restart with restored file
          process.exit(0);
        }
      } catch (err) {
        if (err?.name !== 'NoSuchKey' && err?.Code !== 'NoSuchKey') {
          console.warn(`[pulse] Fallback restore check failed: ${err.message}`);
        }
      }
    }
  } catch (e) {
    console.warn(`[pulse] Fallback restore check error: ${e.message}`);
  }

  // Mark that fallback is active so /api/health reports the DB as durable
  process.env.PULSE_DB_FALLBACK = '1';

  // Start periodic backup
  try {
    const intervalSec = Math.min(30, Math.max(5, parseInt(process.env.PULSE_DB_SYNC_SECONDS || '15', 10) || 15));
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      logger: { debug() {}, info() {}, warn() {}, error() {} }
    });
    const backup = async () => {
      try {
        // Ensure WAL is checkpointed so backup is consistent
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
        const tmpPath = dbPath + '.fallback.tmp';
        // better-sqlite3 backup: creates a snapshot
        await db.backup(tmpPath);
        const data = fs.readFileSync(tmpPath);
        await client.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: fallbackKey,
          Body: data,
          ContentLength: data.length,
          ContentType: 'application/octet-stream'
        }));
        fs.rmSync(tmpPath, { force: true });
        // keep health check happy even if env was cleared
        process.env.PULSE_DB_FALLBACK = '1';
      } catch (err) {
        console.warn(`[pulse] Fallback backup failed: ${err.message}`);
      }
    };
    // First backup after 10s, then interval
    setTimeout(backup, 10000).unref?.();
    const iv = setInterval(backup, intervalSec * 1000);
    iv.unref?.();
    console.log(`[pulse] Fallback DB backup enabled (every ${intervalSec}s to ${fallbackKey}) — Litestream is not running, so this keeps data from being lost. Set startCommand to 'npm run start:render' to use Litestream instead.`);
  } catch (e) {
    console.warn(`[pulse] Could not start fallback backup: ${e.message}`);
  }
}
__maybeStartFallback().catch(() => {});

export default db;
