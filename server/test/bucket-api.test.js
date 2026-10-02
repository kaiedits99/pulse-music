// The real server running with its uploads kept in a bucket (an in-process fake S3), driven over HTTP:
// what is stored where, what listeners are sent to, and how deletes and failures are handled.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeS3 } from './fake-s3.js';
import { startServer, call, wavBytes, pngBytes, waitFor, root } from './helpers.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-bucket-'));
const uploadsDir = path.join(dataDir, 'uploads');
let s3;
let server;
let api;
let token;

const keys = () => [...s3.objects.keys()].sort();
const localFiles = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []);
const nameOf = (mediaPath) => mediaPath.replace('/media/uploads/', '');
const bucketHas = (mediaPath) => s3.objects.has(`uploads/${nameOf(mediaPath)}`);

before(async () => {
  s3 = await startFakeS3();
  server = await startServer(dataDir, s3.env());
  api = call(server);
  const res = await api('POST', '/api/auth/register', {
    json: { name: 'Ada', username: 'ada', email: 'ada@example.test', password: 'secret123', artistName: 'Ada', favoriteGenres: ['Pop'] }
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  token = res.body.token;
});

after(async () => {
  server?.stop();
  await s3?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function songForm(fields = {}, { audio = true, cover = true } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ title: 'Lagos Nights', genre: 'Afrobeats', ...fields })) form.append(key, value);
  if (audio) form.append('audio', new Blob([wavBytes()], { type: 'audio/wav' }), 'track.wav');
  if (cover) form.append('cover', new Blob([pngBytes()], { type: 'image/png' }), 'cover.png');
  return form;
}

test('the server reports that it keeps uploads in the bucket', async () => {
  const res = await api('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.storage, 'bucket');
  assert.match(server.logs(), /Uploads are kept on bucket "pulse-test"/);
});

let song;

test('an upload lands in the bucket, is recorded, and leaves nothing behind on the server disk', async () => {
  const res = await api('POST', '/api/songs', { token, form: songForm() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  song = res.body;
  assert.match(song.file_path, /^\/media\/uploads\/[\w.-]+\.wav$/);
  assert.match(song.cover_url, /^\/media\/uploads\/[\w.-]+\.png$/);
  assert.ok(song.duration_seconds > 0, 'the length was still read from the file');

  assert.deepEqual(keys(), [`uploads/${nameOf(song.cover_url)}`, `uploads/${nameOf(song.file_path)}`].sort());
  assert.deepEqual(s3.objects.get(`uploads/${nameOf(song.file_path)}`).body, wavBytes());
  assert.equal(s3.objects.get(`uploads/${nameOf(song.file_path)}`).contentType, 'audio/wav');
  assert.equal(s3.objects.get(`uploads/${nameOf(song.cover_url)}`).contentType, 'image/png');

  await waitFor(() => localFiles().length === 0, { what: 'temporary upload copies to be removed' });
});

test('listeners are sent to a signed bucket link, and playback (including seeking) works through it', async () => {
  const res = await fetch(server.url + song.file_path, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = res.headers.get('location');
  assert.ok(location.startsWith(s3.url + '/pulse-test/uploads/'), location);
  assert.ok(location.includes('X-Amz-Signature='), 'the link is signed');
  assert.match(res.headers.get('cache-control'), /^private, max-age=3600$/);

  const whole = await fetch(server.url + song.file_path);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), wavBytes());

  const part = await fetch(server.url + song.file_path, { headers: { Range: 'bytes=44-99' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 44-99/${wavBytes().length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), wavBytes().subarray(44, 100));

  const cover = await fetch(server.url + song.cover_url);
  assert.equal(cover.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await cover.arrayBuffer()), pngBytes());

  const head = await fetch(server.url + song.file_path, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(wavBytes().length));
});

test('the download button gets a "save as" link, and the play count still moves', async () => {
  const before = (await api('GET', `/api/songs/${song.id}`)).body.downloads || 0;
  const res = await fetch(`${server.url}/api/songs/${song.id}/download`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.ok(location.searchParams.has('X-Amz-Signature'));
  assert.match(location.searchParams.get('response-content-disposition'), /^attachment; filename="[\w.-]+\.wav"/);

  const file = await fetch(location);
  assert.match(file.headers.get('content-disposition'), /^attachment; filename="[\w.-]+\.wav"/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), wavBytes());
  const after = (await api('GET', `/api/songs/${song.id}`)).body.downloads || 0;
  assert.equal(after, before + 1);
});

test('a rejected upload leaves nothing behind anywhere', async () => {
  const objectsBefore = keys();
  const noTitle = await api('POST', '/api/songs', { token, form: songForm({ title: '' }) });
  assert.equal(noTitle.status, 400);
  const noAudio = await api('POST', '/api/songs', { token, form: songForm({}, { audio: false }) });
  assert.equal(noAudio.status, 400);
  await waitFor(() => localFiles().length === 0, { what: 'temporary copies of the rejected uploads to be removed' });
  await waitFor(() => keys().join() === objectsBefore.join(), { what: 'bucket copies of the rejected uploads to be removed' });
});

test('when the bucket is unavailable the upload fails cleanly: no track is recorded, nothing is left over', async () => {
  const objectsBefore = keys();
  const tracksBefore = (await api('GET', '/api/songs?mine=1', { token })).body.length;
  s3.state.failPuts = Infinity;
  const res = await api('POST', '/api/songs', { token, form: songForm({ title: 'Never saved' }) });
  s3.state.failPuts = 0;
  assert.equal(res.status, 502);
  assert.match(res.body.error, /Could not store the upload/);
  assert.equal((await api('GET', '/api/songs?mine=1', { token })).body.length, tracksBefore);
  await waitFor(() => localFiles().length === 0, { what: 'temporary copies to be removed' });
  assert.deepEqual(keys(), objectsBefore);
  assert.match(server.logs(), /Copying .* to the bucket failed \(attempt 3 of 3\)/);
});

test('replacing a track\'s audio frees the old file and keeps the cover', async () => {
  const oldAudio = song.file_path;
  const form = new FormData();
  form.append('title', 'Lagos Nights (remaster)');
  form.append('audio', new Blob([wavBytes()], { type: 'audio/wav' }), 'again.wav');
  const res = await api('PUT', `/api/songs/${song.id}`, { token, form });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.notEqual(res.body.file_path, oldAudio);
  assert.equal(res.body.cover_url, song.cover_url);
  await waitFor(() => !bucketHas(oldAudio), { what: 'the replaced audio to be deleted from the bucket' });
  assert.ok(bucketHas(res.body.file_path));
  assert.ok(bucketHas(song.cover_url));
  song = res.body;
  await waitFor(() => localFiles().length === 0, { what: 'temporary copies to be removed' });
});

test('deleting a track removes its audio and cover from the bucket', async () => {
  const res = await api('DELETE', `/api/songs/${song.id}`, { token });
  assert.equal(res.status, 200);
  await waitFor(() => keys().length === 0, { what: 'the track\'s files to be deleted from the bucket' });
  assert.equal((await fetch(`${server.url}/api/songs/${song.id}/download`, { redirect: 'manual' })).status, 404);
});

test('a cover shared by a show and its episodes is only deleted once nothing uses it', async () => {
  const showForm = new FormData();
  showForm.append('title', 'Naija Tech Talk');
  showForm.append('cover', new Blob([pngBytes()], { type: 'image/png' }), 'show.png');
  const show = await api('POST', '/api/podcasts', { token, form: showForm });
  assert.equal(show.status, 201, JSON.stringify(show.body));

  const episodeForm = new FormData();
  episodeForm.append('title', 'Episode one');
  episodeForm.append('audio', new Blob([wavBytes()], { type: 'audio/wav' }), 'ep1.wav');
  const episode = await api('POST', `/api/podcasts/${show.body.id}/episodes`, { token, form: episodeForm });
  assert.equal(episode.status, 201, JSON.stringify(episode.body));
  assert.equal(episode.body.cover_url, show.body.cover_url, 'the episode shows the show\'s cover');
  assert.equal(keys().length, 2, 'one cover + one episode file');

  const download = await fetch(`${server.url}/api/episodes/${episode.body.id}/download`, { redirect: 'manual' });
  assert.equal(download.status, 302);
  assert.ok(new URL(download.headers.get('location')).searchParams.has('response-content-disposition'));

  const removeEpisode = await api('DELETE', `/api/episodes/${episode.body.id}`, { token });
  assert.equal(removeEpisode.status, 200);
  await waitFor(() => !bucketHas(episode.body.file_path), { what: 'the episode audio to be deleted' });
  assert.ok(bucketHas(show.body.cover_url), 'the show still uses the cover, so it stays');

  const removeShow = await api('DELETE', `/api/podcasts/${show.body.id}`, { token });
  assert.equal(removeShow.status, 200);
  await waitFor(() => keys().length === 0, { what: 'the show\'s cover to be deleted' });
});

test('files that already sit on the local disk (from before the bucket was set up) are still served directly', async () => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, '1600000000-legacy01.mp3'), 'old-local-bytes');
  const res = await fetch(server.url + '/media/uploads/1600000000-legacy01.mp3', { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'old-local-bytes');
  const missing = await fetch(server.url + '/media/uploads/..%2Fpulse.db', { redirect: 'manual' });
  assert.notEqual(missing.status, 302, 'odd names are never turned into bucket links');
  const db = await fetch(server.url + '/media/pulse.db', { redirect: 'manual' });
  assert.equal(db.status, 404, 'the database is still not downloadable');
});

test('a half-configured bucket stops the server from starting instead of silently using a disk that gets wiped', async () => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: '0', PULSE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-half-')), S3_BUCKET: 'pulse', S3_ENDPOINT: 'https://x.example.com' }
  });
  let log = '';
  child.stdout.on('data', (c) => { log += c; });
  child.stderr.on('data', (c) => { log += c; });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(log, /only partly configured — missing S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
});
