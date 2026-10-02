// scripts/start-with-litestream.sh: what it decides, in what order, and when it refuses to start.
// A stand-in "litestream" program records how it was called, so no real replication is involved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root, freePort, waitFor } from './helpers.js';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-start-'));
const fake = path.join(work, 'litestream');
const calls = path.join(work, 'calls.log');
const dataDir = path.join(work, 'data');

before(() => {
  fs.writeFileSync(fake, `#!/usr/bin/env bash
echo "$* | db=$PULSE_DB_PATH region=$S3_REGION interval=$PULSE_DB_SYNC_INTERVAL wait=$PULSE_SHUTDOWN_DELAY_SECONDS" >> "${calls}"
case "$1" in
  restore) exit "\${FAKE_RESTORE_EXIT:-0}" ;;
esac
exit 0
`, { mode: 0o755 });
});
after(() => fs.rmSync(work, { recursive: true, force: true }));

const BUCKET = { S3_ENDPOINT: 'http://127.0.0.1:9', S3_BUCKET: 'pulse', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
const callLog = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : []);

/** Runs the script. Resolves with its output and exit code once it stops; `until` lets a long-running server be stopped early. */
async function run(env, { until } = {}) {
  fs.rmSync(calls, { force: true });
  const port = await freePort();
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) if (/^(S3_|LITESTREAM_|KEEP_AWAKE|RENDER)/.test(key)) delete clean[key];
  const child = spawn('bash', ['scripts/start-with-litestream.sh'], {
    cwd: root,
    env: { ...clean, PORT: String(port), PULSE_DATA_DIR: dataDir, JWT_SECRET: 'test', ...env }
  });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  if (until) {
    await waitFor(() => until.test(output) || child.exitCode !== null, { timeoutMs: 15000, what: String(until) });
    child.kill();
  }
  const code = await exited;
  return { code, output };
}

test('with a bucket it restores first, then runs the server under Litestream', async () => {
  const { code, output } = await run({ ...BUCKET, LITESTREAM_BIN: fake });
  assert.equal(code, 0, output);
  const [restore, replicate, ...extra] = callLog();
  const config = path.join(root, 'litestream.yml');
  const db = path.join(dataDir, 'pulse.db');
  const settings = `db=${db} region=auto interval=5s wait=7`;
  assert.equal(restore, `restore -config ${config} -if-db-not-exists -if-replica-exists ${db} | ${settings}`);
  assert.equal(replicate, `replicate -config ${config} -exec node server/index.js | ${settings}`);
  assert.deepEqual(extra, []);
  assert.match(output, /Restoring the database from the bucket/);
  assert.match(output, /database changes are copied to bucket "pulse"/);
});

test('a custom region is passed through; the default suits R2', async () => {
  await run({ ...BUCKET, S3_REGION: 'eu-west-1', LITESTREAM_BIN: fake });
  assert.match(callLog()[0], /region=eu-west-1 /);
});

test('the copy interval can be tuned, and the server is told to outlast it when stopping', async () => {
  const cases = [['2', '2s', '4'], ['1', '1s', '3'], ['0', '1s', '3'], ['90', '20s', '22'], ['soon', '5s', '7'], ['', '5s', '7']];
  for (const [given, interval, wait] of cases) {
    await run({ ...BUCKET, LITESTREAM_BIN: fake, PULSE_DB_SYNC_SECONDS: given });
    assert.match(callLog()[1], new RegExp(`interval=${interval} wait=${wait}$`), `PULSE_DB_SYNC_SECONDS="${given}"`);
  }
});

test('without Litestream the server is not told to wait when stopping', async () => {
  const { output } = await run({ LITESTREAM_BIN: fake }, { until: /Server running/ });
  assert.ok(!/staying up/.test(output));
});

test('if the saved database cannot be restored it refuses to start rather than begin with an empty one', async () => {
  const { code, output } = await run({ ...BUCKET, LITESTREAM_BIN: fake, FAKE_RESTORE_EXIT: '1' });
  assert.equal(code, 1);
  assert.match(output, /could not restore the database from the bucket, so Pulse is NOT starting/);
  assert.equal(callLog().length, 1, 'only the restore ran; replication and the server never started');
  assert.ok(!/Server running/.test(output));
});

test('a bucket without the Litestream program is an error, not a silent downgrade', async () => {
  const { code, output } = await run({ ...BUCKET, LITESTREAM_BIN: path.join(work, 'missing') });
  assert.equal(code, 1);
  assert.match(output, /Litestream program was not found/);
  assert.ok(!/Server running/.test(output));
});

test('without a bucket it just starts the server', async () => {
  const { output } = await run({ LITESTREAM_BIN: fake }, { until: /Server running/ });
  assert.match(output, /No bucket is configured/);
  assert.match(output, /Uploads are kept on local disk/);
  assert.deepEqual(callLog(), [], 'Litestream is never involved');
});

test('Litestream can be switched off on purpose while uploads still use the bucket', async () => {
  const { output } = await run({ ...BUCKET, LITESTREAM_DISABLED: 'true', LITESTREAM_BIN: fake }, { until: /Server running/ });
  assert.match(output, /Litestream is turned off/);
  assert.match(output, /Uploads are kept on bucket "pulse"/);
  assert.deepEqual(callLog(), []);
});

test('a half-set bucket stops the server (it checks its own settings) without involving Litestream', async () => {
  const { code, output } = await run({ S3_BUCKET: 'pulse', LITESTREAM_BIN: fake });
  assert.equal(code, 1);
  assert.match(output, /only partly configured/);
  assert.deepEqual(callLog(), []);
});

test('the data folder is made if it does not exist yet, and a relative one is resolved', async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  await run({ ...BUCKET, LITESTREAM_BIN: fake });
  assert.ok(fs.existsSync(dataDir));
  const rel = path.relative(root, dataDir);
  await run({ ...BUCKET, LITESTREAM_BIN: fake, PULSE_DATA_DIR: rel });
  assert.match(callLog()[0], new RegExp(`db=${path.join(dataDir, 'pulse.db')} region=auto `), 'the database path handed to Litestream is absolute');
});
