import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { audioDir, coverDir } from './db.js';
import { hashPassword } from './auth.js';
import { generateTrack } from './synth.js';
import { writeCover } from './cover.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function seed() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (existing > 0) {
    console.log('[seed] Database already seeded, skipping.');
    return;
  }

  const now = new Date().toISOString();

  // ---- Users ----
  const adminHash = hashPassword('demo123');
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
    adminHash,
    'artist',
    null,
    JSON.stringify(['Other', 'Pop']),
    now
  ).lastInsertRowid;

  const kofiId = insertUser.run(
    'Kofi Mensah',
    'kofi',
    'kofi@pulse.app',
    adminHash,
    'artist',
    null,
    JSON.stringify(['Other', 'EDM']),
    now
  ).lastInsertRowid;

  const zaraId = insertUser.run(
    'Zara Bello',
    'zara',
    'zara@pulse.app',
    adminHash,
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

  let songCounter = 0;
  const songIds = [];
  for (const [title, artistId, albumId, genre, bpm, plays] of songDefs) {
    songCounter++;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const audioFile = `track-${String(songCounter).padStart(2, '0')}.wav`;
    const audioPath = path.join(audioDir, audioFile);
    const coverRel = '/media/covers/' + slug + '.svg';
    writeCover(path.join(root, 'data', coverRel.slice('/media/'.length)), title, genre, title);

    const rootMidi = 53 + (songCounter % 9);
    const seedBase = hashCode(title) % 100000;
    const { durationSec } = generateTrack({ seed: seedBase, filePath: audioPath, durationSec: 10 + (songCounter % 3) * 2, rootMidi, bpm });

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
  console.log('[seed] Demo accounts -> admin@pulse.app (adebayo) / demo123  ·  amara@pulse.app (amara) / demo123');
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

seed();
