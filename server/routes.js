import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db, { uploadsDir } from './db.js';
import { hashPassword, verifyPassword, signToken, publicUser, authMiddleware, optionalAuth } from './auth.js';

const router = express.Router();

// ---------- Multer for uploads ----------
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadsDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.fieldname === 'audio') {
      const ok = /\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(file.originalname);
      return ok ? cb(null, true) : cb(new Error('Unsupported audio format'));
    }
    if (file.fieldname === 'cover') {
      const ok = /\.(jpg|jpeg|png|svg|webp)$/i.test(file.originalname);
      return ok ? cb(null, true) : cb(new Error('Unsupported image format'));
    }
    cb(null, true);
  }
});

function wavDuration(filePath) {
  try {
    if (!/\.wav$/i.test(filePath)) return null;
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    fs.closeSync(fd);
    const sampleRate = header.readUInt32LE(24);
    const dataSize = header.readUInt32LE(40);
    if (!sampleRate) return null;
    return Math.round((dataSize / (sampleRate * 2)) * 100) / 100;
  } catch { return null; }
}

// ---------- Helpers ----------
function sanitizeSourceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:') throw new Error('Only HTTPS sources are permitted');
    return url.toString();
  } catch {
    const error = new Error('Playback URL must be a valid HTTPS URL from a licensed provider');
    error.status = 400;
    throw error;
  }
}

function artistForUser(userId) {
  return db.prepare('SELECT * FROM artists WHERE user_id = ?').get(userId);
}

function songOwnerIs(req, song) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  const artist = artistForUser(req.user.id);
  return artist && artist.id === song.artist_id;
}

function artistOwnerIs(req, artistId) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  const artist = artistForUser(req.user.id);
  return artist && artist.id === artistId;
}

// ============================== AUTH ==============================
router.post('/auth/register', (req, res) => {
  const { name, email, password, artistName } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'An account with this email already exists' });

  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run(name, email, hashPassword(password), 'artist');
  const userId = info.lastInsertRowid;

  // create artist profile
  const aName = (artistName || name).trim() || name;
  db.prepare('INSERT INTO artists (name, user_id) VALUES (?,?)').run(aName, userId);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const artist = artistForUser(req.user.id);
  res.json({ user: publicUser(req.user), artist });
});

// ============================== STATS ==============================
router.get('/stats', optionalAuth, (req, res) => {
  const songs = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(plays),0) plays, COALESCE(SUM(downloads),0) downloads FROM songs').get();
  const artists = db.prepare('SELECT COUNT(*) c FROM artists').get().c;
  const albums = db.prepare('SELECT COUNT(*) c FROM albums').get().c;
  const playlists = db.prepare('SELECT COUNT(*) c FROM playlists').get().c;
  const top = db.prepare(
    `SELECT s.*, a.name artist_name FROM songs s JOIN artists a ON a.id = s.artist_id ORDER BY s.plays DESC LIMIT 5`
  ).all();
  const recent = db.prepare(
    `SELECT s.*, a.name artist_name FROM songs s JOIN artists a ON a.id = s.artist_id ORDER BY s.created_at DESC LIMIT 6`
  ).all();
  const genreRows = db.prepare(
    `SELECT genre, COUNT(*) c FROM songs GROUP BY genre ORDER BY c DESC`
  ).all();
  res.json({
    songs: songs.c, plays: songs.plays, downloads: songs.downloads,
    artists, albums, playlists, top, recent, genres: genreRows
  });
});

