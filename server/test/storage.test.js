// The storage layer on its own: configuration rules, writing to a bucket, signed links, deleting.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readStorageConfig, createStorage, mediaName, contentTypeFor, attachmentHeader, uploadedFiles
} from '../storage.js';
import { startFakeS3 } from './fake-s3.js';

let s3;
let dir;

before(async () => {
  s3 = await startFakeS3();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-storage-'));
});
after(async () => {
  await s3.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const warnings = [];
const bucketStorage = (extra = {}) => createStorage({
  config: readStorageConfig(s3.env(extra)),
  uploadsDir: dir,
  log: { warn: (message) => warnings.push(message) }
});
const upload = (name, body = 'audio-bytes') => {
  const file = { path: path.join(dir, name), filename: name };
  fs.writeFileSync(file.path, body);
  return file;
};

test('storage settings: none means local, all four mean a bucket, a partial set is refused', () => {
  assert.equal(readStorageConfig({}), null);
  assert.equal(readStorageConfig({ S3_BUCKET: '   ' }), null, 'blank values count as unset');

  assert.throws(
    () => readStorageConfig({ S3_BUCKET: 'b', S3_ENDPOINT: 'https://x.example' }),
    /missing S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/
  );
  assert.throws(
    () => readStorageConfig({ S3_BUCKET: 'b', S3_ENDPOINT: 'not a url', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }),
    /S3_ENDPOINT must be a full URL/
  );

  const config = readStorageConfig({
    S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com//', S3_BUCKET: 'pulse', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
    S3_PUBLIC_BASE_URL: 'https://media.example.com/', S3_SIGNED_URL_TTL_SECONDS: '900'
  });
  assert.equal(config.endpoint, 'https://acct.r2.cloudflarestorage.com');
  assert.equal(config.region, 'auto', 'R2 expects the region "auto"');
  assert.equal(config.publicBaseUrl, 'https://media.example.com');
  assert.equal(config.signedUrlTtl, 900);
  assert.equal(readStorageConfig({
    S3_ENDPOINT: 'https://a.example', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_SIGNED_URL_TTL_SECONDS: '5'
  }).signedUrlTtl, 6 * 3600, 'an unreasonable lifetime falls back to the default');
});

test('only genuine upload paths are treated as stored files', () => {
  assert.equal(mediaName('/media/uploads/1700000000-ab12cd34.mp3'), '1700000000-ab12cd34.mp3');
  for (const bad of ['/media/uploads/../pulse.db', '/media/uploads/a/b.mp3', '/media/audio/old.wav', '/media/uploads/', '', null, '/media/uploads/.hidden']) {
    assert.equal(mediaName(bad), null, String(bad));
  }
  assert.equal(contentTypeFor('x.MP3'), 'audio/mpeg');
  assert.equal(contentTypeFor('x.flac'), 'audio/flac');
  assert.equal(contentTypeFor('x.png'), 'image/png');
  assert.equal(contentTypeFor('x.bin'), 'application/octet-stream');
  assert.deepEqual(uploadedFiles({ files: { audio: [{ n: 1 }], cover: [{ n: 2 }] } }).map((f) => f.n), [1, 2]);
  assert.deepEqual(uploadedFiles({ files: [{ n: 1 }, { n: 2 }] }).map((f) => f.n), [1, 2]);
  assert.deepEqual(uploadedFiles({ file: { n: 3 } }).map((f) => f.n), [3]);
  assert.deepEqual(uploadedFiles({}), []);
});

test('the "save as" header cannot be broken out of', () => {
  const header = attachmentHeader('my "song"\r\nSet-Cookie: x.mp3');
  assert.ok(!/[\r\n]/.test(header));
  assert.equal(header.split('"').length, 3, 'exactly one quoted file name');
  assert.match(attachmentHeader('café.mp3'), /filename\*=UTF-8''caf%C3%A9\.mp3/);
});

test('a file written to the bucket is stored under uploads/ with its type, and read back through a signed link', async () => {
  const storage = bucketStorage();
  assert.equal(storage.remote, true);
  const file = upload('1700000000-aaaaaaaa.wav', Buffer.from('0123456789'));
  await storage.put(file);

  const stored = s3.objects.get('uploads/1700000000-aaaaaaaa.wav');
  assert.ok(stored, 'object exists in the bucket');
  assert.equal(stored.body.toString(), '0123456789');
  assert.equal(stored.contentType, 'audio/wav');
  assert.match(stored.cacheControl, /immutable/);
  const put = s3.requests.findLast((r) => r.method === 'PUT');
  assert.match(put.credential, /^TESTKEYID\//, 'the write was signed with the configured key');

  const url = await storage.urlFor('1700000000-aaaaaaaa.wav');
  assert.ok(url.startsWith(s3.url), 'points at the bucket');
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '0123456789');
  const get = s3.requests.findLast((r) => r.method === 'GET');
  assert.equal(get.signedUrl, true, 'the link carries a signature');
  assert.match(get.credential, /^TESTKEYID\//);
  assert.equal(get.query['X-Amz-Expires'], String(6 * 3600));

  const ranged = await fetch(url, { headers: { Range: 'bytes=2-4' } });
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), '234');
});

test('downloads get a signed link that saves the file under the right name', async () => {
  const storage = bucketStorage();
  const file = upload('1700000000-bbbbbbbb.mp3');
  await storage.put(file);
  const res = await fetch(await storage.urlFor('1700000000-bbbbbbbb.mp3', { downloadAs: 'My Song.mp3' }));
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="My Song\.mp3"/);
});

