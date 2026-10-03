import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { Cover, Spinner } from '../components/ui.jsx';
import MessageBubble from '../components/chat/MessageBubble.jsx';
import Composer from '../components/chat/Composer.jsx';
import ChatDetails from '../components/chat/ChatDetails.jsx';
import NewChatModal from '../components/chat/NewChatModal.jsx';
import InviteModal from '../components/chat/InviteModal.jsx';
import NotesRow from '../components/chat/NotesRow.jsx';
import RoomBar from '../components/chat/RoomBar.jsx';
import { chatApi, formatChatTime, dayLabel, notifyChatChanged, useChatUnread } from '../chat.jsx';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'dm', label: 'DMs' },
  { id: 'party', label: 'Parties' },
  { id: 'channel', label: 'Channels' },
  { id: 'unread', label: 'Unread' }
];

const REPORT_REASONS = ['Harassment or bullying', 'Spam or scam', 'Hate speech', 'Something else'];

/**
 * Messages. A 24-hour conversation: everything here is deleted a day after it is read, so this page
 * keeps no local copy of anything — no offline cache, no drafts saved to the device.
 *
 * Three shapes live in the same list:
 *   direct   — two people, the clock starts when the other one reads
 *   party    — a group, the clock starts when the last member has read, and it can have a
 *              listening room (a shared queue of track ids; each member's own player follows it)
 *   channel  — a broadcast: the owner posts, everyone else reads, and posts live 7 days
 */
