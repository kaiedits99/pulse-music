import { useMemo, useRef, useState } from 'react';
import { formatDuration } from '../format.js';

const BAR_COUNT = 128;

function hashSeed(value) {
  const input = String(value ?? 'pulse');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * A stable, lightweight waveform silhouette for the seek timeline. Keeping the
 * peaks seeded by track means the shape stays put while playback advances and
 * does not require downloading/decoding a second copy of the audio file.
 */
function makeWaveform(seed) {
  let state = hashSeed(seed) || 1;
  const phase = (state % 23) * 0.19;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  let smooth = 0.42;
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const position = index / (BAR_COUNT - 1);
    const phrase = 0.2 + Math.abs(Math.sin(position * 11.5 + phase)) * 0.36;
    const detail = 0.12 + random() * 0.68;
    smooth = smooth * 0.38 + detail * 0.62;
    const envelope = 0.54 + Math.sin(position * Math.PI) * 0.46;
    const height = Math.max(0.12, Math.min(1, (phrase + smooth * 0.72) * envelope));
    return `${Math.round(height * 100)}%`;
  });
}

function clampTime(value, duration) {
  const time = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(duration, time));
}

/** An accessible, draggable waveform timeline used in both player views. */
export default function WaveformSeekbar({
  duration = 0,
  currentTime = 0,
  onSeek,
  onPreviewChange,
  seed,
  className = '',
  ariaLabel = 'Seek',
}) {
  const seekbarRef = useRef(null);
  const [dragTime, setDragTime] = useState(null);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const bars = useMemo(() => makeWaveform(seed), [seed]);
  const value = clampTime(dragTime == null ? currentTime : dragTime, safeDuration);
  const progress = safeDuration > 0 ? (value / safeDuration) * 100 : 0;
  const disabled = safeDuration <= 0;

  const timeFromEvent = (event) => {
    const rect = seekbarRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !safeDuration) return 0;
    return clampTime(((event.clientX - rect.left) / rect.width) * safeDuration, safeDuration);
  };

  const preview = (time) => {
    setDragTime(time);
    onPreviewChange?.(time);
  };

  const finishDrag = () => {
    setDragTime(null);
    onPreviewChange?.(null);
  };

  const onPointerDown = (event) => {
    if (disabled || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
    const time = timeFromEvent(event);
    preview(time);
    onSeek?.(time);
  };

  const onPointerMove = (event) => {
    if (dragTime == null) return;
    event.preventDefault();
    event.stopPropagation();
    preview(timeFromEvent(event));
  };

  const onPointerUp = (event) => {
    if (dragTime == null) return;
    event.preventDefault();
    event.stopPropagation();
    const time = timeFromEvent(event);
    onSeek?.(time);
    finishDrag();
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* unsupported */ }
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    let nextTime;
    const step = event.shiftKey ? 10 : 5;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextTime = value - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextTime = value + step;
    else if (event.key === 'Home') nextTime = 0;
    else if (event.key === 'End') nextTime = safeDuration;
    else return;

    event.preventDefault();
    event.stopPropagation();
    onSeek?.(clampTime(nextTime, safeDuration));
  };

  const renderBars = (played = false) => (
    <span className={`waveform-bars ${played ? 'waveform-bars--played' : ''}`} aria-hidden="true">
      {bars.map((height, index) => (
        <i key={index} className="waveform-bar" style={{ '--bar-height': height }} />
      ))}
    </span>
  );

  return (
    <div
      ref={seekbarRef}
      className={`waveform-seekbar ${disabled ? 'is-disabled' : ''} ${dragTime != null ? 'is-dragging' : ''} ${className}`.trim()}
      style={{ '--waveform-progress': `${progress}%` }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeDuration)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${formatDuration(value)} of ${formatDuration(safeDuration)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={onKeyDown}
      onClick={(event) => event.stopPropagation()}
    >
      {renderBars()}
      {renderBars(true)}
      <span className="waveform-playhead" aria-hidden="true" />
    </div>
  );
}
