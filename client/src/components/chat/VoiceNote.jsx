import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { chatMediaUrl } from '../../chat.jsx';

const BAR_COUNT = 32;

/** Peaks recorded with the note, or a stable silhouette when a note arrived without them. */
function bars(waveform, seed) {
  if (Array.isArray(waveform) && waveform.length) {
    const step = Math.max(1, Math.floor(waveform.length / BAR_COUNT));
    return waveform.filter((_, index) => index % step === 0).slice(0, BAR_COUNT);
  }
  let state = 0;
  for (const char of String(seed || 'pulse')) state = (state * 31 + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: BAR_COUNT }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return 0.2 + (state / 4294967296) * 0.8;
  });
}

const formatSeconds = (value) => {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** A voice note: waveform, play/pause, elapsed time and a speed control (1x / 1.5x / 2x). */
export default function VoiceNote({ message }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(message.media_meta?.duration || 0);
  const [rate, setRate] = useState(1);
  const peaks = bars(message.media_meta?.waveform, message.id);
  const src = chatMediaUrl(message.media_name);
  const total = duration || message.media_meta?.duration || 0;

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  const seekTo = (event) => {
    const audio = audioRef.current;
    if (!audio || !total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * total;
    setElapsed(audio.currentTime);
  };

  const cycleRate = () => setRate((value) => (value === 1 ? 1.5 : value === 1.5 ? 2 : 1));
  const progress = total ? Math.min(1, elapsed / total) : 0;

  return (
    <div className={`voice-note ${playing ? 'playing' : ''}`}>
      <button className="voice-play" onClick={toggle} aria-label={playing ? 'Pause voice note' : 'Play voice note'}>
        <Icon name={playing ? 'pause' : 'play'} size={15} />
      </button>

      <div className="voice-bars" onClick={seekTo} role="presentation">
        {peaks.map((peak, index) => (
          <span
            key={index}
            className={`voice-bar ${index / peaks.length <= progress ? 'done' : ''}`}
            style={{ height: `${Math.max(12, Math.min(100, peak * 100))}%` }}
          />
        ))}
      </div>

      <span className="voice-time">{formatSeconds(playing || elapsed ? elapsed : total)}</span>
      <button className="voice-rate" onClick={cycleRate} title="Playback speed" aria-label={`Playback speed ${rate}x`}>
        {rate}x
      </button>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setElapsed(0); }}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onError={() => setPlaying(false)}
      />
    </div>
  );
}
