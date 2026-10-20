// Does this copy of the app know when a newer one exists?
//
// Pulse for Android ships its interface *inside* the APK, so a web fix reaches an installed copy
// only when a new APK is installed. (The website and the Windows app load the live site, so they
// update themselves.) This module checks GitHub for a newer release and tells the UI, which shows
// a one-tap "Download" that opens the APK — the install itself still has to be confirmed by
// Android, because only the Play Store may install silently.
//
// Everything here is plain JavaScript with no React or Capacitor imports, so it is unit-tested.

export const RELEASES_API = 'https://api.github.com/repos/kaiedits99/pulse-music/releases/latest';
export const RELEASES_PAGE = 'https://github.com/kaiedits99/pulse-music/releases/latest';
const CHECK_KEY = 'pulse_update_check_v1';
const SIX_HOURS = 6 * 60 * 60 * 1000;

/** The version this bundle was built as (vite.config.js defines __APP_VERSION__). */
export const APP_VERSION = (() => {
  try {
    const raw = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0';
    return raw.replace(/^v/i, ''); // a tag like v1.0.2 reads as 1.0.2 in the UI
  } catch {
    return '0.0.0';
  }
})();

/** "1.2.10" -> [1, 2, 10]. Anything unparseable yields [] so it never wins a comparison. */
export function parseVersion(value) {
  const clean = String(value == null ? '' : value).trim().replace(/^v/i, '');
  const match = /^(\d+(?:\.\d+)*)/.exec(clean);
  if (!match) return [];
  return match[1].split('.').map((part) => Number(part));
}

/**
 * Compare dotted versions. Returns 1 when `a` is newer, -1 when `b` is newer, 0 when equal.
 * Missing parts count as zero, so "1.2" and "1.2.0" are the same release.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left.length && !right.length) return 0;
  if (!left.length) return -1;
  if (!right.length) return 1;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

/** The APK attached to a release, preferring the versioned name the workflows produce. */
export function apkAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => /\.apk$/i.test(asset.name || '')) || null;
}

/**
 * Turn a GitHub release into an update notice, or null when there is nothing newer.
 * `current` defaults to this bundle's version.
 */
export function updateFromRelease(release, current = APP_VERSION) {
  if (!release || release.draft || release.prerelease) return null;
  const latest = String(release.tag_name || '');
  if (!latest) return null;
  if (compareVersions(latest, current) <= 0) return null;
  const asset = apkAsset(release);
  return {
    version: latest.replace(/^v/i, ''),
    tag: latest,
    url: asset?.browser_download_url || release.html_url || RELEASES_PAGE,
    page: release.html_url || RELEASES_PAGE,
    size: asset?.size || 0,
    name: asset?.name || ''
  };
}

/** Cached result, so opening the app does not ask GitHub every time. */
export function readCachedCheck(now = Date.now()) {
  try {
    const raw = JSON.parse(localStorage.getItem(CHECK_KEY) || 'null');
    if (!raw || typeof raw.at !== 'number' || now - raw.at > SIX_HOURS) return null;
    return raw.value || null;
  } catch {
    return null;
  }
}

export function writeCachedCheck(value, now = Date.now()) {
  try { localStorage.setItem(CHECK_KEY, JSON.stringify({ at: now, value })); } catch { /* ignore */ }
}

/**
 * Ask GitHub for the newest release. Never throws: offline, rate-limited or a changed API all mean
 * "no update to tell you about" rather than an error in someone's music app.
 */
export async function checkForUpdate({ current = APP_VERSION, fetchImpl = globalThis.fetch, now = Date.now(), force = false } = {}) {
  if (!force) {
    const cached = readCachedCheck(now);
    if (cached !== null) return cached;
  }
  if (typeof fetchImpl !== 'function') return null;
  try {
    const res = await fetchImpl(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const update = updateFromRelease(await res.json(), current);
    writeCachedCheck(update, now);
    return update;
  } catch {
    return null;
  }
}
