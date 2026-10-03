// HTTP surface for messaging. Mounted at /api/chat (see server/index.js).
//
// Two rules run through all of it: you only ever see conversations you are a member of, and
// anything past its expiry deadline is filtered out by the query itself.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { authMiddleware, userFromToken } from './auth.js';
import { chatMediaDir } from './chat-db.js';
import * as chat from './chat.js';

const router = express.Router();
const wrap = (handler) => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

const IMAGE_TYPES = /\.(jpg|jpeg|png|webp|gif)$/i;
const AUDIO_TYPES = /\.(webm|ogg|oga|m4a|mp4|mp3|wav|aac)$/i;

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) { cb(null, chatMediaDir); },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    }
  }),
  limits: { fileSize: chat.MAX_MEDIA_BYTES, files: 4 },
  fileFilter(req, file, cb) {
    const ok = file.fieldname === 'image' ? IMAGE_TYPES.test(file.originalname)
      : file.fieldname === 'audio' ? AUDIO_TYPES.test(file.originalname)
        : false;
    cb(ok ? null : new Error('Unsupported attachment type'), ok);
  }
});

/* ------------------------------------------------------------------ helpers -- */

/** Load a conversation the caller belongs to, or answer 404. */
function requireMember(req, res, next) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Conversation not found' });
  const conversation = chat.membership(id, req.user.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  req.conversationId = id;
  next();
}

/** A DM is shown to the person on the other side: their profile is the conversation's face. */
function presentConversation(userId, row, { withMessages = true } = {}) {
  const memberIds = chat.memberIds(row.id);
  const profiles = chat.profilesFor(memberIds);
  const others = memberIds.filter((id) => id !== userId).map((id) => profiles.get(id)).filter(Boolean);
  const unread = chat.unreadCount(userId, row.id);
  const last = withMessages ? chat.lastVisibleMessage(row.id) : null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.kind === 'dm' ? null : row.title,
    muted: Boolean(row.muted),
    unread,
    members: memberIds.map((id) => profiles.get(id)).filter(Boolean),
    others,
    last_message_at: row.last_message_at,
    last_message: last ? presentMessage(userId, last, profiles) : null
  };
}

function presentMessage(userId, row, profiles = null) {
  const people = profiles || chat.profilesFor([row.sender_id]);
  const sender = people.get(row.sender_id) || null;
  let meta = null;
  if (row.media_meta) { try { meta = JSON.parse(row.media_meta); } catch { meta = null; } }
  const reactions = row.reactions
    ? row.reactions.reduce((acc, reaction) => {
      const found = acc.find((entry) => entry.emoji === reaction.emoji);
      if (found) { found.count += 1; if (reaction.user_id === userId) found.mine = true; }
      else acc.push({ emoji: reaction.emoji, count: 1, mine: reaction.user_id === userId });
      return acc;
    }, [])
    : [];
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender: sender ? { id: sender.id, name: sender.name, username: sender.username, avatar_url: sender.avatar_url } : { id: row.sender_id, name: 'Someone' },
    mine: row.sender_id === userId,
    kind: row.kind,
    body: row.body,
    deleted: Boolean(row.deleted_at),
    // The client fetches this through /api/chat/media/<name> with its token: authorised and
    // no-store, never a permanent link that outlives the message.
    media_name: row.media_name || null,
    media_type: row.media_type || null,
    media_meta: meta,
    track_id: row.track_id || null,
    reactions: reactions.filter((reaction) => reaction.count > 0),
    read_by: row.read_by ? row.read_by.filter((id) => id !== userId) : [],
    created_at: row.created_at,
    expires_at: row.expires_at
  };
}

/* ------------------------------------------------------------------- people -- */

// Who you can start a chat with. Blocked pairs are hidden in both directions.
router.get('/people', authMiddleware, (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 60);
  const blocked = new Set(chat.blockedIds(req.user.id));
  res.json(chat.searchPeople(req.user.id, query).filter((row) => !blocked.has(row.id)));
});

/* ------------------------------------------------------------ conversations -- */

router.get('/conversations', authMiddleware, (req, res) => {
  const rows = chat.conversationsFor(req.user.id);
  res.json(rows.map((row) => presentConversation(req.user.id, row)));
});

router.get('/unread', authMiddleware, (req, res) => {
  res.json({ unread: chat.unreadCount(req.user.id) });
});

// Start (or reopen) a 1:1 chat.
router.post('/conversations', authMiddleware, (req, res) => {
  const otherId = parseInt(req.body.user_id, 10);
  if (!Number.isInteger(otherId) || otherId === req.user.id) {
    return res.status(400).json({ error: 'Choose someone to message' });
  }
  if (!chat.publicProfile(otherId)) return res.status(404).json({ error: 'That account no longer exists' });
  if (chat.isBlocked(req.user.id, otherId)) {
    return res.status(403).json({ error: 'You cannot message this person' });
  }
  const id = chat.createDm(req.user.id, otherId);
  const row = chat.conversationsFor(req.user.id).find((entry) => entry.id === id);
  res.status(201).json(presentConversation(req.user.id, row || { id, kind: 'dm', title: null, muted: 0, last_message_at: null }));
});

router.get('/conversations/:id', authMiddleware, requireMember, (req, res) => {
  const row = chat.conversationsFor(req.user.id).find((entry) => entry.id === req.conversationId);
  if (!row) return res.status(404).json({ error: 'Conversation not found' });
  res.json(presentConversation(req.user.id, row));
});

/* ---------------------------------------------------------------- messages -- */

router.get('/conversations/:id/messages', authMiddleware, requireMember, (req, res) => {
  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const rows = chat.visibleMessages(req.conversationId, { before, limit });
  const profiles = chat.profilesFor([...new Set(rows.map((row) => row.sender_id))]);
  res.json({
    messages: rows.map((row) => presentMessage(req.user.id, row, profiles)),
    has_more: rows.length === limit
  });
});

