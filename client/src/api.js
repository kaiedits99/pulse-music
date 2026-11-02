import { apiUrl } from './config.js';

// Bearer tokens are kept only in memory as a compatibility path for native clients.
// Browsers also receive an HttpOnly session cookie and never persist auth tokens in Web Storage.
let sessionToken = null;
export function getToken() { return sessionToken; }
export function setToken(token) { sessionToken = token || null; }

async function request(method, url, body, isForm) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(apiUrl(url), {
    method,
    headers,
    credentials: 'include',
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined
  });

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
  upload: (url, formData) => request('POST', url, formData, true),
  uploadPut: (url, formData) => request('PUT', url, formData, true)
};
