import { useState } from 'react';
import Icon from '../Icon.jsx';
import { Cover } from '../ui.jsx';
import { formatDuration } from '../../format.js';
import { chatMediaUrl, timeLeft } from '../../chat.jsx';

const TABS = ['Tracks', 'Links', 'Files'];

/** Every http(s) link anyone dropped in the thread. */
function linksIn(messages) {
  const found = new Map();
  const pattern = /https?:\/\/[^\s<>()]+/gi;
  for (const message of messages) {
    for (const url of (message.body || '').match(pattern) || []) {
      if (!found.has(url)) found.set(url, message);
    }
  }
  return [...found.entries()].map(([url, message]) => ({ url, message }));
}

/**
 * The right-hand panel: who you are talking to, what has been shared, and what happens to it.
 * Everything here is derived from the thread itself — nothing is stored twice.
 */
export default function ChatDetails({
  conversation, messages, tracks, onPlayTrack, onBlock, onUnblock, onClose, isBlocked, onMute,
  onInvite, onLeave, onRename, onUnqueue, onRoomNext, onRoomToggle, onJoinRoom, roomJoined
}) {
  const [tab, setTab] = useState('Tracks');
  const peer = conversation.kind === 'dm' ? conversation.others?.[0] : null;
  const channel = conversation.kind === 'channel';
  const party = conversation.kind === 'party';
  const title = conversation.kind === 'dm' ? (peer?.name || 'Conversation') : (conversation.title || 'Group');
  const handle = peer?.username ? `@${peer.username}` : null;
  const members = conversation.members || [];
  const room = conversation.room || null;

  const sharedTracks = [...new Set(messages.filter((m) => m.track_id).map((m) => m.track_id))]
    .map((id) => tracks[id]).filter(Boolean);
  const files = messages.filter((m) => m.media_name);
  const links = linksIn(messages);

  return (
    <aside className="chat-details">
      {onClose && (
        <button className="icon-btn chat-details-close" onClick={onClose} aria-label="Close details">
          <Icon name="close" size={18} />
        </button>
      )}

      <div className="cd-head">
        <Cover src={peer?.avatar_url} alt={title} size={92} round={Boolean(peer)} />
        <h3>{title}</h3>
        {handle && <span className="muted">@{peer.username}</span>}
        <p className="cd-note">
          {conversation.kind === 'dm' && 'Messages here delete themselves 24 hours after they are read.'}
          {party && `A party of ${members.length}. Messages delete themselves 24 hours after everyone has read them.`}
          {channel && 'A channel: the owner posts, everyone else reads. Posts are deleted after 7 days.'}
        </p>
      </div>

      <div className="cd-actions">
        <button className="cd-action" onClick={() => onMute(!conversation.muted)} title={conversation.muted ? 'Unmute' : 'Mute'}>
          <Icon name={conversation.muted ? 'bell' : 'volumeMute'} size={18} /><span>{conversation.muted ? 'Unmute' : 'Mute'}</span>
        </button>
        <button className="cd-action" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/messages`)} title="Copy a link to Pulse messages">
          <Icon name="share" size={18} /><span>Share</span>
        </button>
        {party && (
          <button className="cd-action" onClick={onInvite} title="Invite people by artist tag">
            <Icon name="users" size={18} /><span>Invite</span>
          </button>
        )}
        {party && (
          <button
            className="cd-action"
            onClick={() => {
              const next = window.prompt('Party name', conversation.title || '');
              if (next && next.trim()) onRename?.(next.trim());
            }}
            title="Rename the party"
          >
            <Icon name="edit" size={18} /><span>Rename</span>
          </button>
        )}
        {(party || channel) && (
          <button className="cd-action cd-action--danger" onClick={onLeave} title={party ? 'Leave the party' : 'Leave the channel'}>
            <Icon name="logout" size={18} /><span>Leave</span>
          </button>
        )}
        {peer && (
          isBlocked ? (
            <button className="cd-action" onClick={() => onUnblock(peer.id)} title="Unblock">
              <Icon name="checkCircle" size={18} /><span>Unblock</span>
            </button>
          ) : (
            <button className="cd-action cd-action--danger" onClick={() => onBlock(peer.id)} title="Block this person">
              <Icon name="lock" size={18} /><span>Block</span>
            </button>
          )
        )}
      </div>

      {!peer && members.length > 0 && (
        <div className="cd-members">
          <span className="cd-label">{channel ? 'Members' : 'In this party'}</span>
          {members.slice(0, 8).map((person) => (
            <span key={person.id} className="cd-member">
              <Cover src={person.avatar_url} alt={person.name} size={26} round />
              <span className="cd-member-name">{person.name}</span>
              {person.username && <em>@{person.username}</em>}
              {conversation.owner?.id === person.id && <span className="cd-owner">owner</span>}
            </span>
          ))}
        </div>
      )}

      {party && (
        <div className="cd-room">
          <span className="cd-label"><Icon name="broadcast" size={12} /> Listening room</span>
          {room?.playing?.track_id ? (
            <button className="cd-row" onClick={() => onPlayTrack(tracks[room.playing.track_id])}>
              <Cover src={tracks[room.playing.track_id]?.cover_url} alt="Now playing" size={34} />
              <span className="cd-row-meta">
                <strong>{tracks[room.playing.track_id]?.title || 'Track'}</strong>
                <em>{room.playing.is_playing ? 'playing now' : 'paused'} · added by a member</em>
              </span>
              <Icon name={room.playing.is_playing ? 'pause' : 'play'} size={15} />
            </button>
          ) : (
            <p className="muted pad-sm">{roomJoined ? 'Nothing playing — queue a track below.' : 'Join to listen along.'}</p>
          )}
          {!roomJoined && (
            <button className="btn btn-ghost btn-sm btn-pill" onClick={onJoinRoom}>
              <Icon name="broadcast" size={14} /> Join the room
            </button>
          )}
          {room?.queue?.length > 0 && (
            <>
              <span className="cd-label">Up next · {room.queue.length}</span>
              {room.queue.map((entry) => (
                <div key={entry.id} className="cd-row cd-row--queue">
                  <Cover src={tracks[entry.track_id]?.cover_url} alt="Queued track" size={30} />
                  <span className="cd-row-meta">
                    <strong>{tracks[entry.track_id]?.title || 'Track'}</strong>
                    <em>{tracks[entry.track_id]?.artist_name || 'in the catalogue'}</em>
                  </span>
                  <button className="icon-btn" onClick={() => onUnqueue(entry.id)} title="Remove from the queue">
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </>
          )}
          {roomJoined && (
            <div className="cd-room-actions">
              <button className="btn btn-ghost btn-sm btn-pill" onClick={onRoomToggle}>
                <Icon name={room?.playing?.is_playing ? 'pause' : 'play'} size={14} />
                {room?.playing?.is_playing ? 'Pause' : 'Play'}
              </button>
              <button className="btn btn-ghost btn-sm btn-pill" onClick={onRoomNext}>
                <Icon name="next" size={14} /> Next
              </button>
            </div>
          )}
        </div>
      )}

      <div className="cd-tabs" role="tablist">
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            className={`cd-tab ${tab === name ? 'active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="cd-list">
        {tab === 'Tracks' && (
          sharedTracks.length === 0
            ? <p className="muted pad">No tracks shared yet</p>
            : sharedTracks.map((track) => (
              <button key={track.id} className="cd-row" onClick={() => onPlayTrack(track)}>
                <Cover src={track.cover_url || track.album_cover} alt={track.title} size={38} />
                <span className="cd-row-meta">
                  <strong>{track.title}</strong>
                  <em>{track.artist_name}</em>
                </span>
                <span className="muted">{track.duration_seconds ? formatDuration(track.duration_seconds) : ''}</span>
              </button>
            ))
        )}

        {tab === 'Links' && (
          links.length === 0
            ? <p className="muted pad">No links shared yet</p>
            : links.map(({ url, message }) => (
              <a key={url} className="cd-row cd-row--link" href={url} target="_blank" rel="noreferrer noopener">
                <Icon name="external" size={16} />
                <span className="cd-row-meta">
                  <strong>{url.replace(/^https?:\/\//, '').slice(0, 42)}</strong>
                  <em>{message.sender.name} · {timeLeft(message.expires_at)}</em>
                </span>
              </a>
            ))
        )}

        {tab === 'Files' && (
          files.length === 0
            ? <p className="muted pad">No attachments yet</p>
            : files.map((message) => (
              <a key={message.id} className="cd-row" href={chatMediaUrl(message.media_name)} target="_blank" rel="noreferrer noopener">
                {message.kind === 'image'
                  ? <img className="cd-thumb" src={chatMediaUrl(message.media_name)} alt="" />
                  : <span className="cd-thumb cd-thumb--audio"><Icon name="wave" size={18} /></span>}
                <span className="cd-row-meta">
                  <strong>{message.kind === 'image' ? 'Image' : 'Voice note'}</strong>
                  <em>{message.sender.name} · {timeLeft(message.expires_at)}</em>
                </span>
              </a>
            ))
        )}
      </div>

      <p className="cd-foot">
        <Icon name="info" size={13} />{' '}
        {channel
          ? 'Posts are deleted 7 days after they go out, whatever happens. Reported posts are kept for review.'
          : 'Attachments are served privately and stop working when the message expires.'}
      </p>
    </aside>
  );
}
