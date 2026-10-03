// End-to-end for linked (embedded) tracks: the whole flow over HTTP against a real
// server, with a stand-in oEmbed endpoint so the test never touches the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer, freePort, wavBytes, call } from './helpers.js';

const VIDEO_ID = 'dQw4w9WgXcQ';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-links-'));

let oembed;
let oembedUrl;
let server;
let api;
let token;

before(async () => {
  // A tiny stand-in for https://www.youtube.com/oembed.
  const port = await freePort();
  oembed = http.createServer((req, res) => {
    const target = new URL(req.url, 'http://localhost').searchParams.get('url') || '';
    if (!target.includes(VIDEO_ID)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      title: 'Midnight Drive',
      author_name: 'Pulse Test Channel',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    }));
  });
  await new Promise((resolve) => oembed.listen(port, '127.0.0.1', resolve));
  oembedUrl = `http://127.0.0.1:${port}/oembed`;

  server = await startServer(dataDir, { YOUTUBE_OEMBED_BASE: oembedUrl });
  api = call(server);

  const res = await api('POST', '/api/auth/register', {
    json: { name: 'Linker', username: 'linker', email: 'linker@example.test', password: 'secret123', artistName: 'Linker', favoriteGenres: ['Pop'] }
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  token = res.body.token;
});

after(async () => {
  server?.stop();
  await new Promise((resolve) => oembed.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const linkedForm = (extra = {}) => {
  const form = new FormData();
  form.append('title', 'Midnight Drive');
  form.append('artist_name', 'Pulse Test Channel');
  form.append('provider', 'youtube');
  form.append('external_id', VIDEO_ID);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
};

test('a YouTube link resolves to playable metadata before anything is saved', async () => {
  const res = await api('POST', '/api/link-preview', { token, json: { url: `https://youtu.be/${VIDEO_ID}` } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.provider, 'youtube');
  assert.equal(res.body.external_id, VIDEO_ID);
  assert.equal(res.body.title, 'Midnight Drive');
  assert.equal(res.body.artist, 'Pulse Test Channel');
  assert.equal(res.body.cover_url, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(res.body.embed_url, `https://www.youtube.com/embed/${VIDEO_ID}`);
});

test('Spotify, Apple Music and Audiomack links are refused with a reason', async () => {
  for (const [url, label] of [
    ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 'Spotify'],
    ['https://music.apple.com/us/album/midnight/1?i=2', 'Apple Music'],
    ['https://audiomack.com/artist/song/midnight', 'Audiomack']
  ]) {
    const res = await api('POST', '/api/link-preview', { token, json: { url } });
    assert.equal(res.status, 400, url);
    assert.match(res.body.error, new RegExp(label));
    assert.match(res.body.error, /YouTube/);
  }
});

test('a linked track saves with no audio file and plays through the embed', async () => {
  const res = await api('POST', '/api/songs', { token, form: linkedForm({ cover_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', genre: 'Afrobeats' }) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.provider, 'youtube');
  assert.equal(res.body.external_id, VIDEO_ID);
  assert.equal(res.body.file_path, null);
  assert.equal(res.body.source_url, null);
  assert.equal(res.body.cover_url, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

  const listed = await api('GET', '/api/songs');
  const found = listed.body.find((song) => song.id === res.body.id);
  assert.ok(found, 'the linked track is in the catalogue');
  assert.equal(found.provider, 'youtube');
});

test('a link resolves even when oEmbed cannot be reached, with derived artwork', async () => {
  const offline = await startServer(fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-links-off-')), {
    YOUTUBE_OEMBED_BASE: 'http://127.0.0.1:1/oembed' // nothing listens here
  });
  const offApi = call(offline);
  try {
    const registered = await offApi('POST', '/api/auth/register', {
      json: { name: 'Off', username: 'off', email: 'off@example.test', password: 'secret123', artistName: 'Off', favoriteGenres: ['Pop'] }
    });
    assert.equal(registered.status, 201);
    const res = await offApi('POST', '/api/link-preview', {
      token: registered.body.token,
      json: { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` }
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.metadata_found, false);
    assert.equal(res.body.title, null);
    assert.equal(res.body.cover_url, `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
  } finally {
    offline.stop();
  }
});

test('a linked track cannot be created out of thin air', async () => {
  const form = new FormData();
  form.append('title', 'Nothing');
  form.append('artist_name', 'Nobody');
  const res = await api('POST', '/api/songs', { token, form });
  assert.equal(res.status, 400);

  const badForm = linkedForm();
  badForm.set('external_id', 'not-a-video-id');
  const bad = await api('POST', '/api/songs', { token, form: badForm });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not valid/);
});

test('a streaming page pasted as a playback URL is refused, not stored', async () => {
  const form = new FormData();
  form.append('title', 'Dead link');
  form.append('artist_name', 'Nobody');
  form.append('source_url', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  const res = await api('POST', '/api/songs', { token, form });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Spotify/);
});

test('uploading real audio replaces the link, and re-linking drops the file', async () => {
  const created = await api('POST', '/api/songs', { token, form: linkedForm() });
  assert.equal(created.status, 201);

  const swap = new FormData();
  swap.append('title', 'Midnight Drive');
  swap.append('audio', new Blob([wavBytes()], { type: 'audio/wav' }), 'track.wav');
  const uploaded = await api('PUT', `/api/songs/${created.body.id}`, { token, form: swap });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.provider, null);
  assert.equal(uploaded.body.external_id, null);
  assert.match(uploaded.body.file_path, /^\/media\/uploads\//);

  const relink = new FormData();
  relink.append('title', 'Midnight Drive');
  relink.append('provider', 'youtube');
  relink.append('external_id', VIDEO_ID);
  const linked = await api('PUT', `/api/songs/${created.body.id}`, { token, form: relink });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.provider, 'youtube');
  assert.equal(linked.body.file_path, null);

  const media = await fetch(`${server.url}${uploaded.body.file_path}`);
  assert.equal(media.status, 404, 'the replaced upload was cleaned up');
});
