// Featured-artist catalogs for Pulse.
//
// This module owns the public catalog metadata (artist profile + track list)
// for every featured artist. It is auto-seeded by the server on every boot
// (see server/index.js) and is also used by the one-off scripts
// server/import-thalia.js and server/import-zyny.js.
//
// METADATA ONLY: titles, durations, genre and generated cover art. No playable
// audio is attached here — streaming audio cannot be pulled from public
// links, so each track is a placeholder until real WAV/MP3 files are uploaded
// by the artist (or an admin) through the normal upload flow.
//
// Idempotent: existing artists are never duplicated; missing tracks are
// backfilled. Safe to run on every start.
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { writeCover } from './cover.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Each artist: coverPrefix namespaces that artist's generated covers so two
// artists with a same-titled song never overwrite each other's artwork.
export const FEATURED_ARTISTS = [
  {
    key: 'thalia',
    name: 'Thalia Falcon',
    bio: 'Contemporary R&B / Pop artist from Washington blending catchy R&B melodies with polished pop production.',
    genre: 'R&B / Soul',
    country: 'United States',
    followers: 0,
    avatarLabel: 'Thalia',
    coverPrefix: 'thalia',
    // [title, duration seconds, release year]
    catalog: [
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
      ["Don't Say No", 180, 2021],
      ['End Like This', 219, 2021],
      ['Somebody', 221, 2024],
      ['Eye Contact', 184, 2024],
      ['Play Clothes', 182, 2024]
    ]
  },
  {
    // NOTE: "Zyny" is ambiguous — this currently models the POLISH electronic /
    // ambient artist ŻYŃY. There is also an Egyptian house/techno DJ billed as
    // ZYNY (soundcloud.com/zyny-world) and other similar names. Confirm the
    // intended artist before the catalog goes live; if wrong, swap this entry
    // (name, bio, country and track list) — the seeder needs no changes.
    key: 'zyny',
    name: 'ŻYŃY', // user refers to this artist as "Zyny"
    bio: 'Polish electronic / ambient artist crafting atmospheric, introspective soundscapes.',
    genre: 'Electronic',
    country: 'Poland',
    followers: 0,
    avatarLabel: 'Zyny',
    coverPrefix: 'zyny',
    // [title, duration seconds, release year]
    catalog: [
      ['All Is Fine', 184, 2022],
      ['Phone Call', 215, 2022],
      ['Find Myself', 219, 2022],
      ['Emotions', 251, 2022],
      ['No Need to Say This', 222, 2022],
      ["Can't Sleep", 264, 2022],
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
    ]
  }
];

const insertArtist = db.prepare(
  'INSERT INTO artists (name, bio, genre, country, avatar_url, followers, user_id, created_at) VALUES (?,?,?,?,?,?,?,?)'
);
const insertSong = db.prepare(
  `INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path, cover_url, uploaded_by, plays, downloads, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);

function ownerId() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  return admin ? admin.id : null;
}

// Seed (or backfill) one featured artist. Returns { artistId, created, tracksInserted }.
export function seedFeaturedArtist(spec) {
  const now = new Date().toISOString();
  const owner = ownerId();
  let artist = db
    .prepare('SELECT * FROM artists WHERE LOWER(name) = LOWER(?)')
    .get(spec.name);
  let created = false;

  if (!artist) {
    const avatarRel = '/media/covers/artist-' + slug(spec.name) + '.svg';
    writeCover(path.join(root, 'data', avatarRel.slice('/media/'.length)), spec.avatarLabel, 'Artist', spec.name);
    const info = insertArtist.run(
      spec.name, spec.bio, spec.genre, spec.country, avatarRel, spec.followers, owner, now
    );
    artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(info.lastInsertRowid);
    created = true;
  }

  // Backfill any missing tracks (safe when the artist already exists).
  let tracksInserted = 0;
  for (const [title, seconds, year] of spec.catalog) {
    const dupe = db
      .prepare('SELECT id FROM songs WHERE artist_id = ? AND LOWER(title) = LOWER(?)')
      .get(artist.id, title);
    if (dupe) continue;
    const coverRel = `/media/covers/${spec.coverPrefix}-${slug(title)}.svg`;
    writeCover(
      path.join(root, 'data', coverRel.slice('/media/'.length)),
      title,
      String(year),
      `${spec.name} ${title}`
    );
    insertSong.run(title, artist.id, null, spec.genre, seconds, null, coverRel, owner, 0, 0, now);
    tracksInserted += 1;
  }

  return { artistId: artist.id, created, tracksInserted };
}

// Auto-seed every featured artist catalog. Called on every server start.
export function seedFeaturedCatalog() {
  let added = 0;
  for (const spec of FEATURED_ARTISTS) {
    try {
      const res = seedFeaturedArtist(spec);
      added += res.tracksInserted;
      if (res.created || res.tracksInserted > 0) {
        console.log(
          `[catalog] ${res.created ? 'Imported' : 'Updated'} ${spec.name} (id=${res.artistId}) — ${res.tracksInserted} track(s) added (metadata only, audio uploaded separately).`
        );
      }
    } catch (err) {
      console.error(`[catalog] Failed to seed ${spec.name}:`, err.message);
    }
  }
  if (added === 0) console.log('[catalog] Featured artist catalogs already present — nothing to do.');
}
