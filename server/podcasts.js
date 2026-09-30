// Podcasts & Shows — a first-class section of Pulse, seeded and self-healing.
//
// Shows/episodes are deliberately NOT songs: they have publishers, seasons,
// episode numbers and per-user resume positions, so they live in their own
// tables (see db.js) and are served by their own /api/podcasts routes.
//
// Like the music seeder, everything here is deterministic and idempotent:
// missing rows are inserted, and missing audio/cover files are regenerated from
// the same formulas on any later boot (Render's free tier wipes the filesystem).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { dataDir } from './db.js';
import { generateTrack } from './synth.js';
import { writeCover } from './cover.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* ------------------------------------------------------------------ shows */

export const SHOWS = [
  {
    title: 'The Signal Path',
    publisher: 'Pulse Studios',
    category: 'Technology',
    description:
      'Long-form conversations with the engineers, producers and designers building the tools musicians actually use. New episode every Tuesday.',
    episodes: [
      ['Latency Is a Design Problem', 'Why 12 milliseconds decides whether a take feels alive, and what modern interfaces do about it.'],
      ['The Loudness Truce', 'Streaming normalisation ended the loudness war. Mastering engineers explain what replaced it.'],
      ['Shipping a Player in Six Weeks', 'A build diary: offline caching, media sessions and the bugs nobody warns you about.'],
      ['Sample Rates, Honestly', 'A calm, numbers-first look at 44.1 vs 48 vs 96 kHz — and when any of it is audible.'],
      ['Search That Understands Music', 'Fuzzy matching, transliteration and why “afrobeats” should find “Afro-beats”.']
    ]
  },
  {
    title: 'Lagos After Dark',
    publisher: 'Nightline Audio',
    category: 'Music',
    description:
      'The stories behind Lagos nightlife — the DJs, the promoters, the studios that never close. Recorded on location between sets.',
    episodes: [
      ['The 3AM Set', 'What happens to a dancefloor in the last hour, told by three DJs who live for it.'],
      ['Studios That Never Close', 'Inside the Surulere rooms where half your favourite records were tracked.'],
      ['Alté, Ten Years On', 'The scene that refused a label, and what it turned into.'],
      ['Sound System Economics', 'Speakers, generators, margins: the unglamorous maths of a great night out.']
    ]
  },
  {
    title: 'Liner Notes',
    publisher: 'Pulse Studios',
    category: 'Culture',
    description:
      'One record, one episode. We take a single album apart — the demos, the arguments, the happy accidents — with the people who made it.',
    episodes: [
      ['A Debut Recorded in a Bedroom', 'Four microphones, one duvet, and a record that outsold the studio version.'],
      ['The B-Side That Became the Hit', 'How a throwaway take escaped the cutting room floor.'],
      ['Sequencing Is Storytelling', 'Why track order still matters in a shuffled world.'],
      ['The Remaster Question', 'When a reissue honours a record — and when it flattens it.'],
      ['Credits, Properly', 'Session players, engineers and the long fight for a line in the metadata.']
    ]
  },
  {
    title: 'Indie Business',
    publisher: 'Mainstage Media',
    category: 'Business',
    description:
      'Practical, unromantic advice for independent artists: royalties, contracts, touring maths and building an audience without a label.',
    episodes: [
      ['Your First 1,000 Listeners', 'Where they actually come from, and how to keep them.'],
      ['Reading a Royalty Statement', 'Line by line, with a distributor who explains every column.'],
      ['Touring Without Losing Money', 'Van, hotel, guarantee: the spreadsheet that decides the route.'],
      ['Sync Licensing 101', 'How songs end up in adverts, games and shows — and what they pay.']
    ]
  },
  {
    title: 'Quiet Hours',
    publisher: 'Slow Radio',
    category: 'Wellness',
    description:
      'Unhurried listening for focus and sleep: field recordings, soft interviews and long ambient beds. No adverts, no hype.',
    episodes: [
      ['Rain on a Tin Roof', 'Forty unbroken minutes recorded in Ikorodu, mid-July.'],
      ['Harmattan Morning', 'Dust, distance and the sound of a city waking slowly.'],
      ['The Library at Closing Time', 'Trolley wheels, fluorescent hum, and the last two readers.'],
      ['Tide Coming In', 'A single microphone, one shoreline, one hour of patience.']
    ]
  }
];

/* ----------------------------------------------------------- derivations */

/** Deterministic synthesis + artwork parameters for one episode. */
function deriveEpisode(show, index) {
  const number = index + 1;
  const key = `${show.title} · ${show.episodes[index][0]}`;
  const seedBase = hashCode(key) % 100000;
  return {
    number,
    title: show.episodes[index][0],
    description: show.episodes[index][1],
    audioRel: `/media/audio/podcast-${slugify(show.title)}-${String(number).padStart(2, '0')}.wav`,
    seedBase,
    // Slow, sparse ambient beds so an episode never sounds like a pop track.
    rootMidi: 43 + (seedBase % 5),
    bpm: 58 + (seedBase % 9),
    durationSec: 14 + (seedBase % 5) * 2
  };
}

