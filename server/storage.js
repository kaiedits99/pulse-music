// Where uploaded audio and artwork live.
//
//  - Local (default): files stay in <data>/uploads and are served straight from disk. This is right
//    for local development and for any host that has a persistent disk.
//  - Bucket: files are copied to an S3-compatible bucket (Cloudflare R2 is the one Pulse is documented
//    against) and the app sends listeners to short-lived signed links. This is what lets Pulse keep its
//    uploads on hosts whose own disk is wiped on every restart, such as Render's free plan, and it keeps
//    audio traffic off the app server's bandwidth allowance.
//
// This module is deliberately free of database and Express code so it can be tested on its own.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const KEY_PREFIX = 'uploads/';
const SIGNED_URL_DEFAULT_TTL = 6 * 60 * 60; // seconds

/** Names multer generates: "<timestamp>-<hex><ext>". Anything else is never looked up. */
export const MEDIA_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;

/** "/media/uploads/<name>" -> "<name>", or null for anything that is not an uploaded file. */
export function mediaName(mediaPath) {
  const match = /^\/media\/uploads\/([^/?#]+)$/.exec(String(mediaPath || ''));
  return match && MEDIA_NAME.test(match[1]) ? match[1] : null;
}

const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
export const contentTypeFor = (name) => CONTENT_TYPES[path.extname(String(name)).toLowerCase()] || 'application/octet-stream';

/** Every file multer stored for this request, whichever multer helper (single/array/fields) was used. */
export function uploadedFiles(req) {
  const found = [];
  if (req.file) found.push(req.file);
  if (Array.isArray(req.files)) found.push(...req.files);
  else if (req.files && typeof req.files === 'object') for (const list of Object.values(req.files)) found.push(...list);
  return found;
}

/**
 * Reads the bucket settings from the environment.
 *  - nothing set                -> null (local mode)
 *  - everything required set    -> a config object
 *  - only some of it set        -> throws, because quietly falling back to a disk that gets wiped
 *                                  would lose every upload without anyone noticing
 */
export function readStorageConfig(env = process.env) {
  const value = (key) => String(env[key] || '').trim();
  const required = {
    S3_ENDPOINT: value('S3_ENDPOINT'),
    S3_BUCKET: value('S3_BUCKET'),
    S3_ACCESS_KEY_ID: value('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: value('S3_SECRET_ACCESS_KEY')
  };
  const given = Object.entries(required).filter(([, v]) => v);
  if (!given.length) return null;
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Object storage is only partly configured — missing ${missing.join(', ')}. `
      + 'Set all four of S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or none of them (see DEPLOY.md).'
    );
  }
  if (!/^https?:\/\/[^/]+/i.test(required.S3_ENDPOINT)) {
    throw new Error('S3_ENDPOINT must be a full URL such as https://<account-id>.r2.cloudflarestorage.com');
  }
  const ttl = parseInt(value('S3_SIGNED_URL_TTL_SECONDS'), 10);
  return {
    endpoint: required.S3_ENDPOINT.replace(/\/+$/, ''),
    bucket: required.S3_BUCKET,
    accessKeyId: required.S3_ACCESS_KEY_ID,
    secretAccessKey: required.S3_SECRET_ACCESS_KEY,
    region: value('S3_REGION') || 'auto',
    // Optional: a permanent public address for the bucket (for example a custom domain connected to it).
    publicBaseUrl: value('S3_PUBLIC_BASE_URL').replace(/\/+$/, ''),
    signedUrlTtl: Number.isFinite(ttl) && ttl >= 60 && ttl <= 7 * 24 * 3600 ? ttl : SIGNED_URL_DEFAULT_TTL
  };
}

/** A header value that makes browsers save the file under `name` (ASCII fallback + UTF-8 form). */
export function attachmentHeader(name) {
  const clean = String(name || 'download').replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'download';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createStorage({ config, uploadsDir, client: injectedClient, log = console }) {
  const remote = Boolean(config);
  const keyFor = (name) => KEY_PREFIX + name;
  const localPath = (name) => path.join(uploadsDir, name);

  const client = remote
    ? (injectedClient || new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Only add integrity checksums where a request needs one. The newer SDK default adds trailing
      // checksums that some S3-compatible services reject.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      // The SDK logs a warning for every failed streamed upload; put() below retries and reports instead.
      logger: { debug() {}, info() {}, warn() {}, error() {} }
    }))
    : null;

  async function putOnce(file) {
    const { size } = await fs.promises.stat(file.path);
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: keyFor(file.filename),
      Body: fs.createReadStream(file.path), // streamed from disk: a 60 MB upload never sits in memory
      ContentLength: size,
      ContentType: contentTypeFor(file.filename),
      CacheControl: 'public, max-age=31536000, immutable' // names are unique and never rewritten
    }));
  }

  return {
    remote,
    publicBaseUrl: remote ? config.publicBaseUrl : '',
    signedUrlTtl: remote ? config.signedUrlTtl : 0,

    describe() {
      if (!remote) return 'local disk';
      return `bucket "${config.bucket}" at ${new URL(config.endpoint).host}`;
    },

    /** Makes a freshly uploaded file permanent. A no-op in local mode, where it is already in place. */
    async put(file) {
      if (!remote) return;
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try { return await putOnce(file); } catch (err) {
          lastError = err;
          log.warn(`[pulse] Copying ${file.filename} to the bucket failed (attempt ${attempt} of 3): ${err.name}: ${err.message}`);
          if (attempt < 3) await sleep(attempt * 400);
        }
      }
      throw lastError;
    },

    /** Deletes a stored file (and any local copy). A missing file is not an error. */
    async remove(name) {
      if (!MEDIA_NAME.test(name)) return;
      if (remote) await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: keyFor(name) }));
      await fs.promises.rm(localPath(name), { force: true });
    },

    /**
     * Where a browser should fetch `name` from. Downloads always use a signed link so the response can
     * carry a "save as" file name; plain playback uses the public address when one is configured.
     */
    async urlFor(name, { downloadAs } = {}) {
      if (!remote) throw new Error('urlFor needs a bucket');
      if (config.publicBaseUrl && !downloadAs) return `${config.publicBaseUrl}/${keyFor(name)}`;
      return getSignedUrl(client, new GetObjectCommand({
        Bucket: config.bucket,
        Key: keyFor(name),
        ...(downloadAs ? { ResponseContentDisposition: attachmentHeader(downloadAs) } : {})
      }), { expiresIn: config.signedUrlTtl });
    },

    /** Round-trips a small object (write, signed read, delete). Used by `npm run storage:check`. */
    async check({ origin } = {}) {
      if (!remote) throw new Error('No bucket is configured');
      const name = `healthcheck-${crypto.randomBytes(6).toString('hex')}.txt`;
      const body = `pulse storage check ${new Date().toISOString()}`;
      const tmp = path.join(uploadsDir, name);
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      await fs.promises.writeFile(tmp, body);
      const result = { name, wrote: false, read: false, deleted: false, cors: null };
      try {
        await this.put({ path: tmp, filename: name });
        result.wrote = true;
        const res = await fetch(await this.urlFor(name), origin ? { headers: { Origin: origin } } : undefined);
        result.read = res.ok && (await res.text()) === body;
        if (origin) result.cors = res.headers.get('access-control-allow-origin');
      } finally {
        await fs.promises.rm(tmp, { force: true });
        try { await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: keyFor(name) })); result.deleted = true; } catch { /* reported below */ }
      }
      return result;
    }
  };
}
