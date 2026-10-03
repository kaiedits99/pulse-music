// The ephemeral store: conversations and messages live in their own SQLite file, apart
// from the music catalogue.
//
// Why separate? Everything in here is designed to be deleted within a day of being read,
// and the file is compacted regularly to give the space back. Keeping that churn away from
// pulse.db means aggressive deletion can never touch accounts, tracks or playlists, and it
// lets the replica for this file keep a much shorter history (see litestream.yml).
//
// Deletion rules that this schema supports:
//   - reads filter on expires_at, so a message is invisible the moment it lapses — even if
//     the cleaner has not run (the app sleeps on a free host; correctness cannot depend on it)
//   - secure_delete is ON, so deleted rows are zeroed rather than left in free pages
//   - every media object is registered in chat_media, so the cleaner can delete the file in
//     the bucket too, and find orphans left by a crash
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.js';

export const chatMediaDir = path.join(dataDir, 'chat-media');
export const chatDbPath = process.env.PULSE_CHAT_DB_PATH || path.join(dataDir, 'chat.db');

for (const dir of [dataDir, chatMediaDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(chatDbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
// Zero freed pages instead of leaving the text of deleted messages in the file.
db.pragma('secure_delete = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'dm',           -- dm | party | channel
  title TEXT,                                 -- parties and channels only
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_read_at TEXT,                          -- where this member's unread count starts
  muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',          -- text | image | voice | track
  body TEXT,
  media_name TEXT,                            -- file in the ephemeral media store
  media_type TEXT,
  media_meta TEXT,                            -- JSON: waveform peaks, duration, size, dimensions
  track_id INTEGER,                           -- a shared Pulse track (played, never copied)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Absolute deadline. Starts at the 30-day cap so an unopened message cannot outlive it;
  -- pulled in to 24 hours after the last member reads it (see markRead).
  expires_at TEXT NOT NULL,
  read_at TEXT,                               -- when the last recipient saw it
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_expiry ON messages(expires_at);

-- Who has seen what. Drives both the "read" ticks and the 24h clock.
CREATE TABLE IF NOT EXISTS message_reads (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- A report takes a copy of the message at the moment it is reported. That copy — not the live
-- row — is what survives the 24-hour wipe, so moderation still has something to act on while
-- the promise to everyone else stays intact.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  subject_user_id INTEGER,
  conversation_id INTEGER,
  message_id INTEGER,
  reason TEXT,
  snapshot TEXT,
  media_name TEXT,
  keep_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every uploaded chat object, so the cleaner can delete the file as well as the row, and can
-- find anything left behind by a crash between "the message was saved" and "the file was stored".
CREATE TABLE IF NOT EXISTS chat_media (
  name TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL,
  message_id INTEGER,                         -- null until the message row that owns it is written
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_media_expiry ON chat_media(expires_at);

-- Notes: the short status line above the conversation list. A note is not addressed to anyone, so
-- it follows one clock only — 24 hours from posting, read or not. Same store, same rules: secure
-- deletion, swept, never cached on a device.
CREATE TABLE IF NOT EXISTS notes (
  user_id INTEGER PRIMARY KEY,
  body TEXT,
  emoji TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_expiry ON notes(expires_at);

-- Listening rooms. This is a *shared queue*, not a live audio stream: it records what a party is
-- playing so each member's own player can follow along. No audio passes through this table.
CREATE TABLE IF NOT EXISTS room_state (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  track_id INTEGER,
  is_playing INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL,
  added_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_queue_conversation ON room_queue(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_room_queue_expiry ON room_queue(expires_at);

-- Who has the thread open right now ("5 online"). Stamped by the ordinary message poll and
-- forgotten after two minutes: presence is a moment, not a history.
CREATE TABLE IF NOT EXISTS presence (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_presence_seen ON presence(seen_at);
`);

// Migrations for installations created before a column existed.
const messageColumns = db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name);
if (!messageColumns.includes('deleted_at')) db.exec('ALTER TABLE messages ADD COLUMN deleted_at TEXT');
const mediaColumns = db.prepare('PRAGMA table_info(chat_media)').all().map((column) => column.name);
if (!mediaColumns.includes('message_id')) db.exec('ALTER TABLE chat_media ADD COLUMN message_id INTEGER');
if (!mediaColumns.includes('removed_at')) db.exec('ALTER TABLE chat_media ADD COLUMN removed_at TEXT');

export default db;
