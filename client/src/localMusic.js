const DB_NAME = 'pulse-local-music-v1';
const DB_VERSION = 1;
const TRACK_STORE = 'tracks';
const AUDIO_STORE = 'audio';
export const LOCAL_MUSIC_EVENT = 'pulse-local-music-updated';

const objectUrls = new Map();
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|webm)$/i;

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser does not support offline music storage.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) db.createObjectStore(TRACK_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open offline music storage.'));
    request.onblocked = () => reject(new Error('Offline music storage is busy in another tab. Close the other Pulse tab and try again.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save local music.'));
    transaction.onabort = () => reject(transaction.error || new Error('Saving local music was cancelled.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not read offline music storage.'));
  });
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function trackId(file, relativePath) {
  const fingerprint = `${relativePath}|${file.size}|${file.lastModified || 0}`;
  return `local-${hash(fingerprint)}-${file.size.toString(36)}`;
}

function getTrackLabels(file, relativePath) {
  const baseName = file.name.replace(/\.[^.]+$/, '').trim() || file.name;
  const split = baseName.match(/^(.+?)\s[-–—]\s(.+)$/);
  const folders = relativePath.split('/').filter(Boolean).slice(0, -1);
  return {
    title: split ? split[2].trim() : baseName,
    artist_name: split ? split[1].trim() : (folders[folders.length - 1] || 'On this device')
  };
}

export function isAudioFile(file) {
  if (!file || typeof file.name !== 'string') return false;
  return String(file.type || '').toLowerCase().startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}

/** Import selected audio files into this browser's private offline library. */
export async function importLocalAudioFiles(entries) {
  const input = Array.from(entries || []);
  const files = input
    .map((entry) => {
      const file = entry?.file || entry;
      return {
        file,
        relativePath: entry?.relativePath || file?.webkitRelativePath || file?.name || ''
      };
    })
    .filter(({ file }) => isAudioFile(file));

  if (!files.length) return { imported: 0, skipped: input.length };

  const db = await openDatabase();
  try {
    const transaction = db.transaction([TRACK_STORE, AUDIO_STORE], 'readwrite');
    const done = transactionDone(transaction);
    const tracks = transaction.objectStore(TRACK_STORE);
    const audio = transaction.objectStore(AUDIO_STORE);
    const addedAt = Date.now();

    files.forEach(({ file, relativePath }) => {
      const labels = getTrackLabels(file, relativePath);
      const id = trackId(file, relativePath);
      tracks.put({
        id,
        ...labels,
        kind: 'local',
        file_name: file.name,
        relative_path: relativePath,
        mime_type: file.type || 'audio/*',
        size_bytes: file.size || 0,
        duration_seconds: 0,
        added_at: addedAt
      });
      audio.put(file, id);
    });

    await done;
    window.dispatchEvent(new CustomEvent(LOCAL_MUSIC_EVENT));
    return { imported: files.length, skipped: input.length - files.length };
  } catch (error) {
    if (error?.name === 'QuotaExceededError') {
      throw new Error('This device is out of browser storage. Remove some downloads or local tracks, then try again.');
    }
    throw error;
  } finally {
    db.close();
  }
}

export async function listLocalTracks() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(TRACK_STORE, 'readonly');
    const done = transactionDone(transaction);
    const tracks = await requestResult(transaction.objectStore(TRACK_STORE).getAll());
    await done;
    return (tracks || []).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  } finally {
    db.close();
  }
}

/** Resolve a stored file to a reusable object URL for the HTML audio player. */
export async function resolveLocalAudioUrl(id) {
  if (!id) return null;
  if (objectUrls.has(id)) return objectUrls.get(id);

  const db = await openDatabase();
  try {
    const transaction = db.transaction(AUDIO_STORE, 'readonly');
    const done = transactionDone(transaction);
    const blob = await requestResult(transaction.objectStore(AUDIO_STORE).get(id));
    await done;
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    objectUrls.set(id, url);
    return url;
  } finally {
    db.close();
  }
}

export async function removeLocalTrack(id) {
  if (!id) return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction([TRACK_STORE, AUDIO_STORE], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(TRACK_STORE).delete(id);
    transaction.objectStore(AUDIO_STORE).delete(id);
    await done;
    window.dispatchEvent(new CustomEvent(LOCAL_MUSIC_EVENT));
  } finally {
    db.close();
  }
}
