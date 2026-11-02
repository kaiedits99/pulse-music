#!/usr/bin/env node
// Operator-only admin provisioning. This script is deliberately not exposed over HTTP.
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const email = String(process.env.PULSE_ADMIN_EMAIL || '').trim().toLowerCase();
const name = String(process.env.PULSE_ADMIN_NAME || '').trim();
const username = String(process.env.PULSE_ADMIN_USERNAME || '').trim();
const password = String(process.env.PULSE_ADMIN_PASSWORD || '');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
  console.error('Set PULSE_ADMIN_EMAIL, PULSE_ADMIN_NAME, and PULSE_ADMIN_USERNAME (3–30 letters, numbers, underscores).');
  process.exit(2);
}
if (Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 72) {
  console.error('PULSE_ADMIN_PASSWORD must be between 12 and 72 UTF-8 bytes.');
  process.exit(2);
}
const dataDir = process.env.PULSE_DATA_DIR ? path.resolve(process.env.PULSE_DATA_DIR) : path.resolve('data');
const dbPath = path.join(dataDir, 'pulse.db');
if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}. Start Pulse once before provisioning an admin.`);
  process.exit(2);
}
const db = new Database(dbPath);
try {
  const existingEmail = db.prepare('SELECT id, role FROM users WHERE LOWER(email) = LOWER(?)').get(email);
  const existingUsername = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  if (existingUsername && existingUsername.id !== existingEmail?.id) {
    throw new Error('That username is already in use. Choose a different PULSE_ADMIN_USERNAME.');
  }
  const hash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();
  if (existingEmail) {
    db.prepare(`UPDATE users SET name = ?, username = ?, password_hash = ?, role = 'admin',
      email_verified_at = ?, auth_version = auth_version + 1 WHERE id = ?`)
      .run(name.slice(0, 80), username, hash, now, existingEmail.id);
  } else {
    db.prepare(`INSERT INTO users (name, username, email, password_hash, role, favorite_genres, email_verified_at, created_at)
      VALUES (?, ?, ?, ?, 'admin', '[]', ?, ?)`)
      .run(name.slice(0, 80), username, email, hash, now, now);
  }
  console.log(`Administrator provisioned for ${email}. No credentials were written to logs.`);
} finally {
  db.close();
}
