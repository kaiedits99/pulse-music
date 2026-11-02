// Express-facing side of media storage: keeping uploads, serving them, and cleaning up after deletes.
// The storage itself (local disk or a bucket) lives in storage.js.
import fs from 'node:fs';
import path from 'node:path';
import db, { uploadsDir } from './db.js';
import { chatMediaDir } from './chat-db.js';
import { createStorage, readStorageConfig, mediaName, uploadedFiles, MEDIA_NAME } from './storage.js';

let config = null;
try {
  config = readStorageConfig(process.env);
} catch (err) {
  // Refusing to start is deliberate: a half-configured bucket would silently fall back to a disk that
  // may be wiped on the next restart.
  console.error(`[pulse] ${err.message}`);
  process.exit(1);
}

export const storage = createStorage({ config, uploadsDir });

/**
 * Ephemeral chat media: a separate folder and bucket prefix, so wiping a conversation can never
 * touch a track, and so its objects can be swept on their own. Links to it are always short-lived
 * and no-store — nothing here should end up in a browser cache after the 24 hours are up.
 */
export const chatStorage = createStorage({
  config,
  uploadsDir: chatMediaDir,
  prefix: 'chat/'
});

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const forget = (files) => Promise.allSettled(files.map((file) => storage.remove(file.filename)));

/** Check that uploaded bytes match the extension allow-list; filenames and browser MIME types are untrusted. */
export async function uploadSignatureIsValid(file) {
  if (['cover', 'image'].includes(file.fieldname) && Number(file.size) > 10 * 1024 * 1024) return false;
  const ext = path.extname(file.originalname || file.filename).toLowerCase();
  const header = Buffer.alloc(16);
  const handle = await fs.promises.open(file.path, 'r');
  let count;
  try { ({ bytesRead: count } = await handle.read(header, 0, header.length, 0)); }
  finally { await handle.close(); }
  const starts = (value, offset = 0) => header.subarray(offset, offset + value.length).equals(Buffer.from(value));
  if (['.jpg', '.jpeg'].includes(ext)) return starts([0xff, 0xd8, 0xff]);
  if (ext === '.png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === '.webp') return starts('RIFF') && starts('WEBP', 8);
  if (ext === '.gif') return starts('GIF87a') || starts('GIF89a');
  if (ext === '.wav') return starts('RIFF') && starts('WAVE', 8);
  if (ext === '.flac') return starts('fLaC');
  if (ext === '.ogg' || ext === '.oga') return starts('OggS');
  if (ext === '.m4a' || ext === '.mp4') return starts('ftyp', 4);
  if (ext === '.mp3') return starts('ID3') || (count >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  if (ext === '.aac') return count >= 2 && header[0] === 0xff && (header[1] & 0xf6) === 0xf0;
  // WebM/Matroska EBML, or an Ogg/WebM wrapper for voice notes.
  if (ext === '.webm' || ext === '.mkv') return starts([0x1a, 0x45, 0xdf, 0xa3]);
  return false;
}

/**
 * Runs right after multer. With a bucket configured it copies every uploaded file there before the
 * route handler records it, so the database never points at a file that was not stored. The temporary
 * local copies are removed once the response has gone out (the handlers read the WAV header from
 * them first). A request that ends up rejected leaves nothing behind, locally or in the bucket.
 */
export function keepUploads(req, res, next) {
  const files = uploadedFiles(req);
  if (!files.length) return next();

  Promise.all(files.map(uploadSignatureIsValid)).then((valid) => {
    if (valid.some((ok) => !ok)) {
      return Promise.all(files.map((file) => fs.promises.rm(file.path, { force: true })))
        .then(() => res.status(400).json({ error: 'The file contents do not match a supported media format' }));
    }
    if (!storage.remote) {
      // The file already sits where it will be served from; only a rejected request should remove it.
      res.once('close', () => { if (res.statusCode >= 400) forget(files); });
      return next();
    }

    mapLimit(files, 3, (file) => storage.put(file)).then(
      () => {
        if (req.socket.destroyed) { forget(files); return; } // the client left while we were uploading
        res.once('close', () => {
          if (res.statusCode >= 400) forget(files);
          else for (const file of files) fs.rm(file.path, { force: true }, () => {});
        });
        next();
      },
      (err) => {
        console.error('[pulse] Could not store an upload:', err.code || err.name || 'storage error');
        forget(files);
        res.status(502).json({ error: 'Could not store the upload right now. Please try again in a moment.' });
      }
    );
  }).catch(next);
}

/** GET /media/uploads/:name when the file is not on local disk: send the browser to the bucket. */
export async function redirectToBucket(req, res, next) {
  const { name } = req.params;
  if (!MEDIA_NAME.test(name)) return next();
  try {
    const url = await storage.urlFor(name);
    // A signed link stays valid for hours, so the browser may reuse the redirect for a while without
    // asking this server again (this matters for players that make several range requests per track).
    res.set('Cache-Control', storage.publicBaseUrl
      ? 'public, max-age=86400'
      : `private, max-age=${Math.min(3600, Math.floor(storage.signedUrlTtl / 2))}`);
    res.status(302).set('Location', url).end();
  } catch (err) {
    next(err);
  }
}

/** The "download" buttons: a local file is sent directly, a bucket file through a "save as" signed link. */
export async function sendDownload(res, next, mediaPath, downloadName) {
  const name = mediaName(mediaPath);
  if (!name) return res.status(404).json({ error: 'No audio available' });

  const toBucket = async () => {
    if (!storage.remote || res.headersSent) return next();
    const url = await storage.urlFor(name, { downloadAs: downloadName });
    return res.status(302).set('Location', url).end();
  };

  try {
    const local = path.join(uploadsDir, name);
    if (fs.existsSync(local)) {
      // With a bucket, the file on disk is only the staging copy of a fresh upload and is deleted
      // moments after the upload is copied across. Between the check above and the read it can
      // disappear, which used to surface as a 404 for a perfectly good track — so fall back to the
      // bucket instead of failing.
      return res.download(local, downloadName, (err) => {
        if (!err) return undefined;
        if (storage.remote && !res.headersSent) return toBucket().catch(next);
        return next(err);
      });
    }
    if (!storage.remote) return res.status(404).json({ error: 'No audio available' });
    return await toBucket();
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------------------------------
// Cleanup. Removing a track (or replacing its file) should free the stored file, but only when nothing
// else still refers to it: an album cover, for example, is shared by every track on that album.
// ---------------------------------------------------------------------------------------------------
export const MEDIA_COLUMNS = new Set(['file_path', 'cover_url', 'avatar_url', 'image_url']);
let referenceChecks = null;

function isReferenced(mediaPath) {
  if (!referenceChecks) {
    // Every column that can hold a media path, found from the schema itself so a new table cannot be forgotten.
    referenceChecks = [];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    for (const { name: table } of tables) {
      for (const column of db.prepare(`PRAGMA table_info("${table}")`).all()) {
        if (MEDIA_COLUMNS.has(column.name)) {
          referenceChecks.push(db.prepare(`SELECT 1 FROM "${table}" WHERE "${column.name}" = ? LIMIT 1`));
        }
      }
    }
  }
  return referenceChecks.some((statement) => statement.get(mediaPath));
}

/** Call after the database rows are gone. Never throws and never blocks the response. */
export function releaseMedia(mediaPaths) {
  for (const mediaPath of new Set((mediaPaths || []).filter(Boolean))) {
    const name = mediaName(mediaPath);
    if (!name || isReferenced(mediaPath)) continue;
    storage.remove(name).catch((err) => console.error(`[pulse] Could not delete ${name}:`, err.message));
  }
}
