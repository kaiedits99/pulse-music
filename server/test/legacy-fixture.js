// A miniature copy of what Pulse used to seed on first boot (sample artists, albums,
// generated tracks, featured placeholders, playlists, podcasts, demo log-ins and the
// generated media files), mixed with REAL user data that a clean-up must never touch.
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const HASH = bcrypt.hashSync('demo123', 4); // the password the old demo accounts shared

export function buildLegacyFixture(db, dataDir) {
  const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid);
  const user = (name, username, email, role = 'artist') =>
    insert('INSERT INTO users (name, username, email, password_hash, role) VALUES (?,?,?,?,?)', name, username, email, HASH, role);
  const artist = (name, userId = null, avatar = null, followers = 0) =>
    insert('INSERT INTO artists (name, bio, genre, country, avatar_url, followers, user_id) VALUES (?,?,?,?,?,?,?)',
      name, avatar ? 'Invented demo biography' : null, avatar ? 'Pop' : null, avatar ? 'Nowhere' : null, avatar, followers, userId);
  const album = (title, artistId, cover, uploadedBy = null) =>
    insert('INSERT INTO albums (title, artist_id, cover_url, uploaded_by) VALUES (?,?,?,?)', title, artistId, cover, uploadedBy);
  const song = (title, artistId, { albumId = null, file = null, source = null, cover = null, by = null, genre = 'Pop', isPublic = 1 } = {}) =>
    insert('INSERT INTO songs (title, artist_id, album_id, genre, file_path, source_url, cover_url, uploaded_by, is_public, plays) VALUES (?,?,?,?,?,?,?,?,?,?)',
      title, artistId, albumId, genre, file, source, cover, by, isPublic, 1000);
  const playlist = (name, userId, cover = null) =>
    insert('INSERT INTO playlists (name, user_id, cover_url) VALUES (?,?,?)', name, userId, cover);
  const addToPlaylist = (playlistId, songId, position) =>
    db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?,?,?)').run(playlistId, songId, position);
  const favorite = (userId, songId) => db.prepare('INSERT INTO favorites (user_id, song_id) VALUES (?,?)').run(userId, songId);

  // ---- accounts ----------------------------------------------------------------
  const admin = user('Adebayo Cole', 'adebayo', 'admin@pulse.app', 'admin');
  const amara = user('Amara Okafor', 'amara', 'amara@pulse.app');   // demo, ends up unused
  const kofi = user('Kofi Mensah', 'kofi', 'kofi@pulse.app');       // demo, but someone uploaded real music with it
  const zara = user('Zara Bello', 'zara', 'zara@pulse.app');         // demo, ends up unused
  const real = user('Real Person', 'real_person', 'real@example.test');

  // ---- seeded artists / albums -------------------------------------------------
  const luna = artist('Luna Ray', null, '/media/covers/artist-luna-ray.svg', 345000);
  const solaris = artist('SOLARIS', null, '/media/covers/artist-solaris.svg', 489000);
  const amaraArtist = artist('Amara Okafor', amara, '/media/covers/artist-amara-okafor.svg', 225000);
  const kofiArtist = artist('Kofi Mensah', kofi, '/media/covers/artist-kofi-mensah.svg', 98000);
  const zaraArtist = artist('Zara Bello', zara, '/media/covers/artist-zara-bello.svg', 142000);
  const thalia = artist('Thalia Falcon', admin, '/media/covers/artist-thalia-falcon.svg');
  const zyny = artist('ŻYŃY', admin, '/media/covers/artist-y-y.svg');
  const starlight = album('Starlight Boulevard', luna, '/media/covers/album-starlight-boulevard.svg');
  const goldenHour = album('Golden Hour', amaraArtist, '/media/covers/album-golden-hour.svg');
  const tidesOfGold = album('Tides of Gold', kofiArtist, '/media/covers/album-tides-of-gold.svg');

  // ---- seeded tracks (generated audio) and featured placeholders (no audio) -----
  const demoSongs = [
    song('Electric Dreams', luna, { albumId: starlight, file: '/media/audio/track-01.wav', cover: '/media/covers/electric-dreams.svg' }),
    song('Sunset Boulevard', amaraArtist, { albumId: goldenHour, file: '/media/audio/track-02.wav', cover: '/media/covers/sunset-boulevard.svg' }),
    song('Tide Song', kofiArtist, { albumId: tidesOfGold, file: '/media/audio/track-03.wav', cover: '/media/covers/tide-song.svg' }),
    song('Neon Seoul', solaris, { file: '/media/audio/track-04.wav', cover: '/media/covers/neon-seoul.svg', genre: 'K-Pop' })
  ];
  song('Out Your Life', thalia, { cover: '/media/covers/thalia-out-your-life.svg', by: admin, genre: 'R&B/Soul' });
  song('No Need', zyny, { cover: '/media/covers/zyny-no-need.svg', by: admin, genre: 'Electronic' });

  // ---- REAL user content --------------------------------------------------------
  const realArtist = artist('Real Person', real);
  const realAlbum = album('My Real Album', realArtist, null, real);
  const realSong = song('Real Song', realArtist, { albumId: realAlbum, file: '/media/uploads/111-aaaa.mp3', by: real, genre: 'Afrobeats' });
  // uploaded through the demo "kofi" log-in, attributed to the seeded profile and picking its seeded album:
  const kofiRealUpload = song('Kofi Real Upload', kofiArtist, {
    albumId: tidesOfGold, file: '/media/uploads/222-bbbb.mp3', by: kofi, genre: 'Highlife',
    cover: '/media/covers/album-tides-of-gold.svg' // copied from the album, exactly as POST /songs does
  });
  // a real upload that merely typed the name of a seeded artist:
  const lunaRealUpload = song('Luna Cover', luna, { file: '/media/uploads/333-cccc.mp3', by: real, genre: 'Pop' });

  // ---- playlists & favourites ---------------------------------------------------
  const stadium = playlist('Stadium Anthems', admin, '/media/covers/playlist-stadium-anthems.svg');
  const popStars = playlist('Pop & K-Pop Stars', amara, '/media/covers/playlist-pop-kpop-stars.svg');
  addToPlaylist(stadium, demoSongs[0], 0);
  addToPlaylist(popStars, demoSongs[1], 0);
  const roadTrip = playlist('Road Trip', real); // a real playlist mixing demo and real tracks
  addToPlaylist(roadTrip, demoSongs[0], 0);
  addToPlaylist(roadTrip, realSong, 1);
  addToPlaylist(roadTrip, kofiRealUpload, 2);
  addToPlaylist(roadTrip, lunaRealUpload, 3);
  favorite(admin, demoSongs[0]);
  favorite(real, demoSongs[0]);
  favorite(real, realSong);

  // ---- podcasts -----------------------------------------------------------------
  const demoShow = insert('INSERT INTO podcasts (title, publisher, category, cover_url) VALUES (?,?,?,?)',
    'The Signal Path', 'Pulse Studios', 'Music', '/media/covers/podcast-the-signal-path.svg');
  const demoEpisodes = [1, 2].map((n) => insert(
    'INSERT INTO episodes (podcast_id, title, file_path, cover_url) VALUES (?,?,?,?)',
    demoShow, `Demo episode ${n}`, `/media/audio/podcast-the-signal-path-0${n}.wav`, '/media/covers/podcast-the-signal-path.svg'));
  db.prepare('INSERT INTO podcast_subscriptions (user_id, podcast_id) VALUES (?,?)').run(real, demoShow);
  db.prepare('INSERT INTO saved_episodes (user_id, episode_id) VALUES (?,?)').run(real, demoEpisodes[0]);
  db.prepare('INSERT INTO episode_progress (user_id, episode_id, position_seconds) VALUES (?,?,?)').run(real, demoEpisodes[1], 42);
  const realShow = insert('INSERT INTO podcasts (title, publisher, user_id) VALUES (?,?,?)', 'Real Show', 'Real Person', real);
  insert('INSERT INTO episodes (podcast_id, title, file_path) VALUES (?,?,?)', realShow, 'Real episode', '/media/uploads/444-dddd.mp3');

  // ---- files on disk ------------------------------------------------------------
  const write = (dir, name, body = 'x') => {
    fs.mkdirSync(path.join(dataDir, dir), { recursive: true });
    fs.writeFileSync(path.join(dataDir, dir, name), body);
  };
  ['track-01.wav', 'track-02.wav', 'track-03.wav', 'track-04.wav', 'podcast-the-signal-path-01.wav', 'podcast-the-signal-path-02.wav']
    .forEach((name) => write('audio', name));
  write('audio', 'notes.txt', 'not generated by the seeder — must survive');
  ['artist-luna-ray.svg', 'album-golden-hour.svg', 'electric-dreams.svg', 'thalia-out-your-life.svg'].forEach((name) => write('covers', name));
  fs.writeFileSync(path.join(dataDir, 'seed-manifest.json'), '{"tracks":[]}');
  ['111-aaaa.mp3', '222-bbbb.mp3', '333-cccc.mp3', '444-dddd.mp3'].forEach((name) => write('uploads', name, 'real audio'));

  return {
    ids: { admin, amara, kofi, zara, real, realSong, kofiRealUpload, lunaRealUpload, realAlbum, realArtist, roadTrip, realShow, kofiArtist, luna },
    demo: { songs: 4 + 2, albums: 3, playlists: 2, podcasts: 1, episodes: 2 }
  };
}
