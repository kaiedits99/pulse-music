// The YouTube engine drives playback for linked tracks, so its state machine is tested
// here against a stand-in IFrame API: no browser, no network, no real iframe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeEngine, isLinkedTrack, youtubeErrorMessage } from './youtube.js';

/* ---- a browser good enough for the engine ---- */
function stubDom() {
  const hosts = [];
  globalThis.window = { location: { origin: 'https://pulse.test' }, YT: undefined };
  globalThis.document = {
    createElement: () => ({ setAttribute() {} })
  };
  return { hosts };
}

function fakeYouTube() {
  const players = [];
  class FakePlayer {
    constructor(target, config) {
      this.target = target;
      this.config = config;
      this.calls = [];
      this.destroyed = false;
      this.time = 0;
      this.duration = 0;
      players.push(this);
    }
    ready() { this.config.events.onReady(); }
    state(code) { this.config.events.onStateChange({ data: code }); }
    fail(code) { this.config.events.onError({ data: code }); }
    loadVideoById(arg) { this.calls.push(['load', arg]); }
    playVideo() { this.calls.push(['play']); }
    pauseVideo() { this.calls.push(['pause']); }
    seekTo(seconds, allowSeekAhead) { this.calls.push(['seek', seconds, allowSeekAhead]); }
    setVolume(value) { this.calls.push(['volume', value]); }
    getCurrentTime() { return this.time; }
    getDuration() { return this.duration; }
    stopVideo() { this.calls.push(['stop']); }
    destroy() { this.destroyed = true; }
  }
  globalThis.window.YT = { Player: FakePlayer };
  return players;
}

const hostElement = () => ({ appendChild() {} });

test('a link only counts as linked when it has a provider and an id', () => {
  assert.equal(isLinkedTrack({ provider: 'youtube', external_id: 'dQw4w9WgXcQ' }), true);
  assert.equal(isLinkedTrack({ provider: 'youtube' }), false);
  assert.equal(isLinkedTrack({ external_id: 'dQw4w9WgXcQ' }), false);
  assert.equal(isLinkedTrack({ provider: 'spotify', external_id: 'x' }), false);
  assert.equal(isLinkedTrack(null), false);
});

test('YouTube error codes become instructions a person can act on', () => {
  assert.match(youtubeErrorMessage(101), /does not allow it to be embedded/);
  assert.match(youtubeErrorMessage(150), /does not allow it to be embedded/);
  assert.match(youtubeErrorMessage(100), /unavailable/);
  assert.match(youtubeErrorMessage(2), /not a playable video/);
  assert.match(youtubeErrorMessage(undefined), /could not play/);
});

test('the video is loaded once the player reports ready, at the resume position', async () => {
  stubDom();
  const players = fakeYouTube();
  const engine = createYouTubeEngine({});
  await engine.attach(hostElement());

  engine.load('dQw4w9WgXcQ', 42);
  assert.equal(players.length, 1);
  assert.deepEqual(players[0].calls, [], 'nothing is called before the player is ready');

  players[0].ready();
  assert.deepEqual(players[0].calls, [['load', { videoId: 'dQw4w9WgXcQ', startSeconds: 42 }]]);
});

test('playing and pausing map onto the engine, and time updates flow to the caller', async () => {
  stubDom();
  const players = fakeYouTube();
  const seen = { states: [], progress: [], durations: [] };
  const engine = createYouTubeEngine({
    onState: (s) => seen.states.push(s),
    onProgress: (time, duration) => seen.progress.push([time, duration]),
    onDuration: (d) => seen.durations.push(d)
  });
  await engine.attach(hostElement());
  engine.load('dQw4w9WgXcQ');
  players[0].ready();

  engine.play();
  engine.pause();
  assert.deepEqual(players[0].calls.filter((c) => c[0] === 'play' || c[0] === 'pause'), [['play'], ['pause']]);

  // While playing the engine polls the player for position and length.
  players[0].time = 12;
  players[0].duration = 213;
  players[0].state(1); // playing
  await new Promise((resolve) => setTimeout(resolve, 320));
  players[0].state(2); // paused: polling stops
  const before = seen.progress.length;
  await new Promise((resolve) => setTimeout(resolve, 320));

  assert.deepEqual(seen.states, [1, 2]);
  assert.ok(before >= 1, 'progress was reported while playing');
  assert.equal(seen.progress.length, before, 'no polling while paused');
  assert.deepEqual(seen.progress.at(-1), [12, 213]);
  assert.deepEqual(seen.durations, [213]);
});

test('seeking, volume and teardown reach the player', async () => {
  stubDom();
  const players = fakeYouTube();
  const engine = createYouTubeEngine({});
  await engine.attach(hostElement());
  engine.load('dQw4w9WgXcQ');
  players[0].ready();

  engine.seekTo(-5);
  engine.seekTo(90);
  engine.setVolume(0.4);
  assert.deepEqual(players[0].calls.filter((c) => c[0] !== 'load'), [
    ['seek', 0, true], ['seek', 90, true], ['volume', 40]
  ]);

  engine.stop();
  assert.equal(players[0].destroyed, true);
  assert.deepEqual(players[0].calls.at(-1), ['stop']);
  assert.equal(engine.currentTime(), 0, 'after teardown there is no position to report');
});

test('a player error is reported once, with the code', async () => {
  stubDom();
  const players = fakeYouTube();
  const errors = [];
  const engine = createYouTubeEngine({ onError: (code, message) => errors.push([code, message]) });
  await engine.attach(hostElement());
  engine.load('dQw4w9WgXcQ');
  players[0].fail(150);
  assert.deepEqual(errors, [[150, undefined]]);
});
