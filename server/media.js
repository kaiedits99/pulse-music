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

/**
 * Runs right after multer. With a bucket configured it copies every uploaded file there before the
 * route handler records it, so the database never points at a file that was not stored. The temporary
 * local copies are removed once the response has gone out (the handlers read the WAV header from
 * them first). A request that ends up rejected leaves nothing behind, locally or in the bucket.
 */
export function keepUploads(req, res, next) {
  const files = uploadedFiles(req);
  if (!files.length) return next();

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
      console.error('[pulse] Could not store an upload:', err.message);
      forget(files);
      res.status(502).json({ error: 'Could not store the upload right now. Please try again in a moment.' });
    }
  );
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
  try {
    const local = path.join(uploadsDir, name);
    if (fs.existsSync(local)) return res.download(local, downloadName);
    if (!storage.remote) return res.status(404).json({ error: 'No audio available' });
    const url = await storage.urlFor(name, { downloadAs: downloadName });
    return res.status(302).set('Location', url).end();
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
