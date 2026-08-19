// API base URL. Defaults to same-origin (single-origin web deployment).
// For the Android app (or split deployments), set VITE_API_URL at build time,
// OR — better — point the app at your backend at runtime from the login screen,
// which is stored in localStorage and wins over the build-time value.
const STORAGE_KEY = 'pulse_api_url';

export function getRuntimeUrl() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

export function setRuntimeUrl(v) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, v.trim());
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

const buildUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export const API_URL = (getRuntimeUrl() || buildUrl).replace(/\/+$/, '');

export function apiUrl(path) {
  return API_URL + path;
}

// Resolve media/cover paths returned by the API (which are relative, e.g. "/media/audio/x.wav").
export function mediaUrl(path) {
  if (!path) return path;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return API_URL + path;
}
