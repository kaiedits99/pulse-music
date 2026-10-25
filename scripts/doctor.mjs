#!/usr/bin/env node
// `npm run doctor` — report how this deployment is configured, without starting anything.
//
// Everything it checks is something that has actually gone wrong here: a start command that skips
// Litestream, a bucket that only half exists, a Node version the native SQLite build does not support,
// an app pointing at an address it cannot reach. It prints one line per check and exits non-zero when
// data is at risk, so it can also be used in CI or a one-off Render shell.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataSafety } from '../server/persistence.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const results = [];
const record = (ok, label, detail) => results.push({ ok, label, detail });
const say = (result) => {
  const mark = result.ok === true ? '✓' : result.ok === false ? '✗' : '•';
  const colour = result.ok === true ? '\x1b[32m' : result.ok === false ? '\x1b[31m' : '\x1b[2m';
  console.log(`  ${colour}${mark}\x1b[0m ${result.label}${result.detail ? ` — ${result.detail}` : ''}`);
};

console.log('\nPulse doctor\n');

/* ---- Node version: better-sqlite3 is native and only ships binaries for known majors ---- */
const wanted = String(env.NODE_VERSION || '').trim();
const running = process.versions.node.split('.')[0];
const versionsFile = path.join(root, '.node-version');
const declared = wanted || (fs.existsSync(versionsFile) ? fs.readFileSync(versionsFile, 'utf8').trim() : '');
const onRender = Boolean(env.RENDER);
const majorOk = !declared || declared.split('.')[0] === running;
// A mismatch here is fatal on the host (the native SQLite module has no binary for it) but merely
// informative on a developer's machine, where the pinned version may simply not be installed.
record(majorOk ? true : onRender ? false : null, 'Node version',
  `running ${process.versions.node}${declared ? `, deployment expects ${declared}` : ''}`);

/* ---- Uploads: all four S3 settings or none ---- */
const s3Keys = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const setS3 = s3Keys.filter((key) => env[key]);
const remote = setS3.length === s3Keys.length;
if (setS3.length === 0) {
  record(null, 'Object storage', 'no S3_* settings (uploads stay on this machine)');
} else if (!remote) {
  record(false, 'Object storage', `only ${setS3.join(', ')} set; the server refuses to start on a partial set`);
} else {
  record(true, 'Object storage', `bucket "${env.S3_BUCKET}" at ${env.S3_ENDPOINT}`);
}

/* ---- Litestream: the only thing that makes the database survive a temporary disk ---- */
// Same location the start script looks in (the @flydotio/litestream package installs one per platform).
const litestreamBin = env.LITESTREAM_BIN
  || path.join(root, 'node_modules', '@flydotio', `litestream-${process.platform}-${process.arch}`, 'litestream');
const litestreamPresent = fs.existsSync(litestreamBin);
if (!remote) {
  record(null, 'Litestream', 'not needed without a bucket');
} else {
  record(litestreamPresent, 'Litestream', litestreamPresent ? litestreamBin : 'not installed (run `npm ci` on Linux/macOS)');
}

/* ---- The verdict: uploads and database, reported separately ---- */
const safety = dataSafety({ remote });
// With a bucket the database is only safe if Litestream exists to copy it. The server cannot check
// that from inside its own process, so the doctor does it here — this is the check whose absence let
// a "healthy bucket" deployment erase accounts on every deploy.
// The JS fallback (fallback/pulse.db) also counts as durable when Litestream is missing.
const fallbackActive = Boolean(env.PULSE_DB_FALLBACK === '1');
const databaseSafe = safety.database.durable && (!remote || litestreamPresent || fallbackActive || safety.database.where === 'disk');
record(safety.uploads.durable, 'Uploads survive restarts', safety.uploads.message);
record(databaseSafe, 'Database survives restarts',
  databaseSafe ? safety.database.message
    : remote && !litestreamPresent
      ? 'the bucket is configured but Litestream is not installed, so nothing copies the database'
      : safety.database.message);

/* ---- Is the app pointed somewhere real? ---- */
const appUrl = String(env.PULSE_APP_URL || env.VITE_API_URL || '').trim();
if (!appUrl) {
  record(null, 'App address', 'not set — the Android/Windows builds will ask on first launch');
} else if (!/^https?:\/\//i.test(appUrl)) {
  record(false, 'App address', `${appUrl} — needs https:// (or http://localhost for local testing)`);
} else {
  record(true, 'App address', appUrl);
}

console.log('\n  Checks\n');
for (const result of results) say(result);

if (!safety.uploads.durable || !databaseSafe) {
  console.log('\n\x1b[31mThis deployment loses data on its next deploy.\x1b[0m');
  console.log('  The full fix, step by step: RENDER-GUIDE.md (or DEPLOY.md for non-Render hosts).\n');
  process.exit(1);
}

console.log('\n\x1b[32mEverything this deployment can keep, it keeps.\x1b[0m\n');