// Send: text, an image, a voice note, a shared track, or a combination.
router.post('/conversations/:id/messages', authMiddleware, requireMember,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }]),
  wrap(async (req, res) => {
    const body = String(req.body.body || '').trim().slice(0, 4000);
    const trackId = req.body.track_id ? parseInt(req.body.track_id, 10) : null;
    const image = req.files?.image?.[0] || null;
    const audio = req.files?.audio?.[0] || null;

    if (!body && !trackId && !image && !audio) {
      return res.status(400).json({ error: 'Write something or attach a file' });
    }
    // In a 1:1 chat, either side blocking ends the conversation.
    const others = chat.memberIds(req.conversationId).filter((id) => id !== req.user.id);
    if (others.some((id) => chat.isBlocked(req.user.id, id))) {
      return res.status(403).json({ error: 'You cannot message this person' });
    }
    if (trackId !== null && !Number.isInteger(trackId)) {
      return res.status(400).json({ error: 'That track is not available' });
    }

    let meta = null;
    if (req.body.duration || req.body.waveform) {
      let waveform = null;
      if (req.body.waveform) { try { waveform = JSON.parse(req.body.waveform); } catch { waveform = null; } }
      meta = {
        duration: Number(req.body.duration) || null,
        waveform: Array.isArray(waveform) ? waveform.slice(0, 200) : null
      };
    }

    const file = image || audio;
    let kind = body ? 'text' : 'image';
    if (audio && !image && !body) kind = 'voice';
    else if (trackId && !file && !body) kind = 'track';
    else if (file && !body) kind = image ? 'image' : 'voice';

    try {
      if (file) await chat.keepChatMedia([file]);
      const id = chat.insertMessage({
        conversationId: req.conversationId,
        senderId: req.user.id,
        kind,
        body: body || null,
        media: file ? { name: file.filename, type: file.mimetype || null } : null,
        trackId: Number.isInteger(trackId) ? trackId : null,
        meta
      });
      const [sent] = chat.visibleMessages(req.conversationId, { before: id + 1, limit: 1 });
      const profiles = chat.profilesFor([req.user.id]);
      res.status(201).json(presentMessage(req.user.id, sent, profiles));
    } finally {
      // With a bucket, the uploaded copy lives there and the temp file must not linger. Without one
      // the temp file is the stored file — deleting it here would delete the attachment itself.
      if (chat.chatMediaIsRemote()) {
        for (const f of [image, audio].filter(Boolean)) fs.rm(f.path, { force: true }, () => {});
      }
    }
  }));

// Mute is a per-member preference; it changes nothing about the message lifecycle.
router.patch('/conversations/:id', authMiddleware, requireMember, (req, res) => {
  if (req.body.muted !== undefined) {
    chat.setMuted(req.conversationId, req.user.id, Boolean(req.body.muted));
  }
  const row = chat.conversationsFor(req.user.id).find((entry) => entry.id === req.conversationId);
  res.json(presentConversation(req.user.id, row || { id: req.conversationId, kind: 'dm', muted: Boolean(req.body.muted) }));
});

// "I've read the thread" — starts the 24-hour clock on everything the other side sent.
router.post('/conversations/:id/read', authMiddleware, requireMember, (req, res) => {
  const upTo = req.body.up_to ? parseInt(req.body.up_to, 10) : null;
  chat.markRead(req.conversationId, req.user.id, Number.isInteger(upTo) ? upTo : null);
  res.json({ ok: true, unread: chat.unreadCount(req.user.id) });
});

/* ------------------------------------------------------- message lifecycle -- */

router.post('/messages/:id/react', authMiddleware, (req, res) => {
  const message = chat.messageForUser(req.params.id, req.user.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  chat.toggleReaction(message.id, req.user.id, req.body.emoji);
  res.json({ ok: true });
});

router.delete('/messages/:id', authMiddleware, (req, res) => {
  const message = chat.messageForUser(req.params.id, req.user.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only unsend your own messages' });
  chat.deleteMessage(message.id);
  res.json({ ok: true });
});

router.post('/messages/:id/report', authMiddleware, (req, res) => {
  const message = chat.messageForUser(req.params.id, req.user.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.sender_id === req.user.id) return res.status(400).json({ error: 'You cannot report your own message' });
  const id = chat.reportMessage({ messageId: message.id, reporterId: req.user.id, reason: req.body.reason });
  res.status(201).json({ ok: true, report_id: id, message: 'Reported. The message is kept for review.' });
});

router.post('/users/:id/block', authMiddleware, (req, res) => {
  const target = parseInt(req.params.id, 10);
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot block yourself' });
  chat.blockUser(req.user.id, target);
  res.json({ ok: true });
});

router.delete('/users/:id/block', authMiddleware, (req, res) => {
  chat.unblockUser(req.user.id, parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/* ------------------------------------------------------------------- media -- */

/**
 * Ephemeral media. The token rides in the query string because <img>/<audio> cannot send headers.
 * Every response is membership-checked, expiry-checked and marked no-store, so nothing survives in
 * a browser cache after the message is gone.
 */
router.get('/media/:name', wrap(async (req, res) => {
  const token = req.query.t || (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const row = chat.mediaIsReadable(req.params.name, user.id);
  if (!row) return res.status(404).json({ error: 'This attachment has expired' });

  const location = await chat.resolveMediaLocation(req.params.name);
  if (!location) return res.status(404).json({ error: 'This attachment has expired' });

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  if (location.redirect) return res.status(302).set('Location', location.redirect).end();
  res.type(location.type);
  return res.sendFile(location.file);
}));

export default router;
