// The promise behind running on a host with a temporary disk: wipe the server's disk completely, start
// it again, and every account, track and file is still there. Uses the real Litestream program (copying
// the database to a local folder instead of a cloud bucket) and the real start script; uploads go to an
// in-process fake bucket. Skipped where the Litestream program is not installed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeS3 } from './fake-s3.js';
import { root, freePort, waitFor, call, wavBytes, pngBytes } from './helpers.js';

const probe = spawnSync(process.execPath, ['scripts/litestream-path.mjs'], { cwd: root, encoding: 'utf8' });
const available = probe.status === 0;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-ls-e2e-'));
const dataDir = path.join(work, 'data');
const replicaDir = path.join(work, 'replica');
const configFile = path.join(work, 'litestream.yml');
let s3;
const running = [];
after(async () => {
  // If an assertion failed part-way, make sure nothing is left running (Litestream and the server it started).
  for (const child of running) {
    if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
  await s3?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

async function boot() {
  const port = await freePort();
  const env = {
    ...process.env, ...s3.env(), PORT: String(port), PULSE_DATA_DIR: dataDir, JWT_SECRET: 'test',
    LITESTREAM_CONFIG: configFile, PULSE_DB_SYNC_SECONDS: '1'
  };
  const child = spawn('bash', ['scripts/start-with-litestream.sh'], { cwd: root, env, detached: true });
  running.push(child);
  let log = '';
  child.stdout.on('data', (c) => { log += c; });
  child.stderr.on('data', (c) => { log += c; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  await waitFor(() => log.includes('Server running') || child.exitCode !== null, { timeoutMs: 20000, what: 'the server to start' });
  assert.equal(child.exitCode, null, `the server exited early:\n${log}`);
  const server = { url: `http://127.0.0.1:${port}` };
  return {
    server,
    api: call(server),
    logs: () => log,
    /** A normal shutdown, like the host's. The server stays up a moment so the last changes are copied. */
    async stop() { child.kill('SIGTERM'); return exited; }
  };
}

const register = async (api, username) => {
  const res = await api('POST', '/api/auth/register', {
    json: { name: username, username, email: `${username}@example.test`, password: 'secret123', artistName: username, favoriteGenres: ['Pop'] }
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.token;
};

test('accounts, tracks and files survive wiping the server disk, repeatedly', { skip: !available && 'the Litestream program is not installed on this platform' }, async () => {
  s3 = await startFakeS3();
  fs.writeFileSync(configFile, [
    'dbs:',
    '  - path: ${PULSE_DB_PATH}',
    '    replicas:',
    '      - type: file',
    `        path: ${replicaDir}`,
    '        sync-interval: ${PULSE_DB_SYNC_INTERVAL}',
    ''
  ].join('\n'));

  // First ever start: nothing saved yet, nothing on disk.
  let run = await boot();
  assert.match(run.logs(), /no matching backups found/);
  const token = await register(run.api, 'ada');
  const form = new FormData();
  form.append('title', 'Survives restarts');
  form.append('genre', 'Afrobeats');
  form.append('audio', new Blob([wavBytes()], { type: 'audio/wav' }), 'a.wav');
  form.append('cover', new Blob([pngBytes()], { type: 'image/png' }), 'c.png');
  const upload = await run.api('POST', '/api/songs', { token, form });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const song = upload.body;
  // Stop straight away: the changes were made well inside one copy interval and must still be saved.
  assert.equal(await run.stop(), 0, 'a normal shutdown exits cleanly');

  // The host wipes the disk.
  fs.rmSync(dataDir, { recursive: true, force: true });

  // Second start: everything comes back from the saved copy and the bucket.
  run = await boot();
  assert.match(run.logs(), /restoring snapshot/);
  const login = await run.api('POST', '/api/auth/login', { json: { email: 'ada@example.test', password: 'secret123' } });
  assert.equal(login.status, 200, 'the account is back');
  const songs = await run.api('GET', '/api/songs');
  assert.deepEqual(songs.body.map((s) => s.title), ['Survives restarts'], 'the track is back');
  const audio = await fetch(run.server.url + song.file_path);
  assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wavBytes(), 'and so is its audio');

  // New activity after a restore is kept too, and survives a second wipe.
  await register(run.api, 'bola');
  assert.equal(await run.stop(), 0);
  fs.rmSync(dataDir, { recursive: true, force: true });

  run = await boot();
  for (const username of ['ada', 'bola']) {
    const again = await run.api('POST', '/api/auth/login', { json: { email: `${username}@example.test`, password: 'secret123' } });
    assert.equal(again.status, 200, `${username} is still registered after the second wipe`);
  }
  assert.equal((await run.api('GET', '/api/songs')).body.length, 1);
  await run.stop();
});
