// Album, artist and playlist DETAIL pages, fetched by a signed-in user.
//
// These three routes build their song-visibility clause for the outer query but run it
// against a query that joins different table aliases. When the aliases drifted apart the
// clause referenced a table that was not in scope, so SQLite answered
// "no such column: al.uploaded_by" (and a.user_id / p.user_id) with a 500 — the detail
// pages came up empty for every signed-in visitor, while signed-out visitors saw them
// fine and the rest of the suite stayed green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, wavBytes, call } from './helpers.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-detail-'));

let server;
let api;
let owner;      // the artist who owns everything below
let visitor;    // a second artist, signed in, with no claim on any of it

before(async () => {
  server = await startServer(dataDir);
  api = call(server);
  owner = await register('Detail Owner', 'detailowner');
  visitor = await register('Detail Visitor', 'detailvisitor');
});

after(() => {
  server?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function register(name, username) {
  const res = await api('POST', '/api/auth/register', {
    json: { name, username, email: `${username}@example.test`, password: 'secret123', artistName: name, favoriteGenres: ['Pop'] }
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function upload(token, title, extra = {}) {
  const form = new FormData();
  form.append('title', title);
  form.append('genre', 'Pop');
  form.append('audio', new Blob([wavBytes()], { type: 'audio/wav' }), 'track.wav');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const res = await api('POST', '/api/songs', { token, form });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

/** The owner's artist profile, album and playlist, every time (ids are not stable across runs). */
async function ownerThings() {
  const artist = (await api('GET', '/api/artists?q=Detail%20Owner', { token: owner.token })).body.find((a) => a.name === 'Detail Owner');
  const album = (await api('GET', '/api/albums', { token: owner.token })).body.find((a) => a.title === 'Detail Album');
  const playlist = (await api('GET', '/api/playlists', { token: owner.token })).body.find((p) => p.name === 'Detail Playlist');
  assert.ok(artist && album && playlist, 'the owner fixture exists');
  return { artist, album, playlist };
}

test('the three detail routes answer a signed-in user instead of failing', async () => {
  const song = await upload(owner.token, 'Owner Public Track');

  const album = (await api('POST', '/api/albums', { token: owner.token, json: { title: 'Detail Album', genre: 'Pop' } })).body;
  const playlist = (await api('POST', '/api/playlists', { token: owner.token, json: { name: 'Detail Playlist' } })).body;
  const { artist } = await ownerThings();

  // Put the track in the album and the playlist so the detail pages have songs to return.
  const edit = new FormData();
  edit.append('title', 'Owner Public Track');
  edit.append('album_id', String(album.id));
  assert.equal((await api('PUT', `/api/songs/${song.id}`, { token: owner.token, form: edit })).status, 200);
  assert.equal((await api('POST', `/api/playlists/${playlist.id}/songs`, { token: owner.token, json: { song_id: song.id } })).status, 200);

  const checks = [
    ['album', await api('GET', `/api/albums/${album.id}`, { token: owner.token })],
    ['artist', await api('GET', `/api/artists/${artist.id}`, { token: owner.token })],
    ['playlist', await api('GET', `/api/playlists/${playlist.id}`, { token: owner.token })]
  ];
  for (const [what, res] of checks) {
    assert.equal(res.status, 200, `${what} detail returned ${res.status}: ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body.songs.map((s) => s.title), ['Owner Public Track'], `${what} detail returns its song`);
  }
});

test('a signed-in stranger sees the public song but not the owner\'s private one', async () => {
  const priv = await upload(owner.token, 'Owner Private Track', { is_public: '0' });
  assert.equal(priv.is_public, 0, 'the track really is private');

  const { album, artist, playlist } = await ownerThings();
  await api('POST', `/api/playlists/${playlist.id}/songs`, { token: owner.token, json: { song_id: priv.id } });

  for (const [what, res] of [
    ['album', await api('GET', `/api/albums/${album.id}`, { token: visitor.token })],
    ['artist', await api('GET', `/api/artists/${artist.id}`, { token: visitor.token })],
    ['playlist', await api('GET', `/api/playlists/${playlist.id}`, { token: visitor.token })]
  ]) {
    assert.equal(res.status, 200, `${what} detail returned ${res.status} for a visitor`);
    const titles = res.body.songs.map((s) => s.title);
    assert.ok(!titles.includes('Owner Private Track'), `${what} detail hides the owner's private track`);
  }

  // The owner still sees both of their own tracks in their playlist.
  const own = await api('GET', `/api/playlists/${playlist.id}`, { token: owner.token });
  assert.deepEqual(own.body.songs.map((s) => s.title).sort(), ['Owner Private Track', 'Owner Public Track']);
});

test('the three detail routes also behave for a signed-out visitor', async () => {
  const { album, artist, playlist } = await ownerThings();

  assert.equal((await api('GET', `/api/albums/${album.id}`)).status, 200);
  assert.equal((await api('GET', `/api/artists/${artist.id}`)).status, 200);
  assert.equal((await api('GET', `/api/playlists/${playlist.id}`)).status, 200);
  assert.equal((await api('GET', '/api/albums/9999')).status, 404);
  assert.equal((await api('GET', '/api/artists/9999')).status, 404);
  assert.equal((await api('GET', '/api/playlists/9999')).status, 404);
});
