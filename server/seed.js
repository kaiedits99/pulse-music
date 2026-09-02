import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { dataDir, audioDir } from './db.js';
import { hashPassword } from './auth.js';
import { generateTrack } from './synth.js';
import { writeCover } from './cover.js';
import { FEATURED_ARTISTS, featuredSlug } from './catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Render's free tier restarts with a **wiped filesystem**: the SQLite database and
// everything under data/ (synthesized audio, generated covers) can disappear, and
// they can also disappear *independently* of each other. That produced two broken
// states on every cold boot:
//
//   1. DB present, media gone  -> rows point at /media/audio/track-01.wav that no
//                                 longer exists, so every seeded track 404s and the
//                                 boot-time seeder skips (it only checks user count).
//   2. DB gone, media present  -> a full re-seed, which is fine but wasteful.
//
// To make state (1) repairable we persist a small manifest next to the database
// recording exactly how each seeded WAV was synthesized, so the bytes can be
// regenerated deterministically on any later boot. If the manifest is missing
// (installations seeded before this fix) it is rebuilt from the same formulas used
// during the original seed, keyed off the seeded track filenames.
const MANIFEST_PATH = path.join(dataDir, 'seed-manifest.json');

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Single source of truth for a seeded track's synthesis parameters. Both the
// first-time seed and the repair pass derive their values from here, so a
// regenerated WAV is byte-for-byte the track the database row describes.
function deriveSeededTrack(counter, title) {
  return {
    counter,
    title,
    audioFile: `track-${String(counter).padStart(2, '0')}.wav`,
    coverRel: `/media/covers/${slugify(title)}.svg`,
    seedBase: hashCode(title) % 100000,
    rootMidi: 53 + (counter % 9),
    durationSec: 10 + (counter % 3) * 2,
    bpm: BPM_BY_TITLE[title] ?? 100
  };
}

// BPM per seeded title, mirrored from songDefs below. It has to live at module
// scope because the repair pass must be able to regenerate a track's audio from
// the title alone — when both the manifest *and* the original seeding run are
// gone, this table is the only remaining record of the tempo. seed() re-asserts
// these values from songDefs (the real source of truth) and warns on drift.
const BPM_BY_TITLE = {
  'Electric Dreams': 124, 'Dancing on Mirrors': 120, 'Sweet Velocity': 128,
  'Wildflower': 108, 'Campfire Crown': 102, 'Run the Rivers': 114,
  'Static Skies': 132, 'Overdrive Heart': 138, 'Bleed the Signal': 126,
  'Champions': 136, 'Golden Trophy': 130, 'Come Alive': 142,
  'Supernova Love': 130, 'Neon Seoul': 126, 'Velocity Beat': 134,
  'Festival Horizon': 128, 'Cybernetic Bass': 130, 'Infinity Drop': 132,
  'Sunset Drive': 104, 'Fire & Gold': 96, 'Island Breeze': 100,
  'Midnight Call': 82, 'Slow Fade': 78, 'Gold Coast': 92
};

function readManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return Array.isArray(parsed?.tracks) ? parsed : null;
  } catch {
    return null;
  }
}

function writeManifest(tracks) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ version: 1, tracks }, null, 2));
}

function writeFileSafe(target, write) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    write();
    return true;
  } catch (err) {
    console.warn(`[seed] Could not write ${target}:`, err.message);
    return false;
  }
}

/**
 * Regenerate any seeded audio/cover that is missing from disk, deterministically.
 * Idempotent and safe to call on every boot: when the filesystem is intact it does
 * nothing but verify. Returns { audio, covers, tracks } counts of restored files.
 */
