import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db, { uploadsDir } from './db.js';
import { searchClause } from './search.js';
import { hashPassword, verifyPassword, signToken, publicUser, parseGenres, authMiddleware, optionalAuth } from './auth.js';

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
  // the uploader keeps rights over their upload even when it is attributed
  // to a typed artist profile that isn't their own
  if (song.uploaded_by === req.user.id) return true;
  const artist = artistForUser(req.user.id);
  return artist && artist.id === song.artist_id;
}

function canAccessSong(req, song) {
  if (!song) return false;
  if (song.is_public === 1 || song.is_public === '1' || song.is_public === true) return true;
  return songOwnerIs(req, song);
}

function albumOwnerIs(req, album) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  if (album.uploaded_by === req.user.id) return true;
  const artist = artistForUser(req.user.id);
  return artist && artist.id === album.artist_id;
}

function artistOwnerIs(req, artistId) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  const artist = artistForUser(req.user.id);
  return artist && artist.id === artistId;
}

function normaliseArtistName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Case-insensitive lookup by name; creates the artist profile when new. */
function findOrCreateArtist(name) {
  const clean = normaliseArtistName(name);
  const existing = db.prepare('SELECT * FROM artists WHERE LOWER(name) = LOWER(?) ORDER BY id LIMIT 1').get(clean);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO artists (name) VALUES (?)').run(clean);
  return db.prepare('SELECT * FROM artists WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Resolve the owner of an uploaded song. A typed artist name always wins:
 * it links to an existing profile with the same name (case-insensitive) or
 * creates a brand-new artist, so uploaders are never limited to a fixed list.
 */
function resolveUploadArtist(req, body) {
  const typed = normaliseArtistName(body.artist_name);
  if (typed) return findOrCreateArtist(typed).id;

  let artistId = parseInt(body.artist_id, 10) || null;
  if (!artistId) {
    const own = artistForUser(req.user.id);
    if (own) artistId = own.id;
  }
  if (!artistId) throw httpError(400, 'Artist is required');
  if (!artistOwnerIs(req, artistId)) throw httpError(403, 'You can only upload for your own artist profile');
  return artistId;
}

// ============================== HEALTH ==============================
// Unauthenticated liveness probe used as the Render health check path
// (see render.yaml). It deliberately does no database work: on a host that
// restarts with a wiped filesystem we want "process is up and serving" to be
// distinguishable from "data is ready", and boot-time maintenance should never
// be able to make the instance look dead to the platform.
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), time: new Date().toISOString() });
});

