// Offline downloads for Pulse — the "downloaded" green-arrow layer, Spotify-style.
//
// Audio + cover bytes live in the Cache Storage API (named `pulse-offline-v1`,
// shared with the service worker so it can serve them when the device is
// offline). A small JSON index in localStorage tracks WHAT is downloaded and
// lets the UI render lists, progress and badges without any network.
//
// Playlist downloads also snapshot the playlist + its tracks, so the Downloads
// page can list and play them fully offline (no API call needed).
import { resolveLocalAudioUrl } from './localMusic.js';
import { getApiUrl, apiUrl } from './config.js';
import { resolveMediaUrl, mediaUrlCandidates } from './media-url.js';

const CACHE_NAME = 'pulse-offline-v1';
const INDEX_KEY = 'pulse_offline_index_v1';
export const OFFLINE_EVENT = 'pulse-offline-updated';

// In-memory cache of object URLs for downloaded tracks (revoked on remove/clear).
const blobUrlCache = new Map(); // songId → object URL (kept for page lifetime)
function revokeBlobUrl(songId) {
  const url = blobUrlCache.get(songId);
  if (!url) return;
  try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  blobUrlCache.delete(songId);
}

function emptyIndex() {
  return { songs: {}, playlists: {} };
}

export function readIndex() {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
    if (raw && raw.songs && raw.playlists) return raw;
  } catch { /* corrupted — rebuild */ }
  return emptyIndex();
}

function writeIndex(idx) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch { /* quota — ignore */ }
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
}

// Bump subscribers re-render (rows with green arrows, playlist toggles, …).
export function notifyOfflineChanged() {
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
}

async function cache() {
  return caches.open(CACHE_NAME);
}

// Absolute URL for a media path ("/media/…" → the API host).
//
// This must use the API base, not the page origin: in the Android app the page lives on
// https://localhost while the catalog and files live on the Pulse server, so resolving against
// the page origin asked the phone for a file that only exists on the server — the track showed up
// but would not play, and downloads cached the wrong address. On the website both are the same.
function mediaHref(path) {
  const api = getApiUrl();
  const resolved = resolveMediaUrl(path, api);
  if (/^(https?:|blob:|data:)/i.test(resolved)) return resolved;
  return new URL(resolved, window.location.origin).toString();
}

export function songAudioUrl(song) {
  // Linked tracks play through someone else's player and have no file to cache.
  if (song && song.provider) return null;
  // `audioUrl` is how a saved entry remembers the address it was stored under; without it a
  // downloaded song had no URL at playback time and silently refused to play.
  const raw = (song && (song.file_path || song.source_url || song.audioUrl)) || '';
  if (!raw) return null;
  if (/^(https?:|blob:|data:)/.test(raw)) return raw;
  return mediaHref(raw);
}

function candidateUrlsForSong(song) {
  const raw = (song && (song.file_path || song.source_url || song.audioUrl)) || '';
  if (!raw) return [];
  if (/^(https?:|blob:|data:)/i.test(String(raw))) return [String(raw)];
  return mediaUrlCandidates(raw, getApiUrl(), typeof window !== 'undefined' ? window.location.origin : '');
}

async function cacheAddWithFallback(url) {
  const c = await cache();
  // First try the simple path — cache.add follows redirects and is the common case
  try {
    await c.add(url);
    return true;
  } catch {}
  // Fallback for cross-origin bucket redirects that need CORS mode, or opaque responses
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return false;
    // Cache the final response under the original request URL so future c.match(url) finds it
    await c.put(url, res);
    return true;
  } catch {
    return false;
  }
}

async function findCachedResponse(url) {
  const candidates = (() => {
    if (/^(https?:|blob:|data:)/i.test(String(url))) return [url];
    // url is already absolute via songAudioUrl, but try both API and page origins just in case
    // the entry was cached under a different base (e.g., after a runtime URL change)
    const api = getApiUrl();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const list = [url];
    for (const cand of mediaUrlCandidates(url, api, origin)) {
      if (!list.includes(cand)) list.push(cand);
    }
    // Also try resolving raw path if url looks like /media/...
    if (String(url).startsWith('/media/')) {
      for (const cand of mediaUrlCandidates(url, api, origin)) {
        if (!list.includes(cand)) list.push(cand);
      }
    }
    return list;
  })();
  const c = await cache();
  for (const candidate of candidates) {
    try {
      const hit = await c.match(candidate);
      if (hit) return hit;
    } catch {}
  }
  return null;
}

export function hasPlayableAudio(song) {
  if (song && song.provider) return false;
  const hasSource = String(song.file_path || song.source_url || song.audioUrl || '').trim().length > 0;
  return Boolean(songAudioUrl(song) && hasSource);
}

export function isSongDownloaded(songId) {
  return Boolean(readIndex().songs[songId]);
}

export function isPlaylistDownloaded(playlistId) {
  return Boolean(readIndex().playlists[playlistId]);
}

