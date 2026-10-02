// Removes the demo content that earlier versions of Pulse seeded on first boot.
//
// Pulse now starts completely empty: the catalog is made only of tracks that people
// upload. A database created by an older version, though, still holds the old demo
// rows (sample artists, albums, playlists, tracks, podcasts and demo log-ins) plus the
// generated audio/artwork files behind them. This runs on every boot, is idempotent,
// and costs a handful of indexed queries when there is nothing left to remove.
//
// It is deliberately conservative — real data must never be collateral damage:
//   * rows are matched by what the old seeder produced: generated `/media/audio/…` and
//     `/media/covers/…` URLs together with the exact seeded names. Uploads live in
//     `/media/uploads/…` and can never match;
//   * a seeded artist that real uploads were attached to is kept (stripped of its
//     invented bio and stats) so those uploads stay where they are;
//   * a demo account is only deleted when it owns nothing at all;
//   * the private admin account is never touched.
import fs from 'fs';
import path from 'path';

const DEMO_ARTISTS = [
  'Luna Ray', 'The Copper Vines', 'Velvet Echo', 'Silver Youth', 'SOLARIS', 'AeroFlux',
  'Amara Okafor', 'Zara Bello', 'Kofi Mensah'
];
// Placeholder catalogs (track metadata only, no audio) that older versions imported.
const FEATURED_ARTISTS = ['Thalia Falcon', 'ŻYŃY'];
const DEMO_ALBUMS = [
  'Starlight Boulevard', 'Wildflower State', 'Shadow Horizon', 'Anthem Season', 'Nova Frequency',
  'Hyperdrive Euphoria', 'Golden Hour', 'Velvet Nights', 'Tides of Gold'
];
const DEMO_PLAYLISTS = ['Stadium Anthems', 'Festival Euphoria', 'Pop & K-Pop Stars', 'Afrobeats & Soul'];
const DEMO_PODCASTS = ['The Signal Path', 'Lagos After Dark', 'Liner Notes', 'Indie Business', 'Quiet Hours'];
const DEMO_ACCOUNTS = ['amara@pulse.app', 'kofi@pulse.app', 'zara@pulse.app'];

// Everything that may reference or belong to a user.
const ACCOUNT_USAGE_QUERIES = [
  'SELECT 1 FROM songs WHERE uploaded_by = ? LIMIT 1',
  'SELECT 1 FROM albums WHERE uploaded_by = ? LIMIT 1',
  'SELECT 1 FROM artists WHERE user_id = ? LIMIT 1',
  'SELECT 1 FROM playlists WHERE user_id = ? LIMIT 1',
  'SELECT 1 FROM podcasts WHERE user_id = ? LIMIT 1',
  'SELECT 1 FROM favorites WHERE user_id = ? LIMIT 1',
  'SELECT 1 FROM podcast_subscriptions WHERE user_id = ? LIMIT 1',
  'SELECT 1 FROM saved_episodes WHERE user_id = ? LIMIT 1',
  'SELECT 1 FROM episode_progress WHERE user_id = ? LIMIT 1'
];

// Columns that could still point at generated artwork once its rows are gone.
const GENERATED_ARTWORK_COLUMNS = [
  ['songs', 'cover_url'], ['albums', 'cover_url'], ['playlists', 'cover_url'],
  ['podcasts', 'cover_url'], ['episodes', 'cover_url'],
  ['artists', 'avatar_url'], ['users', 'avatar_url']
];

const marks = (list) => list.map(() => '?').join(', ');

/** Delete regular files in `dir` whose name matches `pattern`; returns how many went. */
function removeGeneratedFiles(dir, pattern) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0; // directory does not exist — nothing to clean
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    try {
      fs.unlinkSync(path.join(dir, entry.name));
      removed += 1;
    } catch { /* best effort — retried on the next boot */ }
  }
  return removed;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} dataDir  folder holding the SQLite file and the media directories
 * @returns {{total:number, songs:number, albums:number, artists:number, playlists:number,
 *            podcasts:number, episodes:number, accounts:number, files:number, keptAccounts:string[]}}
 */