export function ensureSeedAssets({ log = console.log } = {}) {
  const started = Date.now();
  let manifest = readManifest();
  if (!manifest) manifest = { version: 1, tracks: rebuildManifestFromDb({ log }) };

  const byAudioFile = new Map(manifest.tracks.map((t) => [t.audioFile, t]));
  let audioRestored = 0;
  let coversRestored = 0;
  let tracksChecked = 0;

  // Audio: only touch rows that still point at one of *our* generated WAVs.
  // Anything an artist uploaded (or a licensed source_url) is left alone.
  const rows = db
    .prepare("SELECT id, title, file_path FROM songs WHERE file_path LIKE '/media/audio/%'")
    .all();
  for (const row of rows) {
    const entry = byAudioFile.get(path.basename(row.file_path));
    if (!entry) continue;
    tracksChecked += 1;
    const audioPath = path.join(audioDir, entry.audioFile);
    if (!fileExists(audioPath)) {
      if (writeFileSafe(audioPath, () => generateTrack({
        seed: entry.seedBase,
        filePath: audioPath,
        durationSec: entry.durationSec,
        rootMidi: entry.rootMidi,
        bpm: entry.bpm
      }))) {
        audioRestored += 1;
        log(`[seed] Restored missing audio for "${row.title}" -> ${entry.audioFile}`);
      }
    }
  }

  // Covers are cheap generated SVGs, so regenerate every one the database still
  // references but the filesystem no longer has. Titles/subtitles/seed strings are
  // read back from the rows rather than guessed from filenames — generated artwork
  // is seeded off those strings, so using them is what makes the restored SVG
  // identical to the original. Only rows whose cover_url still matches the
  // deterministic generated naming are touched, so artwork an artist uploaded
  // through the normal flow is never overwritten.
  const coverSources = [
    {
      // seed()'s artist() helper: filename from the artist name, first word drawn as
      // the title, artwork seeded off the account holder's full name when the artist
      // belongs to a user. catalog.js instead seeds off its avatarLabel, so featured
      // artists are handled by the next entry.
      sql: `SELECT ar.avatar_url AS url, ar.name AS name, u.name AS full_name
              FROM artists ar LEFT JOIN users u ON u.id = ar.user_id
             WHERE ar.avatar_url LIKE '/media/covers/artist-%'`,
      // Featured artists are excluded: slugify() and catalog.js's slug() agree on
      // ASCII names, so this pattern would otherwise claim their avatars too — and
      // draw them with the wrong title/seed (first word + user name, vs the
      // avatarLabel + full artist name catalog.js actually used).
      where: (row) => !featuredSpec(row.name)
        && row.url === `/media/covers/artist-${slugify(row.name)}.svg`,
      title: (row) => row.name.split(' ')[0],
      subtitle: () => 'Artist',
      seedStr: (row) => row.full_name || row.name
    },
    {
      // catalog.js's seedFeaturedArtist(): filename and artwork both come from its
      // own slug()/avatarLabel, which differ from seed()'s for non-ASCII names
      // ("ŻYŃY" -> artist-y-y.svg). Match on avatarLabel so the right rows are found.
      sql: `SELECT avatar_url AS url, name FROM artists WHERE avatar_url LIKE '/media/covers/artist-%'`,
      where: (row) => {
        const spec = FEATURED_ARTISTS.find(
          (a) => a.name.toLowerCase() === String(row.name ?? '').toLowerCase()
        );
        return Boolean(spec) && row.url === `/media/covers/artist-${featuredSlug(spec.name)}.svg`;
      },
      title: (row) => featuredSpec(row.name).avatarLabel,
      subtitle: () => 'Artist',
      seedStr: (row) => row.name
    },
    {
      sql: `SELECT cover_url AS url, title, CAST(release_year AS TEXT) AS year FROM albums WHERE cover_url LIKE '/media/covers/album-%'`,
      where: (row) => row.url === `/media/covers/album-${slugify(row.title)}.svg`,
      title: (row) => row.title,
      subtitle: (row) => row.year,
      seedStr: (row) => row.title
    },
    {
      // The playlist slug is not stored anywhere, so recover it from the filename and
      // require it to round-trip. seed() seeds this artwork off the slug, not the name.
      sql: `SELECT cover_url AS url, name FROM playlists WHERE cover_url LIKE '/media/covers/playlist-%'`,
      where: (row) => playlistSlug(row.url) !== null,
      title: (row) => row.name,
      subtitle: () => 'Playlist',
      seedStr: (row) => playlistSlug(row.url)
    },
    {
      // Demo-catalog track art: filename and seed string are both the title slug.
      sql: `SELECT cover_url AS url, title, COALESCE(genre, 'Track') AS genre FROM songs WHERE cover_url LIKE '/media/covers/%'`,
      where: (row) => row.url === `/media/covers/${slugify(row.title)}.svg`,
      title: (row) => row.title,
      subtitle: (row) => row.genre,
      seedStr: (row) => row.title
    },
    {
      // Featured-catalog track art. catalog.js only writes covers while inserting a
      // track, so an artist that already exists in the DB gets no artwork back after
      // a filesystem wipe unless we regenerate it here — with the same
      // prefix-slug filename, year subtitle and "Artist Title" seed string it uses.
      sql: `SELECT s.cover_url AS url, s.title, COALESCE(al.release_year, '') AS year, a.name AS artist
              FROM songs s
              JOIN artists a ON a.id = s.artist_id
              LEFT JOIN albums al ON al.id = s.album_id
             WHERE s.cover_url LIKE '/media/covers/%'`,
      where: (row) => {
        const spec = featuredSpec(row.artist);
        return Boolean(spec) && row.url === `/media/covers/${spec.coverPrefix}-${featuredSlug(row.title)}.svg`;
      },
      title: (row) => row.title,
      // catalog.js draws the year as the subtitle but inserts these songs with
      // album_id = NULL, so the year only exists in the catalog spec — read it back
      // from there, falling back to a joined album for anything else.
      subtitle: (row) => String(row.year || featuredYearFor(row.artist, row.title) || ''),
      seedStr: (row) => `${row.artist} ${row.title}`
    }
  ];

  for (const source of coverSources) {
    for (const row of db.prepare(source.sql).all()) {
      if (!row.url) continue;
      // Each source only claims rows whose stored cover_url is exactly the filename
      // its seeder would have generated — artwork attached through the upload flow
      // (which lives under /media/uploads) is therefore never touched.
      if (!source.where(row)) continue;
      const target = path.join(dataDir, row.url.slice('/media/'.length));
      if (fileExists(target)) continue;
      const title = source.title(row);
      const subtitle = source.subtitle(row);
      const seedStr = source.seedStr(row);
      if (writeFileSafe(target, () => writeCover(target, title, subtitle, seedStr))) {
        coversRestored += 1;
      }
    }
  }

  // Keep the manifest fresh so the next boot can repair without guessing.
  if (!readManifest()) writeManifest(manifest.tracks);

  if (audioRestored || coversRestored) {
    log(
      `[seed] Self-healed generated media after a filesystem reset — ${audioRestored} audio file(s), ` +
      `${coversRestored} cover(s) restored in ${Date.now() - started}ms.`
    );
  }
  return { audio: audioRestored, covers: coversRestored, tracks: tracksChecked };
}

