import Icon from '../Icon.jsx';
import { Cover } from '../ui.jsx';

/**
 * The listening room, as it appears above the composer of a party.
 *
 * This is a shared queue, not a live audio stream: the room records which track the party is on,
 * and every member's own player follows it. Nothing is streamed through anyone's browser but your
 * own playback, which is why it works on an ordinary connection.
 */
export default function RoomBar({ room, track, joined, onJoin, onLeave, onToggle, onNext, canControl }) {
  if (!room) return null;
  const playing = room.playing;
  const queued = room.queue?.length || 0;

  return (
    <div className={`room-bar ${joined ? 'room-bar--joined' : ''}`}>
      <span className="room-tag"><Icon name="broadcast" size={13} /> LISTENING ROOM</span>

      <span className="room-state">
        {playing?.track_id ? (
          <>
            <Cover src={track?.cover_url} alt={track?.title || 'Track'} size={28} />
            <span className="room-track">
              <strong>{track?.title || 'Track'}</strong>
              <em>{track?.artist_name || 'in the catalogue'}</em>
            </span>
            {!playing.is_playing && <span className="room-paused">paused</span>}
          </>
        ) : (
          <span className="muted">
            {queued ? `${queued} queued — press play` : 'Nothing playing yet — queue a track'}
          </span>
        )}
      </span>

      <span className="room-online">
        <span className="room-dot" /> {room.online || 0} online
      </span>

      <div className="room-actions">
        {joined && canControl && (
          <button className="icon-btn" onClick={onToggle} title={playing?.is_playing ? 'Pause' : 'Play'}>
            <Icon name={playing?.is_playing ? 'pause' : 'play'} size={16} />
          </button>
        )}
        {joined && canControl && (
          <button className="icon-btn" onClick={onNext} title="Next track" disabled={!queued && !playing?.track_id}>
            <Icon name="next" size={16} />
          </button>
        )}
        <button className={`btn btn-sm btn-pill ${joined ? 'btn-ghost' : 'btn-primary'}`} onClick={joined ? onLeave : onJoin}>
          {joined ? 'Leave' : 'Join'}
        </button>
      </div>
    </div>
  );
}
