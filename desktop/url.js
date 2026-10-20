// Where the desktop app points, and what counts as a valid address.
//
// Pulse for Windows is not a second product: it is a window onto the same website, so it shows the
// same catalog, signs in to the same accounts and shares the same messages. That makes this file
// the one thing worth getting right — a bad address here is a blank window.
//
// Kept as a plain CommonJS module with no Electron imports so it can be unit-tested anywhere.

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/**
 * Turn what someone typed into a URL the app can load.
 *   pulse-music.onrender.com        -> https://pulse-music.onrender.com
 *   http://localhost:8080/          -> http://localhost:8080
 *   https://example.com/pulse/      -> https://example.com/pulse
 * Returns { ok: true, url } or { ok: false, error } with a sentence to show the user.
 */
function normalizeWebsiteUrl(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, error: 'Enter the address of your Pulse website.' };
  if (/\s/.test(raw)) return { ok: false, error: 'That address has a space in it — check it and try again.' };

  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const withScheme = hadScheme ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: 'That does not look like a web address. Try something like https://pulse-music.onrender.com' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, error: 'Pulse opens a website, so the address has to start with http:// or https://.' };
  }

  // A dev server on this machine is plain http; anything without a scheme elsewhere is https.
  if (!hadScheme && LOOPBACK.test(parsed.host)) parsed.protocol = 'http:';

  const host = parsed.hostname;
  if (!host) return { ok: false, error: 'That address is missing a domain name.' };
  // A bare host with no dot is almost always a typo, unless it is this machine.
  if (!host.includes('.') && !LOOPBACK.test(parsed.host)) {
    return { ok: false, error: `"${host}" is not a full address — include the domain, e.g. pulse-music.onrender.com` };
  }
  // Plain http off the machine would send a password in the clear: say so rather than allow it.
  if (protocol === 'http:' && !LOOPBACK.test(parsed.host) && parsed.hostname !== 'localhost') {
    return {
      ok: false,
      error: 'Use https:// for a site that is not on this computer — http:// would send your password unencrypted.'
    };
  }

  parsed.hash = '';
  parsed.search = '';
  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.protocol}//${parsed.host}${path === '/' ? '' : path}` };
}

/** Same-origin check: everything else opens in the real browser. */
function isSameSite(target, base) {
  try {
    return new URL(target).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

module.exports = { normalizeWebsiteUrl, isSameSite };