// ============================== SONGS ==============================
router.get('/songs', optionalAuth, (req, res) => {
  const { q, artist_id, album_id, genre, sort } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(s.title LIKE ? OR a.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (artist_id) { where.push('s.artist_id = ?'); params.push(artist_id); }
  if (album_id) { where.push('s.album_id = ?'); params.push(album_id); }
  if (genre) { where.push('s.genre = ?'); params.push(genre); }
  let order = 's.created_at DESC';
  if (sort === 'plays') order = 's.plays DESC';
  if (sort === 'downloads') order = 's.downloads DESC';
  if (sort === 'title') order = 's.title ASC';

  const rows = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover
    FROM songs s
    JOIN artists a ON a.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order}
  `).all(...params);

  let favs = new Set();
  if (req.user) {
    const f = db.prepare('SELECT song_id FROM favorites WHERE user_id = ?').all(req.user.id);
    favs = new Set(f.map(r => r.song_id));
  }
  const result = rows.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 }));
  res.json(result);
});

router.get('/songs/:id', optionalAuth, (req, res) => {
  const s = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title
    FROM songs s JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Song not found' });
  res.json(s);
});

// Bulk import is intentionally limited to ten files per request. Audio stays in Pulse storage;
// only upload music you own or are authorized to make available.
router.post('/songs/import', authMiddleware, upload.array('audio', 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Choose at least one audio file' });
  const artistId = parseInt(req.body.artist_id, 10) || artistForUser(req.user.id)?.id;
  if (!artistId) return res.status(400).json({ error: 'Artist is required' });
  if (!artistOwnerIs(req, artistId)) return res.status(403).json({ error: 'You can only upload for your own artist profile' });
  const albumId = req.body.album_id ? parseInt(req.body.album_id, 10) : null;
  const genre = (req.body.genre || '').trim() || null;
  const insert = db.prepare(`INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path)
    VALUES (?,?,?,?,?,?)`);
  const getSong = db.prepare(`SELECT s.*, a.name artist_name, al.title album_title FROM songs s
    JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id WHERE s.id = ?`);
  const imported = db.transaction(() => files.map((file) => {
    const title = path.basename(file.originalname, path.extname(file.originalname)).replace(/[-_]+/g, ' ').trim() || 'Untitled track';
    const duration = wavDuration(file.path) || 0;
    const id = insert.run(title, artistId, albumId, genre, duration, '/media/uploads/' + file.filename).lastInsertRowid;
    return getSong.get(id);
  }))();
  res.status(201).json({ imported, count: imported.length });
});

router.post('/songs', authMiddleware, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  const body = req.body;
  const title = (body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });

  // resolve artist
  let artistId = parseInt(body.artist_id, 10);
  if (!artistId && req.user) {
    const own = artistForUser(req.user.id);
    if (own) artistId = own.id;
  }
  if (!artistId) return res.status(400).json({ error: 'Artist is required' });
  if (!artistOwnerIs(req, artistId)) return res.status(403).json({ error: 'You can only upload for your own artist profile' });

  const audioFile = req.files && req.files.audio && req.files.audio[0];
  const coverFile = req.files && req.files.cover && req.files.cover[0];
  let filePath = null;
  if (audioFile) filePath = '/media/uploads/' + audioFile.filename;
  const sourceUrl = sanitizeSourceUrl(body.source_url);
  if (!filePath && !sourceUrl) return res.status(400).json({ error: 'Choose an audio file or provide an approved HTTPS playback URL' });

  const duration = wavDuration(audioFile ? audioFile.path : '') || parseFloat(body.duration) || 0;
  const albumId = body.album_id ? parseInt(body.album_id, 10) : null;

  let coverUrl = null;
  if (coverFile) coverUrl = '/media/uploads/' + coverFile.filename;
  else {
    const own = db.prepare('SELECT cover_url FROM albums WHERE id = ?').get(albumId);
    coverUrl = (own && own.cover_url) || null;
  }

  const info = db.prepare(
    `INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path, source_url, cover_url)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(title, artistId, albumId, body.genre || null, duration, filePath, sourceUrl, coverUrl);

  const s = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title
    FROM songs s JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id WHERE s.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(s);
});