// ============================== AUTH ==============================
router.get('/auth/check-username', (req, res) => {
  const raw = String(req.query.username || '').trim();
  if (!raw) return res.json({ available: false, reason: 'Username cannot be empty' });
  if (raw.length < 3) return res.json({ available: false, reason: 'Username must be at least 3 characters' });
  if (raw.length > 30) return res.json({ available: false, reason: 'Username cannot exceed 30 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(raw)) return res.json({ available: false, reason: 'Only letters, numbers, and underscores allowed' });

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(raw);
  if (existing) {
    return res.json({ available: false, username: raw, reason: 'This username is already taken' });
  }
  res.json({ available: true, username: raw });
});

router.post('/auth/register', (req, res) => {
  const { name, username, email, password, artistName, favoriteGenres } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanUsername = String(username || '').trim();

  if (!cleanName || !cleanEmail || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (!cleanUsername) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (cleanUsername.length < 3 || cleanUsername.length > 30) {
    return res.status(400).json({ error: 'Username must be between 3 and 30 characters' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const emailExists = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail);
  if (emailExists) return res.status(400).json({ error: 'An account with this email already exists' });

  const usernameExists = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername);
  if (usernameExists) return res.status(400).json({ error: 'This username is already taken. Please choose another.' });

  if (!Array.isArray(favoriteGenres) || favoriteGenres.length === 0) {
    return res.status(400).json({ error: 'Please select at least 1 favorite genre' });
  }
  if (favoriteGenres.length > 3) {
    return res.status(400).json({ error: 'You can select at most 3 favorite genres' });
  }

  const validGenres = favoriteGenres.map((g) => String(g).trim()).filter(Boolean);
  const genresJson = JSON.stringify(validGenres);

  const info = db.prepare(
    'INSERT INTO users (name, username, email, password_hash, role, favorite_genres) VALUES (?,?,?,?,?,?)'
  ).run(cleanName, cleanUsername, cleanEmail, hashPassword(password), 'artist', genresJson);
  const userId = info.lastInsertRowid;

  // create artist profile
  const aName = (artistName || cleanName).trim() || cleanName;
  db.prepare('INSERT INTO artists (name, user_id) VALUES (?,?)').run(aName, userId);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

// ---------- Private admin passphrase login ----------
// Admin access is handled here, server-side only. The exact passphrase (typed
// in the email/username field) and passkey (typed in the password field) must
// match letter-for-letter, space-for-space, case-sensitively. These values are
// SECRET — never copy them into client code or docs. Normal signup/login for
// everyone else is completely unaffected: this check only recognizes the
// sentinel passphrase and nothing else can trigger it.
const ADMIN_PASSPHRASE = 'You bill me, I block you';
const ADMIN_PASSKEY = "that's one thing that I hate";

router.post('/auth/login', (req, res) => {
  const { email, identifier, password } = req.body || {};

  // Private admin access — raw, exact comparison BEFORE any trimming or
  // case-folding, so a stray space or different capitalization just fails and
  // falls through to the normal (failing) login path.
  const rawId = String(identifier != null && identifier !== '' ? identifier : (email != null ? email : ''));
  const rawPw = String(password != null ? password : '');
  if (rawId === ADMIN_PASSPHRASE && rawPw === ADMIN_PASSKEY) {
    let admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    if (!admin) {
      // Admin row missing (e.g. wiped users table) — recreate it so the
      // private login keeps working. Password stays the passkey, never stored
      // in plaintext beyond the bcrypt hash.
      const now = new Date().toISOString();
      const info = db.prepare(
        'INSERT INTO users (name, username, email, password_hash, role, avatar_url, favorite_genres, created_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run('Adebayo Cole', 'adebayo', 'admin@pulse.app', hashPassword(ADMIN_PASSKEY), 'admin', null, JSON.stringify(['Indie', 'Alternative Rock', 'Pop']), now);
      admin = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    return res.json({ token: signToken(admin), user: publicUser(admin) });
  }

  const queryId = String(identifier || email || '').trim();
  if (!queryId || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  // Support login via email or username
  let user = null;
  if (queryId.includes('@')) {
    user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(queryId);
  } else {
    user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(queryId);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(queryId);
    }
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username/email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

// ---------- Google sign-in (ID token / "credential" flow) ----------
// The browser obtains a Google-signed ID token via Google Identity Services and
// POSTs it here. We verify it with Google's tokeninfo endpoint, check the
// audience matches our client ID, then find-or-create the user and return the
// SAME { token, user } shape as POST /auth/login. No OAuth client secret is
// involved. Configure with the PUBLIC client ID env var:
//   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

// Lets the client decide whether to show the "Continue with Google" button
// (also covers the Android app, which can't read a build-time VITE_ var).
router.get('/auth/google/status', (req, res) => {
  res.json({ enabled: Boolean(GOOGLE_CLIENT_ID), clientId: GOOGLE_CLIENT_ID || null });
});

router.post('/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server' });
  }
  const credential = String((req.body || {}).credential || '');
  if (!credential) return res.status(400).json({ error: 'Google credential is required' });

  // Verify the ID token with Google itself (no client secret needed).
  // https://developers.google.com/identity/sign-in/web/backend-auth
  let payload;
  try {
    const r = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!r.ok) return res.status(401).json({ error: 'Invalid or expired Google credential' });
    payload = await r.json();
  } catch {
    return res.status(502).json({ error: 'Could not verify Google credential right now' });
  }
  const issuerOk = payload.iss === 'accounts.google.com' || payload.iss === 'https://accounts.google.com';
  if (!issuerOk || payload.aud !== GOOGLE_CLIENT_ID) {
    return res.status(401).json({ error: 'Google credential was not issued for this app' });
  }
  if (payload.exp && Number(payload.exp) * 1000 < Date.now()) {
    return res.status(401).json({ error: 'Google credential has expired' });
  }
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  const email = String(payload.email || '').trim().toLowerCase();
  if (!verified || !email || email.includes('@placeholder')) {
    return res.status(401).json({ error: 'Google account email is not verified' });
  }

  // Sign in existing users by email; otherwise create the account on the fly
  // (same shape as /auth/register: artist role + auto-created artist profile).
  // Passwordless Google-only accounts get a random hash so they can never be
  // signed into via the password form.
  let user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
  if (!user) {
    const now = new Date().toISOString();
    const cleanName = String(payload.name || email.split('@')[0]).trim().slice(0, 60) || 'New Artist';
    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || 'artist';
    let username = base;
    const taken = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
    for (let i = 2; taken.get(username); i++) username = `${base.slice(0, 24)}_${i}`;
    const info = db.prepare(
      'INSERT INTO users (name, username, email, password_hash, role, avatar_url, favorite_genres, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(cleanName, username, email, hashPassword(crypto.randomBytes(32).toString('hex')), 'artist', String(payload.picture || '') || null, '[]', now);
    const userId = info.lastInsertRowid;
    db.prepare('INSERT INTO artists (name, user_id, created_at) VALUES (?,?,?)').run(cleanName, userId, now);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.put('/auth/preferences', authMiddleware, (req, res) => {
  const { favoriteGenres, username } = req.body || {};
  const user = req.user;

  if (username !== undefined) {
    const cleanUsername = String(username).trim();
    if (cleanUsername.length < 3 || cleanUsername.length > 30 || !/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username must be 3-30 characters with letters, numbers, and underscores only' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(cleanUsername, user.id);
    if (taken) return res.status(400).json({ error: 'This username is already taken' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(cleanUsername, user.id);
  }

  if (favoriteGenres !== undefined) {
    if (!Array.isArray(favoriteGenres) || favoriteGenres.length === 0) {
      return res.status(400).json({ error: 'Please select at least 1 favorite genre' });
    }
    if (favoriteGenres.length > 3) {
      return res.status(400).json({ error: 'You can select at most 3 favorite genres' });
    }
    const valid = favoriteGenres.map((g) => String(g).trim()).filter(Boolean);
    db.prepare('UPDATE users SET favorite_genres = ? WHERE id = ?').run(JSON.stringify(valid), user.id);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ user: publicUser(updated) });
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const artist = artistForUser(req.user.id);
  res.json({ user: publicUser(req.user), artist });
});

// ============================== STATS & RECOMMENDATIONS ==============================
router.get('/stats', optionalAuth, (req, res) => {
  const own = req.user ? artistForUser(req.user.id) : null;
  const ownArtistId = own ? own.id : -1;

  let songVisibilityWhere = 'WHERE s.is_public = 1';
  let songCountWhere = 'WHERE is_public = 1';
  const songParams = [];
  const countParams = [];

  if (req.user) {
    if (req.user.role === 'admin') {
      songVisibilityWhere = '';
      songCountWhere = '';
    } else {
      songVisibilityWhere = 'WHERE (s.is_public = 1 OR s.uploaded_by = ? OR s.artist_id = ?)';
      songParams.push(req.user.id, ownArtistId);
      songCountWhere = 'WHERE (is_public = 1 OR uploaded_by = ? OR artist_id = ?)';
      countParams.push(req.user.id, ownArtistId);
    }
  }

  const songs = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(plays),0) plays, COALESCE(SUM(downloads),0) downloads FROM songs ${songCountWhere}`).get(...countParams);
  // Artists that actually have music the caller can see (profiles are created at sign-up).
  const artists = db.prepare(`SELECT COUNT(DISTINCT artist_id) c FROM songs ${songCountWhere}`).get(...countParams).c;
  const albums = db.prepare('SELECT COUNT(*) c FROM albums').get().c;
  const playlists = db.prepare('SELECT COUNT(*) c FROM playlists').get().c;
  const podcasts = db.prepare('SELECT COUNT(*) c FROM podcasts').get().c;
  const episodes = db.prepare('SELECT COUNT(*) c FROM episodes').get().c;

  const top = db.prepare(
    `SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover
     FROM songs s JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
     ${songVisibilityWhere}
     ORDER BY s.plays DESC LIMIT 6`
  ).all(...songParams);

  const recent = db.prepare(
    `SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover
     FROM songs s JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
     ${songVisibilityWhere}
     ORDER BY s.created_at DESC, s.id DESC LIMIT 8`
  ).all(...songParams);

  // Recent public uploads (published for everyone)
  const communityUploads = db.prepare(
    `SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover, u.name uploader_name, u.username uploader_username
     FROM songs s
     JOIN artists a ON a.id = s.artist_id
     LEFT JOIN albums al ON al.id = s.album_id
     LEFT JOIN users u ON u.id = s.uploaded_by
     WHERE s.is_public = 1 AND (s.uploaded_by IS NOT NULL OR s.file_path LIKE '/media/uploads/%')
     ORDER BY s.created_at DESC, s.id DESC LIMIT 10`
  ).all();

  // Current user's own uploads (both public and private)
  let myUploads = [];
  if (req.user) {
    myUploads = db.prepare(
      `SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover
       FROM songs s
       JOIN artists a ON a.id = s.artist_id
       LEFT JOIN albums al ON al.id = s.album_id
       WHERE (s.uploaded_by = ? OR s.artist_id = ?)
       ORDER BY s.created_at DESC, s.id DESC LIMIT 10`
    ).all(req.user.id, ownArtistId);
  }

  const genreRows = db.prepare(
    `SELECT genre, COUNT(*) c FROM songs ${songCountWhere ? songCountWhere + ' AND genre IS NOT NULL' : 'WHERE genre IS NOT NULL'} GROUP BY genre ORDER BY c DESC`
  ).all(...countParams);

  let favs = new Set();
  if (req.user) {
    const f = db.prepare('SELECT song_id FROM favorites WHERE user_id = ?').all(req.user.id);
    favs = new Set(f.map(r => r.song_id));
  }
  const topWithFav = top.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 }));
  const recentWithFav = recent.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 }));
  const communityWithFav = communityUploads.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 }));
  const myWithFav = myUploads.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 }));

  const userGenres = req.user && req.user.favorite_genres ? parseGenres(req.user.favorite_genres) : [];
  let recommended = [];

  if (userGenres.length > 0) {
    const conditions = [];
    for (const g of userGenres) {
      const gl = g.toLowerCase();
      if (gl === 'pop') conditions.push("s.genre LIKE '%Pop%'");
      else if (gl === 'indie') conditions.push("s.genre LIKE '%Indie%'");
      else if (gl === 'alternative rock' || gl === 'alt rock') conditions.push("(s.genre LIKE '%Alt%' OR s.genre LIKE '%Alternative%')");
      else if (gl === 'rock') conditions.push("(s.genre LIKE '%Rock%')");
      else if (gl === 'kpop' || gl === 'k-pop') conditions.push("(s.genre LIKE '%K-Pop%' OR s.genre LIKE '%Kpop%')");
      else if (gl === 'edm') conditions.push("(s.genre LIKE '%EDM%' OR s.genre LIKE '%Dance%' OR s.genre LIKE '%Synthpop%' OR s.genre LIKE '%Electronic%')");
      else conditions.push("(s.genre NOT LIKE '%Pop%' AND s.genre NOT LIKE '%Rock%')");
    }
    const genreFilter = conditions.length ? '(' + conditions.join(' OR ') + ')' : '1=1';
    const recWhere = songVisibilityWhere ? `${songVisibilityWhere} AND ${genreFilter}` : `WHERE ${genreFilter}`;
    recommended = db.prepare(`
      SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover
      FROM songs s
      JOIN artists a ON a.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      ${recWhere}
      ORDER BY s.plays DESC, s.created_at DESC
      LIMIT 10
    `).all(...songParams);
  }

  // Fallback if not enough matching tracks
  if (recommended.length < 4) {
    const existing = new Set(recommended.map(s => s.id));
    const popular = db.prepare(`
      SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover
      FROM songs s
      JOIN artists a ON a.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      ${songVisibilityWhere}
      ORDER BY s.plays DESC LIMIT 8
    `).all(...songParams);
    for (const p of popular) {
      if (!existing.has(p.id) && recommended.length < 8) {
        recommended.push(p);
        existing.add(p.id);
      }
    }
  }
  const recWithFav = recommended.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 }));

  res.json({
    songs: songs.c, plays: songs.plays, downloads: songs.downloads,
    artists, albums, playlists, podcasts, episodes,
    top: topWithFav, recent: recentWithFav,
    community_uploads: communityWithFav, my_uploads: myWithFav,
    recommended: recWithFav, user_genres: userGenres, genres: genreRows
  });
});

router.get('/songs/recommended', optionalAuth, (req, res) => {
  const user = req.user;
  const genres = (user && user.favorite_genres) ? parseGenres(user.favorite_genres) : [];
  const own = user ? artistForUser(user.id) : null;
  const ownArtistId = own ? own.id : -1;

  let songVisibilityWhere = 'WHERE s.is_public = 1';
  const songParams = [];
  if (user) {
    if (user.role === 'admin') {
      songVisibilityWhere = '';
    } else {
      songVisibilityWhere = 'WHERE (s.is_public = 1 OR s.uploaded_by = ? OR s.artist_id = ?)';
      songParams.push(user.id, ownArtistId);
    }
  }

  let favs = new Set();
  if (user) {
    const f = db.prepare('SELECT song_id FROM favorites WHERE user_id = ?').all(user.id);
    favs = new Set(f.map(r => r.song_id));
  }

  let songs = [];
  if (genres.length > 0) {
    const conditions = [];
    for (const g of genres) {
      const gl = g.toLowerCase();
      if (gl === 'pop') conditions.push("s.genre LIKE '%Pop%'");
      else if (gl === 'indie') conditions.push("s.genre LIKE '%Indie%'");
      else if (gl === 'alternative rock' || gl === 'alt rock') conditions.push("(s.genre LIKE '%Alt%' OR s.genre LIKE '%Alternative%')");
      else if (gl === 'rock') conditions.push("(s.genre LIKE '%Rock%')");
      else if (gl === 'kpop' || gl === 'k-pop') conditions.push("(s.genre LIKE '%K-Pop%' OR s.genre LIKE '%Kpop%')");
      else if (gl === 'edm') conditions.push("(s.genre LIKE '%EDM%' OR s.genre LIKE '%Dance%' OR s.genre LIKE '%Synthpop%' OR s.genre LIKE '%Electronic%')");
      else conditions.push("(s.genre NOT LIKE '%Pop%' AND s.genre NOT LIKE '%Rock%')");
    }
    const genreFilter = conditions.length ? '(' + conditions.join(' OR ') + ')' : '1=1';
    const where = songVisibilityWhere ? `${songVisibilityWhere} AND ${genreFilter}` : `WHERE ${genreFilter}`;
    songs = db.prepare(`
      SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover
      FROM songs s
      JOIN artists a ON a.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      ${where}
      ORDER BY s.plays DESC, s.created_at DESC
      LIMIT 20
    `).all(...songParams);
  }

  if (songs.length < 5) {
    const existingIds = new Set(songs.map(s => s.id));
    const fallback = db.prepare(`
      SELECT s.*, a.name artist_name, al.title album_title, al.cover_url album_cover
      FROM songs s
      JOIN artists a ON a.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      ${songVisibilityWhere}
      ORDER BY s.plays DESC, s.created_at DESC
      LIMIT 15
    `).all(...songParams);
    for (const s of fallback) {
      if (!existingIds.has(s.id) && songs.length < 15) {
        songs.push(s);
        existingIds.add(s.id);
      }
    }
  }

  res.json({
    recommendations: songs.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 })),
    count: songs.length,
    user_genres: genres
  });
});

// ============================== SONGS ==============================
router.get('/songs', optionalAuth, (req, res) => {
  const { q, artist_id, album_id, genre, sort, visibility } = req.query;
  const where = [];
  const params = [];

  const own = req.user ? artistForUser(req.user.id) : null;
  const ownArtistId = own ? own.id : -1;

  if (req.query.mine === '1') {
    if (!req.user) {
      return res.json([]);
    }
    where.push('(s.uploaded_by = ? OR s.artist_id = ?)');
    params.push(req.user.id, ownArtistId);
    if (visibility === 'public' || req.query.public === '1') {
      where.push('s.is_public = 1');
    } else if (visibility === 'private' || req.query.private === '1') {
      where.push('s.is_public = 0');
    }
  } else {
    if (visibility === 'public' || req.query.public === '1') {
      where.push('s.is_public = 1');
    } else if (visibility === 'private' || req.query.private === '1') {
      if (!req.user) {
        return res.json([]);
      }
      where.push('s.is_public = 0');
      if (req.user.role !== 'admin') {
        where.push('(s.uploaded_by = ? OR s.artist_id = ?)');
        params.push(req.user.id, ownArtistId);
      }
    } else {
      if (!req.user) {
        where.push('s.is_public = 1');
      } else if (req.user.role !== 'admin') {
        where.push('(s.is_public = 1 OR s.uploaded_by = ? OR s.artist_id = ?)');
        params.push(req.user.id, ownArtistId);
      }
    }
  }

  if (req.query.uploaded === '1') {
    where.push('(s.uploaded_by IS NOT NULL OR s.file_path LIKE \'/media/uploads/%\')');
  }

  // Free-text search: every word must match the track title, the artist or the genre.
  const search = searchClause(['s.title', 'a.name', 's.genre'], q);
  if (search.sql) { where.push(search.sql); params.push(...search.params); }
  if (artist_id) { where.push('s.artist_id = ?'); params.push(artist_id); }
  if (album_id) { where.push('s.album_id = ?'); params.push(album_id); }
  if (genre) { where.push('s.genre = ?'); params.push(genre); }

  // created_at only has one-second resolution (a bulk import shares it), so every
  // order falls back to the id to keep "newest first" truly newest first.
  let order = 's.created_at DESC';
  if (sort === 'plays') order = 's.plays DESC, s.created_at DESC';
  if (sort === 'downloads') order = 's.downloads DESC, s.created_at DESC';
  if (sort === 'title') order = 's.title ASC';
  order += ', s.id DESC';

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
  if (!s || !canAccessSong(req, s)) return res.status(404).json({ error: 'Song not found' });
  let isFavorite = 0;
  if (req.user) {
    const fav = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND song_id = ?').get(req.user.id, s.id);
    isFavorite = fav ? 1 : 0;
  }
  res.json({ ...s, is_favorite: isFavorite });
});

// Bulk import is intentionally limited to ten files per request. Audio stays in Pulse storage;
// only upload music you own or are authorized to make available.
router.post('/songs/import', authMiddleware, upload.array('audio', 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Choose at least one audio file' });
  const artistId = resolveUploadArtist(req, req.body);
  const albumId = req.body.album_id ? parseInt(req.body.album_id, 10) : null;
  const genre = (req.body.genre || '').trim() || null;

  let defaultIsPublic = 1;
  if (req.body.is_public !== undefined) {
    const val = String(req.body.is_public).toLowerCase();
    defaultIsPublic = (val === '0' || val === 'false' || val === 'private') ? 0 : 1;
  }

  let metadata = [];
  try {
    metadata = req.body.metadata ? JSON.parse(req.body.metadata) : [];
    if (!Array.isArray(metadata)) throw new Error('Metadata must be a list');
  } catch {
    return res.status(400).json({ error: 'Track metadata is invalid' });
  }
  const insert = db.prepare(`INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path, uploaded_by, is_public)
    VALUES (?,?,?,?,?,?,?,?)`);
  const getSong = db.prepare(`SELECT s.*, a.name artist_name, al.title album_title FROM songs s
    JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id WHERE s.id = ?`);
  const imported = db.transaction(() => files.map((file, index) => {
    const meta = metadata[index] || {};
    const fallbackTitle = path.basename(file.originalname, path.extname(file.originalname)).replace(/[-_]+/g, ' ').trim();
    const title = String(meta.title || fallbackTitle || 'Untitled track').trim().slice(0, 250) || 'Untitled track';
    const trackGenre = String(meta.genre || genre || '').trim().slice(0, 100) || null;
    let trackIsPublic = defaultIsPublic;
    if (meta.is_public !== undefined) {
      const v = String(meta.is_public).toLowerCase();
      trackIsPublic = (v === '0' || v === 'false' || v === 'private') ? 0 : 1;
    }
    const duration = wavDuration(file.path) || 0;
    const id = insert.run(title, artistId, albumId, trackGenre, duration, '/media/uploads/' + file.filename, req.user.id, trackIsPublic).lastInsertRowid;
    return getSong.get(id);
  }))();
  res.status(201).json({ imported, count: imported.length });
});

router.post('/songs', authMiddleware, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  const body = req.body;
  const title = (body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });

  // resolve artist — a typed name can be brand-new or belong to another profile
  const artistId = resolveUploadArtist(req, body);

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
  else if (albumId) {
    const own = db.prepare('SELECT cover_url FROM albums WHERE id = ?').get(albumId);
    coverUrl = (own && own.cover_url) || null;
  }

  let isPublic = 1;
  if (body.is_public !== undefined) {
    const val = String(body.is_public).toLowerCase();
    isPublic = (val === '0' || val === 'false' || val === 'private') ? 0 : 1;
  }

  const info = db.prepare(
    `INSERT INTO songs (title, artist_id, album_id, genre, duration_seconds, file_path, source_url, cover_url, uploaded_by, is_public)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(title, artistId, albumId, body.genre || null, duration, filePath, sourceUrl, coverUrl, req.user.id, isPublic);

  const s = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title
    FROM songs s JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id WHERE s.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(s);
});

router.patch('/songs/:id/visibility', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Song not found' });
  if (!songOwnerIs(req, existing)) return res.status(403).json({ error: 'Not allowed' });

  let isPublic;
  if (req.body && req.body.is_public !== undefined) {
    const val = String(req.body.is_public).toLowerCase();
    isPublic = (val === '0' || val === 'false' || val === 'private') ? 0 : 1;
  } else {
    isPublic = existing.is_public ? 0 : 1;
  }

  db.prepare('UPDATE songs SET is_public = ? WHERE id = ?').run(isPublic, existing.id);
  const updated = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title
    FROM songs s JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id WHERE s.id = ?
  `).get(existing.id);
  res.json(updated);
});

router.put('/songs/:id', authMiddleware, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  const existing = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Song not found' });
  if (!songOwnerIs(req, existing)) return res.status(403).json({ error: 'Not allowed' });

  const body = req.body;
  const title = body.title != null ? (body.title || '').trim() : existing.title;
  let artistId;
  const typedArtist = normaliseArtistName(body.artist_name);
  if (typedArtist) {
    // re-typing the owner links to the existing profile or creates a new one
    artistId = findOrCreateArtist(typedArtist).id;
  } else if (body.artist_id) {
    // explicitly changing the attributed artist requires owning that profile
    artistId = parseInt(body.artist_id, 10) || existing.artist_id;
    if (!artistOwnerIs(req, artistId)) return res.status(403).json({ error: 'Not allowed' });
  } else {
    // artist untouched - keep the attributed profile
    artistId = existing.artist_id;
  }

  const albumId = body.album_id !== undefined ? (body.album_id ? parseInt(body.album_id, 10) : null) : existing.album_id;
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

  let isPublic = existing.is_public ?? 1;
  if (body.is_public !== undefined) {
    const val = String(body.is_public).toLowerCase();
    isPublic = (val === '0' || val === 'false' || val === 'private') ? 0 : 1;
  }

  db.prepare(
    `UPDATE songs SET title=?, artist_id=?, album_id=?, genre=?, duration_seconds=?, file_path=?, source_url=?, cover_url=?, is_public=? WHERE id=?`
  ).run(title, artistId, albumId, body.genre !== undefined ? (body.genre || null) : existing.genre, duration, filePath, sourceUrl, coverUrl, isPublic, existing.id);

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

router.get('/songs/:id/download', optionalAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!s || !s.file_path) return res.status(404).json({ error: 'No audio available' });
  if (!canAccessSong(req, s)) return res.status(404).json({ error: 'No audio available' });
  db.prepare('UPDATE songs SET downloads = downloads + 1 WHERE id = ?').run(s.id);
  const rel = s.file_path.replace('/media/', '');
  const abs = path.join(uploadsDir, '..', rel);
  const safe = path.basename(s.file_path);
  res.download(abs, safe);
});

// ============================== FAVORITES ==============================
router.get('/favorites', authMiddleware, (req, res) => {
  const own = artistForUser(req.user.id);
  const ownArtistId = own ? own.id : -1;
  const where = req.user.role === 'admin'
    ? 'WHERE f.user_id = ?'
    : 'WHERE f.user_id = ? AND (s.is_public = 1 OR s.uploaded_by = ? OR s.artist_id = ?)';
  const params = req.user.role === 'admin' ? [req.user.id] : [req.user.id, req.user.id, ownArtistId];

  const rows = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title
    FROM favorites f JOIN songs s ON s.id = f.song_id
    JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
    ${where} ORDER BY f.created_at DESC
  `).all(...params);
  res.json(rows.map(r => ({ ...r, is_favorite: 1 })));
});

// A route id must be a plain positive integer ("12"), never "12abc", "1e3" or "-4".
const parseSongId = (raw) => (/^[1-9]\d{0,14}$/.test(String(raw)) ? Number(raw) : null);

// Liking is idempotent. A song can only be liked by someone who is allowed to see it, and the
// answer for "does not exist" and "not yours to see" is the same 404, so ids can't be probed.
router.post('/favorites/:songId', authMiddleware, (req, res) => {
  const songId = parseSongId(req.params.songId);
  if (!songId) return res.status(400).json({ error: 'Invalid song id' });
  const song = db.prepare('SELECT id, is_public, uploaded_by, artist_id FROM songs WHERE id = ?').get(songId);
  if (!canAccessSong(req, song)) return res.status(404).json({ error: 'Song not found' });
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, song_id) VALUES (?,?)').run(req.user.id, song.id);
  res.json({ is_favorite: 1 });
});

// Un-liking only ever touches the caller's own row, so it needs no visibility check
// (and still works for a track that has since been made private or deleted).
router.delete('/favorites/:songId', authMiddleware, (req, res) => {
  const songId = parseSongId(req.params.songId);
  if (!songId) return res.status(400).json({ error: 'Invalid song id' });
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND song_id = ?').run(req.user.id, songId);
  res.json({ is_favorite: 0 });
});

// ============================== ALBUMS ==============================
router.get('/albums', optionalAuth, (req, res) => {
  const { q, artist_id } = req.query;
  const where = [];
  const params = [];

  const own = req.user ? artistForUser(req.user.id) : null;
  const ownArtistId = own ? own.id : -1;

  const search = searchClause(['al.title', 'a.name', 'al.genre'], q);
  if (search.sql) { where.push(search.sql); params.push(...search.params); }
  if (artist_id) { where.push('al.artist_id = ?'); params.push(artist_id); }

  let countWhere = 'WHERE s.album_id = al.id AND s.is_public = 1';
  let countParams = [];
  if (req.user) {
    if (req.user.role === 'admin') {
      countWhere = 'WHERE s.album_id = al.id';
    } else {
      countWhere = 'WHERE s.album_id = al.id AND (s.is_public = 1 OR s.uploaded_by = ? OR s.artist_id = ? OR al.uploaded_by = ?)';
      countParams = [req.user.id, ownArtistId, req.user.id];
    }
  }

  const rows = db.prepare(`
    SELECT al.*, a.name artist_name, (SELECT COUNT(*) FROM songs s ${countWhere}) track_count
    FROM albums al JOIN artists a ON a.id = al.artist_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY al.release_year DESC, al.title ASC
  `).all(...countParams, ...params);
  res.json(rows);
});

router.get('/albums/:id', optionalAuth, (req, res) => {
  const al = db.prepare(`
    SELECT al.*, a.name artist_name FROM albums al JOIN artists a ON a.id = al.artist_id WHERE al.id = ?
  `).get(req.params.id);
  if (!al) return res.status(404).json({ error: 'Album not found' });

  let where = 's.album_id = ? AND s.is_public = 1';
  const params = [al.id];
  if (req.user) {
    if (req.user.role === 'admin') {
      where = 's.album_id = ?';
    } else {
      const own = artistForUser(req.user.id);
      const ownArtistId = own ? own.id : -1;
      where = 's.album_id = ? AND (s.is_public = 1 OR s.uploaded_by = ? OR s.artist_id = ? OR al.uploaded_by = ?)';
      params.push(req.user.id, ownArtistId, req.user.id);
    }
  }

  const songs = db.prepare(`
    SELECT s.*, a.name artist_name, al2.title album_title FROM songs s
    JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al2 ON al2.id = s.album_id
    WHERE ${where} ORDER BY s.created_at ASC
  `).all(...params);

  let favs = new Set();
  if (req.user) {
    const f = db.prepare('SELECT song_id FROM favorites WHERE user_id = ?').all(req.user.id);
    favs = new Set(f.map(r => r.song_id));
  }

  res.json({ ...al, songs: songs.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 })) });
});

router.post('/albums', authMiddleware, (req, res) => {
  const { title, release_year, genre } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required' });
  // typed artist name wins: links to an existing profile or creates a new one
  const aId = resolveUploadArtist(req, req.body || {});
  const info = db.prepare('INSERT INTO albums (title, artist_id, release_year, genre, uploaded_by) VALUES (?,?,?,?,?)')
    .run(title, aId, release_year || new Date().getFullYear(), genre || null, req.user.id);
  const al = db.prepare('SELECT * FROM albums WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(al);
});

router.put('/albums/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Album not found' });
  if (!albumOwnerIs(req, existing)) return res.status(403).json({ error: 'Not allowed' });
  const b = req.body || {};
  let artistId = existing.artist_id;
  const typedArtist = normaliseArtistName(b.artist_name);
  if (typedArtist) artistId = findOrCreateArtist(typedArtist).id;
  else if (b.artist_id) artistId = parseInt(b.artist_id, 10) || existing.artist_id;
  db.prepare('UPDATE albums SET title=?, artist_id=?, release_year=?, genre=? WHERE id=?')
    .run(b.title || existing.title, artistId, b.release_year || existing.release_year, b.genre || existing.genre, existing.id);
  res.json(db.prepare('SELECT * FROM albums WHERE id = ?').get(existing.id));
});

router.delete('/albums/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Album not found' });
  if (!albumOwnerIs(req, existing)) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM albums WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

// ============================== ARTISTS ==============================
router.get('/artists', optionalAuth, (req, res) => {
  const { q } = req.query;
  const search = searchClause(['a.name', 'a.genre'], q);
  const where = search.sql ? `WHERE ${search.sql}` : '';
  const params = search.params;

  const own = req.user ? artistForUser(req.user.id) : null;
  const ownArtistId = own ? own.id : -1;

  let songCountWhere = 'WHERE s.artist_id = a.id AND s.is_public = 1';
  let songCountParams = [];
  if (req.user) {
    if (req.user.role === 'admin') {
      songCountWhere = 'WHERE s.artist_id = a.id';
    } else {
      songCountWhere = 'WHERE s.artist_id = a.id AND (s.is_public = 1 OR s.uploaded_by = ? OR a.user_id = ?)';
      songCountParams = [req.user.id, req.user.id];
    }
  }

  // song_count only counts tracks the caller may see, so clients can tell a profile that has
  // music (worth listing on browse pages) from one that was only created at sign-up.
  const rows = db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM songs s ${songCountWhere}) song_count,
           (SELECT COUNT(*) FROM albums al WHERE al.artist_id = a.id) album_count
    FROM artists a ${where} ORDER BY a.followers DESC, song_count DESC, a.id ASC
  `).all(...songCountParams, ...params);
  res.json(rows);
});

router.get('/artists/:id', optionalAuth, (req, res) => {
  const own = req.user ? artistForUser(req.user.id) : null;
  const ownArtistId = own ? own.id : -1;

  let songCountWhere = 'WHERE s.artist_id = a.id AND s.is_public = 1';
  let songCountParams = [];
  if (req.user) {
    if (req.user.role === 'admin') {
      songCountWhere = 'WHERE s.artist_id = a.id';
    } else {
      songCountWhere = 'WHERE s.artist_id = a.id AND (s.is_public = 1 OR s.uploaded_by = ? OR a.user_id = ?)';
      songCountParams = [req.user.id, req.user.id];
    }
  }

  const a = db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM songs s ${songCountWhere}) song_count
    FROM artists a WHERE a.id = ?
  `).get(...songCountParams, req.params.id);
  if (!a) return res.status(404).json({ error: 'Artist not found' });

  let where = 's.artist_id = ? AND s.is_public = 1';
  const params = [a.id];
  if (req.user) {
    if (req.user.role === 'admin') {
      where = 's.artist_id = ?';
    } else {
      where = 's.artist_id = ? AND (s.is_public = 1 OR s.uploaded_by = ? OR s.artist_id = ? OR a.user_id = ?)';
      params.push(req.user.id, ownArtistId, req.user.id);
    }
  }

  const songs = db.prepare(`
    SELECT s.*, a2.name artist_name, al.title album_title FROM songs s
    JOIN artists a2 ON a2.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
    WHERE ${where} ORDER BY s.plays DESC
  `).all(...params);

  let favs = new Set();
  if (req.user) {
    const f = db.prepare('SELECT song_id FROM favorites WHERE user_id = ?').all(req.user.id);
    favs = new Set(f.map(r => r.song_id));
  }

  const albums = db.prepare('SELECT * FROM albums WHERE artist_id = ? ORDER BY release_year DESC').all(a.id);
  res.json({ ...a, songs: songs.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 })), albums });
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
  const mine = req.query.mine === '1';
  const rows = db.prepare(`
    SELECT p.*, u.name creator_name,
      (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) track_count
    FROM playlists p LEFT JOIN users u ON u.id = p.user_id
    ${mine ? 'WHERE p.user_id = ?' : ''}
    ORDER BY p.created_at DESC
  `).all(...(mine ? [req.user.id] : []));
  if (req.query.with_songs === '1') {
    const ids = db.prepare('SELECT playlist_id, song_id FROM playlist_songs');
    const map = new Map(rows.map((r) => [r.id, []]));
    for (const r of ids.all()) if (map.has(r.playlist_id)) map.get(r.playlist_id).push(r.song_id);
    return res.json(rows.map((r) => ({ ...r, song_ids: map.get(r.id) || [] })));
  }
  res.json(rows);
});

