import { resolveMediaUrl } from './media-url.js';

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

// `import.meta.env` exists under Vite (the shipped app) and is absent in plain Node, where the
// tests import this module to check media URLs.
const buildUrl = String((import.meta.env && import.meta.env.VITE_API_URL) || '').replace(/\/+$/, '');

export function getApiUrl() {
  try {
    return (getRuntimeUrl() || buildUrl).replace(/\/+$/, '');
  } catch {
    return buildUrl.replace(/\/+$/, '');
  }
}

// Static export for backward compatibility — prefer getApiUrl() where freshness matters
// (the runtime URL can be set from the UI and needs a reload, but offline helpers
// should always read the latest value).
export const API_URL = getApiUrl();

export function apiUrl(path) {
  return getApiUrl() + path;
}

// Resolve media/cover paths returned by the API (which are relative, e.g. "/media/uploads/x.wav").
// Absolute URLs pass through untouched; the API base is what a relative path is joined to, so the
// Android app (page on https://localhost, API elsewhere) asks the right host.
export function mediaUrl(path) {
  return resolveMediaUrl(path, getApiUrl());
}
