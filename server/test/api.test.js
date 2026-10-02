// End-to-end: boots the real server (server/index.js) against a temporary data folder
// and drives it over HTTP, the way two different people would use the app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildLegacyFixture } from './legacy-fixture.js';
import { startServer, wavBytes, call } from './helpers.js';

const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-api-'));
const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-api-legacy-'));

let fresh;
let legacy;
let api;
let apiLegacy;

before(async () => {
  fresh = await startServer(freshDir);
  api = call(fresh);
});

after(() => {
  fresh?.stop();
  legacy?.stop();
  fs.rmSync(freshDir, { recursive: true, force: true });
  fs.rmSync(legacyDir, { recursive: true, force: true });
});

async function register(name, username) {
  const res = await api('POST', '/api/auth/register', {
    json: { name, username, email: `${username}@example.test`, password: 'secret123', artistName: name, favoriteGenres: ['Pop'] }
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.token;
}

async function upload(token, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('audio', new Blob([wavBytes()], { type: 'audio/wav' }), 'track.wav');
  return api('POST', '/api/songs', { token, form });
}

const titles = (res) => res.body.map((song) => song.title);

test('a fresh install starts completely empty — no seeded content of any kind', async () => {
  assert.deepEqual((await api('GET', '/api/songs')).body, []);
  assert.deepEqual((await api('GET', '/api/artists')).body, []);
  assert.deepEqual((await api('GET', '/api/albums')).body, []);
  const stats = (await api('GET', '/api/stats')).body;
  for (const key of ['songs', 'plays', 'downloads', 'artists', 'albums', 'playlists', 'podcasts', 'episodes']) {
    assert.equal(stats[key], 0, key);
  }
  assert.deepEqual([stats.top, stats.recent, stats.recommended, stats.community_uploads, stats.genres], [[], [], [], [], []]);
  assert.deepEqual((await api('GET', '/api/podcasts')).body.podcasts, []);
  assert.ok(!fresh.logs().includes('seed'), 'boot must not seed anything');
});

let tokenA;
let tokenB;
let tokenC;

test('the first upload becomes the catalog, and the next user sees it without uploading anything', async () => {
  tokenA = await register('Kai Rivers', 'kai_rivers');
  tokenB = await register('Zed Okoro', 'zed_okoro');
  tokenC = await register('Quiet Listener', 'quiet_listener');

  // still empty after sign-ups: profiles created at registration are not "music"
  assert.deepEqual((await api('GET', '/api/songs', { token: tokenB })).body, []);
  assert.equal((await api('GET', '/api/stats', { token: tokenB })).body.songs, 0);

  const first = await upload(tokenA, { title: 'Midnight Drive', artist_name: 'Kai Rivers', genre: 'Afrobeats' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.file_path.startsWith('/media/uploads/'), true);

  // B never uploads — but sees A's track everywhere the catalog is shown
  const asB = await api('GET', '/api/songs', { token: tokenB });
  assert.deepEqual(titles(asB), ['Midnight Drive']);
  const stats = (await api('GET', '/api/stats', { token: tokenB })).body;
  assert.equal(stats.songs, 1);
  assert.equal(stats.artists, 1);
  assert.deepEqual(stats.recent.map((s) => s.title), ['Midnight Drive']);
  assert.deepEqual(stats.community_uploads.map((s) => s.title), ['Midnight Drive']);
  assert.deepEqual(stats.genres.map((g) => g.genre), ['Afrobeats']);
  // and so does a signed-out visitor (public uploads), which is what the sign-in screen's totals use
  assert.deepEqual(titles(await api('GET', '/api/songs')), ['Midnight Drive']);
});

test('every further upload accumulates, newest first', async () => {
  const second = await upload(tokenB, { title: 'Golden Hour Jam', artist_name: 'Zed Okoro', genre: 'Indie Pop' });
  assert.equal(second.status, 201);
  for (const token of [tokenA, tokenB, tokenC]) {
    assert.deepEqual(titles(await api('GET', '/api/songs', { token })), ['Golden Hour Jam', 'Midnight Drive']);
  }
  assert.equal((await api('GET', '/api/stats', { token: tokenC })).body.songs, 2);
});

test('search finds tracks by artist, title or genre — case, accent and punctuation insensitive', async () => {
  const find = async (q, token = tokenC) => titles(await api('GET', `/api/songs?q=${encodeURIComponent(q)}`, { token }));

  assert.deepEqual(await find('kai'), ['Midnight Drive']);              // artist
  assert.deepEqual(await find('RIVERS'), ['Midnight Drive']);           // artist, other case
  assert.deepEqual(await find('midnight'), ['Midnight Drive']);         // title
  assert.deepEqual(await find('golden hour'), ['Golden Hour Jam']);     // title, two words
  assert.deepEqual(await find('afrobeats'), ['Midnight Drive']);        // genre — the gap in the old search
  assert.deepEqual(await find('AFROBEATS'), ['Midnight Drive']);
  assert.deepEqual(await find('indie'), ['Golden Hour Jam']);           // genre, partial
  assert.deepEqual(await find('indiepop'), ['Golden Hour Jam']);        // spacing ignored
  assert.deepEqual(await find('zed indie'), ['Golden Hour Jam']);       // artist + genre together
  assert.deepEqual(await find('kai indie'), []);                        // every word has to match
  assert.deepEqual(await find('nothing like this'), []);
  assert.deepEqual(await find('  '), ['Golden Hour Jam', 'Midnight Drive']); // blank = no filter
  assert.deepEqual(await find('%'), ['Golden Hour Jam', 'Midnight Drive']);  // never a wildcard
  assert.deepEqual(await find("x'; DROP TABLE songs;--"), []);
  assert.equal((await api('GET', '/api/songs', { token: tokenC })).body.length, 2, 'table is intact');
});

test('private uploads stay private, including from search', async () => {
  const hidden = await upload(tokenA, { title: 'Secret Draft', artist_name: 'Kai Rivers', genre: 'Afrobeats', is_public: '0' });
  assert.equal(hidden.status, 201);
  assert.equal(hidden.body.is_public, 0);

  const find = async (q, token) => titles(await api('GET', `/api/songs?q=${q}`, { token }));
  assert.deepEqual(await find('secret', tokenB), []);
  assert.deepEqual(await find('afrobeats', tokenB), ['Midnight Drive']);
  assert.deepEqual(await find('secret', tokenA), ['Secret Draft']);
  assert.deepEqual(await find('secret', undefined), []);
  assert.equal((await api('GET', '/api/stats', { token: tokenB })).body.songs, 2);
});

test('artist profiles report the music the caller can see, so pages can skip empty ones', async () => {
  const list = (await api('GET', '/api/artists', { token: tokenC })).body;
  const count = Object.fromEntries(list.map((a) => [a.name, a.song_count]));
  // every profile is listed (the upload and album pickers need them all) ...
  assert.deepEqual(Object.keys(count).sort(), ['Kai Rivers', 'Quiet Listener', 'Zed Okoro']);
  // ... but one created only at sign-up has nothing to play, and A's private draft is not counted for C
  assert.equal(count['Quiet Listener'], 0);
  assert.equal(count['Kai Rivers'], 1);
  assert.equal(count['Zed Okoro'], 1);
  assert.deepEqual((await api('GET', '/api/artists?q=zed', { token: tokenC })).body.map((a) => a.name), ['Zed Okoro']);
  assert.deepEqual((await api('GET', '/api/artists?q=afro', { token: tokenC })).body, []); // artists match by name/genre only
  assert.equal((await api('GET', '/api/stats', { token: tokenC })).body.artists, 2);
});

// A raw request, because fetch() would normalise `..` away before it reaches the server.
const rawGet = (server, rawPath) => new Promise((resolve, reject) => {
  const { hostname, port } = new URL(server.url);
  http.get({ hostname, port, path: rawPath }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

test('only uploaded media is served — the database is not downloadable', async () => {
  const list = (await api('GET', '/api/songs', { token: tokenC })).body;
  const mine = list.find((s) => s.title === 'Midnight Drive');
  const audio = await fetch(fresh.url + mine.file_path, { headers: { Range: 'bytes=0-9' } });
  assert.equal(audio.status, 206, 'uploads stream with Range support');

  for (const exposed of ['/media/pulse.db', '/media/pulse.db-wal', '/media/pulse.db-shm', '/media/seed-manifest.json']) {
    assert.equal((await fetch(fresh.url + exposed)).status, 404, `${exposed} must not be served`);
  }
  for (const sneaky of ['/media/uploads/../pulse.db', '/media/uploads/..%2Fpulse.db', '/media/uploads/%2e%2e/pulse.db']) {
    const res = await rawGet(fresh, sneaky);
    assert.ok([400, 403, 404].includes(res.status), `${sneaky} -> ${res.status}`);
    assert.ok(!res.body.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'), `${sneaky} leaked the database`);
  }
});

test('liking a track is per user, idempotent, and limited to tracks the caller may see', async () => {
  const owner = await register('Fav Owner', 'fav_owner');
  const fan = await register('Fav Fan', 'fav_fan');
  const open = (await upload(owner, { title: 'Open Door', artist_name: 'Fav Owner', genre: 'Pop', is_public: '1' })).body;
  const locked = (await upload(owner, { title: 'Locked Door', artist_name: 'Fav Owner', genre: 'Pop', is_public: '0' })).body;
  const like = (id, token) => api('POST', `/api/favorites/${id}`, { token });
  const unlike = (id, token) => api('DELETE', `/api/favorites/${id}`, { token });
  const liked = async (token) => titles(await api('GET', '/api/favorites', { token }));
  const flag = async (token, id) => (await api('GET', '/api/songs', { token })).body.find((song) => song.id === id)?.is_favorite;

  // a stranger can like a public track; liking it twice is the same as once
  assert.deepEqual((await like(open.id, fan)).body, { is_favorite: 1 });
  assert.equal((await like(open.id, fan)).status, 200);
  assert.deepEqual(await liked(fan), ['Open Door']);

  // it is the fan's like only: the list endpoints flag it for them and nobody else
  assert.equal(await flag(fan, open.id), 1);
  assert.equal(await flag(owner, open.id), 0);
  assert.deepEqual(await liked(owner), []);

  // un-liking is idempotent too
  assert.deepEqual((await unlike(open.id, fan)).body, { is_favorite: 0 });
  assert.equal((await unlike(open.id, fan)).status, 200);
  assert.deepEqual(await liked(fan), []);
  assert.equal(await flag(fan, open.id), 0);

  // someone else's private track can't be liked, and the answer is the same as for a track
  // that does not exist, so ids cannot be probed
  const sneaky = await like(locked.id, fan);
  const ghost = await like(999999, fan);
  assert.equal(sneaky.status, 404);
  assert.equal(ghost.status, 404);
  assert.deepEqual(sneaky.body, ghost.body);
  assert.deepEqual(await liked(fan), []);
  // the owner may like their own private track
  assert.equal((await like(locked.id, owner)).status, 200);
  assert.deepEqual(await liked(owner), ['Locked Door']);

  // anything that is not a plain positive integer is rejected, and nothing is stored
  for (const bad of ['abc', '0', '-3', '1.5', '1e3', '12abc']) {
    assert.equal((await like(bad, fan)).status, 400, `like ${bad}`);
    assert.equal((await unlike(bad, fan)).status, 400, `unlike ${bad}`);
  }
  assert.equal((await api('POST', `/api/favorites/${open.id}`)).status, 401);
  assert.deepEqual(await liked(fan), []);

  // a liked track the owner later hides leaves the fan's liked list, and un-liking it still works
  await like(open.id, fan);
  assert.equal((await api('PATCH', `/api/songs/${open.id}/visibility`, { token: owner, json: { is_public: 0 } })).status, 200);
  assert.deepEqual(await liked(fan), []);
  assert.equal((await unlike(open.id, fan)).status, 200);
  await api('PATCH', `/api/songs/${open.id}/visibility`, { token: owner, json: { is_public: 1 } });
  assert.deepEqual(await liked(fan), [], 'a track that was un-liked while hidden does not come back');
});

test('existing databases are cleaned of demo content on boot, keeping real uploads', async () => {
  // build a legacy database (old demo rows + real data) before the server ever sees it
  process.env.PULSE_DATA_DIR = legacyDir;
  const { default: db } = await import('../db.js');
  const fixture = buildLegacyFixture(db, legacyDir);
  db.close();

  legacy = await startServer(legacyDir);
  apiLegacy = call(legacy);
  assert.match(legacy.logs(), /Removed leftover demo content: 6 track\(s\), 3 album\(s\), 5 artist\(s\)/);
  assert.match(legacy.logs(), /2 demo account\(s\)/);
  assert.match(legacy.logs(), /Kept legacy demo account kofi@pulse\.app/);

  const songs = (await apiLegacy('GET', '/api/songs')).body;
  assert.deepEqual(songs.map((s) => s.title).sort(), ['Kofi Real Upload', 'Luna Cover', 'Real Song']);
  assert.ok(songs.every((s) => s.file_path.startsWith('/media/uploads/')));
  assert.equal((await apiLegacy('GET', '/api/albums')).body.length, 1);
  assert.equal((await apiLegacy('GET', '/api/podcasts')).body.podcasts.length, 1);
  assert.ok(fixture.ids.real > 0);

  // the unused demo log-ins are gone; the one that owns real uploads was kept (the fixture's
  // hash really is demo123, so this proves the 401s below come from the account being deleted)
  const login = (email) => apiLegacy('POST', '/api/auth/login', { json: { email, password: 'demo123' } });
  assert.equal((await login('kofi@pulse.app')).status, 200);
  for (const email of ['amara@pulse.app', 'zara@pulse.app']) {
    assert.equal((await login(email)).status, 401, email);
  }
  assert.ok(!fs.existsSync(path.join(legacyDir, 'seed-manifest.json')));
});
