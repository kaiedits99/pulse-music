// `npm run doctor` is the one command that answers "will my next deploy erase everything?" without
// starting a server. It must say the truth in all three situations, and exit non-zero when data is at
// risk so it can gate a deploy or be run in a Render shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { root } from './helpers.js';

const run = (env = {}) => {
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) {
    if (/^(S3_|RENDER|PULSE_DB_REPLICATED|PULSE_PERSISTENT_DISK|PULSE_APP_URL|VITE_API_URL)/.test(key)) delete clean[key];
  }
  const result = spawnSync(process.execPath, ['scripts/doctor.mjs'], { cwd: root, env: { ...clean, ...env }, encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
};

const BUCKET = {
  S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  S3_BUCKET: 'pulse',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret'
};

test('nothing configured: both halves fail and the exit code says so', () => {
  const { code, out } = run();
  assert.equal(code, 1);
  assert.match(out, /Uploads survive restarts/);
  assert.match(out, /Database survives restarts/);
  assert.match(out, /loses data on its next deploy/);
});

test('a bucket alone is caught as the half-state that erased accounts', () => {
  const { code, out } = run(BUCKET);
  // Uploads pass, the database does not — which is only visible because they are reported separately.
  assert.match(out, /✓\x1b\[0m Uploads survive restarts/);
  assert.match(out, /✗\x1b\[0m Database survives restarts/);
  assert.equal(code, 1);
});

test('a bucket plus Litestream is the healthy deployment', () => {
  const { code, out } = run({ ...BUCKET, PULSE_DB_REPLICATED: '1' });
  assert.match(out, /✓\x1b\[0m Uploads survive restarts/);
  assert.match(out, /✓\x1b\[0m Database survives restarts/);
  assert.match(out, /Everything this deployment can keep, it keeps/);
  assert.equal(code, 0);
});

test('a declared disk is enough on its own', () => {
  const { code, out } = run({ PULSE_PERSISTENT_DISK: 'true' });
  assert.match(out, /✓\x1b\[0m Database survives restarts/);
  assert.equal(code, 0);
});

test('a partial bucket setting is called out instead of being treated as configured', () => {
  const { out } = run({ S3_ENDPOINT: BUCKET.S3_ENDPOINT, S3_BUCKET: 'pulse' });
  assert.match(out, /only S3_ENDPOINT, S3_BUCKET set/);
  assert.match(out, /refuses to start/);
});