// Download one track's audio (+ cover). Returns 'cached' | 'added' | 'no-audio' | 'failed'.
export async function downloadSong(song) {
  if (!hasPlayableAudio(song)) return 'no-audio';
  const audioUrl = songAudioUrl(song);
  // Check all candidate URLs — after a runtime URL change the same track may be known under
  // a different absolute host, and we don't want to treat it as new.
  let existing = null;
  try { existing = await findCachedResponse(audioUrl); } catch { existing = null; }
  let added = !existing;
  if (!existing) {
    const ok = await cacheAddWithFallback(audioUrl);
    if (!ok) return 'failed';
  }
  if (song.cover_url) {
    const coverUrl = mediaHref(song.cover_url);
    let coverHit = null;
    try { coverHit = await findCachedResponse(coverUrl); } catch {}
    if (!coverHit) {
      await cacheAddWithFallback(coverUrl).catch(() => {});
    }
  }
  const idx = readIndex();
  const isNew = !idx.songs[song.id];
  idx.songs[song.id] = {
    title: song.title || 'Untitled',
    artist_name: song.artist_name || '',
    cover_url: song.cover_url || null,
    duration_seconds: song.duration_seconds || 0,
    // Podcast episodes are cached through the same store; keep what the player
    // needs to route play counts and links back to the right entity.
    kind: song.kind === 'episode' ? 'episode' : 'song',
    episode_id: song.episode_id ?? null,
    podcast_id: song.podcast_id ?? null,
    audioUrl,
    at: Date.now()
  };
  writeIndex(idx);
  countSave(song);
  return added && isNew ? 'added' : 'cached';
}

/** The bearer token, if someone is signed in. Kept here to avoid importing the api module (which
 *  the offline store deliberately does not depend on — it must work with the network switched off). */