/**
 * Rebuild the manifest for installations seeded before it existed. Seeded tracks
 * were inserted in order, so row order maps 1:1 onto track-01.wav, track-02.wav…
 * Only rows whose file_path already matches the expected generated name are
 * claimed, which keeps user uploads and featured-catalog rows out of the manifest.
 */
function rebuildManifestFromDb({ log = console.log } = {}) {
  const rows = db
    .prepare("SELECT id, title, genre, file_path FROM songs WHERE file_path LIKE '/media/audio/track-%.wav' ORDER BY id")
    .all();
  if (rows.length === 0) return [];

  const tracks = [];
  for (const row of rows) {
    const derived = deriveSeededTrack(tracks.length + 1, row.title);
    // Seeded rows were inserted in order as track-01, track-02, … so the next
    // counter must line up with the stored filename. Anything that does not match
    // (a deleted track, a renamed file, an upload) is skipped rather than claimed,
    // which keeps the numbering from drifting onto the wrong rows.
    if (`/media/audio/${derived.audioFile}` !== row.file_path) continue;
    derived.genre = row.genre;
    tracks.push(derived);
  }

  if (tracks.length) log(`[seed] Rebuilt seed manifest from ${tracks.length} existing seeded track(s).`);
  return tracks;
}

// The featured-catalog spec for an artist name, if there is one. Used to tell
// generated artwork apart from files an artist uploaded: catalog.js names its covers
// `<coverPrefix>-<slug(title)>.svg` and seeds them off `<artist> <title>`, so only
// rows matching that exact pattern are rebuilt.
function featuredSpec(artistName) {
  return FEATURED_ARTISTS.find(
    (a) => a.name.toLowerCase() === String(artistName ?? '').toLowerCase()
  ) || null;
}

