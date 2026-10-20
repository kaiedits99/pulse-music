// The app can only tell someone "there is a newer version" if the comparison itself is right —
// a false positive nags forever, a false negative hides a fix. These are the rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVersion, compareVersions, updateFromRelease, apkAsset, readCachedCheck, writeCachedCheck
} from './appVersion.js';

const release = (tag, assets = []) => ({
  tag_name: tag,
  html_url: `https://github.com/x/y/releases/tag/${tag}`,
  assets
});
const apk = (name = 'Pulse-1.0.2-android.apk') => ({
  name, size: 4_400_000, browser_download_url: `https://github.com/x/y/releases/download/v1.0.2/${name}`
});

test('versions parse leniently: a leading v, missing parts, junk', () => {
  assert.deepEqual(parseVersion('v1.2.10'), [1, 2, 10]);
  assert.deepEqual(parseVersion('1.2'), [1, 2]);
  assert.deepEqual(parseVersion(' 2.0.0-beta '), [2, 0, 0]);
  assert.deepEqual(parseVersion('nightly'), []);
  assert.deepEqual(parseVersion(null), []);
});

test('comparison is numeric per part, and "1.2" equals "1.2.0"', () => {
  assert.equal(compareVersions('1.0.2', '1.0.1'), 1);
  assert.equal(compareVersions('1.0.1', '1.0.2'), -1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('v2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1, '10 is newer than 9, not older');
});

test('a release newer than the installed version becomes a notice with the APK link', () => {
  const update = updateFromRelease(release('v1.0.2', [apk()]), '1.0.1');
  assert.equal(update.version, '1.0.2');
  assert.match(update.url, /Pulse-1\.0\.2-android\.apk$/);
  assert.equal(update.size, 4_400_000);
});

test('the installed version (or an older release) shows nothing', () => {
  assert.equal(updateFromRelease(release('v1.0.1', [apk()]), '1.0.1'), null);
  assert.equal(updateFromRelease(release('v1.0.0', [apk()]), '1.0.1'), null);
});

test('drafts and pre-releases are never offered', () => {
  assert.equal(updateFromRelease({ ...release('v9.9.9', [apk()]), draft: true }, '1.0.1'), null);
  assert.equal(updateFromRelease({ ...release('v9.9.9', [apk()]), prerelease: true }, '1.0.1'), null);
});

test('a release without an APK still points somewhere useful', () => {
  const update = updateFromRelease(release('v1.1.0', [{ name: 'notes.txt', browser_download_url: 'https://x/notes.txt' }]), '1.0.0');
  assert.equal(update.url, 'https://github.com/x/y/releases/tag/v1.1.0');
  assert.equal(apkAsset(release('v1.1.0', [{ name: 'notes.txt' }])), null);
});

test('the check result is cached, and expires after six hours', () => {
  globalThis.localStorage = {
    store: new Map(),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); }
  };
  const at = 1_000_000;
  writeCachedCheck({ version: '1.0.2' }, at);
  assert.deepEqual(readCachedCheck(at + 60_000), { version: '1.0.2' });
  assert.equal(readCachedCheck(at + 7 * 60 * 60 * 1000), null, 'stale entries are ignored');
});
