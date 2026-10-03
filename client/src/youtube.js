// Playback for linked tracks: drives YouTube's official IFrame player.
//
// Pulse stores only a video id — it never downloads, rips or proxies the audio, and
// playback happens inside YouTube's own player. The engine is a single instance: the
// iframe lives for as long as a linked track is current, and is torn down when the
// queue moves on, so the element is never hidden or moved while it plays.
//
// The player element is created imperatively inside a host <div> that React owns.
// React must never render children into that host (the API replaces its target node),
// which is why the slot is appended with createElement rather than via JSX.

export const LINKED_PROVIDER = 'youtube';

/** True when this track plays through a provider's embed instead of a file we host. */
export const isLinkedTrack = (song) => Boolean(song && song.provider === LINKED_PROVIDER && song.external_id);

let apiPromise = null;

/** Load https://www.youtube.com/iframe_api exactly once, for the whole app. */
export function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null; // a later attempt may succeed (offline, blocked, …)
      window.onYouTubeIframeAPIReady = previous;
      reject(new Error('Could not reach YouTube. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

/** Friendly text for the player's onError codes. */
export function youtubeErrorMessage(code) {
  switch (code) {
    case 2: return 'That YouTube link is not a playable video.';
    case 5: return 'YouTube could not play this video in your browser.';
    case 100: return 'This video is unavailable — it may have been removed or set to private.';
    case 101:
    case 150: return 'The owner of this video does not allow it to be embedded. Open it on YouTube instead.';
    default: return 'YouTube could not play this video.';
  }
}

/**
 * Creates the controller for one host element. Callbacks are read live, so the owner
 * can re-render without recreating the player.
 *
 *   const engine = createYouTubeEngine({ onState, onProgress, onError });
 *   engine.attach(hostEl); engine.load(videoId); engine.play(); …
 */
export function createYouTubeEngine(callbacks = {}) {
  let host = null;
  let slot = null;
  let player = null;
  let ready = false;
  let destroyed = false;
  let pending = null; // { videoId, startAt }
  let ticker = null;
  let lastDuration = 0;

  const emit = (name, ...args) => {
    const fn = callbacks[name];
    if (typeof fn === 'function') fn(...args);
  };

  const stopTicker = () => {
    if (ticker) { clearInterval(ticker); ticker = null; }
  };

  // YouTube has no timeupdate event; poll while something is playing.
  const startTicker = () => {
    stopTicker();
    ticker = setInterval(() => {
      if (!player || typeof player.getCurrentTime !== 'function') return;
      const time = Number(player.getCurrentTime()) || 0;
      const duration = Number(player.getDuration()) || 0;
      if (duration && duration !== lastDuration) {
        lastDuration = duration;
        emit('onDuration', duration);
      }
      emit('onProgress', time, duration);
    }, 250);
  };

  const applyPending = () => {
    if (!ready || !pending || !player) return;
    const { videoId, startAt } = pending;
    pending = null;
    player.loadVideoById(startAt > 0 ? { videoId, startSeconds: startAt } : { videoId });
  };

  return {
    /** Put the player inside `element` (a plain, empty div that React keeps mounted). */
    async attach(element) {
      if (!element || element === host) return;
      this.detach();
      host = element;
      destroyed = false;
      slot = document.createElement('div');
      host.appendChild(slot);

      try {
        const YT = await loadYouTubeApi();
        if (destroyed || !host) return;
        player = new YT.Player(slot, {
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 1,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            origin: window.location.origin
          },
          events: {
            onReady: () => {
              if (destroyed) return;
              ready = true;
              emit('onReady');
              applyPending();
            },
            onStateChange: (event) => {
              if (destroyed) return;
              emit('onState', event.data);
              if (event.data === 1) startTicker(); // playing
              else stopTicker();
              if (event.data === 0) emit('onEnded');
            },
            onError: (event) => emit('onError', event.data)
          }
        });
      } catch (err) {
        emit('onError', null, err.message);
      }
    },

    /** Load a video, or remember it until the player reports ready. */
    load(videoId, startAt = 0) {
      pending = { videoId, startAt };
      lastDuration = 0;
      applyPending();
    },

    play() {
      if (player && ready) player.playVideo();
      else pending = pending || null;
    },

    pause() {
      if (player && ready) player.pauseVideo();
      stopTicker();
    },

    seekTo(seconds) {
      if (player && ready && typeof player.seekTo === 'function') player.seekTo(Math.max(0, seconds), true);
    },

    setVolume(value) {
      if (player && ready && typeof player.setVolume === 'function') player.setVolume(Math.round(Math.max(0, Math.min(1, value)) * 100));
    },

    currentTime() {
      return player && ready && typeof player.getCurrentTime === 'function' ? Number(player.getCurrentTime()) || 0 : 0;
    },

    stop() {
      stopTicker();
      pending = null;
      lastDuration = 0;
      if (player && ready) {
        try { player.stopVideo(); } catch { /* the player may already be gone */ }
      }
      this.detach();
    },

    /** Tear the iframe down; a fresh attach creates a new player for the next video. */
    detach() {
      stopTicker();
      if (player) {
        try { player.destroy(); } catch { /* already destroyed */ }
      }
      player = null;
      ready = false;
      if (slot && slot.parentNode) slot.parentNode.removeChild(slot);
      slot = null;
      host = null;
    }
  };
}
