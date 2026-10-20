// The desktop app is only as good as the address it is given, so that parsing is tested here
// rather than discovered as a blank window.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWebsiteUrl, isSameSite } = require('./url.js');

test('a bare domain becomes https', () => {
  assert.deepEqual(normalizeWebsiteUrl('pulse-music.onrender.com'), {
    ok: true, url: 'https://pulse-music.onrender.com'
  });
});

test('a trailing slash and a hash are removed, a path is kept', () => {
  assert.equal(normalizeWebsiteUrl('https://example.com/').url, 'https://example.com');
  assert.equal(normalizeWebsiteUrl('https://example.com/pulse/').url, 'https://example.com/pulse');
  assert.equal(normalizeWebsiteUrl('https://example.com/#/messages').url, 'https://example.com');
  assert.equal(normalizeWebsiteUrl('  https://example.com/pulse?x=1  ').url, 'https://example.com/pulse');
});

test('this computer may use plain http, with a port', () => {
  assert.deepEqual(normalizeWebsiteUrl('http://localhost:8080/'), { ok: true, url: 'http://localhost:8080' });
  assert.deepEqual(normalizeWebsiteUrl('localhost:5173'), { ok: true, url: 'http://localhost:5173' });
  assert.deepEqual(normalizeWebsiteUrl('http://127.0.0.1:8080'), { ok: true, url: 'http://127.0.0.1:8080' });
});

test('http anywhere else is refused, because it would expose the password', () => {
  const result = normalizeWebsiteUrl('http://pulse-music.onrender.com');
  assert.equal(result.ok, false);
  assert.match(result.error, /https/);
});

test('other schemes, empty input and typos get an explanation, not a crash', () => {
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', '', '   ']) {
    const result = normalizeWebsiteUrl(bad);
    assert.equal(result.ok, false, `${bad} should be rejected`);
    assert.ok(result.error.length > 10, 'the message should say what to do');
  }
  const typo = normalizeWebsiteUrl('pulse music');
  assert.equal(typo.ok, false);
  assert.match(typo.error, /space/i);
  const noDomain = normalizeWebsiteUrl('pulse');
  assert.equal(noDomain.ok, false);
  assert.match(noDomain.error, /domain/i);
});

test('same-site checks keep navigation inside the app', () => {
  assert.equal(isSameSite('https://pulse.example.com/messages', 'https://pulse.example.com'), true);
  assert.equal(isSameSite('https://accounts.google.com/signin', 'https://pulse.example.com'), false);
  assert.equal(isSameSite('not a url', 'https://pulse.example.com'), false);
});
