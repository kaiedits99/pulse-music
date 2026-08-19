import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api';
import { mediaUrl } from '../config.js';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.9);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);

  const current = index >= 0 && index < queue.length ? queue[index] : null;

  useEffect(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = 'metadata';
      a.addEventListener('timeupdate', () => setCurrentTime(a.currentTime));
      a.addEventListener('loadedmetadata', () => setDuration(a.duration || 0));
      a.addEventListener('play', () => setIsPlaying(true));
      a.addEventListener('pause', () => setIsPlaying(false));
      a.addEventListener('ended', () => handleEnded());
      audioRef.current = a;
    }
    return () => {};
  }, []);

  function handleEnded() {
    if (repeat) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }
    next();
  }

  const loadSong = useCallback((song) => {
    const a = audioRef.current;
    if (!a || !song) return;
    a.src = mediaUrl(song.file_path);
    a.volume = volume;
    a.play().catch(() => {});
    // fire-and-forget play count
    if (song.id) api.post(`/api/songs/${song.id}/play`).catch(() => {});
  }, [volume]);

  const play = useCallback((songs, startIndex = 0) => {
    if (!songs || !songs.length) return;
    setQueue(songs);
    setIndex(startIndex);
    setCurrentTime(0);
    const song = songs[startIndex];
    loadSong(song);
  }, [loadSong]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!current && queue.length) { loadSong(queue[0]); setIndex(0); return; }
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, [current, queue, loadSong]);

  const next = useCallback(() => {
    if (!queue.length) return;
    let ni;
    if (shuffle) {
      ni = Math.floor(Math.random() * queue.length);
      if (ni === index) ni = (ni + 1) % queue.length;
    } else {
      ni = (index + 1) % queue.length;
    }
    setIndex(ni);
    loadSong(queue[ni]);
  }, [queue, index, shuffle, loadSong]);

  const prev = useCallback(() => {
    if (!queue.length) return;
    const a = audioRef.current;
    if (a && a.currentTime > 3) { a.currentTime = 0; return; }
    let pi = shuffle ? Math.floor(Math.random() * queue.length) : (index - 1 + queue.length) % queue.length;
    setIndex(pi);
    loadSong(queue[pi]);
  }, [queue, index, shuffle, loadSong]);

  const seek = useCallback((t) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = t;
    setCurrentTime(t);
  }, []);

  const setVolume = useCallback((v) => {
    const a = audioRef.current;
    setVolumeState(v);
    if (a) a.volume = v;
  }, []);

  const playSongAt = useCallback((i) => {
    if (i < 0 || i >= queue.length) return;
    setIndex(i);
    loadSong(queue[i]);
  }, [queue, loadSong]);

  // update is_favorite optimistically via a flag we can lift through queue
  const markFavorite = useCallback((songId, val) => {
    setQueue((q) => q.map((s) => (s.id === songId ? { ...s, is_favorite: val } : s)));
  }, []);

  return (
    <PlayerContext.Provider value={{
      current, queue, index, isPlaying, currentTime, duration, volume, shuffle, repeat,
      play, togglePlay, next, prev, seek, setVolume, setShuffle, setRepeat, playSongAt, markFavorite
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}