function showCoverRel(show) {
  return `/media/covers/podcast-${slugify(show.title)}.svg`;
}

function absolute(mediaRelPath) {
  // "/media/audio/x.wav" -> <repo>/data/audio/x.wav
  return path.join(dataDir, mediaRelPath.replace(/^\/media\//, ''));
}

function ensureAudio(spec) {
  const target = absolute(spec.audioRel);
  if (fs.existsSync(target) && fs.statSync(target).size > 1024) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  generateTrack({
    seed: spec.seedBase,
    filePath: target,
    durationSec: spec.durationSec,
    rootMidi: spec.rootMidi,
    bpm: spec.bpm
  });
  return true;
}

function ensureCover(relPath, title, subtitle, seedStr) {
  const target = absolute(relPath);
  if (fs.existsSync(target) && fs.statSync(target).size > 64) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeCover(target, title, subtitle, seedStr);
  return true;
}

/** Real duration of the generated WAV, so scrubbing and resume line up. */
function wavDuration(absPath) {
  try {
    const fd = fs.openSync(absPath, 'r');
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    fs.closeSync(fd);
    const sampleRate = header.readUInt32LE(24);
    const dataSize = header.readUInt32LE(40);
    if (!sampleRate) return null;
    return Math.round((dataSize / (sampleRate * 2)) * 100) / 100;
  } catch { return null; }
}

/* ---------------------------------------------------------------- seeding */

/**
 * Insert any missing shows/episodes and regenerate any missing media.
 * Safe to call on every boot.
 */
export function seedPodcasts() {
  const insertShow = db.prepare(
    'INSERT INTO podcasts (title, publisher, description, category, cover_url, created_at) VALUES (?,?,?,?,?,?)'
  );
  const insertEpisode = db.prepare(`INSERT INTO episodes
    (podcast_id, title, description, episode_number, season, duration_seconds, file_path, cover_url, published_at, plays, downloads)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const findShow = db.prepare('SELECT * FROM podcasts WHERE title = ?');
  const findEpisode = db.prepare('SELECT * FROM episodes WHERE podcast_id = ? AND title = ?');

  let addedShows = 0;
  let addedEpisodes = 0;
  let madeAudio = 0;
  let madeCovers = 0;

  SHOWS.forEach((show, showIndex) => {
    const coverRel = showCoverRel(show);
    if (ensureCover(coverRel, show.title, show.publisher, slugify(show.title))) madeCovers += 1;

    let row = findShow.get(show.title);
    if (!row) {
      const createdAt = new Date(Date.now() - (showIndex + 2) * 14 * 86400000).toISOString();
      const id = insertShow.run(show.title, show.publisher, show.description, show.category, coverRel, createdAt).lastInsertRowid;
      row = findShow.get(show.title);
      addedShows += 1;
      if (!row) row = { id };
    } else if (!row.cover_url) {
      db.prepare('UPDATE podcasts SET cover_url = ? WHERE id = ?').run(coverRel, row.id);
    }

    show.episodes.forEach((_, epIndex) => {
      const spec = deriveEpisode(show, epIndex);
      if (ensureAudio(spec)) madeAudio += 1;

      const existing = findEpisode.get(row.id, spec.title);
      const duration = wavDuration(absolute(spec.audioRel)) || spec.durationSec;

      if (!existing) {
        // Newest episode first: episode N was published N weeks ago, reversed.
        const weeksAgo = show.episodes.length - epIndex;
        const publishedAt = new Date(Date.now() - weeksAgo * 7 * 86400000).toISOString();
        const plays = 320 + ((spec.seedBase % 47) * 37);
        insertEpisode.run(
          row.id, spec.title, spec.description, spec.number, 1,
          duration, spec.audioRel, coverRel, publishedAt, plays, Math.floor(plays / 9)
        );
        addedEpisodes += 1;
      } else if (!existing.file_path || existing.duration_seconds !== duration) {
        db.prepare('UPDATE episodes SET file_path = ?, duration_seconds = ?, cover_url = COALESCE(cover_url, ?) WHERE id = ?')
          .run(spec.audioRel, duration, coverRel, existing.id);
      }
    });
  });

  if (addedShows || addedEpisodes) {
    console.log(`[podcasts] Seeded ${addedShows} show(s) and ${addedEpisodes} episode(s).`);
  }
  if (madeAudio || madeCovers) {
    console.log(`[podcasts] Regenerated ${madeAudio} episode audio file(s) and ${madeCovers} cover(s).`);
  }
  return { addedShows, addedEpisodes, madeAudio, madeCovers };
}

export default seedPodcasts;
