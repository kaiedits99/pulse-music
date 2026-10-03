import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import VoiceNote from './VoiceNote.jsx';
import { Cover } from '../ui.jsx';
import { chatMediaUrl, timeLeft } from '../../chat.jsx';
import { formatDuration } from '../../format.js';

const QUICK = ['🔥', '❤️', '😂', '😮', '👏', '🎶', '⚡', '🙏'];

/** Small "expires in …" tag so the countdown is never a surprise. */
function Expiry({ message }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const left = timeLeft(message.expires_at);
  if (!left) return null;
  return <span className="msg-expiry" title="This message deletes itself">{left}</span>;
}

/** The shared-track card: art, title, artist and a play button that queues it in Pulse. */
function TrackCard({ track, onPlay }) {
  if (!track) {
    return <div className="msg-track msg-track--missing"><Icon name="music" size={16} /> This track is no longer available</div>;
  }
  return (
    <div className="msg-track">
      <Cover src={track.cover_url || track.album_cover} alt={track.title} size={56} />
      <div className="msg-track-meta">
        <span className="msg-track-label"><Icon name="music" size={11} /> SHARED TRACK</span>
        <strong>{track.title}</strong>
        <span className="muted">{track.artist_name}{track.album_title ? ` · ${track.album_title}` : ''}</span>
      </div>
      <span className="msg-track-time muted">{track.duration_seconds ? formatDuration(track.duration_seconds) : ''}</span>
      <button className="btn btn-primary btn-sm btn-pill msg-track-play" onClick={() => onPlay(track)}>
        <Icon name="play" size={14} /> Play on Pulse
      </button>
    </div>
  );
}

export default function MessageBubble({ message, track, onPlayTrack, onReact, onUnsend, onReport, onShowTime, showSender = false }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const imageRef = useRef(null);
  const mine = message.mine;
  const read = message.read_by?.length > 0;
  const isImage = message.kind === 'image' && message.media_name;

  const openImage = () => {
    const url = chatMediaUrl(message.media_name);
    if (url) window.open(url, '_blank', 'noopener');
  };

  return (
    <div className={`msg-row ${mine ? 'mine' : 'theirs'}`}>
      {!mine && (
        <Cover src={message.sender.avatar_url} alt={message.sender.name} size={34} round className="msg-avatar" />
      )}

      <div className="msg-stack">
        {!mine && (
          <span className="msg-sender">
            {message.sender.name}
            {showSender && message.sender.username && <em>@{message.sender.username}</em>}
          </span>
        )}

        <div className={`msg-bubble ${isImage ? 'msg-bubble--media' : ''}`}>
          {isImage && (
            <img
              ref={imageRef}
              className="msg-image"
              src={chatMediaUrl(message.media_name)}
              alt="Shared attachment"
              loading="lazy"
              onClick={openImage}
              onError={(event) => { event.currentTarget.classList.add('gone'); }}
            />
          )}
          {message.kind === 'voice' && message.media_name && <VoiceNote message={message} />}
          {message.track_id && <TrackCard track={track} onPlay={onPlayTrack} />}
          {message.body && <p className="msg-text">{message.body}</p>}
        </div>

        <div className="msg-foot">
          {mine && (
            <span className={`msg-tick ${read ? 'read' : ''}`} title={read ? 'Read' : 'Sent'}>
              <Icon name={read ? 'checkDouble' : 'check'} size={13} />
            </span>
          )}
          <button className="msg-time-btn" onClick={() => onShowTime(message)} title="Message details">
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </button>
          {mine && <Expiry message={message} />}
        </div>

        {message.reactions?.length > 0 && (
          <div className="msg-reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className={`msg-reaction ${reaction.mine ? 'mine' : ''}`}
                onClick={() => onReact(message, reaction.emoji)}
                title={reaction.mine ? 'Remove your reaction' : 'React'}
              >
                {reaction.emoji} <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="msg-actions">
        <button className="msg-action" onClick={() => setPickerOpen((open) => !open)} title="React" aria-label="React">
          <Icon name="smiley" size={16} />
        </button>
        {mine ? (
          <button className="msg-action" onClick={() => onUnsend(message)} title="Unsend" aria-label="Unsend">
            <Icon name="trash" size={15} />
          </button>
        ) : (
          <button className="msg-action" onClick={() => onReport(message)} title="Report" aria-label="Report">
            <Icon name="flag" size={15} />
          </button>
        )}
        {pickerOpen && (
          <div className="msg-emoji-picker" onMouseLeave={() => setPickerOpen(false)}>
            {QUICK.map((emoji) => (
              <button key={emoji} onClick={() => { onReact(message, emoji); setPickerOpen(false); }}>{emoji}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
