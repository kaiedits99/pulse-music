// Messaging rules: who may talk to whom, when a message lapses, and what deletes it.
//
// The lifecycle, in one place:
//
//   compose ──► expires_at = now + 30 days      (a message nobody opens cannot outlive the cap)
//      │
//      └─ every other member reads it ──► expires_at = min(expires_at, now + 24 hours)
//
// Every read path filters on `expires_at > now`, so a lapsed message is gone from the app the
// moment it lapses — the cleaner below only reclaims space (the host sleeps; correctness cannot
// depend on a timer firing). Reported messages are the single exception, and even then the copy
// kept is the snapshot taken at report time, not the live row.
import fs from 'node:fs';
import path from 'node:path';
import db from './chat-db.js';
import { chatMediaDir } from './chat-db.js';
import mainDb from './db.js'; // accounts live with the catalogue; only chat tables live in chat.db
import { chatStorage } from './media.js';
import { MEDIA_NAME, contentTypeFor } from './storage.js';

export const TTL_HOURS_AFTER_READ = 24;
export const MAX_AGE_DAYS = 30;
export const REPORT_KEEP_DAYS = 90;
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

/** A message counts as present while it has not lapsed and was not unsent. */
const VISIBLE = "m.deleted_at IS NULL AND m.expires_at > datetime('now')";

const iso = (column) => `strftime('%Y-%m-%dT%H:%M:%SZ', ${column})`;

/* ------------------------------------------------------------------ people ---- */

export function publicProfile(id) {
  const user = mainDb.prepare('SELECT id, name, username, avatar_url FROM users WHERE id = ?').get(id);
  return user || null;
}

export function profilesFor(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = mainDb.prepare(
    `SELECT id, name, username, avatar_url FROM users WHERE id IN (${placeholders})`
  ).all(...ids);
  return new Map(rows.map((row) => [row.id, row]));
}

/** People picker: a name or @username match when searching, otherwise recent sign-ups. */
export function searchPeople(userId, query = '') {
  if (query) {
    const like = `%${query.toLowerCase()}%`;
    return mainDb.prepare(`
      SELECT id, name, username, avatar_url FROM users
      WHERE id != ? AND (LOWER(name) LIKE ? OR LOWER(COALESCE(username, '')) LIKE ?)
      ORDER BY name LIMIT 25
    `).all(userId, like, like);
  }
  return mainDb.prepare(`
    SELECT id, name, username, avatar_url FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 25
  `).all(userId);
}

/** A message the given user is allowed to act on (they must be in its conversation). */
export function messageForUser(messageId, userId) {
  const id = parseInt(messageId, 10);
  if (!Number.isInteger(id)) return null;
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!message || message.deleted_at) return null;
  if (!membership(message.conversation_id, userId)) return null;
  return message;
}

export function isBlocked(a, b) {
  return Boolean(db.prepare(
    'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
  ).get(a, b, b, a));
}

export function blockUser(blockerId, blockedId) {
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(blockerId, blockedId);
}

export function unblockUser(blockerId, blockedId) {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
}

export function blockedIds(userId) {
  const rows = db.prepare(
    'SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = ? OR blocked_id = ?'
  ).all(userId, userId);
  return rows.map((row) => (row.blocker_id === userId ? row.blocked_id : row.blocker_id));
}

/* ----------------------------------------------------------- conversations ---- */

export function membership(conversationId, userId) {
  return db.prepare(
    'SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
  ).get(conversationId, userId) || null;
}

export function memberIds(conversationId) {
  return db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId).map((row) => row.user_id);
}