// Release year for a featured-catalog track, straight from the catalog spec.
function featuredYearFor(artistName, title) {
  const spec = featuredSpec(artistName);
  if (!spec) return null;
  const entry = spec.catalog.find((row) => row[0] === title);
  return entry ? entry[2] : null;
}

// Recover a playlist's cover slug from its filename (`playlist-<slug>.svg`), or null
// if the URL is not one seed() generated. The slug is what seed() seeds the artwork
// off, and it is not stored in any column.
function playlistSlug(url) {
  const match = /^\/media\/covers\/playlist-([a-z0-9-]+)\.svg$/.exec(String(url ?? ''));
  return match ? match[1] : null;
}

function fileExists(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function seed() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (existing > 0) {
    console.log('[seed] Database already seeded, skipping.');
    return false;
  }

  const now = new Date().toISOString();

  // ---- Users ----
  // The admin account's password is the private passkey (paired with the
  // passphrase login handled in server/routes.js). SECRET — server-side only:
  // never document it in the README or client code. Other demo accounts keep
  // the shared demo password.
  const adminHash = hashPassword("that's one thing that I hate");
  const demoHash = hashPassword('demo123');
  const insertUser = db.prepare(
    'INSERT INTO users (name, username, email, password_hash, role, avatar_url, favorite_genres, created_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  const adminId = insertUser.run(
    'Adebayo Cole',
    'adebayo',
    'admin@pulse.app',
    adminHash,
    'admin',
    null,
    JSON.stringify(['Indie', 'Alternative Rock', 'Pop']),
    now
  ).lastInsertRowid;

  const amaraId = insertUser.run(
    'Amara Okafor',
    'amara',
    'amara@pulse.app',
    demoHash,
    'artist',
    null,
    JSON.stringify(['Other', 'Pop']),
    now
  ).lastInsertRowid;

  const kofiId = insertUser.run(
    'Kofi Mensah',
    'kofi',
    'kofi@pulse.app',
    demoHash,
    'artist',
    null,
    JSON.stringify(['Other', 'EDM']),
    now
  ).lastInsertRowid;

  const zaraId = insertUser.run(
    'Zara Bello',
    'zara',
    'zara@pulse.app',
    demoHash,
    'artist',
    null,
    JSON.stringify(['Other', 'K-Pop']),
    now
  ).lastInsertRowid;

  // ---- Artists ----
  const insertArtist = db.prepare(
    'INSERT INTO artists (name, bio, genre, country, avatar_url, followers, user_id, created_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  function artist(name, bio, genre, country, followers, userId) {
    const avatar = '/media/covers/artist-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.svg';
    writeCover(path.join(root, 'data', avatar.slice('/media/'.length)), name.split(' ')[0], 'Artist', name);
    return insertArtist.run(name, bio, genre, country, avatar, followers, userId, now).lastInsertRowid;
  }

  // 1. Pop
  const luna = artist('Luna Ray', 'Stockholm pop powerhouse crafting glittering vocal melodies, shimmering hooks, and dancefloor anthems.', 'Pop', 'Sweden', 345000, null);
  // 2. Indie
  const copper = artist('The Copper Vines', 'Vancouver indie-folk group weaving warm acoustic harmonies, atmospheric guitars, and open-road melodies.', 'Indie', 'Canada', 198000, null);
  // 3. Alternative Rock
  const velvetEcho = artist('Velvet Echo', 'Driving guitars, roaring basslines, and euphoric alternative rock anthems built for arena stages.', 'Alternative Rock', 'United Kingdom', 276000, null);
  // 4. Rock
  const silver = artist('Silver Youth', 'Electrifying stadium rock band delivering heavy rhythms, blistering solos, and crowd chant choruses.', 'Rock', 'United States', 312000, null);
  // 5. K-Pop
  const solaris = artist('SOLARIS', 'Seoul-based electronic pop group delivering hyper-catchy hooks, intricate choreography, and futuristic beats.', 'K-Pop', 'South Korea', 489000, null);
  // 6. EDM
  const aeroflux = artist('AeroFlux', 'Amsterdam festival headliner blending massive synth drops, progressive house chords, and high-energy bass.', 'EDM', 'Netherlands', 412000, null);
  // 7. Other (Afrobeats & R&B/Soul)
  const amaraArtist = artist('Amara Okafor', 'Lagos-born Afrobeats sensation blending shimmering polyrhythms with smooth, soulful vocal hooks.', 'Afrobeats', 'Nigeria', 225000, amaraId);
  const zaraArtist = artist('Zara Bello', 'Sultry Abuja R&B vocalist crafting midnight slow-burns and velvet harmonic ballads.', 'R&B / Soul', 'Nigeria', 142000, zaraId);
  const kofiArtist = artist('Kofi Mensah', 'Accra-based highlife and Afropop producer blending brass ensembles with modern club percussion.', 'Afropop', 'Ghana', 98000, kofiId);

  // ---- Albums ----
  const insertAlbum = db.prepare(
    'INSERT INTO albums (title, artist_id, cover_url, release_year, genre, created_at) VALUES (?,?,?,?,?,?)'
  );
  function album(title, artistId, year, genre) {
    const cover = '/media/covers/album-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.svg';
    writeCover(path.join(root, 'data', cover.slice('/media/'.length)), title, String(year), title);
    return insertAlbum.run(title, artistId, cover, year, genre, now).lastInsertRowid;
  }

  const starlightAlbum = album('Starlight Boulevard', luna, 2024, 'Pop');
  const wildflowerAlbum = album('Wildflower State', copper, 2024, 'Indie');
  const shadowAlbum = album('Shadow Horizon', velvetEcho, 2024, 'Alternative Rock');
  const anthemAlbum = album('Anthem Season', silver, 2023, 'Rock');
  const novaAlbum = album('Nova Frequency', solaris, 2024, 'K-Pop');
  const hyperdriveAlbum = album('Hyperdrive Euphoria', aeroflux, 2024, 'EDM');
  const goldenAlbum = album('Golden Hour', amaraArtist, 2025, 'Afrobeats');
  const velvetAlbum = album('Velvet Nights', zaraArtist, 2025, 'R&B / Soul');
  const tidesAlbum = album('Tides of Gold', kofiArtist, 2024, 'Afropop');

  // ---- Songs ----
  const insertSong = db.prepare(
    `INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path, cover_url, plays, downloads, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );

  // [title, artistVar, albumVar, genre, bpm, plays]
  const songDefs = [
    // Pop
    ['Electric Dreams', luna, starlightAlbum, 'Pop', 124, 432100],
    ['Dancing on Mirrors', luna, starlightAlbum, 'Pop', 120, 378400],
    ['Sweet Velocity', luna, starlightAlbum, 'Pop', 128, 298700],

    // Indie
    ['Wildflower', copper, wildflowerAlbum, 'Indie', 108, 245600],
    ['Campfire Crown', copper, wildflowerAlbum, 'Indie', 102, 189200],
    ['Run the Rivers', copper, wildflowerAlbum, 'Indie', 114, 212400],

    // Alternative Rock
    ['Static Skies', velvetEcho, shadowAlbum, 'Alternative Rock', 132, 365800],
    ['Overdrive Heart', velvetEcho, shadowAlbum, 'Alternative Rock', 138, 318200],
    ['Bleed the Signal', velvetEcho, shadowAlbum, 'Alternative Rock', 126, 284100],

    // Rock
    ['Champions', silver, anthemAlbum, 'Rock', 136, 489200],
    ['Golden Trophy', silver, anthemAlbum, 'Rock', 130, 395100],
    ['Come Alive', silver, anthemAlbum, 'Rock', 142, 342000],

    // K-Pop
    ['Supernova Love', solaris, novaAlbum, 'K-Pop', 130, 542000],
    ['Neon Seoul', solaris, novaAlbum, 'K-Pop', 126, 488100],
    ['Velocity Beat', solaris, novaAlbum, 'K-Pop', 134, 421500],

    // EDM
    ['Festival Horizon', aeroflux, hyperdriveAlbum, 'EDM', 128, 512000],
    ['Cybernetic Bass', aeroflux, hyperdriveAlbum, 'EDM', 130, 467300],
    ['Infinity Drop', aeroflux, hyperdriveAlbum, 'EDM', 132, 398400],

    // Other (Afrobeats & R&B/Soul)
    ['Sunset Drive', amaraArtist, goldenAlbum, 'Afrobeats', 104, 310500],
    ['Fire & Gold', amaraArtist, goldenAlbum, 'Afrobeats', 96, 274300],
    ['Island Breeze', amaraArtist, goldenAlbum, 'Afrobeats', 100, 215600],
    ['Midnight Call', zaraArtist, velvetAlbum, 'R&B / Soul', 82, 194200],
    ['Slow Fade', zaraArtist, velvetAlbum, 'R&B / Soul', 78, 162100],
    ['Gold Coast', kofiArtist, tidesAlbum, 'Afropop', 92, 134500]
  ];

  // songDefs is the source of truth for tempo; re-assert the module-level lookup
  // the repair pass depends on, and complain loudly if the two ever drift.
  for (const [title, , , , bpm] of songDefs) {
    if (BPM_BY_TITLE[title] !== undefined && BPM_BY_TITLE[title] !== bpm) {
      console.warn(`[seed] BPM table drift for "${title}" (${BPM_BY_TITLE[title]} vs ${bpm}) — regenerated audio would not match.`);
    }
    BPM_BY_TITLE[title] = bpm;
  }

  let songCounter = 0;
  const songIds = [];
  const manifestTracks = [];
  for (const [title, artistId, albumId, genre, bpm, plays] of songDefs) {
    songCounter++;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const derived = deriveSeededTrack(songCounter, title);
    const audioFile = derived.audioFile;
    const audioPath = path.join(audioDir, audioFile);
    const coverRel = '/media/covers/' + slug + '.svg';
    writeCover(path.join(root, 'data', coverRel.slice('/media/'.length)), title, genre, title);

    const { durationSec } = generateTrack({
      seed: derived.seedBase,
      filePath: audioPath,
      durationSec: derived.durationSec,
      rootMidi: derived.rootMidi,
      bpm
    });
    manifestTracks.push({ ...derived, genre, coverRel, durationSec });

    const downloads = Math.floor(plays / 12);
    const createdAt = new Date(Date.now() - (songCounter * 5 + 2) * 86400000).toISOString();
    const id = insertSong.run(title, artistId, albumId, genre, durationSec, '/media/audio/' + audioFile, coverRel, plays, downloads, createdAt).lastInsertRowid;
    songIds.push(id);
  }

  // ---- Playlists ----
  const insertPlaylist = db.prepare('INSERT INTO playlists (name, description, cover_url, user_id, created_at) VALUES (?,?,?,?,?)');
  function playlist(name, desc, userId, slugStr) {
    const cover = '/media/covers/playlist-' + slugStr + '.svg';
    writeCover(path.join(root, 'data', cover.slice('/media/'.length)), name, 'Playlist', slugStr);
    return insertPlaylist.run(name, desc, cover, userId, now).lastInsertRowid;
  }
  const stadium = playlist('Stadium Anthems', 'High energy rock and alt-rock anthems.', adminId, 'stadium-anthems');
  const electronicVibe = playlist('Festival Euphoria', 'Top EDM and electronic bangers.', adminId, 'festival-euphoria');
  const popHits = playlist('Pop & K-Pop Stars', 'Catchiest pop and k-pop chart toppers.', amaraId, 'pop-kpop-stars');
  const afroVibe = playlist('Afrobeats & Soul', 'Golden vibes, Afrobeats rhythms and midnight soul.', adminId, 'afrobeats-soul');

  const addToPlaylist = db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position) VALUES (?,?,?)');
  const byTitle = (t) => songDefs.findIndex((s) => s[0] === t);

  // Stadium Anthems
  ['Champions', 'Static Skies', 'Overdrive Heart', 'Come Alive', 'Golden Trophy']
    .forEach((t, i) => addToPlaylist.run(stadium, songIds[byTitle(t)], i));
  // Festival Euphoria
  ['Festival Horizon', 'Cybernetic Bass', 'Infinity Drop', 'Supernova Love']
    .forEach((t, i) => addToPlaylist.run(electronicVibe, songIds[byTitle(t)], i));
  // Pop & K-Pop Stars
  ['Electric Dreams', 'Supernova Love', 'Dancing on Mirrors', 'Neon Seoul', 'Sweet Velocity']
    .forEach((t, i) => addToPlaylist.run(popHits, songIds[byTitle(t)], i));
  // Afrobeats & Soul
  ['Sunset Drive', 'Fire & Gold', 'Midnight Call', 'Slow Fade', 'Gold Coast']
    .forEach((t, i) => addToPlaylist.run(afroVibe, songIds[byTitle(t)], i));

  // ---- Favorites (demo user) ----
  const addFav = db.prepare('INSERT OR IGNORE INTO favorites (user_id, song_id) VALUES (?,?)');
  ['Champions', 'Electric Dreams', 'Static Skies', 'Supernova Love', 'Festival Horizon', 'Sunset Drive']
    .forEach((t) => addFav.run(adminId, songIds[byTitle(t)]));

  console.log('[seed] Seeded database successfully with 7-genre catalog!');
  console.log('[seed] Demo artist accounts -> amara@pulse.app / demo123 (kofi, zara share the same password).');
  console.log('[seed] Admin account uses the private passkey (see server/routes.js) — credentials intentionally not printed.');

  // Record how the WAVs were synthesized so a later boot can regenerate them if
  // the host (e.g. Render free tier) restarts with a wiped filesystem.
  writeManifest(manifestTracks);
  console.log(`[seed] Wrote ${path.relative(root, MANIFEST_PATH)} (${manifestTracks.length} tracks) for media self-healing.`);
  return true;
}

export { seed as seedDatabase };

// Seeding is driven explicitly by server/index.js on boot and by `npm run seed`
// below — importing this module must not have side effects of its own.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  seed();
  // `npm run seed` (and Render's manual shell) should also repair any media that
  // went missing without touching an already-populated database.
  ensureSeedAssets();
}
