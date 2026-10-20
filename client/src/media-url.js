// One place that decides where a media path ("/media/uploads/x.mp3") actually lives.
//
// The website and the Android app differ in exactly one way that matters here: in the browser the
// page and the API share an origin, while inside the app the page is `https://localhost` and the
// API is somewhere else entirely. Resolving a media path against the *page* origin therefore works
// on the web and points at the phone itself in the app — a track that is listed but never plays.
//
// So: an absolute URL is left alone, a configured API base wins, and the page origin is only the
// last resort for a same-origin deployment.
export function isAbsoluteMediaUrl(path) {
  return /^(https?:|blob:|data:)/i.test(String(path || ''));
}

export function resolveMediaUrl(path, apiBase = '') {
  if (!path) return path;
  const raw = String(path).trim();
  if (!raw) return raw;
  if (isAbsoluteMediaUrl(raw)) return raw;
  const base = String(apiBase || '').replace(/\/+$/, '');
  if (!base) return raw;
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

/**
 * Every URL worth trying for one media path, best first.
 *
 * Normally there is exactly one. The second candidate exists because the failure this replaced was
 * invisible: a wrong base produced a URL on the WebView's own origin, and nothing else was tried.
 * Trying the page origin as a fallback costs nothing when the first URL works (the player only ever
 * asks for the next one after a real error), and it rescues a build where the address was never
 * configured — the single-origin deployment the website itself uses.
 */
export function mediaUrlCandidates(path, apiBase = '', pageOrigin = '') {
  const first = resolveMediaUrl(path, apiBase);
  if (!first) return [];
  if (isAbsoluteMediaUrl(first)) return [first];

  const origin = String(pageOrigin || '').replace(/\/+$/, '');
  const candidates = [first];
  if (origin) {
    const fallback = resolveMediaUrl(path, origin);
    if (fallback && !candidates.includes(fallback)) candidates.push(fallback);
  }
  return candidates;
}