// Playlists are personal spaces (like Spotify): only the creator or an admin
// may edit, delete, or change their contents. Viewing stays open to all users.
function canManagePlaylist(req, playlist) {
  return req.user.role === 'admin' || playlist.user_id === req.user.id;
}

router.get('/playlists/:id', optionalAuth, (req, res) => {
  const p = db.prepare('SELECT p.*, u.name creator_name FROM playlists p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });

  let where = 'ps.playlist_id = ? AND s.is_public = 1';
  const params = [p.id];
  if (req.user) {
    if (req.user.role === 'admin') {
      where = 'ps.playlist_id = ?';
    } else {
      const own = artistForUser(req.user.id);
      const ownArtistId = own ? own.id : -1;
      where = 'ps.playlist_id = ? AND (s.is_public = 1 OR s.uploaded_by = ? OR s.artist_id = ? OR p.user_id = ?)';
      params.push(req.user.id, ownArtistId, req.user.id);
    }
  }

  const songs = db.prepare(`
    SELECT s.*, a.name artist_name, al.title album_title, ps.position
    FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id
    JOIN artists a ON a.id = s.artist_id LEFT JOIN albums al ON al.id = s.album_id
    WHERE ${where} ORDER BY ps.position ASC
  `).all(...params);

  let favs = new Set();
  if (req.user) {
    const f = db.prepare('SELECT song_id FROM favorites WHERE user_id = ?').all(req.user.id);
    favs = new Set(f.map(r => r.song_id));
  }

  res.json({ ...p, songs: songs.map(r => ({ ...r, is_favorite: favs.has(r.id) ? 1 : 0 })) });
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
  if (!canManagePlaylist(req, p)) return res.status(403).json({ error: 'Only the owner can edit this playlist' });
  const b = req.body || {};
  db.prepare('UPDATE playlists SET name=?, description=? WHERE id=?')
    .run(b.name || p.name, b.description != null ? b.description : p.description, p.id);
  res.json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(p.id));
});

