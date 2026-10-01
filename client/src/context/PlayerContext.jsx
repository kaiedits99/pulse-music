import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api.js';
import { mediaUrl } from '../config.js';
import { resolvePlayableUrl } from '../offline.js';

const PlayerContext = createContext(null);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Return a safe playable URL for a song, or null if none exists. */
function resolveSource(song) {
  if (!song || typeof song !== 'object') return null;
  const raw = song.source_url || song.file_path;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed;
}

/** Normalise a song object so downstream render code never hits undefined. */
function normaliseSong(song) {
  if (!song || typeof song !== 'object') return null;
  return {
    id: song.id ?? null,
    title: song.title || 'Unknown Track',
    artist_name: song.artist_name || 'Unknown Artist',
    artist_id: song.artist_id ?? null,
    album_title: song.album_title || '',
    album_cover: song.album_album || song.album_cover || null,
    cover_url: song.cover_url || null,
    genre: song.genre || '',
    duration_seconds: Number.isFinite(song.duration_seconds) ? song.duration_seconds : 0,
    file_path: song.file_path || null,
    source_url: song.source_url || null,
    is_favorite: song.is_favorite ? 1 : 0,
    plays: song.plays ?? 0,
    downloads: song.downloads ?? 0,
    // Podcast episodes travel through the same queue (see episodes.js).
    kind: song.kind === 'episode' ? 'episode' : song.kind === 'local' ? 'local' : 'song',
    local_id: song.local_id ?? (song.kind === 'local' ? song.id : null),
    offline_only: Boolean(song.offline_only),
    episode_id: song.episode_id ?? null,
    podcast_id: song.podcast_id ?? null,
    description: song.description || '',
    published_at: song.published_at || null,
    saved: song.saved ? 1 : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Provider                                                          */
/* ------------------------------------------------------------------ */

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const queueRef = useRef([]);
  const indexRef = useRef(-1);
  const currentRef = useRef(null);
  const durationRef = useRef(0);
  const pendingSeekRef = useRef(null);
  const repeatRef = useRef(false);
  const shuffleRef = useRef(false);
  const volumeRef = useRef(0.9);
  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0); // guards async loads against fast track switching
  // Resume positions for podcast episodes: { episodeId, last, ready }
  const progressRef = useRef({ episodeId: null, last: 0, ready: false });

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.9);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeatState] = useState(false);
  const [error, setError] = useState('');

  const current = index >= 0 && index < queue.length ? queue[index] : null;

  const updateIndex = (value) => {
    indexRef.current = value;
    setIndex(value);
    const curr = value >= 0 && value < queueRef.current.length ? queueRef.current[value] : null;
    currentRef.current = curr;
  };

  const updateQueue = (value) => {
    queueRef.current = value;
    setQueue(value);
  };

  /* ---- Episode resume positions ----
     Only episodes report progress, only while signed in, and only once the new
     source is actually loaded (so a track switch never writes the outgoing
     position onto the incoming episode). */
  const pushProgress = useCallback((force = false, completed = false) => {
    const state = progressRef.current;
    const audio = audioRef.current;
    if (!state.episodeId || !state.ready || !audio) return;
    if (!getToken()) return;
    const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (!force && Math.abs(t - state.last) < 10) return;
    state.last = t;
    api.put(`/api/episodes/${state.episodeId}/progress`, {
      position_seconds: completed ? 0 : t,
      completed
    }).catch(() => {});
  }, []);

  /* ---- loadSong: sets up audio source and begins playback ---- */
  const loadSong = useCallback((song, startAtTime = 0) => {
    try {
      const audio = audioRef.current;
      const isLocal = song?.kind === 'local' || Boolean(song?.local_id);
      const offlineOnly = isLocal || Boolean(song?.offline_only);
      const source = resolveSource(song);
      if (!audio || (!source && !isLocal)) {
        setError('This track does not have a playable audio source.');
        return;
      }
      setError('');

      // Preload initial duration from song metadata if available
      const initialDuration = Number.isFinite(song.duration_seconds) && song.duration_seconds > 0
        ? song.duration_seconds
        : 0;
      durationRef.current = initialDuration;
      setDuration(initialDuration);

      const startTime = Number.isFinite(startAtTime) && startAtTime > 0 ? startAtTime : 0;
      setCurrentTime(startTime);
      pendingSeekRef.current = startTime > 0 ? startTime : null;

      // Flush where we left off on the outgoing episode, then re-arm for this one.
      pushProgress(true);
      progressRef.current = {
        episodeId: song.kind === 'episode' && !offlineOnly ? song.episode_id : null,
        last: startTime,
        ready: false
      };

      audio.pause();

      const streamUrl = offlineOnly ? null : mediaUrl(source);
      if (!offlineOnly && !streamUrl) {
        setError('This track does not have a valid playback URL.');
        return;
      }

      // Offline-first: saved site tracks use their cache and local imports use
      // their IndexedDB copy; ordinary tracks keep using the network stream.
      const seq = ++loadSeqRef.current;
      resolvePlayableUrl(song)
        .then((playUrl) => {
          if (seq !== loadSeqRef.current || !mountedRef.current) return; // superseded
          const url = offlineOnly ? playUrl : (playUrl || streamUrl);
          if (!url) {
            setError(isLocal
              ? 'This local file is no longer available. Import it again to play.'
              : 'This saved copy is missing. Reconnect and download the track again.');
            return;
          }
          audio.src = url;
          audio.volume = volumeRef.current;
          audio.load();

          if (startTime > 0) {
            try {
              audio.currentTime = startTime;
            } catch { /* will apply when metadata loads */ }
          }
          progressRef.current.ready = true;

          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
              if (mountedRef.current) {
                setError('Playback was blocked or this audio source is unavailable. Try play again.');
              }
            });
          }
        })
        .catch(() => { if (seq === loadSeqRef.current) setError('Could not prepare this track for playback.'); });

      // Record play count (fire-and-forget) — episodes have their own counter.
      if (song.kind === 'episode' && song.episode_id && !offlineOnly) {
        api.post(`/api/episodes/${song.episode_id}/play`).catch(() => {});
      } else if (song.id && !offlineOnly) {
        api.post(`/api/songs/${song.id}/play`).catch(() => {});
      }
    } catch (err) {
      setError('An unexpected error occurred while loading this track.');
      if (import.meta.env.DEV) console.error('[PlayerContext] loadSong error:', err);
    }
  }, [pushProgress]);

  const advance = useCallback(() => {
    const items = queueRef.current;
    if (!items.length) return;
    if (repeatRef.current) {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        setCurrentTime(0);
        audio.play().catch(() => {});
      }
      return;
    }
    const oldIndex = indexRef.current;
    let nextIndex = shuffleRef.current ? Math.floor(Math.random() * items.length) : oldIndex + 1;
    if (shuffleRef.current && items.length > 1 && nextIndex === oldIndex) nextIndex = (nextIndex + 1) % items.length;
    if (nextIndex >= items.length) {
      setIsPlaying(false);
      return;
    }
    updateIndex(nextIndex);
    loadSong(items[nextIndex]);
  }, [loadSong]);

  useEffect(() => {
    mountedRef.current = true;
    const audio = new Audio();
    audio.preload = 'metadata';

    const onTime = () => {
      if (!mountedRef.current) return;
      setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
      pushProgress(false);
    };

    const onMetadata = () => {
      if (!mountedRef.current) return;
      const audioDur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const effectiveDur = audioDur > 0 ? audioDur : (currentRef.current?.duration_seconds ?? 0);
      if (effectiveDur > 0) {
        durationRef.current = effectiveDur;
        setDuration(effectiveDur);
      }
      if (pendingSeekRef.current !== null && Number.isFinite(pendingSeekRef.current)) {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        try {
          const maxDur = effectiveDur > 0 ? effectiveDur : target;
          const safeTarget = Math.max(0, Math.min(target, maxDur));
          audio.currentTime = safeTarget;
          setCurrentTime(safeTarget);
        } catch { /* ignore */ }
      }
    };

    const onPlay = () => {
      if (!mountedRef.current) return;
      setIsPlaying(true);
      setError('');
    };

    const onPause = () => {
      if (!mountedRef.current) return;
      setIsPlaying(false);
      pushProgress(true);
    };

    const onError = () => {
      if (!mountedRef.current) return;
      setError('We could not load this audio source.');
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('durationchange', onMetadata);
    audio.addEventListener('canplay', onMetadata);
    audio.addEventListener('loadeddata', onMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    const onEnded = () => {
      pushProgress(true, true); // finished: clear the resume point
      advance();
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audioRef.current = audio;

    return () => {
      pushProgress(true);
      mountedRef.current = false;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('durationchange', onMetadata);
      audio.removeEventListener('canplay', onMetadata);
      audio.removeEventListener('loadeddata', onMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, [advance, pushProgress]);

  /* ---- Public API ---- */

  const play = useCallback((songs, startIndex = 0, startAtTime = 0) => {
    if (!Array.isArray(songs) || !songs.length) return;
    const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
    const normalised = songs.map(normaliseSong).filter(Boolean);
    if (!normalised.length) { setError('No playable tracks.'); return; }
    const idx = Math.min(safeIndex, normalised.length - 1);
    updateQueue(normalised);
    updateIndex(idx);
    loadSong(normalised[idx], startAtTime);
  }, [loadSong]);

  const togglePlay = useCallback(() => {
    try {
      const audio = audioRef.current;
      if (!audio) return;
      if (!currentRef.current && queueRef.current.length) {
        updateIndex(0);
        loadSong(queueRef.current[0]);
        return;
      }
      if (!audio.src) {
        if (currentRef.current) loadSong(currentRef.current);
        return;
      }
      if (audio.paused) {
        audio.play().catch(() => setError('Playback was blocked. Try play again.'));
      } else {
        audio.pause();
      }
    } catch (err) {
      setError('Playback error.');
      if (import.meta.env.DEV) console.error('[PlayerContext] togglePlay error:', err);
    }
  }, [loadSong]);

  const next = useCallback(() => advance(), [advance]);

  const seek = useCallback((time) => {
    try {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(time)) return;
      const targetTime = Math.max(0, time);
      const audioDur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const songDur = durationRef.current > 0 ? durationRef.current : (currentRef.current?.duration_seconds ?? 0);
      const effectiveDur = audioDur > 0 ? audioDur : songDur;
      const clampedTime = effectiveDur > 0 ? Math.min(targetTime, effectiveDur) : targetTime;

      // Update state immediately for instant feedback
      setCurrentTime(clampedTime);

      if (audio.readyState >= 1 || (audio.seekable && audio.seekable.length > 0)) {
        audio.currentTime = clampedTime;
      } else {
        pendingSeekRef.current = clampedTime;
        try {
          audio.currentTime = clampedTime;
        } catch { /* will apply on loadedmetadata */ }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('[PlayerContext] seek error:', err);
    }
  }, []);

  const seekRelative = useCallback((delta) => {
    const audio = audioRef.current;
    const curr = Number.isFinite(audio?.currentTime) ? audio.currentTime : currentTime;
    seek(curr + delta);
  }, [currentTime, seek]);

  const prev = useCallback(() => {
    try {
      const items = queueRef.current;
      const audio = audioRef.current;
      if (!items.length) return;
      if (audio && Number.isFinite(audio.currentTime) && audio.currentTime > 3) {
        seek(0);
        return;
      }
      const previous = shuffleRef.current ? Math.floor(Math.random() * items.length) : Math.max(0, indexRef.current - 1);
      updateIndex(previous);
      loadSong(items[previous]);
    } catch (err) {
      if (import.meta.env.DEV) console.error('[PlayerContext] prev error:', err);
    }
  }, [loadSong, seek]);

  const setVolume = useCallback((value) => {
    const safe = Math.max(0, Math.min(1, Number(value) || 0));
    volumeRef.current = safe;
    setVolumeState(safe);
    if (audioRef.current) audioRef.current.volume = safe;
  }, []);

  const setShuffle = useCallback((value) => {
    shuffleRef.current = value;
    setShuffleState(value);
  }, []);

  const setRepeat = useCallback((value) => {
    repeatRef.current = value;
    setRepeatState(value);
  }, []);

  const markFavorite = useCallback((songId, value) => {
    updateQueue(queueRef.current.map((song) => song.id === songId ? { ...song, is_favorite: value } : song));
  }, []);

  /** Patch any field of a queued item (used for the episode “Saved” toggle). */
  const patchTrack = useCallback((trackId, patch) => {
    updateQueue(queueRef.current.map((song) => song.id === trackId ? { ...song, ...patch } : song));
  }, []);

  return (
    <PlayerContext.Provider value={{
      current, queue, index, isPlaying, currentTime, duration,
      volume, shuffle, repeat, error,
      play, togglePlay, next, prev, seek, seekRelative, setVolume, setShuffle, setRepeat,
      markFavorite, patchTrack
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() { return useContext(PlayerContext); }
