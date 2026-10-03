import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { Spinner, Cover } from '../ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDuration } from '../../format.js';

const QUICK = ['🔥', '❤️', '😂', '😮', '😢', '👏', '🎶', '⚡', '💜', '🙏', '✅', '🎧'];
const MAX_SECONDS = 300; // five minutes is plenty for a voice note, and kind to the bucket

/** Live recording: mic → MediaRecorder, with peaks sampled for the waveform it will play back as. */
function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [peaks, setPeaks] = useState([]);
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState(null);
  const bits = useRef({ recorder: null, stream: null, context: null, timer: null, started: 0 });

  const cleanup = () => {
    const { stream, context, timer } = bits.current;
    clearInterval(timer);
    stream?.getTracks().forEach((track) => track.stop());
    context?.close?.().catch?.(() => {});
    bits.current.timer = null;
    bits.current.stream = null;
    bits.current.context = null;
  };

  useEffect(() => () => cleanup(), []);

  const stop = ({ keep = true } = {}) => {
    const recorder = bits.current.recorder;
    if (!recorder) return;
    recorder.onstop = () => {
      const duration = Math.max(0.4, (Date.now() - bits.current.started) / 1000);
      const blob = new Blob(recorder.__chunks, { type: recorder.mimeType || 'audio/webm' });
      cleanup();
      setRecording(false);
      if (keep && blob.size) {
        setClip({ blob, url: URL.createObjectURL(blob), duration, waveform: recorder.__peaks });
      }
      bits.current.recorder = null;
    };
    try { recorder.stop(); } catch { cleanup(); setRecording(false); }
  };

  const start = async (onError) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError?.('Recording is not supported in this browser — attach a file instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((candidate) => MediaRecorder.isTypeSupported?.(candidate));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      recorder.__chunks = [];
      recorder.__peaks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) recorder.__chunks.push(event.data); };

      const context = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      bits.current = { recorder, stream, context, started: Date.now(), timer: null };
      bits.current.timer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) { const v = (data[i] - 128) / 128; sum += v * v; }
        recorder.__peaks.push(Math.min(1, Math.max(0.06, Math.sqrt(sum / data.length) * 3.2)));
        setPeaks(recorder.__peaks.slice(-80));
        const elapsed = (Date.now() - bits.current.started) / 1000;
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) stop();
      }, 100);

      recorder.start();
      setRecording(true);
      setSeconds(0);
      setPeaks([]);
    } catch {
      onError?.('Microphone access was blocked. Allow it in your browser, or attach a file.');
    }
  };

  const clear = () => {
    setClip((current) => { if (current?.url) URL.revokeObjectURL(current.url); return null; });
  };

  return { recording, peaks, seconds, clip, start, stop, clear };
}

