// The distinction these tests protect: uploads and the database are kept by different mechanisms, so
// "storage: bucket" can be true while accounts and songs are still being erased on every deploy.
// That exact half-state is what made the bug so confusing, so it gets its own tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataSafety, describeDataSafety } from '../persistence.js';

const bucketOnly = () => dataSafety({ remote: true, env: {} });
const bucketAndLitestream = () => dataSafety({ remote: true, env: { PULSE_DB_REPLICATED: '1' } });

test('a bucket with Litestream keeps everything', () => {
  const safety = bucketAndLitestream();
  assert.equal(safety.persistent, true);
  assert.equal(safety.keeps, 'bucket');
  assert.equal(safety.uploads.where, 'bucket');
  assert.equal(safety.database.where, 'bucket');
  assert.deepEqual(safety.issues, []);
  assert.match(safety.message, /object storage/i);
});

test('a bucket alone is NOT enough: uploads are safe, the database is not', () => {
  const safety = bucketOnly();
  assert.equal(safety.persistent, false, 'a deployment that erases accounts must not claim to be safe');
  assert.equal(safety.uploads.durable, true);
  assert.equal(safety.uploads.where, 'bucket');
  assert.equal(safety.database.durable, false);
  assert.equal(safety.database.replicated, false);
  assert.equal(safety.issues.length, 1);
  assert.equal(safety.issues[0].code, 'database-not-replicated');
  // The message has to name the actual cause and the actual fix, or it is just noise.
  assert.match(safety.message, /uploads are safe/i);
  assert.match(safety.message, /npm run start:render/);
});

test('a declared disk keeps both halves', () => {
  const safety = dataSafety({ remote: false, env: { PULSE_PERSISTENT_DISK: 'true' } });
  assert.equal(safety.persistent, true);
  assert.equal(safety.uploads.where, 'disk');
  assert.equal(safety.database.where, 'disk');
});

test('a disk still covers the database when a bucket holds the uploads', () => {
  const safety = dataSafety({ remote: true, env: { PULSE_PERSISTENT_DISK: 'true' } });
  assert.equal(safety.persistent, true);
  assert.equal(safety.uploads.where, 'bucket');
  assert.equal(safety.database.where, 'disk');
});

test('nothing configured reports both halves as lost, with the fix', () => {
  const safety = dataSafety({ remote: false, env: {} });
  assert.equal(safety.persistent, false);
  assert.equal(safety.keeps, 'temporary');
  assert.equal(safety.issues.length, 2);
  assert.deepEqual(safety.issues.map((i) => i.code), ['uploads-on-temporary-disk', 'database-on-temporary-disk']);
  assert.match(safety.message, /erases accounts, songs/i);
  assert.match(safety.message, /S3_|disk/i, 'tell the operator what to change');
});

test('only an explicit true / 1 counts — a stale or vague value never claims safety', () => {
  for (const value of ['', 'yes', '1', 'false', 'no', 'TRUE ']) {
    assert.equal(
      dataSafety({ remote: false, env: { PULSE_PERSISTENT_DISK: value } }).persistent,
      false,
      `PULSE_PERSISTENT_DISK=${JSON.stringify(value)}`
    );
  }
  for (const value of ['true', 'yes', '2', '']) {
    assert.equal(
      dataSafety({ remote: true, env: { PULSE_DB_REPLICATED: value } }).database.durable,
      false,
      `PULSE_DB_REPLICATED=${JSON.stringify(value)}`
    );
  }
});

test('the startup line names whichever half is at risk', () => {
  const half = describeDataSafety(bucketOnly(), { host: 'Render' });
  assert.match(half, /WARNING/);
  assert.match(half, /uploads are safe/i);
  assert.match(half, /DATABASE is not/);
  assert.match(half, /start:render/);

  const none = describeDataSafety(dataSafety({ remote: false, env: {} }), { host: 'Render' });
  assert.match(none, /WARNING/);
  assert.match(none, /Render/);
  assert.match(none, /DEPLOY\.md/);

  const safe = describeDataSafety(bucketAndLitestream());
  assert.doesNotMatch(safe, /WARNING/);
  assert.match(safe, /safe across restarts/i);
});
