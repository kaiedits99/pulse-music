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

const CACHE_NAME = 'pulse-offline-v1';
const INDEX_KEY = 'pulse_offline_index_v1';
export const OFFLINE_EVENT = 'pulse-offline-updated';

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

// Absolute URL the browser uses for a media path ("/media/…" → API host).
function mediaHref(path) {
  return new URL(path, window.location.origin).toString();
}

export function songAudioUrl(song) {
  const raw = (song && (song.file_path || song.source_url)) || '';
  if (!raw) return null;
  if (/^(https?:|blob:|data:)/.test(raw)) return raw;
  return mediaHref(raw);
}

export function hasPlayableAudio(song) {
  return Boolean(songAudioUrl(song) && String(song.file_path || '').length > 0);
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
  const c = await cache();
  const audioUrl = songAudioUrl(song);
  const existing = await c.match(audioUrl);
  let added = !existing;
  if (!existing) {
    try { await c.add(audioUrl); } catch { return 'failed'; }
  }
  if (song.cover_url) {
    try { await c.add(mediaHref(song.cover_url)); } catch { /* cover is optional */ }
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
  return added && isNew ? 'added' : 'cached';
}

export async function removeSong(songId) {
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
      await c.delete(entry.audioUrl).catch(() => {});
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
  try { await caches.delete(CACHE_NAME); } catch { /* ignore */ }
  writeIndex(emptyIndex());
}

/* ---- playback resolution ---- */

const blobUrlCache = new Map(); // songId → object URL (kept for page lifetime)

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
      const c = await cache();
      const hit = await c.match(audioUrl);
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
      const c = await cache();
      const hit = await c.match(audioUrl);
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
    const c = await cache();
    const hit = await c.match(mediaHref(coverPath));
    return hit ? URL.createObjectURL(await hit.blob()) : null;
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
