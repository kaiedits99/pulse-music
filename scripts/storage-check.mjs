// Tries your bucket settings for real, so problems show up now rather than on the first upload:
//
//   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com S3_BUCKET=pulse \
//   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... PULSE_ORIGIN=https://your-app.onrender.com \
//   npm run storage:check
//
// It writes, reads (through a signed link) and deletes one small test file, checks that browsers on
// your site may read from the bucket (needed for "Download for offline"), and, where the Litestream
// program is available, checks that Litestream can reach the bucket too. It never prints your keys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readStorageConfig, createStorage } from '../server/storage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const good = (message) => console.log(`  ✔ ${message}`);
const bad = (message) => { failed = true; console.log(`  ✖ ${message}`); };
const note = (message) => console.log(`  ! ${message}`);

console.log('\nChecking Pulse storage settings\n');

let config;
try {
  config = readStorageConfig(process.env);
} catch (err) {
  bad(err.message);
  process.exit(1);
}
if (!config) {
  bad('No bucket settings found. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (see DEPLOY.md).');
  process.exit(1);
}
good(`Settings found: bucket "${config.bucket}" at ${new URL(config.endpoint).host}`);

const HINTS = {
  InvalidAccessKeyId: 'The access key ID is not recognised. Copy it again from the R2 API token page.',
  SignatureDoesNotMatch: 'The secret access key is wrong (or has stray spaces). Copy it again; it is only shown once.',
  AccessDenied: 'The API token may not use this bucket. Give it "Object Read & Write" and include this bucket.',
  NoSuchBucket: 'No bucket with that name exists in this account. Check S3_BUCKET and the account ID in S3_ENDPOINT.',
  ENOTFOUND: 'The endpoint address could not be found. It should look like https://<account-id>.r2.cloudflarestorage.com',
  ECONNREFUSED: 'The endpoint refused the connection. Check S3_ENDPOINT.'
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-storage-check-'));
try {
  const storage = createStorage({ config, uploadsDir: scratch, log: { warn() {} } });
  const origin = String(process.env.PULSE_ORIGIN || '').trim().replace(/\/+$/, '');
  const result = await storage.check({ origin: origin || undefined });
  if (result.wrote) good('Wrote a test file to the bucket');
  if (result.read) good('Read it back through a signed link (this is how listeners will play uploads)');
  else bad('The test file could not be read back through a signed link');
  if (result.deleted) good('Deleted the test file');
  else bad('The test file could not be deleted. Is the API token allowed to delete objects?');

  if (!origin) {
    note('Set PULSE_ORIGIN=https://your-site to also check that browsers may download from the bucket.');
  } else if (result.cors === '*' || result.cors === origin) {
    good(`The bucket allows browsers on ${origin} to read files (offline downloads will work)`);
  } else {
    bad(`The bucket does not allow browsers on ${origin} to read files yet. Playback still works, but "Download for offline"`
      + ' will fail until you add the CORS policy from docs/r2-cors.json (bucket > Settings > CORS policy).');
  }
} catch (err) {
  const code = err.code || err.cause?.code || err.name;
  bad(`Could not use the bucket: ${code}${err.message && err.message !== code ? ` (${err.message})` : ''}`);
  if (HINTS[code]) console.log(`    ${HINTS[code]}`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

// Litestream has its own connection to the bucket, so check it separately.
const found = spawnSync(process.execPath, [path.join(root, 'scripts', 'litestream-path.mjs')], { encoding: 'utf8' });
const litestream = process.env.LITESTREAM_BIN || (found.status === 0 ? found.stdout.trim() : '');
if (!litestream || !fs.existsSync(litestream)) {
  note('The Litestream program is not installed here (it only installs on Linux and macOS), so the database copy was not checked.');
} else {
  // Listing the saved copies only needs a database path to exist, so use an empty stand-in rather than
  // the real data folder.
  const standIn = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-litestream-check-'));
  try {
    const dbPath = path.join(standIn, 'pulse.db');
    fs.writeFileSync(dbPath, '');
    const configFile = process.env.LITESTREAM_CONFIG || path.join(root, 'litestream.yml');
    const run = spawnSync(litestream, ['generations', '-config', configFile, dbPath], {
      env: { ...process.env, S3_REGION: config.region, PULSE_DB_PATH: dbPath },
      encoding: 'utf8',
      timeout: 45000
    });
    const output = `${run.stdout || ''}\n${run.stderr || ''}`;
    // Litestream reports a bucket it cannot use as an ERROR line but still exits 0, so read the output too.
    const errors = output.split('\n').filter((line) => /level=ERROR/.test(line));
    if (run.status === 0 && !errors.length) {
      const copies = output.split('\n').filter((line) => line.trim() && !/^name\s/.test(line)).length;
      good(copies
        ? 'Litestream can reach the bucket and found an earlier copy of the database'
        : 'Litestream can reach the bucket (no database copy saved yet, which is normal before the first deploy)');
    } else {
      const reason = (errors.length ? errors : output.trim().split('\n')).slice(-2).join(' | ') || run.error?.message || 'no output';
      bad(`Litestream could not use the bucket: ${reason.replace(/\s+/g, ' ')}`);
    }
  } finally {
    fs.rmSync(standIn, { recursive: true, force: true });
  }
}

console.log(failed ? '\nSome checks failed. Fix them and run this again.\n' : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
