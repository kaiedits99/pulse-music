// One-off import for Thalia Falcon's public catalog (artist profile + track
// metadata). Thin wrapper over the shared featured-catalog seeder, which is
// also run automatically on every server start (see server/catalog.js and
// server/index.js). This inserts METADATA ONLY — titles, durations, genre and
// generated cover art. There is no playable audio because audio cannot be
// downloaded from Spotify; the tracks appear in the catalog and can be paired
// with uploaded audio files later (the artist can share WAV/MP3 files).
//
// Run:  node server/import-thalia.js
// Idempotent: safely skips existing artists and only backfills missing tracks.
import { FEATURED_ARTISTS, seedFeaturedArtist } from './catalog.js';

const spec = FEATURED_ARTISTS.find((a) => a.key === 'thalia');
const res = seedFeaturedArtist(spec);
console.log(
  res.created
    ? `Imported ${spec.name} (id=${res.artistId}) with ${res.tracksInserted} tracks (metadata only).`
    : `Artist "${spec.name}" already exists (id=${res.artistId}) — ${res.tracksInserted} missing track(s) backfilled.`
);
console.log('No audio: tracks will show "no playable audio source" until real files are uploaded.');