router.put('/songs/:id', authMiddleware, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  const existing = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Song not found' });
  if (!songOwnerIs(req, existing)) return res.status(403).json({ error: 'Not allowed' });

  const body = req.body;
  const title = body.title != null ? (body.title || '').trim() : existing.title;
  let artistId = body.artist_id ? parseInt(body.artist_id, 10) : existing.artist_id;
  if (!artistOwnerIs(req, artistId)) return res.status(403).json({ error: 'Not allowed' });

  const albumId = body.album_id ? parseInt(body.album_id, 10) : existing.album_id;
  const audioFile = req.files && req.files.audio && req.files.audio[0];
  const coverFile = req.files && req.files.cover && req.files.cover[0];

  let filePath = existing.file_path;
  if (audioFile) filePath = '/media/uploads/' + audioFile.filename;
  const sourceUrl = body.source_url !== undefined ? sanitizeSourceUrl(body.source_url) : existing.source_url;
  if (!filePath && !sourceUrl) return res.status(400).json({ error: 'A playable audio source is required' });
  let duration = existing.duration_seconds;
  if (audioFile) duration = wavDuration(audioFile.path) || parseFloat(body.duration) || duration;

  let coverUrl = existing.cover_url;
  if (coverFile) coverUrl = '/media/uploads/' + coverFile.filename;

  db.prepare(
    `UPDATE songs SET title=?, artist_id=?, album_id=?, genre=?, duration_seconds=?, file_path=?, source_url=?, cover_url=? WHERE id=?`
  ).run(title, artistId, albumId, body.genre || existing.genre, duration, filePath, sourceUrl, coverUrl, existing.id);

  const s = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title
    FROM songs s JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id WHERE s.id = ?
  `).get(existing.id);
  res.json(s);
});

router.delete('/songs/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Song not found' });
  if (!songOwnerIs(req, existing)) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM songs WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

// play + download counters
router.post('/songs/:id/play', (req, res) => {
  db.prepare('UPDATE songs SET plays = plays + 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/songs/:id/download', (req, res) => {
  const s = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!s || !s.file_path) return res.status(404).json({ error: 'No audio available' });
  db.prepare('UPDATE songs SET downloads = downloads + 1 WHERE id = ?').run(s.id);
  const rel = s.file_path.replace('/media/', '');
  const abs = path.join(uploadsDir, '..', rel);
  const safe = path.basename(s.file_path);
  res.download(abs, safe);
});

// ============================== FAVORITES ==============================
router.get('/favorites', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title
    FROM favorites f JOIN songs s ON s.id = f.song_id
    JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
    WHERE f.user_id = ? ORDER BY f.created_at DESC
  `).all(req.user.id);
  res.json(rows.map(r => ({ ...r, is_favorite: 1 })));
});

router.post('/favorites/:songId', authMiddleware, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, song_id) VALUES (?,?)').run(req.user.id, req.params.songId);
  res.json({ is_favorite: 1 });
});

router.delete('/favorites/:songId', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND song_id = ?').run(req.user.id, req.params.songId);
  res.json({ is_favorite: 0 });
});

// ============================== ALBUMS ==============================
router.get('/albums', optionalAuth, (req, res) => {
  const { q, artist_id } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(al.title LIKE ? OR a.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (artist_id) { where.push('al.artist_id = ?'); params.push(artist_id); }
  const rows = db.prepare(`
    SELECT al.*, a.name artist_name, (SELECT COUNT(*) FROM songs s WHERE s.album_id = al.id) track_count
    FROM albums al JOIN artists a ON a.id = al.artist_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY al.release_year DESC, al.title ASC
  `).all(...params);
  res.json(rows);
});

router.get('/albums/:id', optionalAuth, (req, res) => {
  const al = db.prepare(`
    SELECT al.*, a.name artist_name FROM albums al JOIN artists a ON a.id = al.artist_id WHERE al.id = ?
  `).get(req.params.id);
  if (!al) return res.status(404).json({ error: 'Album not found' });
  const songs = db.prepare(`
    SELECT s.*, a.name artist_name, al2.title album_title FROM songs s
    JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al2 ON al2.id = s.album_id
    WHERE s.album_id = ? ORDER BY s.created_at ASC
  `).all(al.id);
  res.json({ ...al, songs });
});

router.post('/albums', authMiddleware, (req, res) => {
  const { title, artist_id, release_year, genre } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required' });
  let aId = artist_id ? parseInt(artist_id, 10) : null;
  if (!aId) { const own = artistForUser(req.user.id); if (own) aId = own.id; }
  if (!aId) return res.status(400).json({ error: 'Artist is required' });
  if (!artistOwnerIs(req, aId)) return res.status(403).json({ error: 'Not allowed' });
  const info = db.prepare('INSERT INTO albums (title, artist_id, release_year, genre) VALUES (?,?,?,?)')
    .run(title, aId, release_year || new Date().getFullYear(), genre || null);
  const al = db.prepare('SELECT * FROM albums WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(al);
});

router.put('/albums/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Album not found' });
  if (!artistOwnerIs(req, existing.artist_id)) return res.status(403).json({ error: 'Not allowed' });
  const b = req.body || {};
  db.prepare('UPDATE albums SET title=?, release_year=?, genre=? WHERE id=?')
    .run(b.title || existing.title, b.release_year || existing.release_year, b.genre || existing.genre, existing.id);
  res.json(db.prepare('SELECT * FROM albums WHERE id = ?').get(existing.id));
});