router.delete('/playlists/:id', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  if (!canManagePlaylist(req, p)) return res.status(403).json({ error: 'Only the owner can delete this playlist' });
  db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

router.post('/playlists/:id/songs', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  if (!canManagePlaylist(req, p)) return res.status(403).json({ error: 'Only the owner can add songs to this playlist' });
  const song = db.prepare('SELECT id FROM songs WHERE id = ?').get(req.body?.song_id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  const { song_id } = req.body || {};
  if (!song_id) return res.status(400).json({ error: 'song_id required' });
  const max = db.prepare('SELECT COALESCE(MAX(position), -1) m FROM playlist_songs WHERE playlist_id = ?').get(p.id).m;
  db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position) VALUES (?,?,?)').run(p.id, song_id, max + 1);
  res.json({ ok: true });
});

router.delete('/playlists/:id/songs/:songId', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  if (!canManagePlaylist(req, p)) return res.status(403).json({ error: 'Only the owner can remove songs from this playlist' });
  db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?').run(req.params.id, req.params.songId);
  res.json({ ok: true });
});

// ============================== PODCASTS ==============================
// Shows and episodes are a separate section of the app, not songs: they have a
// publisher, seasons, episode numbers, subscriptions, a save-for-later list and
// per-user resume positions. Everything below is scoped to those tables.