function authHeader() {
  try {
    const token = localStorage.getItem('pulse_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

/**
 * Tell the catalogue a track was saved. Fire-and-forget: the copy is already on the device, so a
 * failed counter (offline, signed out) must never turn a successful save into an error.
 */
function countSave(song) {
  if (typeof fetch !== 'function' || !song || !song.id) return;
  const path = song.kind === 'episode' && song.episode_id
    ? `/api/episodes/${song.episode_id}/saved`
    : `/api/songs/${song.id}/saved`;
  try {
    fetch(apiUrl(path), { method: 'POST', headers: authHeader() }).catch(() => {});
  } catch { /* ignore */ }
}

export async function removeSong(songId) {
  revokeBlobUrl(songId);
  const idx = readIndex();
  const entry = idx.songs[songId];
  delete idx.songs[songId];
  // Drop the bytes if no playlist snapshot still references this track.
  if (entry) {
    const stillUsed = Object.values(idx.playlists).some((pl) =>
      (pl.songs || []).some((s) => s.id === songId)
    );
    if (!stillUsed) {
      const c = await cache();
      // Try all candidates when deleting, to clean up after a host change
      const urls = [entry.audioUrl, ...mediaUrlCandidates(entry.audioUrl, getApiUrl(), typeof window !== 'undefined' ? window.location.origin : '')];
      for (const u of [...new Set(urls)]) {
        try { await c.delete(u); } catch {}
      }
    }
  }
  writeIndex(idx);
}

// Download every playable track of a playlist + snapshot it for offline use.
// onProgress({ done, total, title }) for the UI's "Downloading 3/12" state.
export async function downloadPlaylist(playlist, onProgress) {
  const songs = (playlist.songs || []).filter(hasPlayableAudio);
  const skipped = (playlist.songs || []).length - songs.length;
  let done = 0;
  for (const s of songs) {
    await downloadSong(s);
    done += 1;
    onProgress && onProgress({ done, total: songs.length, title: s.title });
  }
  const idx = readIndex();
  idx.playlists[playlist.id] = {
    name: playlist.name,
    description: playlist.description || null,
    cover_url: playlist.cover_url || null,
    user_id: playlist.user_id,
    at: Date.now(),
    skippedNoAudio: skipped,
    songs: songs.map((s) => ({ ...s }))  // full row snapshot → playable offline
  };
  writeIndex(idx);
  return { downloaded: done, skipped };
}

export async function removePlaylistDownloads(playlistId) {
  const idx = readIndex();
  const snapshot = idx.playlists[playlistId];
  // Revoke cached blob URLs for tracks that will become orphaned (not referenced elsewhere)
  if (snapshot && Array.isArray(snapshot.songs)) {
    const stillReferenced = new Set();
    for (const [otherId, other] of Object.entries(idx.playlists)) {
      if (String(otherId) === String(playlistId)) continue;
      for (const s of other.songs || []) stillReferenced.add(String(s.id));
    }
    for (const s of snapshot.songs) {
      if (!idx.songs[s.id] && !stillReferenced.has(String(s.id))) revokeBlobUrl(s.id);
    }
  }
  delete idx.playlists[playlistId];
  writeIndex(idx);
}

// Song ids are numeric; podcast episodes use the string key `ep-<id>`, so only
// coerce keys that really are numbers.
const decodeId = (id) => (/^\d+$/.test(id) ? Number(id) : id);

export function downloadedSongs() {
  return Object.entries(readIndex().songs).map(([id, e]) => ({ id: decodeId(id), ...e }));
}

export function downloadedPlaylists() {
  return Object.entries(readIndex().playlists).map(([id, e]) => ({ id: Number(id), ...e }));
}

export async function clearAllDownloads() {
  for (const [, url] of blobUrlCache) { try { URL.revokeObjectURL(url); } catch {} }
  blobUrlCache.clear();
  try { await caches.delete(CACHE_NAME); } catch { /* ignore */ }
  writeIndex(emptyIndex());
}

/* ---- playback resolution ---- */

// Prefer the locally cached copy for downloaded tracks (zero network, instant
// seek), fall back to the normal stream URL otherwise. Also used as the
// error-retry path when a stream fails while offline.
export async function resolvePlayableUrl(song) {
  if (!song) return null;
  if (song.kind === 'local' || song.local_id) {
    return resolveLocalAudioUrl(song.local_id || song.id);
  }
  const audioUrl = songAudioUrl(song);
  if (!audioUrl) return null;
  if (song.offline_only) {
    if (blobUrlCache.has(song.id)) return blobUrlCache.get(song.id);
    try {
      const hit = await findCachedResponse(audioUrl);
      if (hit) {
        const url = URL.createObjectURL(await hit.blob());
        blobUrlCache.set(song.id, url);
        return url;
      }
    } catch { /* offline-only never falls back to the network */ }
    return null;
  }
  if (isSongDownloaded(song.id) || !navigator.onLine) {
    if (blobUrlCache.has(song.id)) return blobUrlCache.get(song.id);
    try {
      const hit = await findCachedResponse(audioUrl);
      if (hit) {
        const url = URL.createObjectURL(await hit.blob());
        blobUrlCache.set(song.id, url);
        return url;
      }
    } catch { /* fall through to network */ }
  }
  return audioUrl;
}

// Used by <Cover> fallbacks so downloaded artwork also renders offline.
export async function cachedCoverBlobUrl(coverPath) {
  if (!coverPath) return null;
  try {
    const hit = await findCachedResponse(mediaHref(coverPath));
    // findCachedResponse already opens cache; for cover we can also try direct mediaHref fallback
    if (hit) return URL.createObjectURL(await hit.blob());
    // try raw path candidate as well
    const c = await cache();
    const direct = await c.match(mediaHref(coverPath)).catch(() => null);
    return direct ? URL.createObjectURL(await direct.blob()) : null;
  } catch {
    return null;
  }
}

/* ---- one-time cleanup of the retired demo catalog ----
   Older versions shipped generated demo audio (/media/audio/…) and covers (/media/covers/…); real uploads
   live in /media/uploads/. A device that saved any of that demo music for offline listening would keep
   listing and playing it long after the server stopped knowing about it, so it is removed once per device. */
const SEED_MEDIA = /^\/media\/(audio|covers)\//;
const SEED_PURGED_KEY = 'pulse_demo_media_purged_v1';

function isSeedMedia(url) {
  if (!url || typeof url !== 'string') return false;
  try { return SEED_MEDIA.test(new URL(url, window.location.origin).pathname); } catch { return false; }
}

/** Returns true when something was removed. Safe to call on every start: it only does work once. */
export async function purgeLegacyDemoDownloads() {
  try { if (localStorage.getItem(SEED_PURGED_KEY)) return false; } catch { return false; }

  let changed = false;
  const idx = readIndex();

  for (const [id, entry] of Object.entries(idx.songs)) {
    if (isSeedMedia(entry.audioUrl)) { delete idx.songs[id]; changed = true; }
  }
  for (const [id, snapshot] of Object.entries(idx.playlists)) {
    const all = snapshot.songs || [];
    const kept = all.filter((song) => !isSeedMedia(song.file_path || song.source_url));
    if (kept.length === all.length) continue;
    changed = true;
    if (!kept.length) delete idx.playlists[id]; // nothing real left in this saved playlist
    else idx.playlists[id] = { ...snapshot, songs: kept, cover_url: isSeedMedia(snapshot.cover_url) ? null : snapshot.cover_url };
  }

  try {
    const store = await cache();
    for (const request of await store.keys()) {
      if (isSeedMedia(request.url)) { await store.delete(request); changed = true; }
    }
  } catch { /* Cache Storage unavailable: the index above is what the screens read */ }

  if (changed) writeIndex(idx); // also tells open screens to refresh
  try { localStorage.setItem(SEED_PURGED_KEY, '1'); } catch { /* try again next start */ }
  return changed;
}

export { CACHE_NAME };