test('with a public address configured, playback uses it directly and downloads stay signed', async () => {
  const storage = bucketStorage({ S3_PUBLIC_BASE_URL: 'https://media.example.com/' });
  assert.equal(await storage.urlFor('x.mp3'), 'https://media.example.com/uploads/x.mp3');
  const download = await storage.urlFor('x.mp3', { downloadAs: 'x.mp3' });
  assert.ok(download.startsWith(s3.url) && download.includes('X-Amz-Signature'));
});

test('deleting removes the stored object and any local copy; deleting twice is fine', async () => {
  const storage = bucketStorage();
  const file = upload('1700000000-cccccccc.mp3');
  await storage.put(file);
  assert.ok(s3.objects.has('uploads/1700000000-cccccccc.mp3'));
  await storage.remove('1700000000-cccccccc.mp3');
  assert.equal(s3.objects.has('uploads/1700000000-cccccccc.mp3'), false);
  assert.equal(fs.existsSync(file.path), false);
  await storage.remove('1700000000-cccccccc.mp3');
  await storage.remove('../../etc/passwd'); // not a valid name: ignored rather than looked up
  assert.ok(!s3.requests.some((r) => r.key.includes('passwd')));
});

test('a flaky bucket is retried, and a dead one is reported rather than swallowed', async () => {
  const storage = bucketStorage();
  const file = upload('1700000000-dddddddd.mp3', 'retry me');
  s3.state.failPuts = 2;
  await storage.put(file);
  assert.equal(s3.objects.get('uploads/1700000000-dddddddd.mp3').body.toString(), 'retry me', 'third attempt succeeded');

  const other = upload('1700000000-eeeeeeee.mp3');
  s3.state.failPuts = Infinity;
  await assert.rejects(() => storage.put(other));
  s3.state.failPuts = 0;
  assert.equal(s3.objects.has('uploads/1700000000-eeeeeeee.mp3'), false);
  assert.equal(warnings.length, 5, 'each failed attempt is reported once (2 + 3)');
  assert.match(warnings.at(-1), /eeeeeeee\.mp3 to the bucket failed \(attempt 3 of 3\)/);
});

test('local mode keeps files where they are, and deleting removes them', async () => {
  const storage = createStorage({ config: null, uploadsDir: dir });
  assert.equal(storage.remote, false);
  assert.equal(storage.describe(), 'local disk');
  const file = upload('1700000000-ffffffff.mp3');
  await storage.put(file);
  assert.ok(fs.existsSync(file.path), 'put changes nothing');
  await storage.remove('1700000000-ffffffff.mp3');
  assert.equal(fs.existsSync(file.path), false);
  await assert.rejects(() => storage.urlFor('x.mp3'), /needs a bucket/);
});

test('the connection check writes, reads through a signed link, deletes, and reports CORS', async () => {
  const storage = bucketStorage();
  const result = await storage.check({ origin: 'https://pulse.example' });
  assert.equal(result.wrote, true);
  assert.equal(result.read, true);
  assert.equal(result.deleted, true);
  assert.equal(result.cors, '*');
  assert.equal([...s3.objects.keys()].some((k) => k.includes('healthcheck')), false, 'cleans up after itself');
});
