// Unit tests for the link handling behind linked (embedded) tracks. No server needed:
// `describeLink` takes an injectable fetch, so oEmbed is exercised without the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeId, unsupportedProvider, describeLink, readLinkedFields } from '../youtube.js';

test('every YouTube link shape yields the same video id', () => {
  const id = 'dQw4w9WgXcQ';
  const shapes = [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&list=PLabc&index=3`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`
  ];
  for (const url of shapes) assert.equal(parseYouTubeId(url), id, url);
});

test('non-video and non-YouTube links are rejected', () => {
  const rejected = [
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?v=tooshort',
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://audiomack.com/artist/song/example',
    'not a url',
    ''
  ];
  for (const url of rejected) assert.equal(parseYouTubeId(url), null, url);
});

test('streaming catalogues are named so the refusal can explain itself', () => {
  assert.equal(unsupportedProvider('https://open.spotify.com/track/abc'), 'Spotify');
  assert.equal(unsupportedProvider('https://music.apple.com/us/album/x/1'), 'Apple Music');
  assert.equal(unsupportedProvider('https://audiomack.com/artist/song/x'), 'Audiomack');
  assert.equal(unsupportedProvider('https://soundcloud.com/artist/track'), 'SoundCloud');
  assert.equal(unsupportedProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(unsupportedProvider('https://cdn.example.com/track.mp3'), null);
});

test('a YouTube link becomes a linked-track payload with oEmbed metadata', async () => {
  const fetchImpl = async (endpoint) => {
    assert.match(endpoint, /youtube\.com\/oembed\?url=.*dQw4w9WgXcQ/);
    return { ok: true, json: async () => ({ title: 'A Song', author_name: 'A Channel', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg' }) };
  };
  const link = await describeLink('https://youtu.be/dQw4w9WgXcQ', { fetchImpl });
  assert.deepEqual(link, {
    provider: 'youtube',
    external_id: 'dQw4w9WgXcQ',
    embed_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    watch_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'A Song',
    artist: 'A Channel',
    cover_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg',
    metadata_found: true
  });
});

test('a link still resolves when oEmbed is unreachable, rate limited or broken', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })
  ]) {
    const link = await describeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { fetchImpl });
    assert.equal(link.external_id, 'dQw4w9WgXcQ');
    assert.equal(link.title, null);
    assert.equal(link.metadata_found, false);
    // The thumbnail address is derived from the id, so artwork still shows up.
    assert.equal(link.cover_url, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  }
});

test('unsupported services get an explanation instead of a saved dead track', async () => {
  for (const [url, label] of [
    ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 'Spotify'],
    ['https://music.apple.com/us/album/song/1?i=2', 'Apple Music'],
    ['https://audiomack.com/artist/song/example', 'Audiomack']
  ]) {
    await assert.rejects(
      describeLink(url, { fetchImpl: async () => { throw new Error('must not be called'); } }),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, new RegExp(label));
        return true;
      }
    );
  }
});

test('readLinkedFields validates what a save request sends', () => {
  assert.equal(readLinkedFields({}), null);
  assert.equal(readLinkedFields({ provider: '' }), null);
  assert.deepEqual(readLinkedFields({ provider: 'YouTube', external_id: 'dQw4w9WgXcQ' }), { provider: 'youtube', external_id: 'dQw4w9WgXcQ' });
  assert.throws(() => readLinkedFields({ provider: 'spotify', external_id: 'x' }), /not supported/);
  assert.throws(() => readLinkedFields({ provider: 'youtube', external_id: 'nope' }), /not valid/);
});