/** The 1:1 conversation between two people, if it exists. */
export function findDm(a, b) {
  return db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members x ON x.conversation_id = c.id AND x.user_id = ?
    JOIN conversation_members y ON y.conversation_id = c.id AND y.user_id = ?
    WHERE c.kind = 'dm'
      AND (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2
    LIMIT 1
  `).get(a, b)?.id || null;
}

export function createDm(a, b) {
  const existing = findDm(a, b);
  if (existing) return existing;
  return db.transaction(() => {
    const info = db.prepare("INSERT INTO conversations (kind, created_by) VALUES ('dm', ?)").run(a);
    const add = db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)');
    add.run(info.lastInsertRowid, a);
    add.run(info.lastInsertRowid, b);
    return info.lastInsertRowid;
  })();
}

export function createGroup(creatorId, userIds, { kind = 'party', title = null } = {}) {
  const members = [...new Set([creatorId, ...userIds])].filter((id) => Number.isInteger(id) && id > 0);
  return db.transaction(() => {
    const info = db.prepare('INSERT INTO conversations (kind, title, created_by) VALUES (?,?,?)')
      .run(kind, title, creatorId);
    const add = db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)');
    for (const id of members) add.run(info.lastInsertRowid, id);
    return info.lastInsertRowid;
  })();
}

/* --------------------------------------------------------------- messages ---- */

/**
 * Store a message. `expires_at` starts at the 30-day cap; reading it pulls that in to 24 hours.
 * Media is registered in chat_media so the cleaner can delete the object too.
 */
export function insertMessage({ conversationId, senderId, kind = 'text', body = null, media = null, trackId = null, meta = null }) {
  return db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, kind, body, media_name, media_type, media_meta, track_id, expires_at)
      VALUES (?,?,?,?,?,?,?,?, datetime('now', ?))
    `).run(
      conversationId, senderId, kind, body,
      media ? media.name : null,
      media ? media.type : null,
      meta ? JSON.stringify(meta) : null,
      trackId,
      `+${MAX_AGE_DAYS} days`
    );
    if (media) {
      db.prepare(`
        INSERT INTO chat_media (name, conversation_id, uploaded_by, message_id, expires_at)
        VALUES (?,?,?,?, datetime('now', ?))
      `).run(media.name, conversationId, senderId, info.lastInsertRowid, `+${MAX_AGE_DAYS} days`);
    }
    db.prepare("UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?").run(conversationId);
    return info.lastInsertRowid;
  })();
}

/**
 * Mark everything up to `upToId` as read for this member, then start the 24-hour clock on any
 * message that every other member has now seen.
 */
export function markRead(conversationId, userId, upToId = null) {
  const rows = db.prepare(`
    SELECT m.id FROM messages m
    WHERE m.conversation_id = ? AND m.sender_id != ? AND m.deleted_at IS NULL
      ${upToId ? 'AND m.id <= ?' : ''}
  `).all(...(upToId ? [conversationId, userId, upToId] : [conversationId, userId]));

  const seen = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)');
  const recipients = db.prepare(
    'SELECT COUNT(*) c FROM conversation_members WHERE conversation_id = ? AND user_id != ?'
  ).get(conversationId, userId).c;

  db.transaction(() => {
    for (const { id } of rows) {
      seen.run(id, userId);
      const readers = db.prepare(`
        SELECT COUNT(*) c FROM message_reads r
        JOIN messages m ON m.id = r.message_id
        WHERE r.message_id = ? AND r.user_id != m.sender_id
      `).get(id).c;
      if (readers >= recipients) {
        // Last recipient has seen it: this is the 24-hour deadline, unless the 30-day cap is sooner.
        db.prepare(`
          UPDATE messages SET read_at = datetime('now'),
            expires_at = MIN(expires_at, datetime('now', ?))
          WHERE id = ? AND read_at IS NULL
        `).run(`+${TTL_HOURS_AFTER_READ} hours`, id);
        // The attachment goes with its message, so give it the same deadline.
        db.prepare(`
          UPDATE chat_media SET expires_at = MIN(expires_at, datetime('now', ?))
          WHERE message_id = ?
        `).run(`+${TTL_HOURS_AFTER_READ} hours`, id);
      }
    }
    db.prepare("UPDATE conversation_members SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?")
      .run(conversationId, userId);
  })();
}

export function setMuted(conversationId, userId, muted) {
  db.prepare('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?')
    .run(muted ? 1 : 0, conversationId, userId);
}

export function toggleReaction(messageId, userId, emoji) {
  const clean = String(emoji || '').slice(0, 8);
  if (!clean) return;
  const existing = db.prepare(
    'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).get(messageId, userId, clean);
  if (existing) db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
    .run(messageId, userId, clean);
  else db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?,?,?)')
    .run(messageId, userId, clean);
}

/** Unsend: the row stays as a tombstone so the thread keeps its shape, and the media goes now. */
export function deleteMessage(messageId) {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) return null;
  db.prepare('UPDATE messages SET deleted_at = datetime(\'now\'), body = NULL WHERE id = ?').run(messageId);
  if (message.media_name) removeMedia(message.media_name);
  return message;
}

/* ---------------------------------------------------------------- reports ---- */

/**
 * Keep an immutable copy of a reported message for review. The copy lives in `reports`, not in the
 * thread, so the live message still lapses on schedule — the promise to everyone else is unchanged.
 */
export function reportMessage({ messageId, reporterId, reason }) {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) return null;
  const snapshot = JSON.stringify({
    body: message.body,
    kind: message.kind,
    media_type: message.media_type,
    media_meta: message.media_meta,
    created_at: message.created_at,
    sender_id: message.sender_id,
    conversation_id: message.conversation_id
  });
  const info = db.prepare(`
    INSERT INTO reports (reporter_id, subject_user_id, conversation_id, message_id, reason, snapshot, media_name, keep_until)
    VALUES (?,?,?,?,?,?,?, datetime('now', ?))
  `).run(
    reporterId, message.sender_id, message.conversation_id, message.id,
    String(reason || '').slice(0, 500), snapshot, message.media_name, `+${REPORT_KEEP_DAYS} days`
  );
  return info.lastInsertRowid;
}

