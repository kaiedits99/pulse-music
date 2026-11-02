import { apiUrl } from './config.js';

// Bearer tokens are kept only in memory as a compatibility path for native clients.
// Browsers also receive an HttpOnly session cookie and never persist auth tokens in Web Storage.
let sessionToken = null;
export function getToken() { return sessionToken; }
export function setToken(token) { sessionToken = token || null; }

// A request that never answers is worse than one that fails: the boot screen spins forever and the
// app looks blank. Phones on a weak network — or a host waking from sleep, which needs 30-60s — hit
// this often, so every request gets a deadline: long enough for a cold start, short enough that the
// UI can say what happened instead of hanging. Uploads get their own, generous one.
export const REQUEST_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 120_000;

function timeoutError() {
  const error = new Error('The server took too long to respond. Check your connection and try again.');
  error.status = 0;
  error.code = 'TIMEOUT';
  return error;
}

/** The low-level call every `api.*` helper uses. Exported so the deadline itself can be tested. */
export async function request(method, url, body, isForm, timeoutMs = REQUEST_TIMEOUT_MS) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  // The deadline is enforced two ways on purpose: the signal cancels the connection, and the race
  // guarantees the caller gets an answer even if the underlying fetch never settles (some WebView /
  // proxy combinations swallow an aborted request). Without the race the boot screen could wait
  // forever — the failure this exists to prevent.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const deadline = controller && timeoutMs > 0
    ? new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { controller.abort(); } catch { /* already settled */ }
        reject(timeoutError());
      }, timeoutMs);
    })
    : null;

  let res;
  try {
    const attempt = fetch(apiUrl(url), {
      method,
      headers,
      credentials: 'include',
      signal: controller ? controller.signal : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    });
    // The race reports a failure; this extra handler only stops the losing promise from being
    // reported as unhandled when the deadline wins.
    if (deadline) attempt.catch(() => {});
    res = await (deadline ? Promise.race([attempt, deadline]) : attempt);
  } catch (error) {
    if (error && error.code === 'TIMEOUT') throw error;
    if (error && error.name === 'AbortError') throw timeoutError();
    // A network failure is not a crash: give the UI a message it can show.
    const offline = new Error('Could not reach the Pulse server. Check your connection and try again.');
    offline.status = 0;
    offline.code = 'NETWORK';
    offline.cause = error;
    throw offline;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url, body) => request('DELETE', url, body),
  upload: (url, formData) => request('POST', url, formData, true, UPLOAD_TIMEOUT_MS),
  uploadPut: (url, formData) => request('PUT', url, formData, true, UPLOAD_TIMEOUT_MS)
};
