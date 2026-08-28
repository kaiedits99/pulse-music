import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { mediaUrl } from '../config.js';

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

  /* ---- loadSong: sets up audio source and begins playback ---- */
  const loadSong = useCallback((song, startAtTime = 0) => {
    try {
      const audio = audioRef.current;
      const source = resolveSource(song);
      if (!audio || !source) {
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

      audio.pause();

      const url = mediaUrl(source);
      if (!url) {
        setError('This track does not have a valid playback URL.');
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

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (mountedRef.current) {
            setError('Playback was blocked or this audio source is unavailable. Try play again.');
          }
        });
      }

      // Record play count (fire-and-forget)
      if (song.id) api.post(`/api/songs/${song.id}/play`).catch(() => {});
    } catch (err) {
      setError('An unexpected error occurred while loading this track.');
      if (import.meta.env.DEV) console.error('[PlayerContext] loadSong error:', err);
    }
  }, []);

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
    const audio = new Audio();
    audio.preload = 'metadata';

    const onTime = () => {
      if (!mountedRef.current) return;
      setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
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
    audio.addEventListener('ended', advance);
    audio.addEventListener('error', onError);
    audioRef.current = audio;

    return () => {
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
      audio.removeEventListener('ended', advance);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, [advance]);

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

  return (
    <PlayerContext.Provider value={{
      current, queue, index, isPlaying, currentTime, duration,
      volume, shuffle, repeat, error,
      play, togglePlay, next, prev, seek, seekRelative, setVolume, setShuffle, setRepeat, markFavorite
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() { return useContext(PlayerContext); }
