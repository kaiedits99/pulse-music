// End-to-end for messaging: the promise is that a conversation is visible while it is alive and
// gone once it lapses — including the attachment, on disk and in the store. Runs against the real
// server, with the cleaner ticking fast (PULSE_CHAT_SWEEP_SECONDS=1) and the chat database opened
// directly to backdate rows, which is how a real day of waiting is simulated.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startServer, wavBytes, pngBytes, waitFor, call } from './helpers.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-chat-'));
const chatDbPath = path.join(dataDir, 'chat.db');
const chatMediaDir = path.join(dataDir, 'chat-media');

let server;
let api;
const tokens = {};

/** Direct access to the ephemeral store, to backdate what a day of waiting would have done. */
const chatDb = () => new Database(chatDbPath);

const expireEverything = () => {
  const db = chatDb();
  try {
    db.prepare("UPDATE messages SET expires_at = datetime('now', '-1 minutes')").run();
    db.prepare("UPDATE chat_media SET expires_at = datetime('now', '-1 minutes')").run();
  } finally { db.close(); }
};

const chatFiles = () => (fs.existsSync(chatMediaDir) ? fs.readdirSync(chatMediaDir) : []);

async function register(username) {
  const res = await api('POST', '/api/auth/register', {
    json: { name: username, username, email: `${username}@example.test`, password: 'secret123', artistName: username, favoriteGenres: ['Pop'] }
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  tokens[username] = res.body.token;
  return res.body.token;
}

const as = (username) => ({ token: tokens[username] });
const send = (username, conversationId, fields = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return api('POST', `/api/chat/conversations/${conversationId}/messages`, { ...as(username), form });
};

async function dmBetween(a, b) {
  const res = await api('POST', '/api/chat/conversations', {
    ...as(a), json: { user_id: (await api('GET', '/api/auth/me', as(b))).body.user.id }
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

let pairs = 0;
/**
 * Two brand-new accounts and the chat between them. Tests that count messages need a thread of
 * their own — a DM between the same two people is deliberately reused by the app.
 */
async function pair() {
  const tag = `p${++pairs}`;
  await register(`sender${tag}`);
  await register(`recipient${tag}`);
  const a = `sender${tag}`;
  const b = `recipient${tag}`;
  return { a, b, conversation: await dmBetween(a, b) };
}

before(async () => {
  server = await startServer(dataDir, { PULSE_CHAT_SWEEP_SECONDS: '1' });
  api = call(server);
  for (const name of ['ada', 'bode', 'chidi']) await register(name);
});

after(async () => {
  server?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a conversation is private to its members', async () => {
  const conversation = await dmBetween('ada', 'bode');
  assert.ok(conversation);

  const outsider = await api('GET', `/api/chat/conversations/${conversation}/messages`, as('chidi'));
  assert.equal(outsider.status, 404, 'someone outside the chat sees nothing at all');

  const list = await api('GET', '/api/chat/conversations', as('chidi'));
  assert.equal(list.body.some((row) => row.id === conversation), false, 'it is not in their list either');
});

test('a message nobody has opened lapses at the 30-day cap', async () => {
  const conversation = await dmBetween('ada', 'bode');
  const sent = await send('ada', conversation, { body: 'never opened' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const created = new Date(sent.body.created_at).getTime();
  const expires = new Date(sent.body.expires_at).getTime();
  const days = (expires - created) / (1000 * 60 * 60 * 24);
  assert.ok(Math.abs(days - 30) < 0.01, `expected a 30-day cap, got ${days} days`);
});

test('reading a message starts the 24-hour clock and shows the read receipt', async () => {
  const conversation = await dmBetween('ada', 'bode');
  const sent = await send('ada', conversation, { body: 'check the mix' });
  assert.equal(sent.status, 201);

  const before = await api('GET', '/api/chat/unread', as('bode'));
  assert.equal(before.body.unread >= 1, true, 'it counts as unread for the recipient');

  const read = await api('POST', `/api/chat/conversations/${conversation}/read`, { ...as('bode'), json: {} });
  assert.equal(read.status, 200);
  assert.equal(read.body.unread, 0);

  const thread = await api('GET', `/api/chat/conversations/${conversation}/messages`, as('ada'));
  const message = thread.body.messages.at(-1);
  const hours = (new Date(message.expires_at) - new Date(message.created_at)) / (1000 * 60 * 60);
  assert.ok(Math.abs(hours - 24) < 0.05, `expected a 24-hour deadline, got ${hours} hours`);
  assert.deepEqual(message.read_by, [(await api('GET', '/api/auth/me', as('bode'))).body.user.id]);
});

test('an expired message disappears from the thread before the cleaner even runs', async () => {
  const { a, b, conversation } = await pair();
  await send(a, conversation, { body: 'here and then gone' });
  await api('POST', `/api/chat/conversations/${conversation}/read`, { ...as(b), json: {} });

  const before = await api('GET', `/api/chat/conversations/${conversation}/messages`, as(a));
  assert.equal(before.body.messages.length, 1);

  // A lapsed message is hidden by the query itself: the host may be asleep and the cleaner idle.
  expireEverything();
  const after = await api('GET', `/api/chat/conversations/${conversation}/messages`, as(a));
  assert.deepEqual(after.body.messages, []);
});

test('the cleaner deletes messages, the attachment rows and the files on disk', async () => {
  const conversation = await dmBetween('ada', 'bode');
  const image = await send('ada', conversation, {});
  assert.equal(image.status, 400, 'an empty message is refused');

  const form = new FormData();
  form.append('image', new Blob([pngBytes()], { type: 'image/png' }), 'photo.png');
  const sent = await api('POST', `/api/chat/conversations/${conversation}/messages`, { ...as('ada'), form });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const mediaName = sent.body.media_name;
  assert.ok(mediaName);
  assert.equal(chatFiles().includes(mediaName), true, 'the file is on disk while the message is alive');

  await api('POST', `/api/chat/conversations/${conversation}/read`, { ...as('bode'), json: {} });
  expireEverything();

  await waitFor(() => !chatFiles().includes(mediaName), { timeoutMs: 8000, what: 'the attachment to be deleted' });
  const db = chatDb();
  try {
    assert.equal(db.prepare('SELECT COUNT(*) c FROM messages WHERE media_name = ?').get(mediaName).c, 0);
    assert.ok(db.prepare('SELECT removed_at FROM chat_media WHERE name = ?').get(mediaName).removed_at);
  } finally { db.close(); }
});

test('attachments are served to members only, marked no-store, and never past the deadline', async () => {
  const conversation = await dmBetween('ada', 'bode');
  const form = new FormData();
  form.append('image', new Blob([pngBytes()], { type: 'image/png' }), 'photo.png');
  const sent = await api('POST', `/api/chat/conversations/${conversation}/messages`, { ...as('ada'), form });
  const url = `/api/chat/media/${sent.body.media_name}`;

  const anon = await fetch(`${server.url}${url}`);
  assert.equal(anon.status, 401, 'no token, no attachment');

  const asBode = await fetch(`${server.url}${url}?t=${tokens.bode}`);
  assert.equal(asBode.status, 200);
  assert.match(asBode.headers.get('cache-control'), /no-store/);
  assert.equal(asBode.headers.get('content-type'), 'image/png');

  const outsider = await fetch(`${server.url}${url}?t=${tokens.chidi}`);
  assert.equal(outsider.status, 404, 'a member of another conversation cannot fetch it');

  // Once the message lapses, the attachment stops being served even if the file is still there.
  await api('POST', `/api/chat/conversations/${conversation}/read`, { ...as('bode'), json: {} });
  const db = chatDb();
  try {
    db.prepare("UPDATE messages SET expires_at = datetime('now', '-1 minutes') WHERE id = ?").run(sent.body.id);
  } finally { db.close(); }
  const lapsed = await fetch(`${server.url}${url}?t=${tokens.bode}`);
  assert.equal(lapsed.status, 404);
});

test('a voice note keeps its waveform and duration, and a shared track keeps its id', async () => {
  const conversation = await dmBetween('ada', 'bode');

  const voice = new FormData();
  voice.append('audio', new Blob([pngBytes()], { type: 'audio/webm' }), 'note.webm');
  voice.append('duration', '38');
  voice.append('waveform', JSON.stringify([0.2, 0.6, 0.3]));
  const sentVoice = await api('POST', `/api/chat/conversations/${conversation}/messages`, { ...as('ada'), form: voice });
  assert.equal(sentVoice.status, 201, JSON.stringify(sentVoice.body));
  assert.equal(sentVoice.body.kind, 'voice');
  assert.equal(sentVoice.body.media_meta.duration, 38);
  assert.deepEqual(sentVoice.body.media_meta.waveform, [0.2, 0.6, 0.3]);

  // A real track to share, so the card has something to point at.
  const upload = new FormData();
  upload.append('title', 'Midnight City');
  upload.append('artist_name', 'M83');
  upload.append('audio', new Blob([wavBytes()], { type: 'audio/wav' }), 'midnight.wav');
  const track = await api('POST', '/api/songs', { token: tokens.bode, form: upload });
  assert.equal(track.status, 201, JSON.stringify(track.body));

  const shared = await send('ada', conversation, { track_id: track.body.id, body: 'this one' });
  assert.equal(shared.status, 201, JSON.stringify(shared.body));
  assert.equal(shared.body.track_id, track.body.id);
  assert.equal(shared.body.kind, 'text', 'a track with a note stays a text message');
});

test('reactions toggle on and off', async () => {
  const { a, b, conversation } = await pair();
  const sent = await send(a, conversation, { body: 'fire?' });

  await api('POST', `/api/chat/messages/${sent.body.id}/react`, { ...as(b), json: { emoji: '🔥' } });
  let thread = await api('GET', `/api/chat/conversations/${conversation}/messages`, as(a));
  assert.deepEqual(thread.body.messages[0].reactions, [{ emoji: '🔥', count: 1, mine: false }]);

  await api('POST', `/api/chat/messages/${sent.body.id}/react`, { ...as(b), json: { emoji: '🔥' } });
  thread = await api('GET', `/api/chat/conversations/${conversation}/messages`, as(a));
  assert.deepEqual(thread.body.messages[0].reactions, []);
});

test('you can unsend your own message — and its attachment goes immediately', async () => {
  const { a, b, conversation } = await pair();
  const form = new FormData();
  form.append('image', new Blob([pngBytes()], { type: 'image/png' }), 'oops.png');
  const sent = await api('POST', `/api/chat/conversations/${conversation}/messages`, { ...as(a), form });

  const notMine = await api('DELETE', `/api/chat/messages/${sent.body.id}`, as(b));
  assert.equal(notMine.status, 403, 'only the sender can unsend');

  const mine = await api('DELETE', `/api/chat/messages/${sent.body.id}`, as(a));
  assert.equal(mine.status, 200);

  const thread = await api('GET', `/api/chat/conversations/${conversation}/messages`, as(a));
  assert.deepEqual(thread.body.messages, [], 'an unsent message leaves no bubble behind');
  await waitFor(() => !chatFiles().includes(sent.body.media_name), { timeoutMs: 8000, what: 'the unsent attachment to be deleted' });
});

test('a report keeps a copy for review while the live message still lapses', async () => {
  const conversation = await dmBetween('ada', 'bode');
  const sent = await send('ada', conversation, { body: 'something to report' });

  const own = await api('POST', `/api/chat/messages/${sent.body.id}/report`, { ...as('ada'), json: { reason: 'mine' } });
  assert.equal(own.status, 400, 'you cannot report yourself');

  const reported = await api('POST', `/api/chat/messages/${sent.body.id}/report`, { ...as('bode'), json: { reason: 'harassment' } });
  assert.equal(reported.status, 201, JSON.stringify(reported.body));
  assert.match(reported.body.message, /kept for review/);

  expireEverything();
  await waitFor(() => {
    const db = chatDb();
    try { return db.prepare('SELECT COUNT(*) c FROM messages WHERE id = ?').get(sent.body.id).c === 0; }
    finally { db.close(); }
  }, { timeoutMs: 8000, what: 'the reported message to lapse' });

  const db = chatDb();
  try {
    const report = db.prepare('SELECT * FROM reports WHERE message_id = ?').get(sent.body.id);
    assert.ok(report, 'the report survives the wipe');
    assert.match(report.snapshot, /something to report/, 'the copy holds what was said');
    assert.equal(report.reason, 'harassment');
  } finally { db.close(); }
});

test('blocking stops new messages in both directions and hides the pair from the picker', async () => {
  const conversation = await dmBetween('ada', 'bode');

  const blocked = await api('POST', `/api/chat/users/${(await api('GET', '/api/auth/me', as('bode'))).body.user.id}/block`, as('ada'));
  assert.equal(blocked.status, 200);

  const fromBlocker = await send('ada', conversation, { body: 'hello?' });
  assert.equal(fromBlocker.status, 403, 'the person who blocked cannot keep messaging either');

  const fromBlocked = await send('bode', conversation, { body: 'hi?' });
  assert.equal(fromBlocked.status, 403);

  const people = await api('GET', '/api/chat/people', as('ada'));
  const bodeId = (await api('GET', '/api/auth/me', as('bode'))).body.user.id;
  assert.equal(people.body.some((row) => row.id === bodeId), false, 'blocked people are hidden');

  const restart = await api('POST', '/api/chat/conversations', { ...as('ada'), json: { user_id: bodeId } });
  assert.equal(restart.status, 403, 'and no new conversation can be opened');

  await api('DELETE', `/api/chat/users/${bodeId}/block`, as('ada'));
  const after = await send('ada', conversation, { body: 'we are fine now' });
  assert.equal(after.status, 201, 'unblocking restores the conversation');
});

test('history pages backwards through a thread', async () => {
  const { a, conversation } = await pair();
  for (let i = 0; i < 5; i += 1) await send(a, conversation, { body: `message ${i}` });

  const first = await api('GET', `/api/chat/conversations/${conversation}/messages?limit=2`, as(a));
  assert.equal(first.body.messages.length, 2);
  assert.equal(first.body.has_more, true);
  assert.deepEqual(first.body.messages.map((m) => m.body), ['message 3', 'message 4']);

  const older = await api('GET', `/api/chat/conversations/${conversation}/messages?limit=2&before=${first.body.messages[0].id}`, as(a));
  assert.deepEqual(older.body.messages.map((m) => m.body), ['message 1', 'message 2']);
});

/* ------------------------------------------------------- artist tags (@tag) --- */

/** Three fresh accounts, for the tests that need a group of people. */
let trios = 0;
async function trio() {
  const tag = `t${++trios}`;
  const names = [`alpha${tag}`, `bravo${tag}`, `charlie${tag}`];
  for (const name of names) await register(name);
  return names;
}

test('an artist tag finds the person, and an exact tag beats a partial name', async () => {
  const [a, b] = await trio();

  // A name that contains the tag would normally sort first; the exact tag must not be buried.
  await register('timid');
  await register('timi');

  // "@" is a hint, not part of the tag: both spellings find the same account.
  for (const query of ['@timi', 'timi', '@TIMI']) {
    const found = await api('GET', `/api/chat/people?q=${encodeURIComponent(query)}`, as(a));
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(found.body[0].username, 'timi', `"${query}" should put @timi first`);
  }

  // A tag that does not exist is a clear 404, not an empty list.
  const missing = await api('GET', '/api/chat/people/nobodyhere', as(a));
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /artist tag/i);

  // Looking yourself up is allowed and says so.
  const me = await api('GET', `/api/chat/people/@${a}`, as(a));
  assert.equal(me.status, 200);
  assert.equal(me.body.self, true);

  // And a tag is enough to start the conversation: no id needed.
  const started = await api('POST', '/api/chat/conversations', { ...as(a), json: { handle: `@${b}` } });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.equal(started.body.kind, 'dm');
  assert.equal(started.body.others[0].username, b);

  const again = await api('GET', `/api/chat/people/@${b}`, as(a));
  assert.equal(again.body.conversation_id, started.body.id, 'the tag resolves to the existing chat');
});

/* ------------------------------------------------------------------- notes --- */

test('a note is shared with the people you talk to, and lives one day', async () => {
  const [a, b, c] = await trio();
  await dmBetween(a, b);

  const posted = await api('PUT', '/api/chat/notes', { ...as(a), json: { body: 'mixing tonight', emoji: '🎧' } });
  assert.equal(posted.status, 201);

  // Your own note comes back first, and only people you share a conversation with see it.
  const mine = await api('GET', '/api/chat/notes', as(a));
  assert.equal(mine.body[0].mine, true);
  assert.equal(mine.body[0].body, 'mixing tonight');

  const contact = await api('GET', '/api/chat/notes', as(b));
  const fromA = contact.body.find((note) => note.user.username === a);
  assert.equal(Boolean(fromA), true, 'someone you talk to sees your note');
  assert.equal(typeof fromA.conversation_id, 'number', 'the note points at the chat you already have');

  // Someone you share no conversation with sees nothing.
  const untouched = `untouched${Date.now()}`;
  await register(untouched);
  const outside = await api('GET', '/api/chat/notes', as(untouched));
  assert.equal(outside.body.some((note) => note.user.username === a), false);

  const stranger = await api('GET', '/api/chat/notes', as(c));
  assert.equal(stranger.body.some((note) => note.user.username === a), false, 'a note is not a public broadcast');

  // A day later the note is gone, and so is the row.
  const db = chatDb();
  try { db.prepare("UPDATE notes SET expires_at = datetime('now', '-1 minutes')").run(); } finally { db.close(); }
  await waitFor(() => {
    const check = chatDb();
    try { return check.prepare('SELECT COUNT(*) c FROM notes').get().c === 0; } finally { check.close(); }
  }, { timeoutMs: 5000, what: 'the note to be swept' });
  const after = await api('GET', '/api/chat/notes', as(b));
  assert.equal(after.body.length, 0);

  // And you can take it down yourself.
  await api('PUT', '/api/chat/notes', { ...as(a), json: { body: 'second note' } });
  await api('DELETE', '/api/chat/notes', as(a));
  assert.equal((await api('GET', '/api/chat/notes', as(a))).body.length, 0);
});

/* ----------------------------------------------------------------- parties --- */

test('a party is a group chat: the clock starts only once everyone has read', async () => {
  const [a, b, c] = await trio();
  const created = await api('POST', '/api/chat/groups', {
    ...as(a), json: { title: 'Synthwave Collective', handles: [`@${b}`, `@${c}`] }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const conversation = created.body.id;
  assert.equal(created.body.kind, 'party');
  assert.equal(created.body.member_count, 3);

  // Everyone can see it, and a member can add someone else by tag.
  for (const name of [a, b, c]) {
    const list = await api('GET', '/api/chat/conversations', as(name));
    assert.equal(list.body.some((row) => row.id === conversation), true, `${name} should see the party`);
  }

  const sent = await send(a, conversation, { body: 'listen to this' });
  assert.equal(sent.status, 201);
  const messageId = sent.body.id;

  const expiresOf = async () => {
    const thread = await api('GET', `/api/chat/conversations/${conversation}/messages`, as(a));
    return new Date(thread.body.messages.find((m) => m.id === messageId).expires_at).getTime();
  };
  const farFuture = await expiresOf();
  assert.ok(farFuture - Date.now() > 20 * 86400000, 'an unread message keeps its 30-day cap');

  // One of the two recipients reads: not everyone has, so the message is still capped at 30 days.
  await api('POST', `/api/chat/conversations/${conversation}/read`, { ...as(b), json: { up_to: messageId } });
  assert.ok((await expiresOf()) - Date.now() > 20 * 86400000, 'one reader is not everyone');

  // The last one reads: now it is a 24-hour message.
  await api('POST', `/api/chat/conversations/${conversation}/read`, { ...as(c), json: { up_to: messageId } });
  const soon = (await expiresOf()) - Date.now();
  assert.ok(soon < 24 * 3600000 && soon > 23 * 3600000, `expected about 24 hours, got ${soon} ms`);

  // Membership: someone else can be added, and can leave again.
  const outsider = `outsider${Date.now()}`;
  await register(outsider);
  const added = await api('POST', `/api/chat/conversations/${conversation}/members`, { ...as(a), json: { handle: outsider } });
  assert.equal(added.status, 200);
  assert.equal(added.body.added, true);
  const outsiderThread = await api('GET', `/api/chat/conversations/${conversation}/messages`, as(outsider));
  assert.equal(outsiderThread.status, 200, 'an invited member can read the thread');

  const left = await api('DELETE', `/api/chat/conversations/${conversation}/members/me`, as(outsider));
  assert.equal(left.status, 200);
  assert.equal((await api('GET', `/api/chat/conversations/${conversation}/messages`, as(outsider))).status, 404);

  // A party can be renamed; a DM cannot.
  const renamed = await api('PATCH', `/api/chat/conversations/${conversation}`, { ...as(b), json: { title: 'Night Shift' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.title, 'Night Shift');
  const dm = await api('POST', '/api/chat/conversations', { ...as(a), json: { handle: b } });
  const badRename = await api('PATCH', `/api/chat/conversations/${dm.body.id}`, { ...as(a), json: { title: 'nope' } });
  assert.equal(badRename.status, 400);
});

/* ---------------------------------------------------------------- channels --- */

test('a channel is a broadcast: the owner posts, everyone else reads, and posts last 7 days', async () => {
  const [owner, listener, stranger] = await trio();
  const created = await api('POST', '/api/chat/channels', { ...as(owner), json: { title: 'Pulse Radio' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const channel = created.body.id;
  assert.equal(created.body.can_post, true);

  // A listener joins from the browse list.
  const browse = await api('GET', '/api/chat/channels?q=pulse', as(listener));
  assert.equal(browse.status, 200);
  assert.equal(browse.body[0].title, 'Pulse Radio');
  assert.equal(browse.body[0].joined, 0);
  const joined = await api('POST', `/api/chat/channels/${channel}/join`, as(listener));
  assert.equal(joined.status, 200);
  assert.equal(joined.body.can_post, false, 'a channel listener cannot post');

  const posted = await send(owner, channel, { body: 'new mix at 8pm' });
  assert.equal(posted.status, 201);
  const life = (new Date(posted.body.expires_at) - new Date(posted.body.created_at)) / 86400000;
  assert.ok(life > 6.99 && life < 7.01, `a channel post should last 7 days, got ${life}`);

  // Reading it does not shorten that — a broadcast has no "everyone has read".
  await api('POST', `/api/chat/conversations/${channel}/read`, { ...as(listener), json: { up_to: posted.body.id } });
  const thread = await api('GET', `/api/chat/conversations/${channel}/messages`, as(owner));
  const seen = thread.body.messages.find((m) => m.id === posted.body.id);
  const left = (new Date(seen.expires_at) - Date.now()) / 86400000;
  assert.ok(left > 6.9, `reading should not pull a channel post in to 24 hours, ${left} days left`);

  // The listener can read it; a stranger cannot even see the channel.
  const read = await api('GET', `/api/chat/conversations/${channel}/messages`, as(listener));
  assert.equal(read.body.messages.some((m) => m.id === posted.body.id), true);
  const reply = await send(listener, channel, { body: 'cannot post' });
  assert.equal(reply.status, 403);
  assert.match(reply.body.error, /owner/i);

  const strangerThread = await api('GET', `/api/chat/conversations/${channel}/messages`, as(stranger));
  assert.equal(strangerThread.status, 404, 'channels are not readable without joining');

  const leftChannel = await api('DELETE', `/api/chat/conversations/${channel}/members/me`, as(listener));
  assert.equal(leftChannel.status, 200);
});

/* --------------------------------------------------------- listening rooms --- */

test('a listening room shares what a party is playing — track ids, not audio', async () => {
  const [a, b, c] = await trio();
  const party = (await api('POST', '/api/chat/groups', { ...as(a), json: { title: 'Room', handles: [`@${b}`] } })).body.id;

  // Somewhere to queue from: a real track in the catalogue.
  const upload = await api('POST', '/api/songs', {
    ...as(a),
    form: (() => {
      const form = new FormData();
      form.append('title', 'Room Test');
      form.append('audio', new Blob([wavBytes(0.4)], { type: 'audio/wav' }), 'room.wav');
      return form;
    })()
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const trackId = upload.body.id || upload.body.song?.id;

  const queued = await api('POST', `/api/chat/conversations/${party}/room/queue`, { ...as(b), json: { track_id: trackId } });
  assert.equal(queued.status, 201, JSON.stringify(queued.body));
  assert.equal(queued.body.queue.length, 1);
  assert.equal(queued.body.queue[0].track_id, trackId);

  // "Next" makes the front of the queue what the room is playing.
  const next = await api('POST', `/api/chat/conversations/${party}/room/next`, as(a));
  assert.equal(next.status, 200);
  assert.equal(next.body.playing.track_id, trackId);
  assert.equal(next.body.playing.is_playing, true);
  assert.equal(next.body.queue.length, 0);

  // Anyone in the room can pause it — it is a shared remote.
  const paused = await api('POST', `/api/chat/conversations/${party}/room/playing`, { ...as(b), json: { is_playing: false } });
  assert.equal(paused.body.playing.is_playing, false);

  // Presence: everyone who has the thread open is "online", and it decays.
  await api('GET', `/api/chat/conversations/${party}/messages`, as(a));
  await api('GET', `/api/chat/conversations/${party}/messages`, as(b));
  const room = await api('GET', `/api/chat/conversations/${party}/room`, as(a));
  assert.equal(room.status, 200);
  assert.equal(room.body.online, 2, 'both members have the thread open');
  assert.equal((await api('GET', `/api/chat/conversations/${party}/room`, as(c))).status, 404, 'outsiders see no room');

  const db = chatDb();
  try { db.prepare("UPDATE presence SET seen_at = datetime('now', '-10 minutes')").run(); } finally { db.close(); }
  await waitFor(() => {
    const check = chatDb();
    try { return check.prepare('SELECT COUNT(*) c FROM presence').get().c === 0; } finally { check.close(); }
  }, { timeoutMs: 5000, what: 'presence to be forgotten' });

  // A DM has no room: the shared remote belongs to parties.
  const dm = (await api('POST', '/api/chat/conversations', { ...as(a), json: { handle: c } })).body.id;
  assert.equal((await api('GET', `/api/chat/conversations/${dm}/room`, as(a))).status, 400);

  // Removing a queue entry works for whoever queued it.
  const second = await api('POST', `/api/chat/conversations/${party}/room/queue`, { ...as(a), json: { track_id: trackId } });
  const entryId = second.body.entry;
  const removed = await api('DELETE', `/api/chat/conversations/${party}/room/queue/${entryId}`, as(a));
  assert.equal(removed.body.queue.length, 0);
});