router.delete('/albums/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Album not found' });
  if (!artistOwnerIs(req, existing.artist_id)) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM albums WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

// ============================== ARTISTS ==============================
router.get('/artists', (req, res) => {
  const { q } = req.query;
  const where = q ? 'WHERE a.name LIKE ? OR a.genre LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  const rows = db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM songs s WHERE s.artist_id = a.id) song_count,
           (SELECT COUNT(*) FROM albums al WHERE al.artist_id = a.id) album_count
    FROM artists a ${where} ORDER BY a.followers DESC
  `).all(...params);
  res.json(rows);
});

router.get('/artists/:id', (req, res) => {
  const a = db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM songs s WHERE s.artist_id = a.id) song_count
    FROM artists a WHERE a.id = ?
  `).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Artist not found' });
  const songs = db.prepare(`
    SELECT s.*, a2.name artist_name, al.title album_title FROM songs s
    JOIN artists a2 ON a2.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
    WHERE s.artist_id = ? ORDER BY s.plays DESC
  `).all(a.id);
  const albums = db.prepare('SELECT * FROM albums WHERE artist_id = ? ORDER BY release_year DESC').all(a.id);
  res.json({ ...a, songs, albums });
});

router.post('/artists', authMiddleware, (req, res) => {
  const { name, bio, genre, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const info = db.prepare('INSERT INTO artists (name, bio, genre, country) VALUES (?,?,?,?)')
    .run(name, bio || null, genre || null, country || null);
  res.status(201).json(db.prepare('SELECT * FROM artists WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/artists/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM artists WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Artist not found' });
  if (!artistOwnerIs(req, existing.id)) return res.status(403).json({ error: 'Not allowed' });
  const b = req.body || {};
  db.prepare('UPDATE artists SET name=?, bio=?, genre=?, country=? WHERE id=?')
    .run(b.name || existing.name, b.bio != null ? b.bio : existing.bio, b.genre != null ? b.genre : existing.genre, b.country != null ? b.country : existing.country, existing.id);
  res.json(db.prepare('SELECT * FROM artists WHERE id = ?').get(existing.id));
});

router.delete('/artists/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM artists WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Artist not found' });
  if (!artistOwnerIs(req, existing.id)) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM artists WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

// ============================== PLAYLISTS ==============================
router.get('/playlists', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.name creator_name,
      (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) track_count
    FROM playlists p LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
  `).all();
  res.json(rows);
});

router.get('/playlists/:id', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT p.*, u.name creator_name FROM playlists p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  const songs = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title, ps.position
    FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id
    JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
    WHERE ps.playlist_id = ? ORDER BY ps.position ASC
  `).all(p.id);
  res.json({ ...p, songs });
});

router.post('/playlists', authMiddleware, (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const info = db.prepare('INSERT INTO playlists (name, description, user_id) VALUES (?,?,?)')
    .run(name, description || null, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/playlists/:id', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  const b = req.body || {};
  db.prepare('UPDATE playlists SET name=?, description=? WHERE id=?')
    .run(b.name || p.name, b.description != null ? b.description : p.description, p.id);
  res.json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(p.id));
});

router.delete('/playlists/:id', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

router.post('/playlists/:id/songs', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  const { song_id } = req.body || {};
  if (!song_id) return res.status(400).json({ error: 'song_id required' });
  const max = db.prepare('SELECT COALESCE(MAX(position), -1) m FROM playlist_songs WHERE playlist_id = ?').get(p.id).m;
  db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position) VALUES (?,?,?)').run(p.id, song_id, max + 1);
  res.json({ ok: true });
});

router.delete('/playlists/:id/songs/:songId', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?').run(req.params.id, req.params.songId);
  res.json({ ok: true });
});

export default router;
