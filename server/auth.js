import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword } from './passwords.js';
import db from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'pulse-dev-secret-change-me';
if (!process.env.JWT_SECRET) {
  const msg = '[pulse] JWT_SECRET is not set — using an insecure default that must never be used in production. Set JWT_SECRET to a random 32+ character string.';
  if (String(process.env.NODE_ENV).toLowerCase() === 'production') {
    console.error(msg + ' Refusing to start.');
    // Throw so tests (which set JWT_SECRET) still run, but a real production boot fails fast
    throw new Error('JWT_SECRET is required in production');
  } else {
    console.warn(msg);
  }
}

// Hashing runs on its own thread so a sign-in never freezes the server (see passwords.js).
export { hashPassword, verifyPassword };

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, ver: Number(user.auth_version || 0) }, JWT_SECRET, { expiresIn: '7d' });
}

export function parseGenres(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  if (typeof raw === 'string') {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username || null,
    email: user.email,
    email_verified: Boolean(user.email_verified_at),
    role: user.role,
    avatar_url: user.avatar_url,
    favorite_genres: parseGenres(user.favorite_genres),
    created_at: user.created_at
  };
}

function cookieToken(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)pulse_session=([^;]+)/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function requestToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : cookieToken(req);
}

export function authMiddleware(req, res, next) {
  const token = requestToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user || Number(payload.ver || 0) !== Number(user.auth_version || 0)) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth: attaches user if token present, but doesn't block
export function optionalAuth(req, res, next) {
  const token = requestToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id) || null;
      req.user = user && Number(payload.ver || 0) === Number(user.auth_version || 0) ? user : null;
    } catch { req.user = null; }
  } else {
    req.user = null;
  }
  next();
}