const SHOW_COLUMNS = `
  p.*,
  (SELECT COUNT(*) FROM episodes e WHERE e.podcast_id = p.id) AS episode_count,
  (SELECT MAX(e.published_at) FROM episodes e WHERE e.podcast_id = p.id) AS latest_published_at,
  (SELECT COALESCE(SUM(e.duration_seconds), 0) FROM episodes e WHERE e.podcast_id = p.id) AS total_duration,
  (SELECT COALESCE(SUM(e.plays), 0) FROM episodes e WHERE e.podcast_id = p.id) AS plays,
  (SELECT COUNT(*) FROM podcast_subscriptions s WHERE s.podcast_id = p.id) AS subscribers,
  EXISTS(SELECT 1 FROM podcast_subscriptions s WHERE s.podcast_id = p.id AND s.user_id = @uid) AS subscribed
`;

function shapeShow(row) {
  if (!row) return row;
  return { ...row, subscribed: !!row.subscribed, episode_count: row.episode_count || 0 };
}

function shapeEpisode(row) {
  if (!row) return row;
  return {
    ...row,
    saved: !!row.saved,
    completed: !!row.completed,
    position_seconds: row.position_seconds || 0
  };
}

function canManagePodcast(req, show) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  return show.user_id === req.user.id;
}

