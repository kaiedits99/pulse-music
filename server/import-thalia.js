// One-off import: adds Thalia Falcon's public catalog (artist profile + track
// metadata) to Pulse. This inserts METADATA ONLY — titles, durations, genre and
// generated cover art. There is no playable audio because audio cannot be
// downloaded from Spotify; the tracks appear in the catalog and can be paired
// with uploaded audio files later (the artist can share WAV/MP3 files).
//
// Run:  node server/import-thalia.js
// Idempotent: safely skips if the artist already exists.
import path from 'path';
import db, { coverDir } from './db.js';
import { writeCover } from './cover.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const ARTIST = {
  name: 'Thalia Falcon',
  bio: 'Contemporary R&B / Pop artist from Washington blending catchy R&B melodies with polished pop production.',
  genre: 'R&B / Soul',
  country: 'United States',
  followers: 0
};

// title -> [duration seconds, release year]
const CATALOG = [
  ['Out Your Life', 220, 2019],
  ['Need to Know', 196, 2020],
  ['Show Me', 202, 2020],
  ['Hands on Me', 206, 2020],
  ['Instructions', 190, 2020],
  ['Kiss Me', 212, 2020],
  ['Gift Giver', 190, 2020],
  ['Enter, Action', 211, 2020],
  ['Stupid Crazy', 200, 2020],
  ['Inside Joke', 203, 2020],
  ['Passively Aggressive', 213, 2020],
  ['Same Song', 195, 2021],
  ['Proud', 227, 2021],
  ['Bad Things', 199, 2021],
  ['Strangers', 181, 2021],
  ['All That', 189, 2021],
  ['Combination', 203, 2021],
  ['Plug N Play', 198, 2021],
  ['Don\'t Say No', 180, 2021],
  ['End Like This', 219, 2021],
  ['Somebody', 221, 2024],
  ['Eye Contact', 184, 2024],
  ['Play Clothes', 182, 2024]
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
const avatarRel = '/media/covers/artist-' + slug(ARTIST.name) + '.svg';
writeCover(path.join(root, 'data', avatarRel.slice('/media/'.length)), 'Thalia', 'Artist', ARTIST.name);

const info = insertArtist.run(
  ARTIST.name, ARTIST.bio, ARTIST.genre, ARTIST.country, avatarRel, ARTIST.followers, adminId, now
);
const artistId = info.lastInsertRowid;

const insertSong = db.prepare(
  `INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path, cover_url, uploaded_by, plays, downloads, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);

for (const [title, seconds, year] of CATALOG) {
  const coverRel = '/media/covers/thalia-' + slug(title) + '.svg';
  writeCover(path.join(root, 'data', coverRel.slice('/media/'.length)), title, String(year), ARTIST.name + ' ' + title);
  insertSong.run(title, artistId, null, ARTIST.genre, seconds, null, coverRel, adminId, 0, 0, now);
}

console.log(`Imported Thalia Falcon (id=${artistId}) with ${CATALOG.length} tracks (metadata only).`);
console.log('No audio: tracks will show "no playable audio source" until real files are uploaded.');
