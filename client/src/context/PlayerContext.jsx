import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { mediaUrl } from '../config.js';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const queueRef = useRef([]);
  const indexRef = useRef(-1);
  const repeatRef = useRef(false);
  const shuffleRef = useRef(false);
  const volumeRef = useRef(0.9);
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
  const updateIndex = (value) => { indexRef.current = value; setIndex(value); };
  const updateQueue = (value) => { queueRef.current = value; setQueue(value); };

  const loadSong = useCallback((song) => {
    const audio = audioRef.current;
    const source = song && (song.source_url || song.file_path);
    if (!audio || !source) {
      setError('This track does not have a playable audio source.');
      return;
    }
    setError('');
    setCurrentTime(0);
    setDuration(0);
    audio.pause();
    audio.src = mediaUrl(source);
    audio.volume = volumeRef.current;
    audio.load();
    audio.play().catch(() => setError('Playback was blocked or this audio source is unavailable. Try play again.'));
    if (song.id) api.post(`/api/songs/${song.id}/play`).catch(() => {});
  }, []);

  const advance = useCallback(() => {
    const items = queueRef.current;
    if (!items.length) return;
    if (repeatRef.current) {
      const audio = audioRef.current;
      if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
      return;
    }
    const oldIndex = indexRef.current;
    let nextIndex = shuffleRef.current ? Math.floor(Math.random() * items.length) : oldIndex + 1;
    if (shuffleRef.current && items.length > 1 && nextIndex === oldIndex) nextIndex = (nextIndex + 1) % items.length;
    // Do not silently loop a one-track queue unless repeat is selected.
    if (nextIndex >= items.length) { setIsPlaying(false); return; }
    updateIndex(nextIndex);
    loadSong(items[nextIndex]);
  }, [loadSong]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const onTime = () => setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    const onMetadata = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => { setIsPlaying(true); setError(''); };
    const onPause = () => setIsPlaying(false);
    const onError = () => setError('We could not load this audio source.');
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', advance);
    audio.addEventListener('error', onError);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', advance);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, [advance]);

  const play = useCallback((songs, startIndex = 0) => {
    if (!Array.isArray(songs) || !songs.length) return;
    const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
    updateQueue(songs);
    updateIndex(safeIndex);
    loadSong(songs[safeIndex]);
  }, [loadSong]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current && queueRef.current.length) { updateIndex(0); loadSong(queueRef.current[0]); return; }
    if (!audio.src) { if (current) loadSong(current); return; }
    if (audio.paused) audio.play().catch(() => setError('Playback was blocked. Try play again.'));
    else audio.pause();
  }, [current, loadSong]);

  const next = useCallback(() => advance(), [advance]);
  const prev = useCallback(() => {
    const items = queueRef.current;
    const audio = audioRef.current;
    if (!items.length) return;
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
    const previous = shuffleRef.current ? Math.floor(Math.random() * items.length) : Math.max(0, indexRef.current - 1);
    updateIndex(previous);
    loadSong(items[previous]);
  }, [loadSong]);
  const seek = useCallback((time) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, Math.min(time, Number.isFinite(audio.duration) ? audio.duration : time));
    setCurrentTime(audio.currentTime);
  }, []);
  const setVolume = useCallback((value) => {
    const safe = Math.max(0, Math.min(1, Number(value) || 0));
    volumeRef.current = safe; setVolumeState(safe);
    if (audioRef.current) audioRef.current.volume = safe;
  }, []);
  const setShuffle = useCallback((value) => { shuffleRef.current = value; setShuffleState(value); }, []);
  const setRepeat = useCallback((value) => { repeatRef.current = value; setRepeatState(value); }, []);
  const markFavorite = useCallback((songId, value) => updateQueue(queueRef.current.map((song) => song.id === songId ? { ...song, is_favorite: value } : song)), []);

  return <PlayerContext.Provider value={{ current, queue, index, isPlaying, currentTime, duration, volume, shuffle, repeat, error, play, togglePlay, next, prev, seek, setVolume, setShuffle, setRepeat, markFavorite }}>{children}</PlayerContext.Provider>;
}
export function usePlayer() { return useContext(PlayerContext); }