export default function Messages() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { play } = usePlayer();
  const { refresh: refreshUnread } = useChatUnread();
  const narrow = useMediaQuery('(max-width: 900px)');
  const { handle } = useParams();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState([]);
  const [room, setRoom] = useState(null);
  const [roomJoined, setRoomJoined] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState({});
  const [shareCandidate, setShareCandidate] = useState(null);
  const [showDetails, setShowDetails] = useState(true);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reportFor, setReportFor] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [detailFor, setDetailFor] = useState(null);

  const bottomRef = useRef(null);
  const markReadRef = useRef(0);
  const roomPlayedRef = useRef(null);

  const active = conversations.find((row) => row.id === activeId) || null;
  const peer = active?.kind === 'dm' ? active.others?.[0] : null;

  /* ------------------------------------------------------------ loading -- */

  const loadConversations = useCallback(async () => {
    try {
      const rows = await chatApi.conversations();
      setConversations(rows || []);
      return rows || [];
    } catch {
      return [];
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadNotes = useCallback(() => {
    chatApi.notes().then((rows) => setNotes(rows || [])).catch(() => {});
  }, []);

  const loadThread = useCallback(async (id) => {
    setLoadingThread(true);
    try {
      const data = await chatApi.messages(id, { limit: 50 });
      setMessages(data.messages || []);
      setHasMore(Boolean(data.has_more));
      setRoom(data.room || null);
    } catch (err) {
      toast(err.message || 'Could not open that conversation', 'error');
      setMessages([]);
      setRoom(null);
    } finally {
      setLoadingThread(false);
    }
  }, [toast]);

  useEffect(() => { loadConversations(); loadNotes(); }, [loadConversations, loadNotes]);

  // Anything that changes a conversation also refreshes the notes row (a new chat can reveal one).
  useEffect(() => {
    const reload = () => { loadNotes(); loadConversations(); };
    window.addEventListener('pulse-chat-changed', reload);
    return () => window.removeEventListener('pulse-chat-changed', reload);
  }, [loadNotes, loadConversations]);

  // First conversation opens by itself, so the page is never an empty frame.
  useEffect(() => {
    if (activeId || !conversations.length || narrow) return;
    setActiveId(conversations[0].id);
  }, [conversations, activeId, narrow]);

  useEffect(() => {
    if (!activeId) { setMessages([]); setRoom(null); return; }
    roomPlayedRef.current = null;
    loadThread(activeId);
  }, [activeId, loadThread]);

  /* ------------------------------------------------------------- @tags -- */

  // /messages/@timi opens (or starts) the chat with whoever owns that artist tag.
  useEffect(() => {
    if (!handle) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const person = await chatApi.person(handle);
        if (cancelled) return;
        if (person.self) {
          toast(`That is your artist tag — share @${person.username} so people can find you`);
        } else {
          const conversation = await chatApi.openDm(person.id);
          if (cancelled) return;
          await loadConversations();
          setActiveId(conversation.id);
        }
      } catch (err) {
        if (!cancelled) toast(err.message || 'No one on Pulse has that artist tag', 'error');
      } finally {
        if (!cancelled) navigate('/messages', { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [handle, toast, navigate, loadConversations]);

  /* ------------------------------------------------------------ polling -- */

  // New messages: every few seconds while a thread is open and the tab is in front of someone.
  // This poll is also the room's heartbeat — it is what "3 online" counts.
  useEffect(() => {
    if (!activeId) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      chatApi.messages(activeId, { limit: 50 })
        .then((data) => {
          setMessages(data.messages || []);
          setHasMore(Boolean(data.has_more));
          setRoom(data.room || null);
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [activeId]);

  // The conversation list moves more slowly.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadConversations();
      loadNotes();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadConversations, loadNotes]);

  /* ------------------------------------------------------------- reading -- */

  // Opening a thread — or receiving into an open one — is what starts the 24-hour clock.
  useEffect(() => {
    if (!activeId || document.hidden) return;
    const newest = messages.at(-1);
    const needsRead = messages.some((message) => !message.mine && !message.read_by?.length);
    if (!newest || !needsRead) return;
    if (markReadRef.current === newest.id) return;
    markReadRef.current = newest.id;
    chatApi.read(activeId, newest.id)
      .then(() => { refreshUnread(); loadConversations(); })
      .catch(() => {});
  }, [activeId, messages, refreshUnread, loadConversations]);

  /* -------------------------------------------------------- track lookup -- */

  // Shared tracks, the room's track and its queue all point at catalogue ids — resolve them once.
  useEffect(() => {
    const wanted = new Set(messages.filter((message) => message.track_id).map((message) => message.track_id));
    if (room?.playing?.track_id) wanted.add(room.playing.track_id);
    for (const entry of room?.queue || []) wanted.add(entry.track_id);
    const missing = [...wanted].filter((id) => !tracks[id]);
    if (!missing.length) return undefined;
    let cancelled = false;
    Promise.all(missing.map((id) => api.get(`/api/songs/${id}`).catch(() => null)))
      .then((rows) => {
        if (cancelled) return;
        setTracks((current) => {
          const next = { ...current };
          rows.filter(Boolean).forEach((song) => { next[song.id] = song; });
          return next;
        });
      });
    return () => { cancelled = true; };
  }, [messages, room, tracks]);

  /* ------------------------------------------------------------ listening -- */

  // Joining the room means your own player follows what the room plays. Nothing is streamed
  // between browsers: the room holds a track id, and each device plays it from Pulse.
  useEffect(() => {
    const playing = room?.playing;
    if (!roomJoined || !playing?.track_id || !playing.is_playing) return;
    if (roomPlayedRef.current === playing.track_id) return;
    const song = tracks[playing.track_id];
    if (!song) return;
    roomPlayedRef.current = playing.track_id;
    play([song]);
  }, [roomJoined, room, tracks, play]);

  /* ---------------------------------------------------------- scrolling -- */

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, activeId]);

  /* ------------------------------------------------------------ actions -- */

  const openConversation = (id) => {
    setActiveId(id);
    markReadRef.current = 0;
    setBlocked(false);
    setRoomJoined(false);
    roomPlayedRef.current = null;
  };

  // A note is an introduction: tapping it opens the chat, starting one if there is none.
  const openFromNote = async (note) => {
    try {
      const conversation = note.conversation_id
        ? { id: note.conversation_id }
        : await chatApi.openDm(note.user.id);
      await loadConversations();
      openConversation(conversation.id);
    } catch (err) {
      toast(err.message || 'Could not open that conversation', 'error');
    }
  };

  const send = async (form) => {
    const sent = await chatApi.send(activeId, form);
    setMessages((current) => [...current, sent]);
    loadConversations();
    notifyChatChanged();
    return sent;
  };

  const toggleMute = async (muted) => {
    setConversations((current) => current.map((row) => (row.id === activeId ? { ...row, muted } : row)));
    try { await chatApi.mute(activeId, muted); } catch { loadConversations(); }
  };

  const rename = async (title) => {
    try {
      await chatApi.rename(activeId, title);
      await loadConversations();
    } catch (err) {
      toast(err.message || 'Could not rename this conversation', 'error');
    }
  };

  const leaveConversation = async () => {
    if (!window.confirm(`Leave ${active.title || 'this conversation'}? Its messages stay for the others.`)) return;
    try {
      await chatApi.leave(activeId);
      toast('You left');
      setActiveId(null);
      await loadConversations();
      notifyChatChanged();
    } catch (err) {
      toast(err.message || 'Could not leave', 'error');
    }
  };

  const queueTrack = async (song) => {
    try {
      const updated = await chatApi.queueTrack(activeId, song.id);
      setRoom(updated);
      toast(`${song.title} is in the room queue`);
    } catch (err) {
      toast(err.message || 'Could not queue that track', 'error');
    }
  };

  const unqueue = async (entryId) => {
    try { setRoom(await chatApi.unqueue(activeId, entryId)); } catch { /* the next poll will correct it */ }
  };

  const roomToggle = async () => {
    const isPlaying = !room?.playing?.is_playing;
    try { setRoom(await chatApi.roomPlaying(activeId, { is_playing: isPlaying })); } catch { /* ignore */ }
  };

  const roomNext = async () => {
    try {
      const updated = await chatApi.roomNext(activeId);
      setRoom(updated);
      if (updated.playing?.track_id) roomPlayedRef.current = null;
    } catch { /* ignore */ }
  };

  const react = async (message, emoji) => {
    // Optimistic: the reaction appears immediately, the server call follows.
    setMessages((current) => current.map((row) => {
      if (row.id !== message.id) return row;
      const existing = row.reactions.find((reaction) => reaction.emoji === emoji);
      let reactions;
      if (!existing) reactions = [...row.reactions, { emoji, count: 1, mine: true }];
      else if (existing.mine) {
        reactions = row.reactions
          .map((reaction) => (reaction.emoji === emoji ? { ...reaction, count: reaction.count - 1, mine: false } : reaction))
          .filter((reaction) => reaction.count > 0);
      } else reactions = row.reactions.map((reaction) => (reaction.emoji === emoji ? { ...reaction, count: reaction.count + 1, mine: true } : reaction));
      return { ...row, reactions };
    }));
    try { await chatApi.react(message.id, emoji); } catch { loadThread(activeId); }
  };

  const unsend = async (message) => {
    if (!window.confirm('Unsend this message? It disappears for everyone.')) return;
    try {
      await chatApi.unsend(message.id);
      setMessages((current) => current.filter((row) => row.id !== message.id));
      loadConversations();
      toast('Message unsent');
    } catch (err) {
      toast(err.message || 'Could not unsend that message', 'error');
    }
  };

  const report = async (reason) => {
    try {
      const result = await chatApi.report(reportFor.message.id, reason);
      toast(result.message || 'Reported');
    } catch (err) {
      toast(err.message || 'Could not send that report', 'error');
    } finally {
      setReportFor(null);
    }
  };

  const block = async (userId) => {
    if (!window.confirm('Block this person? They will not be able to message you.')) return;
    try {
      await chatApi.block(userId);
      setBlocked(true);
      toast('Blocked');
      notifyChatChanged();
    } catch (err) {
      toast(err.message || 'Could not block that person', 'error');
    }
  };

  const unblock = async (userId) => {
    try {
      await chatApi.unblock(userId);
      setBlocked(false);
      toast('Unblocked');
    } catch (err) {
      toast(err.message || 'Could not unblock', 'error');
    }
  };

  const playTrack = (song) => {
    if (!song) return;
    play([song]);
  };

  /* ------------------------------------------------------------- render -- */

  const visible = useMemo(() => conversations.filter((row) => {
    if (filter === 'unread' && !row.unread) return false;
    if (filter !== 'all' && filter !== 'unread' && row.kind !== filter) return false;
    if (!query.trim()) return true;
    // The same "@tag" search as everywhere else: the point of a tag is that it finds one person.
    const people = (row.others || []).map((person) => `${person.name} @${person.username || ''}`).join(' ');
    const text = `${row.title || ''} ${people}`.toLowerCase();
    const needle = query.trim().toLowerCase().replace(/^@/, '');
    return text.includes(needle);
  }), [conversations, filter, query]);

  const showList = !narrow || !activeId;
  const showThread = !narrow || Boolean(activeId);
  const myTag = user?.username ? `@${user.username}` : null;

  return (
    <div className="page messages-page">
      <div className={`messages-grid ${showDetails && !narrow ? 'with-details' : ''}`}>
        {showList && (
          <section className="chat-column">
            <header className="chat-column-head">
              <div className="chat-column-title">
                <h2>Messages</h2>
                <button className="icon-btn" onClick={() => setNewChatOpen(true)} title="New message" aria-label="New message">
                  <Icon name="edit" size={18} />
                </button>
              </div>

              <NotesRow notes={notes} me={user} onOpenConversation={openFromNote} onChanged={loadNotes} />

              <div className="chat-search">
                <Icon name="search" size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={myTag ? `Search chats, or find someone by ${myTag}` : 'Search chats'}
                  aria-label="Search chats"
                />
              </div>
              <div className="chat-filters">
                {FILTERS.map((entry) => (
                  <button
                    key={entry.id}
                    className={`chat-chip ${filter === entry.id ? 'active' : ''}`}
                    onClick={() => setFilter(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
                <span className="chat-chip chat-chip--count">
                  <Icon name="bell" size={12} /> {conversations.reduce((total, row) => total + (row.unread || 0), 0)} unread
                </span>
              </div>
            </header>

            <div className="chat-list">
              {loadingList && <div className="pad"><Spinner size={20} /></div>}
              {!loadingList && visible.length === 0 && (
                <div className="chat-empty">
                  <Icon name="mail" size={30} />
                  <strong>No conversations yet</strong>
                  <span>Start one — or find someone by their artist tag.</span>
                  <button className="btn btn-primary btn-sm btn-pill" onClick={() => setNewChatOpen(true)}>
                    <Icon name="plus" size={15} /> New message
                  </button>
                </div>
              )}

              {visible.map((row) => {
                const person = row.kind === 'dm' ? row.others?.[0] : null;
                const title = row.kind === 'dm' ? (person?.name || 'Conversation') : (row.title || 'Group');
                const preview = row.last_message
                  ? `${row.last_message.mine ? 'You: ' : ''}${previewText(row.last_message)}`
                  : row.kind === 'channel' ? 'Channel — the owner posts' : 'No messages yet';
                return (
                  <button
                    key={row.id}
                    className={`chat-row ${row.id === activeId ? 'active' : ''}`}
                    onClick={() => openConversation(row.id)}
                  >
                    {row.kind === 'dm' ? (
                      <Cover src={person?.avatar_url} alt={title} size={48} round className="chat-row-avatar" />
                    ) : (
                      <span className={`chat-row-icon chat-row-icon--${row.kind}`}>
                        <Icon name={row.kind === 'channel' ? 'broadcast' : 'users'} size={20} />
                      </span>
                    )}
                    <span className="chat-row-meta">
                      <span className="chat-row-top">
                        <strong>{title}</strong>
                        <em>{formatChatTime(row.last_message?.created_at || row.last_message_at)}</em>
                      </span>
                      <span className="chat-row-bottom">
                        <span className="chat-row-preview">
                          {row.kind === 'party' && `${row.member_count || (row.members?.length || 0)} members · `}
                          {preview}
                        </span>
                        {row.unread > 0 && <span className="chat-badge">{row.unread}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {myTag && (
              <p className="chat-column-foot">
                <Icon name="info" size={12} /> People can find you with <strong>{myTag}</strong> — share it,
                or change it in Settings.
              </p>
            )}
          </section>
        )}

        {showThread && (
          <section className="chat-thread">
            {active ? (
              <>
                <header className="chat-thread-head">
                  <div className="cth-left">
                    {narrow && (
                      <button className="icon-btn" onClick={() => setActiveId(null)} aria-label="Back to conversations">
                        <Icon name="arrowLeft" size={19} />
                      </button>
                    )}
                    {peer ? (
                      <Cover src={peer.avatar_url} alt={peer.name || 'Conversation'} size={40} round />
                    ) : (
                      <span className={`chat-row-icon chat-row-icon--${active.kind}`}>
                        <Icon name={active.kind === 'channel' ? 'broadcast' : 'users'} size={17} />
                      </span>
                    )}
                    <div className="cth-meta">
                      <strong>{peer?.name || active.title || 'Conversation'}</strong>
                      <span className="muted">
                        {peer?.username && `@${peer.username}`}
                        {active.kind === 'party' && `${active.member_count || active.members?.length || 0} members · ${active.online ?? room?.online ?? 0} online`}
                        {active.kind === 'channel' && `Channel${active.owner?.username ? ` · @${active.owner.username}` : ''}`}
                        {' · '}
                        {blocked
                          ? 'blocked'
                          : active.kind === 'channel'
                            ? 'deletes 7 days after posting'
                            : 'deletes 24h after it is read'}
                      </span>
                    </div>
                  </div>
                  {!narrow && (
                    <button
                      className={`icon-btn ${showDetails ? 'active' : ''}`}
                      onClick={() => setShowDetails((open) => !open)}
                      title="Conversation details"
                      aria-label="Conversation details"
                    >
                      <Icon name="info" size={18} />
                    </button>
                  )}
                </header>

                <div className="chat-scroll">
                  {loadingThread && <div className="pad"><Spinner size={20} /></div>}
                  {!loadingThread && messages.length === 0 && (
                    <div className="chat-empty chat-empty--thread">
                      <Icon name="wave" size={26} />
                      <strong>No messages in this chat</strong>
                      <span>
                        {active.kind === 'channel' && !active.can_post
                          ? 'When the owner posts, it appears here — and is deleted after 7 days.'
                          : 'Say something — it will be here for a day after it is read.'}
                      </span>
                    </div>
                  )}
                  {hasMore && (
                    <button
                      className="chat-more"
                      onClick={async () => {
                        const data = await chatApi.messages(activeId, { before: messages[0].id, limit: 50 });
                        setMessages((current) => [...(data.messages || []), ...current]);
                        setHasMore(Boolean(data.has_more));
                      }}
                    >
                      Load earlier messages
                    </button>
                  )}
                  {messages.map((message, index) => {
                    const previous = messages[index - 1];
                    const newDay = !previous || dayLabel(previous.created_at) !== dayLabel(message.created_at);
                    return (
                      <div key={message.id}>
                        {newDay && <div className="chat-day"><span>{dayLabel(message.created_at)}</span></div>}
                        <MessageBubble
                          message={message}
                          track={message.track_id ? tracks[message.track_id] : null}
                          showSender={active.kind !== 'dm'}
                          onPlayTrack={playTrack}
                          onReact={react}
                          onUnsend={unsend}
                          onReport={(target) => setReportFor({ message: target })}
                          onShowTime={setDetailFor}
                        />
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>

                {active.kind === 'party' && (
                  <RoomBar
                    room={room}
                    track={room?.playing?.track_id ? tracks[room.playing.track_id] : null}
                    joined={roomJoined}
                    canControl={active.can_post !== false}
                    onJoin={() => setRoomJoined(true)}
                    onLeave={() => { setRoomJoined(false); roomPlayedRef.current = null; }}
                    onToggle={roomToggle}
                    onNext={roomNext}
                  />
                )}

                <Composer
                  onSend={send}
                  onShareTrack={setShareCandidate}
                  shareCandidate={shareCandidate}
                  onClearShare={() => setShareCandidate(null)}
                  disabled={!activeId}
                  canPost={active.can_post !== false}
                  party={active.kind === 'party'}
                  onQueueTrack={queueTrack}
                  lockedNote={active.kind === 'channel'
                    ? (active.can_post
                      ? 'Channel posts are deleted 7 days after they go out.'
                      : 'Only the channel owner can post here — you can still read and react.')
                    : null}
                />
              </>
            ) : (
              <div className="chat-empty chat-empty--thread">
                <Icon name="mail" size={30} />
                <strong>Pick a conversation</strong>
                <span>Or find someone by their artist tag — every account has one.</span>
              </div>
            )}
          </section>
        )}

        {showDetails && !narrow && active && (
          <ChatDetails
            conversation={{ ...active, room }}
            messages={messages}
            tracks={tracks}
            isBlocked={blocked}
            roomJoined={roomJoined}
            onPlayTrack={playTrack}
            onBlock={block}
            onUnblock={unblock}
            onMute={toggleMute}
            onInvite={() => setInviteOpen(true)}
            onLeave={leaveConversation}
            onUnqueue={unqueue}
            onRoomToggle={roomToggle}
            onRoomNext={roomNext}
            onJoinRoom={() => setRoomJoined(true)}
            onRename={rename}
            onClose={() => setShowDetails(false)}
          />
        )}
      </div>

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onPick={(conversation) => {
          loadConversations().then(() => openConversation(conversation.id));
        }}
      />

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        conversation={active}
        onInvited={() => { loadConversations(); loadThread(activeId); }}
      />

      <Modal open={Boolean(reportFor)} onClose={() => setReportFor(null)} title="Report this message" width={420}>
        <div className="report-body">
          <p className="panel-desc">
            A copy of this message is kept so our team can review it. It stays deleted from the chat
            itself, on the usual 24-hour clock.
          </p>
          <div className="report-reasons">
            {REPORT_REASONS.map((reason) => (
              <button key={reason} className="btn btn-ghost btn-block" onClick={() => report(reason)}>{reason}</button>
            ))}
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(detailFor)} onClose={() => setDetailFor(null)} title="Message details" width={380}>
        {detailFor && (
          <div className="msg-detail">
            <div className="spread"><span className="muted">Sent</span><strong>{new Date(detailFor.created_at).toLocaleString()}</strong></div>
            <div className="spread"><span className="muted">From</span><strong>{detailFor.sender.name}</strong></div>
            <div className="spread"><span className="muted">Read by</span><strong>{detailFor.read_by?.length || 0}</strong></div>
            <div className="spread"><span className="muted">Deletes</span><strong>{new Date(detailFor.expires_at).toLocaleString()}</strong></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** "Photo", "Voice note (0:38)", "Shared a track" — how a message reads in the list. */
function previewText(message) {
  if (message.deleted) return 'Message removed';
  if (message.kind === 'image') return 'Photo';
  if (message.kind === 'voice') return 'Voice note';
  if (message.track_id && !message.body) return 'Shared a track';
  return message.body || 'Attachment';
}
