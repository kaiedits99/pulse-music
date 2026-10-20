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