const EPISODE_COLUMNS = `
  e.*,
  p.title AS podcast_title,
  p.publisher AS publisher,
  p.category AS category,
  COALESCE(e.cover_url, p.cover_url) AS cover_url,
  EXISTS(SELECT 1 FROM saved_episodes se WHERE se.episode_id = e.id AND se.user_id = @uid) AS saved,
  COALESCE((SELECT ep.position_seconds FROM episode_progress ep WHERE ep.episode_id = e.id AND ep.user_id = @uid), 0) AS position_seconds,
  COALESCE((SELECT ep.completed FROM episode_progress ep WHERE ep.episode_id = e.id AND ep.user_id = @uid), 0) AS completed
`;

// ---------- shows ----------
router.get('/podcasts', optionalAuth, (req, res) => {
  const uid = req.user ? req.user.id : -1;
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  const where = [];
  const params = { uid };
  if (q) {
    where.push('(p.title LIKE @q OR p.publisher LIKE @q OR p.description LIKE @q OR p.category LIKE @q)');
    params.q = `%${q}%`;
  }
  if (category && category.toLowerCase() !== 'all') {
    where.push('LOWER(p.category) = LOWER(@category)');
    params.category = category;
  }
  if (req.query.subscribed === '1' || req.query.subscribed === 'true') {
    where.push('EXISTS(SELECT 1 FROM podcast_subscriptions s WHERE s.podcast_id = p.id AND s.user_id = @uid)');
  }
  if (req.query.mine === '1' && req.user) {
    where.push('p.user_id = @uid');
  }
  const order = {
    title: 'p.title COLLATE NOCASE ASC',
    episodes: 'episode_count DESC, p.title COLLATE NOCASE ASC',
    popular: 'subscribers DESC, plays DESC',
    newest: 'latest_published_at DESC'
  }[req.query.sort] || 'latest_published_at DESC, p.title COLLATE NOCASE ASC';

  const rows = db.prepare(`
    SELECT ${SHOW_COLUMNS} FROM podcasts p
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order}
  `).all(params);

  const categories = db.prepare(
    "SELECT category, COUNT(*) AS count FROM podcasts WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY count DESC, category ASC"
  ).all();

  res.json({ podcasts: rows.map(shapeShow), categories });
});