export function purgeLegacyDemoData(db, dataDir) {
  const summary = {
    total: 0, songs: 0, albums: 0, artists: 0, playlists: 0, podcasts: 0,
    episodes: 0, accounts: 0, files: 0, keptAccounts: []
  };
  const seededArtists = [...DEMO_ARTISTS, ...FEATURED_ARTISTS];

  db.transaction(() => {
    // Tracks: the generated demo audio, and the featured artists' audio-less placeholders.
    // (Their playlist entries and favourites go with them through ON DELETE CASCADE.)
    summary.songs = db.prepare(`
      DELETE FROM songs WHERE id IN (
        SELECT s.id FROM songs s JOIN artists a ON a.id = s.artist_id
        WHERE s.file_path GLOB '/media/audio/track-[0-9][0-9].wav'
           OR (s.file_path IS NULL AND s.source_url IS NULL
               AND a.name IN (${marks(FEATURED_ARTISTS)})
               AND s.cover_url LIKE '/media/covers/%')
      )
    `).run(...FEATURED_ARTISTS).changes;

    // Podcast shows (their episodes, subscriptions and progress cascade).
    const showFilter = `FROM podcasts WHERE user_id IS NULL AND title IN (${marks(DEMO_PODCASTS)})
                        AND cover_url LIKE '/media/covers/podcast-%'`;
    summary.episodes = db.prepare(`SELECT COUNT(*) AS c FROM episodes WHERE podcast_id IN (SELECT id ${showFilter})`)
      .get(...DEMO_PODCASTS).c;
    summary.podcasts = db.prepare(`DELETE ${showFilter}`).run(...DEMO_PODCASTS).changes;

    summary.albums = db.prepare(
      `DELETE FROM albums WHERE title IN (${marks(DEMO_ALBUMS)}) AND cover_url LIKE '/media/covers/album-%'`
    ).run(...DEMO_ALBUMS).changes;

    summary.playlists = db.prepare(
      `DELETE FROM playlists WHERE name IN (${marks(DEMO_PLAYLISTS)}) AND cover_url LIKE '/media/covers/playlist-%'`
    ).run(...DEMO_PLAYLISTS).changes;

    // Artists: only those left with no tracks and no albums (deleting an artist would
    // cascade to anything still attached to it).
    const seededArtistFilter = `name IN (${marks(seededArtists)}) AND avatar_url LIKE '/media/covers/artist-%'`;
    summary.artists = db.prepare(`
      DELETE FROM artists
      WHERE ${seededArtistFilter}
        AND NOT EXISTS (SELECT 1 FROM songs s WHERE s.artist_id = artists.id)
        AND NOT EXISTS (SELECT 1 FROM albums al WHERE al.artist_id = artists.id)
    `).run(...seededArtists).changes;
    // Seeded profiles that real uploads now hang off keep their name but lose the invented details.
    db.prepare(`UPDATE artists SET bio = NULL, genre = NULL, country = NULL, followers = 0, avatar_url = NULL
                WHERE ${seededArtistFilter}`).run(...seededArtists);

    // Demo log-ins (the private admin account is never matched), only when truly unused.
    const candidates = db.prepare(
      `SELECT id, email FROM users WHERE role != 'admin' AND LOWER(email) IN (${marks(DEMO_ACCOUNTS)})`
    ).all(...DEMO_ACCOUNTS);
    for (const account of candidates) {
      const inUse = ACCOUNT_USAGE_QUERIES.some((sql) => db.prepare(sql).get(account.id));
      if (inUse) {
        summary.keptAccounts.push(account.email);
      } else {
        db.prepare('DELETE FROM users WHERE id = ?').run(account.id);
        summary.accounts += 1;
      }
    }

    // Nothing may keep pointing at artwork that is about to be deleted from disk.
    for (const [table, column] of GENERATED_ARTWORK_COLUMNS) {
      db.prepare(`UPDATE ${table} SET ${column} = NULL WHERE ${column} LIKE '/media/covers/%'`).run();
    }
  })();

  // Generated media and the old seed manifest. Done after the DB commit: a failure here
  // only leaves orphan files, which the next boot retries.
  const audioDir = path.join(dataDir, 'audio');
  const coverDir = path.join(dataDir, 'covers');
  summary.files += removeGeneratedFiles(audioDir, /^(?:track-\d{2}|podcast-[a-z0-9-]+-\d{2})\.wav$/);
  summary.files += removeGeneratedFiles(coverDir, /\.svg$/i);
  try {
    fs.unlinkSync(path.join(dataDir, 'seed-manifest.json'));
    summary.files += 1;
  } catch { /* not there */ }
  for (const dir of [audioDir, coverDir]) {
    try { fs.rmdirSync(dir); } catch { /* missing, or not empty — leave it alone */ }
  }

  summary.total = summary.songs + summary.albums + summary.artists + summary.playlists
    + summary.podcasts + summary.accounts + summary.files;
  return summary;
}
