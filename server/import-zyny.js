// One-off import: adds the Polish electronic/ambient artist ŻYŃY's public
// catalog (artist profile + track metadata) to Pulse. Metadata ONLY — titles,
// durations, genre and generated covers. No playable audio (audio cannot be
// downloaded from streaming links); tracks are placeholders ready to be paired
// with audio files the artist shares.
//
// Run:  node server/import-zyny.js
// Idempotent: safely skips if the artist already exists.
import path from 'path';
import db, { coverDir } from './db.js';
import { writeCover } from './cover.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const ARTIST = {
  name: 'ŻYŃY',           // user refers to this artist as "Zyny"
  bio: 'Polish electronic / ambient artist crafting atmospheric, introspective soundscapes.',
  genre: 'Electronic',
  country: 'Poland',
  followers: 0
};

// title -> [duration seconds, release year]
const CATALOG = [
  ['All Is Fine', 184, 2022],
  ['Phone Call', 215, 2022],
  ['Find Myself', 219, 2022],
  ['Emotions', 251, 2022],
  ['No Need to Say This', 222, 2022],
  ['Can\'t Sleep', 264, 2022],
  ['Looking for Emotions', 237, 2022],
  ['Fine', 181, 2022],
  ['Becks in Sky', 313, 2022],
  ['Waiting', 207, 2022],
  ['Windows', 366, 2022],
  ['Everyday', 267, 2022],
  ['No Need', 202, 2022],
  ['No Control', 278, 2023],
  ['Show You My World', 206, 2023],
  ['Time to Leave', 292, 2023],
  ['Beautiful Lies', 174, 2023],
  ['Looking Down on You', 271, 2023],
  ['Changes', 293, 2023],
  ['Say Goodbye', 295, 2023]
];

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const existing = db.prepare('SELECT id FROM artists WHERE LOWER(name) = LOWER(?)').get(ARTIST.name);
if (existing) {
  console.log(`Artist "${ARTIST.name}" already exists (id=${existing.id}) — skipping.`);
  process.exit(0);
}

const admin = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1').get('admin');
const adminId = admin ? admin.id : null;

const now = new Date().toISOString();
const insertArtist = db.prepare(
  'INSERT INTO artists (name, bio, genre, country, avatar_url, followers, user_id, created_at) VALUES (?,?,?,?,?,?,?,?)'
);
const avatarRel = '/media/covers/artist-zyny.svg';
writeCover(path.join(root, 'data', avatarRel.slice('/media/'.length)), 'Zyny', 'Artist', ARTIST.name);

const info = insertArtist.run(
  ARTIST.name, ARTIST.bio, ARTIST.genre, ARTIST.country, avatarRel, ARTIST.followers, adminId, now
);
const artistId = info.lastInsertRowid;

const insertSong = db.prepare(
  `INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path, cover_url, uploaded_by, plays, downloads, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);

for (const [title, seconds, year] of CATALOG) {
  const coverRel = '/media/covers/zyny-' + slug(title) + '.svg';
  writeCover(path.join(root, 'data', coverRel.slice('/media/'.length)), title, String(year), ARTIST.name + ' ' + title);
  insertSong.run(title, artistId, null, ARTIST.genre, seconds, null, coverRel, adminId, 0, 0, now);
}

console.log(`Imported ŻYŃY (id=${artistId}) with ${CATALOG.length} tracks (metadata only).`);
console.log('No audio: tracks will show "no playable audio source" until real files are uploaded.');
