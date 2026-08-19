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
    'INSERT INTO users (name, email, password_hash, role, avatar_url, created_at) VALUES (?,?,?,?,?,?)'
  );
  const adminId = insertUser.run('Adebayo Cole', 'admin@pulse.app', adminHash, 'admin', null, now).lastInsertRowid;
  const amaraId = insertUser.run('Amara Okafor', 'amara@pulse.app', adminHash, 'artist', null, now).lastInsertRowid;
  const kofiId = insertUser.run('Kofi Mensah', 'kofi@pulse.app', adminHash, 'artist', null, now).lastInsertRowid;
  const zaraId = insertUser.run('Zara Bello', 'zara@pulse.app', adminHash, 'artist', null, now).lastInsertRowid;

  // ---- Artists ----
  const insertArtist = db.prepare(
    'INSERT INTO artists (name, bio, genre, country, avatar_url, followers, user_id, created_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  function artist(name, bio, genre, country, followers, userId) {
    const avatar = '/media/covers/artist-' + name.toLowerCase().replace(/[^a-z]+/g, '-') + '.svg';
    writeCover(path.join(root, 'data', avatar.slice('/media/'.length)), name.split(' ')[0], 'Artist', name);
    return insertArtist.run(name, bio, genre, country, avatar, followers, userId, now).lastInsertRowid;
  }

  // --- Indie / FIFA-soundtrack-flavored artists ---
  const neon = artist('Neon Marigold', 'Indietronica outfit painting summer anthems in neon — synth hooks, handclap beats and festival-ready choruses.', 'Indie Pop', 'United Kingdom', 312400, null);
  const glass = artist('Glass Cathedral', 'Melbourne indie rockers delivering driving riffs and stadium-sized singalongs built for the terraces.', 'Indie Rock', 'Australia', 248600, null);
  const copper = artist('The Copper Vines', 'Warm indie-folk harmonies from the Canadian coast — campfire anthems and open-road Americana.', 'Indie Folk', 'Canada', 176200, null);
  const velvet = artist('Velvet Static', 'Stockholm synthpop duo crafting glossy midnight electronics and bittersweet hooks.', 'Synthpop', 'Sweden', 289400, null);
  const cassette = artist('Cassette Club', 'Alt-pop chameleons bouncing between lo-fi nostalgia and bright, radio-ready pop.', 'Alt Pop', 'United States', 134800, null);
  const arcade = artist('Midnight Arcade', 'Amsterdam indie-dance act fusing retro game blips with four-on-the-floor euphoria.', 'Indie Dance', 'Netherlands', 201100, null);
  const silver = artist('Silver Youth', 'Anthemic indie-rock for the terraces — sing-it-back choruses and gold-trophy energy.', 'Indie Rock', 'United States', 224300, null);

  // --- Afrobeats / African (kept) ---
  const amaraArtist = artist('Amara Okafor', 'Lagos-born Afrobeats star blending soulful vocals with infectious rhythms. Known for her shimmering harmonies and dance-ready hooks.', 'Afrobeats', 'Nigeria', 182400, amaraId);
  const kofiArtist = artist('Kofi Mensah', 'Accra-based highlife revivalist weaving traditional Ghanaian grooves with modern Afropop production.', 'Afropop', 'Ghana', 96400, kofiId);
  const zaraArtist = artist('Zara Bello', 'Sultry R&B vocalist from Abuja crafting midnight slow-burns and heartbreak anthems.', 'R&B / Soul', 'Nigeria', 128700, zaraId);
  const nairobiArtist = artist('Nairobi Collective', 'A five-piece Afro-fusion ensemble known for genre-bending live energy and hypnotic guitar lines.', 'Afro-fusion', 'Kenya', 74200, null);

  // ---- Albums ----
  const insertAlbum = db.prepare(
    'INSERT INTO albums (title, artist_id, cover_url, release_year, genre, created_at) VALUES (?,?,?,?,?,?)'
  );
  function album(title, artistId, year, genre) {
    const cover = '/media/covers/album-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.svg';
    writeCover(path.join(root, 'data', cover.slice('/media/'.length)), title, String(year), title);
    return insertAlbum.run(title, artistId, cover, year, genre, now).lastInsertRowid;
  }

  const sunbleached = album('Sunbleached', neon, 2024, 'Indie Pop');
  const openRoads = album('Open Roads', glass, 2023, 'Indie Rock');
  const wildflowerState = album('Wildflower State', copper, 2024, 'Indie Folk');
  const chromeNights = album('Chrome Nights', velvet, 2023, 'Synthpop');
  const rewind = album('Rewind', cassette, 2024, 'Alt Pop');
  const pixelHearts = album('Pixel Hearts', arcade, 2024, 'Indie Dance');
  const anthemSeason = album('Anthem Season', silver, 2023, 'Indie Rock');
  const goldenAlbum = album('Golden Hour', amaraArtist, 2025, 'Afrobeats');
  const lagosAlbum = album('Lagos Diaries', amaraArtist, 2023, 'Afrobeats');
  const tidesAlbum = album('Tides of Gold', kofiArtist, 2024, 'Afropop');
  const velvetAlbum = album('Velvet Nights', zaraArtist, 2025, 'R&B / Soul');
  const savannaAlbum = album('Savanna Dreams', nairobiArtist, 2024, 'Afro-fusion');

  // ---- Songs ----
  const insertSong = db.prepare(
    `INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path, cover_url, plays, downloads, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );

  // [title, artistVar, albumVar, genre, bpm, plays]
  const songDefs = [
    // Neon Marigold — Indie Pop
    ['Tangerine Sky', neon, sunbleached, 'Indie Pop', 128, 412300],
    ['Heartbeat Static', neon, sunbleached, 'Indie Pop', 122, 356400],
    ['Daydream in Reverse', neon, sunbleached, 'Indie Pop', 118, 289700],
    // Glass Cathedral — Indie Rock
    ['Kick It Up', glass, openRoads, 'Indie Rock', 132, 298600],
    ['Northern Line', glass, openRoads, 'Indie Rock', 126, 264800],
    ['Golden Hour Riot', glass, openRoads, 'Indie Rock', 138, 331200],
    ['Stadium Lights', glass, openRoads, 'Indie Rock', 130, 275100],
    // The Copper Vines — Indie Folk
    ['Wildflower', copper, wildflowerState, 'Indie Folk', 108, 198400],
    ['Campfire Crown', copper, wildflowerState, 'Indie Folk', 102, 154300],
    ['Run the Rivers', copper, wildflowerState, 'Indie Folk', 112, 187600],
    // Velvet Static — Synthpop
    ['Neon Pulse', velvet, chromeNights, 'Synthpop', 124, 342800],
    ['Chrome Nights', velvet, chromeNights, 'Synthpop', 118, 310500],
    ['Afterglow', velvet, chromeNights, 'Synthpop', 116, 287200],
    // Cassette Club — Alt Pop
    ['Rewind', cassette, rewind, 'Alt Pop', 120, 226400],
    ['Gravity Games', cassette, rewind, 'Alt Pop', 114, 198200],
    ['Side A', cassette, rewind, 'Alt Pop', 108, 172900],
    // Midnight Arcade — Indie Dance
    ['Pixel Hearts', arcade, pixelHearts, 'Indie Dance', 126, 254100],
    ['Arcade Love', arcade, pixelHearts, 'Indie Dance', 122, 219300],
    ['High Score', arcade, pixelHearts, 'Indie Dance', 128, 203700],
    // Silver Youth — Indie Rock
    ['Champions', silver, anthemSeason, 'Indie Rock', 136, 318900],
    ['Golden Trophy', silver, anthemSeason, 'Indie Rock', 130, 244600],
    ['Come Alive', silver, anthemSeason, 'Indie Rock', 140, 281400],
    // Amara Okafor — Afrobeats
    ['Sunset Drive', amaraArtist, goldenAlbum, 'Afrobeats', 104, 210040],
    ['Fire & Gold', amaraArtist, goldenAlbum, 'Afrobeats', 88, 168200],
    ['Island Breeze', amaraArtist, goldenAlbum, 'Afrobeats', 96, 121500],
    ['Palm Wine', amaraArtist, lagosAlbum, 'Afrobeats', 92, 98100],
    ['Third Mainland', amaraArtist, lagosAlbum, 'Afrobeats', 100, 143300],
    // Kofi Mensah — Afropop
    ['Gold Coast', kofiArtist, tidesAlbum, 'Afropop', 90, 87200],
    ['Highlife Soul', kofiArtist, tidesAlbum, 'Afropop', 84, 64300],
    ['Accra Nights', kofiArtist, tidesAlbum, 'Afropop', 98, 55800],
    // Zara Bello — R&B / Soul
    ['Midnight Call', zaraArtist, velvetAlbum, 'R&B / Soul', 80, 119800],
    ['Slow Fade', zaraArtist, velvetAlbum, 'R&B / Soul', 76, 96700],
    ['Velvet', zaraArtist, velvetAlbum, 'R&B / Soul', 86, 88400],
    // Nairobi Collective — Afro-fusion
    ['Serengeti', nairobiArtist, savannaAlbum, 'Afro-fusion', 108, 76500],
    ['Baobab', nairobiArtist, savannaAlbum, 'Afro-fusion', 94, 54200],
    ['Kilimanjaro', nairobiArtist, savannaAlbum, 'Afro-fusion', 102, 61300]
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
    const { durationSec } = generateTrack({ seed: seedBase, filePath: audioPath, durationSec: 34 + (songCounter % 4) * 3, rootMidi, bpm });

    const downloads = Math.floor(plays / 14);
    const createdAt = new Date(Date.now() - (songCounter * 6 + 3) * 86400000).toISOString();
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
  const stadium = playlist('Stadium Anthems', 'Sing-it-back indie anthems with FIFA-menu energy.', adminId, 'stadium-anthems');
  const afroVibe = playlist('Afrobeats Vibe', 'Smooth Afrobeats for any mood.', adminId, 'afrobeats-vibe');
  const chill = playlist('Late Night Chill', 'Slow burns and midnight grooves.', adminId, 'late-night-chill');
  const indieDisc = playlist('Indie Discovery', 'Fresh indie, folk and synthpop finds.', amaraId, 'indie-discovery');

  const addToPlaylist = db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position) VALUES (?,?,?)');
  const byTitle = (t) => songDefs.findIndex((s) => s[0] === t);

  // Stadium Anthems
  ['Champions', 'Come Alive', 'Golden Hour Riot', 'Kick It Up', 'Golden Trophy', 'Stadium Lights', 'Tangerine Sky', 'Fire & Gold']
    .forEach((t, i) => addToPlaylist.run(stadium, songIds[byTitle(t)], i));
  // Afrobeats Vibe
  ['Sunset Drive', 'Fire & Gold', 'Island Breeze', 'Palm Wine', 'Gold Coast', 'Highlife Soul']
    .forEach((t, i) => addToPlaylist.run(afroVibe, songIds[byTitle(t)], i));
  // Late Night Chill
  ['Midnight Call', 'Slow Fade', 'Afterglow', 'Side A', 'Velvet', 'Baobab']
    .forEach((t, i) => addToPlaylist.run(chill, songIds[byTitle(t)], i));
  // Indie Discovery
  ['Wildflower', 'Neon Pulse', 'Rewind', 'Pixel Hearts', 'Northern Line', 'Run the Rivers']
    .forEach((t, i) => addToPlaylist.run(indieDisc, songIds[byTitle(t)], i));

  // ---- Favorites (demo user) ----
  const addFav = db.prepare('INSERT OR IGNORE INTO favorites (user_id, song_id) VALUES (?,?)');
  ['Champions', 'Tangerine Sky', 'Neon Pulse', 'Sunset Drive', 'Midnight Call', 'Rewind']
    .forEach((t) => addFav.run(adminId, songIds[byTitle(t)]));

  console.log('[seed] Seeded database successfully.');
  console.log('[seed] Demo accounts -> admin@pulse.app / demo123  ·  amara@pulse.app / demo123');
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

seed();