export default function Composer({ onSend, onShareTrack, disabled, shareCandidate, onClearShare, canPost = true, party = false, onQueueTrack, lockedNote = null }) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const recorder = useRecorder();

  useEffect(() => {
    if (!pickerOpen) return undefined;
    let cancelled = false;
    api.get(`/api/songs?q=${encodeURIComponent(query)}`).then((rows) => {
      if (!cancelled) setResults((rows || []).slice(0, 6));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [query, pickerOpen]);

  useEffect(() => () => { if (image?.url) URL.revokeObjectURL(image.url); }, [image]);

  const canSend = Boolean(text.trim() || image || recorder.clip || shareCandidate) && !disabled && !sending;

  const submit = async () => {
    if (!canSend) return;
    const form = new FormData();
    if (text.trim()) form.append('body', text.trim());
    if (image) form.append('image', image.file, image.file.name);
    if (recorder.clip) {
      const type = recorder.clip.blob.type || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', recorder.clip.blob, `voice-note.${ext}`);
      form.append('duration', String(Math.round(recorder.clip.duration)));
      form.append('waveform', JSON.stringify(recorder.clip.waveform.map((peak) => Math.round(peak * 100) / 100)));
    }
    if (shareCandidate) form.append('track_id', String(shareCandidate.id));

    setSending(true);
    try {
      await onSend(form);
      setText('');
      setImage(null);
      recorder.clear();
      onClearShare?.();
    } catch (err) {
      toast(err.message || 'Message could not be sent', 'error');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  };

  const pickImage = (file) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('Images up to 15 MB', 'error'); return; }
    if (image?.url) URL.revokeObjectURL(image.url);
    setImage({ file, url: URL.createObjectURL(file) });
  };

  if (recorder.recording) {
    return (
      <div className="composer composer--recording">
        <span className="rec-dot" aria-hidden="true" />
        <div className="rec-bars" aria-label="Recording">
          {Array.from({ length: 40 }, (_, index) => {
            const peak = recorder.peaks[index % Math.max(1, recorder.peaks.length)] || 0.1;
            return <span key={index} style={{ height: `${Math.max(8, peak * 100)}%` }} />;
          })}
        </div>
        <span className="rec-time">{formatDuration(recorder.seconds)}</span>
        <button className="composer-icon" onClick={() => recorder.stop({ keep: false })} title="Cancel recording" aria-label="Cancel recording">
          <Icon name="close" size={18} />
        </button>
        <button className="composer-send" onClick={() => recorder.stop()} title="Stop and review" aria-label="Stop recording">
          <Icon name="stop" size={17} />
        </button>
      </div>
    );
  }

  return (
    <div className="composer-wrap">
      {image && (
        <div className="composer-preview">
          <img src={image.url} alt="Attachment preview" />
          <button className="composer-icon" onClick={() => setImage(null)} aria-label="Remove attachment"><Icon name="close" size={15} /></button>
        </div>
      )}

      {recorder.clip && (
        <div className="composer-preview composer-preview--voice">
          <audio controls src={recorder.clip.url} className="composer-audio" />
          <span className="muted">{formatDuration(recorder.clip.duration)}</span>
          <button className="composer-icon" onClick={recorder.clear} aria-label="Remove voice note"><Icon name="close" size={15} /></button>
        </div>
      )}

      {shareCandidate && (
        <div className="composer-share">
          <Cover src={shareCandidate.cover_url} alt={shareCandidate.title} size={30} />
          <span>Sharing <strong>{shareCandidate.title}</strong></span>
          <button className="composer-icon" onClick={onClearShare} aria-label="Remove track"><Icon name="close" size={15} /></button>
        </div>
      )}

      {pickerOpen && (
        <div className="track-picker">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your catalogue…"
            aria-label="Search tracks to share"
          />
          <div className="track-picker-list">
            {results.length === 0 && <span className="muted pad">No tracks found</span>}
            {results.map((song) => (
              <div key={song.id} className="track-picker-row">
                <button
                  className="tp-main"
                  onClick={() => { onShareTrack(song); setPickerOpen(false); setQuery(''); }}
                >
                  <Cover src={song.cover_url} alt={song.title} size={32} />
                  <span className="tp-meta"><strong>{song.title}</strong><em>{song.artist_name}</em></span>
                </button>
                {party && onQueueTrack && (
                  <button
                    className="tp-queue"
                    title="Add to the listening room queue"
                    onClick={() => { onQueueTrack(song); setPickerOpen(false); setQuery(''); }}
                  >
                    <Icon name="broadcast" size={15} /> Room
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {emojiOpen && (
        <div className="composer-emoji" onMouseLeave={() => setEmojiOpen(false)}>
          {QUICK.map((emoji) => (
            <button key={emoji} onClick={() => { setText((value) => value + emoji); inputRef.current?.focus(); }}>{emoji}</button>
          ))}
        </div>
      )}

      <div className="composer">
        <button
          className="composer-icon"
          onClick={() => fileRef.current?.click()}
          title="Attach an image"
          aria-label="Attach an image"
          disabled={!canPost}
        >
          <Icon name="image" size={19} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => { pickImage(event.target.files?.[0]); event.target.value = ''; }}
        />
        <button
          className="composer-icon"
          onClick={() => recorder.start(toast)}
          title="Record a voice note"
          aria-label="Record a voice note"
          disabled={!canPost}
        >
          <Icon name="mic" size={19} />
        </button>
        <button
          className={`composer-icon ${pickerOpen ? 'active' : ''}`}
          onClick={() => setPickerOpen((open) => !open)}
          title="Share a track"
          aria-label="Share a track"
        >
          <Icon name="music" size={19} />
        </button>

        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={!canPost ? 'Only the channel owner can post here' : disabled ? 'Choose a conversation' : 'Message'}
          disabled={disabled || !canPost}
          aria-label="Message"
        />

        <button
          className={`composer-icon ${emojiOpen ? 'active' : ''}`}
          onClick={() => setEmojiOpen((open) => !open)}
          title="Emoji"
          aria-label="Emoji"
        >
          <Icon name="smiley" size={19} />
        </button>

        <button className="composer-send" onClick={submit} disabled={!canSend || !canPost} title="Send" aria-label="Send">
          {sending ? <Spinner size={16} /> : <Icon name="send" size={17} />}
        </button>
      </div>
      <p className="composer-note">
        {lockedNote || 'Messages and attachments are deleted 24 hours after they are read — 30 days if they are never opened.'}
      </p>
    </div>
  );
}
