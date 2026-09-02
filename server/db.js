import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.join(__dirname, '..', 'data');
export const audioDir = path.join(dataDir, 'audio');
export const coverDir = path.join(dataDir, 'covers');
export const uploadsDir = path.join(dataDir, 'uploads');

for (const d of [dataDir, audioDir, coverDir, uploadsDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const db = new Database(path.join(dataDir, 'pulse.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
  cover_url TEXT,
  -- User who uploaded the track. Uploads live in the shared catalog, so this is
  -- only used for provenance and the "My music" view, never for access control.
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album_id);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
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

try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username)) WHERE username IS NOT NULL;');
} catch { /* index may exist */ }

// Lightweight migration for installations created before licensed-source support.
const songColumns = db.prepare('PRAGMA table_info(songs)').all().map((column) => column.name);
if (!songColumns.includes('source_url')) db.exec('ALTER TABLE songs ADD COLUMN source_url TEXT');
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

export default db;
