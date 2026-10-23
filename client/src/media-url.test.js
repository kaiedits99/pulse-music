// The Android app and the website differ in one way that broke playback: the app's page lives on
// https://localhost while the catalog and audio live on the Pulse server. Anything that resolved a
// "/media/…" path against the *page* origin asked the phone for a file that only exists on the
// server, so a track was listed but could not play. These tests pin the rule that fixed it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMediaUrl, isAbsoluteMediaUrl } from './media-url.js';

const APP_ORIGIN = 'https://localhost';
const SERVER = 'https://pulse-music.onrender.com';

test('a relative media path is joined to the API base, never the page origin', () => {
  assert.equal(
    resolveMediaUrl('/media/uploads/track.mp3', SERVER),
    'https://pulse-music.onrender.com/media/uploads/track.mp3'
  );
  // A path with no leading slash still lands under the base.
  assert.equal(resolveMediaUrl('media/uploads/a.wav', SERVER), `${SERVER}/media/uploads/a.wav`);
  // A trailing slash on the base never doubles up.
  assert.equal(resolveMediaUrl('/media/u/a.mp3', `${SERVER}/`), `${SERVER}/media/u/a.mp3`);
});

test('absolute URLs are left exactly as they are', () => {
  for (const url of [
    'https://bucket.example.com/signed/a.mp3?X-Amz-Signature=abc',
    'http://127.0.0.1:8080/media/uploads/a.mp3',
    'blob:https://localhost/1234',
    'data:audio/wav;base64,AAAA'
  ]) {
    assert.equal(resolveMediaUrl(url, SERVER), url);
  }
});

test('same-origin deployments keep returning the path they were given', () => {
  // API_URL is empty on a single-origin deployment: the browser resolves "/media/…" itself.
  assert.equal(resolveMediaUrl('/media/uploads/a.mp3', ''), '/media/uploads/a.mp3');
});

test('nothing is invented for empty input', () => {
  assert.equal(resolveMediaUrl('', SERVER), '');
  assert.equal(resolveMediaUrl(null, SERVER), null);
  assert.equal(resolveMediaUrl('   ', SERVER), '', 'whitespace is not a path');
});

test('only real URL schemes count as absolute', () => {
  assert.equal(isAbsoluteMediaUrl('/media/uploads/a.mp3'), false);
  assert.equal(isAbsoluteMediaUrl('media/a.mp3'), false);
  assert.equal(isAbsoluteMediaUrl('https://x.test/a.mp3'), true);
  assert.equal(isAbsoluteMediaUrl('blob:https://localhost/x'), true);
  assert.equal(isAbsoluteMediaUrl('data:audio/wav;base64,AA'), true);
});

/**
 * The regression: in the app, `songAudioUrl` must return the server's address. This imports the
 * real offline module with the app's environment faked (localStorage holding the address the person
 * typed on the login screen, and a page origin of https://localhost).
 */
test('inside the Android app a track resolves to the server, not to localhost', async () => {
  const store = new Map([['pulse_api_url', SERVER]]);
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.window = {
    location: { origin: APP_ORIGIN },
    dispatchEvent: () => true
  };

  const { songAudioUrl } = await import(`./offline.js?app=${Date.now()}`);
  const url = songAudioUrl({ id: 7, file_path: '/media/uploads/song.mp3' });

  assert.equal(url, `${SERVER}/media/uploads/song.mp3`);
  assert.ok(!url.startsWith(APP_ORIGIN), 'the app must never ask itself for a catalog file');
  // Cover art goes through the same rule.
  const { mediaUrl } = await import(`./config.js?app=${Date.now()}`);
  assert.equal(mediaUrl('/media/uploads/cover.png'), `${SERVER}/media/uploads/cover.png`);
});

/**
 * Saved-for-offline playback. `resolvePlayableUrl` hands back a blob: URL holding the audio on the
 * device; the player must use exactly that. It used to rebuild the track's network address instead,
 * which is why a downloaded song worked only while the server was reachable.
 */
test('a saved copy plays from the device, never from the network', async () => {
  const { playbackCandidates } = await import(`./media-url.js?offline=${Date.now()}`);
  const blob = 'blob:https://localhost/8f1c-42b0';

  assert.deepEqual(playbackCandidates(blob, SERVER, APP_ORIGIN), [blob], 'a blob is the only candidate');
  assert.deepEqual(playbackCandidates('data:audio/wav;base64,AA', SERVER), ['data:audio/wav;base64,AA']);

  // A stream still gets the API host first, then the page origin as the fallback.
  assert.deepEqual(playbackCandidates('/media/uploads/a.mp3', SERVER, APP_ORIGIN), [`${SERVER}/media/uploads/a.mp3`]);
  assert.deepEqual(
    playbackCandidates('/media/uploads/a.mp3', '', APP_ORIGIN),
    ['/media/uploads/a.mp3', `${APP_ORIGIN}/media/uploads/a.mp3`]
  );
  assert.deepEqual(playbackCandidates('', SERVER), []);
});

test('a saved entry remembers the address it was stored under', async () => {
  // Downloads are indexed with `audioUrl`; playback reads file_path/source_url. Without the
  // fallback the saved song had no URL at all, so it failed before anything could be played.
  const store = new Map([['pulse_api_url', SERVER]]);
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.window = { location: { origin: APP_ORIGIN }, dispatchEvent: () => true };

  const { songAudioUrl } = await import(`./offline.js?saved=${Date.now()}`);
  const saved = { id: 7, title: 'Saved', audioUrl: `${SERVER}/media/uploads/song.mp3` };
  assert.equal(songAudioUrl(saved), `${SERVER}/media/uploads/song.mp3`);
  // A linked track has no file to save.
  assert.equal(songAudioUrl({ id: 8, provider: 'youtube', external_id: 'abc' }), null);
});