router.get('/podcasts/:id', optionalAuth, (req, res) => {
  const uid = req.user ? req.user.id : -1;
  const show = db.prepare(`SELECT ${SHOW_COLUMNS} FROM podcasts p WHERE p.id = @id`).get({ uid, id: req.params.id });
  if (!show) return res.status(404).json({ error: 'Podcast not found' });
  const order = req.query.order === 'oldest'
    ? 'e.published_at ASC, e.episode_number ASC'
    : 'e.published_at DESC, e.episode_number DESC';
  const episodes = db.prepare(`
    SELECT ${EPISODE_COLUMNS} FROM episodes e JOIN podcasts p ON p.id = e.podcast_id
    WHERE e.podcast_id = @id ORDER BY ${order}
  `).all({ uid, id: show.id });
  res.json({ ...shapeShow(show), can_manage: canManagePodcast(req, show), episodes: episodes.map(shapeEpisode) });
});

router.post('/podcasts', authMiddleware, upload.fields([{ name: 'cover', maxCount: 1 }]), (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Show title is required' });
  const coverFile = req.files && req.files.cover && req.files.cover[0];
  const info = db.prepare(
    'INSERT INTO podcasts (title, publisher, description, category, cover_url, user_id) VALUES (?,?,?,?,?,?)'
  ).run(
    title.slice(0, 250),
    (req.body.publisher || req.user.username || req.user.name || '').trim().slice(0, 150) || null,
    (req.body.description || '').trim() || null,
    (req.body.category || '').trim() || null,
    coverFile ? '/media/uploads/' + coverFile.filename : null,
    req.user.id
  );
  const show = db.prepare(`SELECT ${SHOW_COLUMNS} FROM podcasts p WHERE p.id = @id`)
    .get({ uid: req.user.id, id: info.lastInsertRowid });
  res.status(201).json(shapeShow(show));
});

router.put('/podcasts/:id', authMiddleware, upload.fields([{ name: 'cover', maxCount: 1 }]), (req, res) => {
  const existing = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Podcast not found' });
  if (!canManagePodcast(req, existing)) return res.status(403).json({ error: 'Not allowed' });
  const coverFile = req.files && req.files.cover && req.files.cover[0];
  const pick = (key, fallback) => (req.body[key] !== undefined ? (req.body[key] || '').trim() || null : fallback);
  db.prepare('UPDATE podcasts SET title=?, publisher=?, description=?, category=?, cover_url=? WHERE id=?').run(
    pick('title', existing.title) || existing.title,
    pick('publisher', existing.publisher),
    pick('description', existing.description),
    pick('category', existing.category),
    coverFile ? '/media/uploads/' + coverFile.filename : existing.cover_url,
    existing.id
  );
  const show = db.prepare(`SELECT ${SHOW_COLUMNS} FROM podcasts p WHERE p.id = @id`).get({ uid: req.user.id, id: existing.id });
  res.json(shapeShow(show));
});