/* ------------------------------------------------------------------ media ---- */

export function registerMedia({ name, conversationId, userId }) {
  db.prepare(`
    INSERT INTO chat_media (name, conversation_id, uploaded_by, expires_at)
    VALUES (?,?,?, datetime('now', ?))
  `).run(name, conversationId, userId, `+${MAX_AGE_DAYS} days`);
}

/**
 * Media is served by name only to members of its conversation, and never after it lapses.
 *
 * The deadline that counts is the *message's*: reading a message pulls its expiry in to 24 hours,
 * and the attachment must go at the same moment. A row that is not attached to a message yet
 * (uploaded but not saved) falls back to its own deadline.
 */
export function mediaIsReadable(name, userId) {
  const row = db.prepare(`
    SELECT cm.* FROM chat_media cm
    WHERE cm.name = ? AND cm.removed_at IS NULL AND cm.expires_at > datetime('now')
      AND (
        cm.message_id IS NULL
        OR EXISTS (
          SELECT 1 FROM messages m
          WHERE m.id = cm.message_id AND m.deleted_at IS NULL AND m.expires_at > datetime('now')
        )
      )
  `).get(name);
  if (!row) return null;
  if (!membership(row.conversation_id, userId)) return null;
  return row;
}

export async function removeMedia(name) {
  if (!MEDIA_NAME.test(String(name || ''))) return;
  try {
    await chatStorage.remove(name);
    db.prepare('UPDATE chat_media SET removed_at = datetime(\'now\') WHERE name = ?').run(name);
  } catch (err) {
    console.error(`[pulse] Could not delete chat media ${name}:`, err.message);
  }
}

/**
 * Move a multer temp file into the ephemeral store. With a bucket configured the file is copied
 * there; without one the temp file *is* the stored file (same folder), which is why callers must
 * only clean up temp copies when `chatMediaIsRemote()` says so.
 */
export async function keepChatMedia(files) {
  const stored = [];
  for (const file of files) {
    if (chatStorage.remote) {
      try {
        await chatStorage.put(file);
      } catch (err) {
        console.error('[pulse] Could not store chat media:', err.message);
        throw new Error('Could not store the attachment right now. Please try again.');
      }
    }
    stored.push(file);
  }
  return stored;
}

export const chatMediaIsRemote = () => chatStorage.remote;

export function mediaUrlFor(name, token) {
  return `/api/chat/media/${encodeURIComponent(name)}?t=${encodeURIComponent(token)}`;
}

/**
 * Where the file physically is right now: local disk (served directly) or the bucket
 * (a short-lived, no-store signed link).
 */
export async function resolveMediaLocation(name) {
  const local = path.join(chatMediaDir, name);
  if (fs.existsSync(local)) return { file: local, type: contentTypeFor(name) };
  if (chatStorage.remote) {
    return { redirect: await chatStorage.urlFor(name, { noStore: true, expiresIn: 300 }) };
  }
  return null;
}

/* ---------------------------------------------------------------- cleaner ---- */

/**
 * Reclaim everything that has lapsed. Runs on a timer and once at boot; it never decides what a
 * user can see (reads already filter), it only makes the deletion real — including in the bucket.
 */
