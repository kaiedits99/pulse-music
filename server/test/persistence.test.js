// Two things must be true, or the platform quietly eats artists' work:
//   1. a server that cannot keep its files must say so (the cause of vanishing accounts);
//   2. saving a track for offline listening must not hand out the audio file itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataSafety, describeDataSafety } from '../persistence.js';

test('a bucket means the data survives deploys', () => {
  const safety = dataSafety({ remote: true, env: {} });
  assert.equal(safety.persistent, true);
  assert.equal(safety.keeps, 'bucket');
  assert.match(safety.message, /object storage/i);
});

test('a declared disk also counts as safe', () => {
  assert.equal(dataSafety({ remote: false, env: { PULSE_PERSISTENT_DISK: 'true' } }).persistent, true);
  assert.equal(dataSafety({ remote: false, env: { PULSE_PERSISTENT_DISK: 'TRUE' } }).persistent, true);
});

test('no bucket and no disk is reported as lossy, with the reason and the fix', () => {
  const safety = dataSafety({ remote: false, env: {} });
  assert.equal(safety.persistent, false);
  assert.equal(safety.keeps, 'temporary');
  assert.match(safety.message, /erases accounts, songs/i);
  assert.match(safety.message, /S3_|disk/i, 'tell the operator what to change');
});

test('anything other than an explicit true does not claim the data is safe', () => {
  for (const value of ['', 'yes', '1', 'false', 'no']) {
    assert.equal(dataSafety({ remote: false, env: { PULSE_PERSISTENT_DISK: value } }).persistent, false, value);
  }
});

test('the startup line is a warning when data is at risk and plain news when it is not', () => {
  const risky = describeDataSafety(dataSafety({ remote: false, env: {} }), { host: 'Render' });
  assert.match(risky, /WARNING/);
  assert.match(risky, /Render/);
  assert.match(risky, /DEPLOY\.md/);

  const safe = describeDataSafety(dataSafety({ remote: true, env: {} }));
  assert.doesNotMatch(safe, /WARNING/);
  assert.match(safe, /safe across restarts/i);
});
