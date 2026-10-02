import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLegacyFixture } from './legacy-fixture.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cleanup-'));
process.env.PULSE_DATA_DIR = dataDir; // must be set before db.js is imported

const { default: db } = await import('../db.js');
const { purgeLegacyDemoData } = await import('../legacy-demo-cleanup.js');

const names = (sql, ...params) => db.prepare(sql).all(...params).map((row) => Object.values(row)[0]).sort();
const exists = (...parts) => fs.existsSync(path.join(dataDir, ...parts));

let fixture;
let summary;

before(() => {
  fixture = buildLegacyFixture(db, dataDir);
  summary = purgeLegacyDemoData(db, dataDir);
});

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('removes the seeded tracks, albums, playlists, podcasts and unused demo log-ins', () => {
  assert.equal(summary.songs, fixture.demo.songs);       // 4 generated + 2 featured placeholders
  assert.equal(summary.albums, fixture.demo.albums);
  assert.equal(summary.playlists, fixture.demo.playlists);
  assert.equal(summary.podcasts, fixture.demo.podcasts);
  assert.equal(summary.episodes, fixture.demo.episodes);
  assert.equal(summary.accounts, 2);                     // amara and zara
  assert.ok(summary.total > 0);

  assert.deepEqual(names('SELECT title FROM albums'), ['My Real Album']);
  assert.deepEqual(names('SELECT name FROM playlists'), ['Road Trip']);
  assert.deepEqual(names('SELECT title FROM podcasts'), ['Real Show']);
  assert.deepEqual(names('SELECT title FROM episodes'), ['Real episode']);
  assert.deepEqual(names('SELECT email FROM users'), ['admin@pulse.app', 'kofi@pulse.app', 'real@example.test']);
});

test('keeps every real upload exactly as it was', () => {
  assert.deepEqual(
    names('SELECT title FROM songs'),
    ['Kofi Real Upload', 'Luna Cover', 'Real Song']
  );
  const real = db.prepare('SELECT * FROM songs WHERE id = ?').get(fixture.ids.realSong);
  assert.equal(real.file_path, '/media/uploads/111-aaaa.mp3');
  assert.equal(real.uploaded_by, fixture.ids.real);
  assert.equal(real.genre, 'Afrobeats');
  assert.equal(real.is_public, 1);
  assert.equal(real.plays, 1000);
  for (const file of ['111-aaaa.mp3', '222-bbbb.mp3', '333-cccc.mp3', '444-dddd.mp3']) {
    assert.ok(exists('uploads', file), `uploads/${file} must survive`);
  }
});

test('real playlists and favourites lose only the demo tracks', () => {
  const inRoadTrip = db.prepare(
    'SELECT s.title FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id WHERE ps.playlist_id = ?'
  ).all(fixture.ids.roadTrip).map((row) => row.title).sort();
  assert.deepEqual(inRoadTrip, ['Kofi Real Upload', 'Luna Cover', 'Real Song']);
  assert.deepEqual(names('SELECT s.title FROM favorites f JOIN songs s ON s.id = f.song_id'), ['Real Song']);
  // the real user's podcast bookkeeping about the demo show is gone, nothing else is
  for (const table of ['podcast_subscriptions', 'saved_episodes', 'episode_progress']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c, 0, table);
  }
});

test('a seeded artist that real uploads hang off is kept, without its invented profile', () => {
  assert.deepEqual(names('SELECT name FROM artists'), ['Kofi Mensah', 'Luna Ray', 'Real Person']);
  for (const id of [fixture.ids.kofiArtist, fixture.ids.luna]) {
    const row = db.prepare('SELECT * FROM artists WHERE id = ?').get(id);
    assert.equal(row.bio, null);
    assert.equal(row.genre, null);
    assert.equal(row.country, null);
    assert.equal(row.avatar_url, null);
    assert.equal(row.followers, 0);
  }
});

test('a demo account that owns real data is kept and reported', () => {
  assert.deepEqual(summary.keptAccounts, ['kofi@pulse.app']);
  assert.ok(db.prepare("SELECT 1 FROM users WHERE email = 'admin@pulse.app' AND role = 'admin'").get(), 'admin untouched');
});

test('nothing references generated media any more', () => {
  const columns = [
    ['songs', 'cover_url'], ['songs', 'file_path'], ['albums', 'cover_url'], ['playlists', 'cover_url'],
    ['podcasts', 'cover_url'], ['episodes', 'cover_url'], ['episodes', 'file_path'], ['artists', 'avatar_url'], ['users', 'avatar_url']
  ];
  for (const [table, column] of columns) {
    const leftovers = db.prepare(
      `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} LIKE '/media/covers/%' OR ${column} LIKE '/media/audio/%'`
    ).get().c;
    assert.equal(leftovers, 0, `${table}.${column}`);
  }
});

test('deletes generated media and the seed manifest, but only what it generated', () => {
  assert.ok(!exists('seed-manifest.json'));
  assert.ok(!exists('covers'), 'covers directory removed once empty');
  assert.ok(!exists('audio', 'track-01.wav'));
  assert.ok(!exists('audio', 'podcast-the-signal-path-01.wav'));
  assert.ok(exists('audio', 'notes.txt'), 'unrelated files are left alone (and so is their folder)');
});

test('is idempotent, and a no-op on a database that never had demo data', () => {
  const again = purgeLegacyDemoData(db, dataDir);
  assert.equal(again.total, 0);
  assert.deepEqual(again.keptAccounts, ['kofi@pulse.app']);
  assert.deepEqual(names('SELECT title FROM songs'), ['Kofi Real Upload', 'Luna Cover', 'Real Song']);
});