export async function sweepChat({ log = console } = {}) {
  const expired = db.prepare(`SELECT * FROM messages WHERE expires_at <= datetime('now')`).all();
  let messages = 0;
  let files = 0;

  for (const message of expired) {
    // A reported message keeps a copy in `reports`; the live row still goes.
    if (message.media_name) {
      const held = db.prepare(
        "SELECT 1 FROM reports WHERE media_name = ? AND keep_until > datetime('now') LIMIT 1"
      ).get(message.media_name);
      if (!held) { await removeMedia(message.media_name); files += 1; }
    }
    db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);
    messages += 1;
  }

  // Objects whose message is gone (or that never got attached), plus anything a crash left behind.
  const orphans = db.prepare(`
    SELECT * FROM chat_media
    WHERE removed_at IS NULL
      AND expires_at <= datetime('now')
      AND (message_id IS NULL OR NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = chat_media.message_id))
  `).all();
  for (const row of orphans) {
    const held = db.prepare(
      "SELECT 1 FROM reports WHERE media_name = ? AND keep_until > datetime('now') LIMIT 1"
    ).get(row.name);
    if (held) continue;
    await removeMedia(row.name);
    files += 1;
  }

  // Reports have their own, longer clock.
  const staleReports = db.prepare("SELECT * FROM reports WHERE keep_until <= datetime('now')").all();
  for (const report of staleReports) {
    if (report.media_name) {
      const stillReferenced = db.prepare(
        "SELECT 1 FROM reports WHERE media_name = ? AND id != ? AND keep_until > datetime('now') LIMIT 1"
      ).get(report.media_name, report.id);
      if (!stillReferenced) { await removeMedia(report.media_name); files += 1; }
    }
    db.prepare('DELETE FROM reports WHERE id = ?').run(report.id);
  }

  // Unsent messages: tombstone stays, but their media should not.
  const unsentMedia = db.prepare(`
    SELECT * FROM chat_media WHERE removed_at IS NULL AND message_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM messages m WHERE m.id = chat_media.message_id AND m.deleted_at IS NOT NULL)
  `).all();
  for (const row of unsentMedia) {
    await removeMedia(row.name);
    files += 1;
  }

  // Deleted rows leave free pages behind: hand the space back to the filesystem now and then.
  if (messages > 0 || files > 0) {
    try { db.exec('VACUUM'); } catch (err) { log.warn?.(`[pulse] Chat store compaction skipped: ${err.message}`); }
  }

  if (messages || files || staleReports.length) {
    log.log?.(`[pulse] Chat cleanup: removed ${messages} message(s), ${files} media file(s), ${staleReports.length} expired report(s).`);
  }
  return { messages, files, reports: staleReports.length };
}

/** Sweep on a timer, and once shortly after boot. Never blocks startup. */
export function startChatCleanup({ intervalMs = 10 * 60 * 1000, log = console } = {}) {
  const config = Number(process.env.PULSE_CHAT_SWEEP_SECONDS);
  const every = Number.isFinite(config) && config > 0 ? config * 1000 : intervalMs;
  const run = () => sweepChat({ log }).catch((err) => log.error?.(`[pulse] Chat cleanup failed: ${err.message}`));
  const timer = setInterval(run, every);
  timer.unref?.();
  const first = setTimeout(run, 1500);
  first.unref?.();
  return () => { clearInterval(timer); clearTimeout(first); };
}

/* ------------------------------------------------------------------ views ---- */

const MESSAGE_COLUMNS = `
  m.id, m.conversation_id, m.sender_id, m.kind, m.body, m.media_name, m.media_type, m.media_meta,
  m.track_id, ${iso('m.created_at')} created_at, ${iso('m.expires_at')} expires_at,
  ${iso('m.read_at')} read_at, ${iso('m.deleted_at')} deleted_at
`;

/** Messages a member may see, oldest first. `before` pages backwards through the thread. */
export function visibleMessages(conversationId, { before = null, limit = 50 } = {}) {
  const rows = db.prepare(`
    SELECT ${MESSAGE_COLUMNS} FROM messages m
    WHERE m.conversation_id = ? AND ${VISIBLE}
      ${before ? 'AND m.id < ?' : ''}
    ORDER BY m.id DESC LIMIT ?
  `).all(...(before ? [conversationId, before, limit] : [conversationId, limit]));

  rows.reverse();
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const reactions = db.prepare(
    `SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (${placeholders})`
  ).all(...ids);
  const reads = db.prepare(
    `SELECT message_id, user_id FROM message_reads WHERE message_id IN (${placeholders})`
  ).all(...ids);

  return rows.map((row) => ({
    ...row,
    reactions: reactions.filter((r) => r.message_id === row.id)
      .map((r) => ({ user_id: r.user_id, emoji: r.emoji })),
    read_by: reads.filter((r) => r.message_id === row.id).map((r) => r.user_id)
  }));
}

export function unreadCount(userId, conversationId = null) {
  return db.prepare(`
    SELECT COUNT(*) c FROM messages m
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
    WHERE m.sender_id != ? AND ${VISIBLE}
      AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
      ${conversationId ? 'AND m.conversation_id = ?' : ''}
  `).get(...(conversationId ? [userId, userId, conversationId] : [userId, userId])).c;
}

export function conversationsFor(userId) {
  return db.prepare(`
    SELECT c.id, c.kind, c.title, ${iso('c.last_message_at')} last_message_at,
           cm.last_read_at, cm.muted
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
    LIMIT 100
  `).all(userId);
}

export function lastVisibleMessage(conversationId) {
  return db.prepare(`
    SELECT ${MESSAGE_COLUMNS} FROM messages m
    WHERE m.conversation_id = ? AND ${VISIBLE}
    ORDER BY m.id DESC LIMIT 1
  `).get(conversationId) || null;
}