router.delete('/podcasts/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Podcast not found' });
  if (!canManagePodcast(req, existing)) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM podcasts WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

// ---------- subscriptions ----------
router.post('/podcasts/:id/subscribe', authMiddleware, (req, res) => {
  const show = db.prepare('SELECT id FROM podcasts WHERE id = ?').get(req.params.id);
  if (!show) return res.status(404).json({ error: 'Podcast not found' });
  db.prepare('INSERT OR IGNORE INTO podcast_subscriptions (user_id, podcast_id) VALUES (?,?)').run(req.user.id, show.id);
  res.json({ ok: true, subscribed: true });
});

router.delete('/podcasts/:id/subscribe', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM podcast_subscriptions WHERE user_id = ? AND podcast_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true, subscribed: false });
});

// ---------- episodes ----------
router.post('/podcasts/:id/episodes', authMiddleware, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  const show = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(req.params.id);
  if (!show) return res.status(404).json({ error: 'Podcast not found' });
  if (!canManagePodcast(req, show)) return res.status(403).json({ error: 'Not allowed' });
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Episode title is required' });
  const audioFile = req.files && req.files.audio && req.files.audio[0];
  if (!audioFile) return res.status(400).json({ error: 'Choose an audio file for this episode' });
  const coverFile = req.files && req.files.cover && req.files.cover[0];
  const nextNumber = db.prepare('SELECT COALESCE(MAX(episode_number), 0) + 1 AS n FROM episodes WHERE podcast_id = ?').get(show.id).n;
  const duration = wavDuration(audioFile.path) || parseFloat(req.body.duration) || 0;
  const info = db.prepare(`INSERT INTO episodes
      (podcast_id, title, description, episode_number, season, duration_seconds, file_path, cover_url)
      VALUES (?,?,?,?,?,?,?,?)`).run(
    show.id,
    title.slice(0, 250),
    (req.body.description || '').trim() || null,
    parseInt(req.body.episode_number, 10) || nextNumber,
    parseInt(req.body.season, 10) || 1,
    duration,
    '/media/uploads/' + audioFile.filename,
    coverFile ? '/media/uploads/' + coverFile.filename : show.cover_url
  );
  const episode = db.prepare(`SELECT ${EPISODE_COLUMNS} FROM episodes e JOIN podcasts p ON p.id = e.podcast_id WHERE e.id = @id`)
    .get({ uid: req.user.id, id: info.lastInsertRowid });
  res.status(201).json(shapeEpisode(episode));
});

router.get('/episodes', optionalAuth, (req, res) => {
  const uid = req.user ? req.user.id : -1;
  const where = [];
  const params = { uid };
  if (req.query.podcast_id) {
    where.push('e.podcast_id = @podcastId');
    params.podcastId = parseInt(req.query.podcast_id, 10) || 0;
  }
  if (req.query.q) {
    where.push('(e.title LIKE @q OR e.description LIKE @q OR p.title LIKE @q)');
    params.q = `%${String(req.query.q).trim()}%`;
  }
  if (req.query.saved === '1') where.push('EXISTS(SELECT 1 FROM saved_episodes se WHERE se.episode_id = e.id AND se.user_id = @uid)');
  if (req.query.subscribed === '1') where.push('EXISTS(SELECT 1 FROM podcast_subscriptions s WHERE s.podcast_id = e.podcast_id AND s.user_id = @uid)');
  if (req.query.continue === '1') {
    where.push('EXISTS(SELECT 1 FROM episode_progress ep WHERE ep.episode_id = e.id AND ep.user_id = @uid AND ep.completed = 0 AND ep.position_seconds > 2)');
  }
  const order = req.query.sort === 'oldest' ? 'e.published_at ASC' : 'e.published_at DESC';
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
  const rows = db.prepare(`
    SELECT ${EPISODE_COLUMNS} FROM episodes e JOIN podcasts p ON p.id = e.podcast_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order} LIMIT ${limit}
  `).all(params);
  res.json(rows.map(shapeEpisode));
});

router.get('/episodes/:id', optionalAuth, (req, res) => {
  const uid = req.user ? req.user.id : -1;
  const row = db.prepare(`SELECT ${EPISODE_COLUMNS} FROM episodes e JOIN podcasts p ON p.id = e.podcast_id WHERE e.id = @id`)
    .get({ uid, id: req.params.id });
  if (!row) return res.status(404).json({ error: 'Episode not found' });
  res.json(shapeEpisode(row));
});

router.delete('/episodes/:id', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT e.*, p.user_id AS show_owner FROM episodes e JOIN podcasts p ON p.id = e.podcast_id WHERE e.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Episode not found' });
  if (!canManagePodcast(req, { user_id: row.show_owner })) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM episodes WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

router.post('/episodes/:id/play', (req, res) => {
  const info = db.prepare('UPDATE episodes SET plays = plays + 1 WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Episode not found' });
  res.json({ ok: true });
});

router.post('/episodes/:id/save', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Episode not found' });
  db.prepare('INSERT OR IGNORE INTO saved_episodes (user_id, episode_id) VALUES (?,?)').run(req.user.id, row.id);
  res.json({ ok: true, saved: true });
});

router.delete('/episodes/:id/save', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM saved_episodes WHERE user_id = ? AND episode_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true, saved: false });
});

// Resume positions: the player pushes these while an episode is playing.
router.put('/episodes/:id/progress', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Episode not found' });
  const position = Math.max(0, parseFloat(req.body?.position_seconds) || 0);
  const duration = row.duration_seconds || 0;
  const completed = req.body?.completed != null
    ? (req.body.completed ? 1 : 0)
    : (duration > 0 && position >= duration - 3 ? 1 : 0);
  db.prepare(`INSERT INTO episode_progress (user_id, episode_id, position_seconds, completed, updated_at)
    VALUES (?,?,?,?, datetime('now'))
    ON CONFLICT(user_id, episode_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      completed = excluded.completed,
      updated_at = excluded.updated_at`).run(req.user.id, row.id, completed ? 0 : position, completed);
  res.json({ ok: true, position_seconds: completed ? 0 : position, completed: !!completed });
});

router.get('/episodes/:id/download', (req, res) => {
  const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!row || !row.file_path) return res.status(404).json({ error: 'No audio available' });
  db.prepare('UPDATE episodes SET downloads = downloads + 1 WHERE id = ?').run(row.id);
  const rel = row.file_path.replace('/media/', '');
  const abs = path.join(uploadsDir, '..', rel);
  res.download(abs, path.basename(row.file_path));
});

export default router;
