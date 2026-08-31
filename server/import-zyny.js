// One-off import for the Polish electronic/ambient artist ŻYŃY's public
// catalog (artist profile + track metadata). Thin wrapper over the shared
// featured-catalog seeder, which also runs automatically on every server start
// (see server/catalog.js and server/index.js). Metadata ONLY — titles,
// durations, genre and generated covers. No playable audio (audio cannot be
// downloaded from streaming links); tracks are placeholders ready to be paired
// with audio files the artist shares.
//
// Run:  node server/import-zyny.js
// Idempotent: safely skips existing artists and only backfills missing tracks.
import { FEATURED_ARTISTS, seedFeaturedArtist } from './catalog.js';

const spec = FEATURED_ARTISTS.find((a) => a.key === 'zyny');
const res = seedFeaturedArtist(spec);
console.log(
  res.created
    ? `Imported ${spec.name} (id=${res.artistId}) with ${res.tracksInserted} tracks (metadata only).`
    : `Artist "${spec.name}" already exists (id=${res.artistId}) — ${res.tracksInserted} missing track(s) backfilled.`
);
console.log('No audio: tracks will show "no playable audio source" until real files are uploaded.');
