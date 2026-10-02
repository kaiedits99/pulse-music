// The safety rule behind every delete: an uploaded file is only removed once nothing in the database
// still refers to it. Runs in local mode against a throwaway database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitFor, sleep } from './helpers.js';

// The data folder is chosen when db.js is first imported, so set it first.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-media-'));
process.env.PULSE_DATA_DIR = dataDir;
for (const key of Object.keys(process.env)) if (key.startsWith('S3_')) delete process.env[key];

const { default: db, uploadsDir } = await import('../db.js');
const { releaseMedia, storage, MEDIA_COLUMNS } = await import('../media.js');

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

let counter = 0;
/** Creates a file in the uploads folder and returns its public path. */
function stored(ext = '.mp3') {
  counter += 1;
  const name = `17000000${counter}-${String(counter).padStart(8, '0')}${ext}`;
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, name), 'x');
  return `/media/uploads/${name}`;
}
const exists = (mediaPath) => fs.existsSync(path.join(uploadsDir, mediaPath.replace('/media/uploads/', '')));
const insert = (table, row) => db.prepare(
  `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`
).run(...Object.values(row)).lastInsertRowid;

test('local mode really is local', () => {
  assert.equal(storage.remote, false);
});

test('every column that can hold an uploaded file is checked before a file is deleted', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const candidates = [];
  for (const { name } of tables) {
    for (const column of db.prepare(`PRAGMA table_info("${name}")`).all()) {
      if (/(_url|_path)$/.test(column.name) && column.name !== 'source_url') candidates.push(`${name}.${column.name}`);
    }
  }
  assert.ok(candidates.length >= 8, `expected the known media columns, found ${candidates.join(', ')}`);
  const unchecked = candidates.filter((c) => !MEDIA_COLUMNS.has(c.split('.')[1]));
  assert.deepEqual(unchecked, [], 'a new column that stores upload paths must be added to MEDIA_COLUMNS in media.js');
});

test('a file nothing refers to is deleted', async () => {
  const orphan = stored();
  releaseMedia([orphan]);
  await waitFor(() => !exists(orphan), { what: 'the unused file to be deleted' });
});

test('a file still used anywhere is kept, whichever table uses it', async () => {
  const artistId = insert('artists', { name: 'A' });
  const podcastId = insert('podcasts', { title: 'Show' });
  const cases = {
    'songs.file_path': (p) => insert('songs', { title: 'T', artist_id: artistId, file_path: p }),
    'songs.cover_url': (p) => insert('songs', { title: 'T', artist_id: artistId, cover_url: p }),
    'albums.cover_url': (p) => insert('albums', { title: 'Al', artist_id: artistId, cover_url: p }),
    'artists.avatar_url': (p) => insert('artists', { name: 'B', avatar_url: p }),
    'users.avatar_url': (p) => insert('users', { name: 'U', email: `u${Math.random()}@x.test`, password_hash: 'x', avatar_url: p }),
    'playlists.cover_url': (p) => insert('playlists', { name: 'P', cover_url: p }),
    'podcasts.cover_url': (p) => insert('podcasts', { title: 'S2', cover_url: p }),
    'episodes.file_path': (p) => insert('episodes', { podcast_id: podcastId, title: 'E', file_path: p }),
    'episodes.cover_url': (p) => insert('episodes', { podcast_id: podcastId, title: 'E', cover_url: p })
  };
  const kept = Object.entries(cases).map(([where, add]) => {
    const file = stored(where.endsWith('cover_url') || where.endsWith('avatar_url') ? '.png' : '.mp3');
    add(file);
    return [where, file];
  });
  releaseMedia(kept.map(([, file]) => file));
  await sleep(300); // deletion is asynchronous, so give it the chance to (wrongly) happen
  for (const [where, file] of kept) assert.ok(exists(file), `${where} still uses it, so it must stay`);
});

test('a file is released as soon as its last user is gone', async () => {
  const shared = stored('.png');
  const showId = insert('podcasts', { title: 'Shared cover', cover_url: shared });
  const episodeId = insert('episodes', { podcast_id: showId, title: 'Ep', cover_url: shared });

  db.prepare('DELETE FROM episodes WHERE id = ?').run(episodeId);
  releaseMedia([shared]);
  await sleep(300);
  assert.ok(exists(shared), 'the show still uses it');

  db.prepare('DELETE FROM podcasts WHERE id = ?').run(showId);
  releaseMedia([shared]);
  await waitFor(() => !exists(shared), { what: 'the file to go once the show is gone too' });
});

test('anything that is not an uploaded file is ignored', async () => {
  const keep = stored();
  const outside = path.join(dataDir, 'outside.txt');
  fs.writeFileSync(outside, 'keep me');
  releaseMedia([
    null, undefined, '', '/media/uploads/', '/media/uploads/../outside.txt', '/media/uploads/a/b.mp3',
    'https://example.com/song.mp3', '/media/audio/old.wav', path.join(uploadsDir, path.basename(keep))
  ]);
  releaseMedia(undefined);
  await sleep(300);
  assert.ok(exists(keep), 'only /media/uploads/<name> paths are ever touched');
  assert.ok(fs.existsSync(outside));
  assert.ok(fs.existsSync(path.join(dataDir, 'pulse.db')));
});
