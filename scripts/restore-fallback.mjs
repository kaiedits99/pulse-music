#!/usr/bin/env node
// Tries to restore a single file from the bucket's fallback backup (fallback/pulse.db etc.)
// Used by start-with-litestream.sh when Litestream finds no replica.
// It uses the same S3 settings Pulse already has (S3_ENDPOINT etc.) and overwrites the
// local file if a backup exists and is larger than ~1KB.

import fs from 'node:fs';
import path from 'node:path';

const dest = process.argv[2];
const key = process.argv[3];
if (!dest || !key) {
  console.error('usage: restore-fallback.mjs <local-path> <s3-key>');
  process.exit(1);
}

// If local file already exists and is non-empty, Litestream already restored — nothing to do.
try {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    console.log(`fallback restore: ${dest} already present (${fs.statSync(dest).size} bytes), skipping`);
    process.exit(0);
  }
} catch {}

let config = null;
try {
  const { readStorageConfig } = await import('../server/storage.js');
  config = readStorageConfig(process.env);
} catch (e) {
  console.log(`fallback restore: no bucket configured (${e.message})`);
  process.exit(0);
}
if (!config) {
  console.log('fallback restore: no bucket configured, skipping');
  process.exit(0);
}

try {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  });
  const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  const body = await res.Body.transformToByteArray();
  if (!body || body.length < 1024) {
    console.log(`fallback restore: backup at ${key} is empty or missing (${body?.length || 0} bytes)`);
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(body));
  // Clean up WAL sidecars that would be stale
  for (const suffix of ['-wal', '-shm']) {
    try { fs.rmSync(dest + suffix, { force: true }); } catch {}
  }
  console.log(`fallback restore: restored ${dest} from s3://${config.bucket}/${key} (${body.length} bytes)`);
} catch (err) {
  if (err?.name === 'NoSuchKey' || err?.Code === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
    console.log(`fallback restore: no backup at s3://${config.bucket}/${key} yet`);
    process.exit(0);
  }
  console.log(`fallback restore: could not fetch s3://${config.bucket}/${key}: ${err.message}`);
  // Do not fail boot
  process.exit(0);
}
