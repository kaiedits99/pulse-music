// Generates pleasant lo-fi synth loops as WAV files so seeded tracks are actually playable.
import fs from 'fs';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_RATE = 22050;

// pentatonic scale semitone offsets
const PENTA = [0, 2, 4, 7, 9];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

function noteFreq(rootMidi, semitone) {
  return 440 * Math.pow(2, (rootMidi + semitone - 69) / 12);
}

// Chord progressions: each is a list of chords, each chord = semitone offsets from root
const PROGRESSIONS = [
  // I vi IV V
  [[0, 4, 7], [9, 0, 4], [5, 9, 0], [7, 11, 2]],
  // I I IV vi
  [[0, 4, 7], [0, 4, 7], [5, 9, 0], [9, 0, 4]],
  // I ii IV V
  [[0, 4, 7], [2, 5, 9], [9, 0, 4], [7, 11, 2]],
  // vi IV I V
  [[9, 0, 4], [5, 9, 0], [0, 4, 7], [7, 11, 2]]
];

function writeWav(filePath, samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

function envelope(i, len, attack, release) {
  const a = Math.min(1, i / (attack * SAMPLE_RATE));
  const r = Math.min(1, (len - i) / (release * SAMPLE_RATE));
  return Math.min(a, r);
}

export function generateTrack({ seed, filePath, durationSec = 36, rootMidi = 55, bpm = 96 }) {
  const rand = mulberry32(seed);
  const total = Math.floor(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(total);

  const progression = PROGRESSIONS[Math.floor(rand() * PROGRESSIONS.length)];
  const chords = progression; // a list of chords, each chord = array of semitone offsets
  const scale = rand() > 0.4 ? PENTA : MAJOR;
  const beatLen = SAMPLE_RATE * 60 / bpm; // samples per beat
  const barLen = beatLen * 4; // 4/4
  const bars = Math.floor(total / barLen);

  // PAD — sustained chords
  for (let b = 0; b < bars; b++) {
    const chord = chords[b % chords.length];
    const chordStart = b * barLen;
    const chordLen = barLen;
    const chordFreqs = chord.map(s => noteFreq(rootMidi, s));
    for (let i = 0; i < chordLen; i++) {
      const idx = chordStart + i;
      if (idx >= total) break;
      let v = 0;
      for (const f of chordFreqs) {
        v += Math.sin(2 * Math.PI * f * i / SAMPLE_RATE) * 0.16;
        v += Math.sin(2 * Math.PI * f * 2 * i / SAMPLE_RATE) * 0.05;
      }
      const env = envelope(i, chordLen, 0.4, 0.5);
      samples[idx] += v * env;
    }
  }

  // MELODY — arpeggio / plucks
  const stepsPerBar = 8;
  for (let b = 0; b < bars; b++) {
    const chord = chords[b % chords.length];
    for (let s = 0; s < stepsPerBar; s++) {
      if (rand() < 0.25) continue; // rests
      const semitone = chord[Math.floor(rand() * chord.length)] + 12 * (rand() > 0.6 ? 1 : 0);
      const f = noteFreq(rootMidi, semitone);
      const start = b * barLen + Math.floor(s * barLen / stepsPerBar);
      const len = Math.floor(beatLen * 0.9);
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= total) break;
        let v = Math.sin(2 * Math.PI * f * i / SAMPLE_RATE);
        v += Math.sin(2 * Math.PI * f * 2 * i / SAMPLE_RATE) * 0.3;
        v += Math.sin(2 * Math.PI * f * 3 * i / SAMPLE_RATE) * 0.12;
        const env = envelope(i, len, 0.005, 0.25);
        samples[idx] += v * 0.2 * env;
      }
    }
  }

  // BASS
  for (let b = 0; b < bars; b++) {
    const chord = chords[b % chords.length];
    const root = chord[0];
    const f = noteFreq(rootMidi - 12, root);
    const noteLen = Math.floor(beatLen * 2);
    for (let n = 0; n < 2; n++) {
      const start = b * barLen + n * noteLen;
      const len = Math.floor(noteLen * 0.8);
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= total) break;
        const env = envelope(i, len, 0.01, 0.3);
        samples[idx] += Math.sin(2 * Math.PI * f * i / SAMPLE_RATE) * 0.22 * env;
      }
    }
  }

  // DRUMS — soft kick + hats
  for (let b = 0; b < bars; b++) {
    for (let beat = 0; beat < 4; beat++) {
      const k = b * barLen + Math.floor(beat * beatLen);
      // kick
      for (let i = 0; i < Math.floor(beatLen * 0.2); i++) {
        const idx = k + i;
        if (idx >= total) break;
        const f = 90 - (i / (beatLen * 0.2)) * 50;
        samples[idx] += Math.sin(2 * Math.PI * f * i / SAMPLE_RATE) * 0.35 * (1 - i / (beatLen * 0.2));
      }
      // hats on offbeats
      const h = k + Math.floor(beatLen / 2);
      for (let i = 0; i < Math.floor(beatLen * 0.06); i++) {
        const idx = h + i;
        if (idx >= total) break;
        const noise = (rand() * 2 - 1) * 0.06 * (1 - i / (beatLen * 0.06));
        samples[idx] += noise;
      }
    }
  }

  // gentle fade out
  const fade = Math.floor(total * 0.05);
  for (let i = 0; i < fade; i++) {
    samples[total - fade + i] *= 1 - i / fade;
  }

  // soft clip / normalize-ish
  let peak = 0;
  for (let i = 0; i < total; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  const gain = peak > 0 ? Math.min(1, 0.85 / peak) : 1;
  for (let i = 0; i < total; i++) samples[i] *= gain;

  writeWav(filePath, samples);
  return { durationSec: Math.round(total / SAMPLE_RATE) };
}
