import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { Cover, Spinner } from '../components/ui.jsx';
import MessageBubble from '../components/chat/MessageBubble.jsx';
import Composer from '../components/chat/Composer.jsx';
import ChatDetails from '../components/chat/ChatDetails.jsx';
import NewChatModal from '../components/chat/NewChatModal.jsx';
import { chatApi, formatChatTime, dayLabel, notifyChatChanged, useChatUnread } from '../chat.jsx';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' }
];

const REPORT_REASONS = ['Harassment or bullying', 'Spam or scam', 'Hate speech', 'Something else'];

/**
 * Messages. A 24-hour conversation: everything here is deleted a day after it is read, so this page
 * keeps no local copy of anything — no offline cache, no drafts saved to the device.
 */
export default function Messages() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { play } = usePlayer();
  const { refresh: refreshUnread } = useChatUnread();
  const narrow = useMediaQuery('(max-width: 900px)');

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState({});
  const [shareCandidate, setShareCandidate] = useState(null);
  const [showDetails, setShowDetails] = useState(true);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [reportFor, setReportFor] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [detailFor, setDetailFor] = useState(null);

  const bottomRef = useRef(null);
  const markReadRef = useRef(0);

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

  const loadThread = useCallback(async (id) => {
    setLoadingThread(true);
    try {
      const data = await chatApi.messages(id, { limit: 50 });
      setMessages(data.messages || []);
      setHasMore(Boolean(data.has_more));
    } catch (err) {
      toast(err.message || 'Could not open that conversation', 'error');
      setMessages([]);
    } finally {
      setLoadingThread(false);
    }
  }, [toast]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // First conversation opens by itself, so the page is never an empty frame.
  useEffect(() => {
    if (activeId || !conversations.length || narrow) return;
    setActiveId(conversations[0].id);
  }, [conversations, activeId, narrow]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    loadThread(activeId);
  }, [activeId, loadThread]);

  /* ------------------------------------------------------------ polling -- */

  // New messages: every few seconds while a thread is open and the tab is in front of someone.
  useEffect(() => {
    if (!activeId) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      chatApi.messages(activeId, { limit: 50 })
        .then((data) => { setMessages(data.messages || []); setHasMore(Boolean(data.has_more)); })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [activeId]);

  // The conversation list moves more slowly.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) loadConversations(); }, 15000);
    return () => clearInterval(timer);
  }, [loadConversations]);

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

  useEffect(() => {
    const missing = [...new Set(messages.filter((m) => m.track_id).map((m) => m.track_id))]
      .filter((id) => !tracks[id]);
    if (!missing.length) return;
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
  }, [messages, tracks]);

  /* ---------------------------------------------------------- scrolling -- */

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, activeId]);

  /* ------------------------------------------------------------ actions -- */

  const openConversation = (id) => {
    setActiveId(id);
    markReadRef.current = 0;
    setBlocked(false);
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
    if (!query.trim()) return true;
    const text = `${row.title || ''} ${(row.others || []).map((person) => `${person.name} ${person.username || ''}`).join(' ')}`;
    return text.toLowerCase().includes(query.trim().toLowerCase());
  }), [conversations, filter, query]);

  const showList = !narrow || !activeId;
  const showThread = !narrow || Boolean(activeId);

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
              <div className="chat-search">
                <Icon name="search" size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search chats"
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
                  <span>Start one — messages vanish 24 hours after they are read.</span>
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
                  : 'No messages yet';
                return (
                  <button
                    key={row.id}
                    className={`chat-row ${row.id === activeId ? 'active' : ''}`}
                    onClick={() => openConversation(row.id)}
                  >
                    <Cover src={person?.avatar_url} alt={title} size={48} round={Boolean(person)}
                      className="chat-row-avatar" />
                    <span className="chat-row-meta">
                      <span className="chat-row-top">
                        <strong>{title}</strong>
                        <em>{formatChatTime(row.last_message?.created_at || row.last_message_at)}</em>
                      </span>
                      <span className="chat-row-bottom">
                        <span className="chat-row-preview">{preview}</span>
                        {row.unread > 0 && <span className="chat-badge">{row.unread}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
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
                    <Cover src={peer?.avatar_url} alt={peer?.name || 'Conversation'} size={40} round={Boolean(peer)} />
                    <div className="cth-meta">
                      <strong>{peer?.name || active.title || 'Conversation'}</strong>
                      <span className="muted">
                        {peer?.username ? `@${peer.username}` : `${active.members?.length || 0} members`}
                        {' · '}
                        {blocked ? 'blocked' : 'deletes 24h after it is read'}
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
                      <span>Say something — it will be here for a day after it is read.</span>
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

                <Composer
                  onSend={send}
                  onShareTrack={setShareCandidate}
                  shareCandidate={shareCandidate}
                  onClearShare={() => setShareCandidate(null)}
                  disabled={!activeId}
                />
              </>
            ) : (
              <div className="chat-empty chat-empty--thread">
                <Icon name="mail" size={30} />
                <strong>Pick a conversation</strong>
                <span>Or start a new one — anything you send is deleted 24 hours after it is read.</span>
              </div>
            )}
          </section>
        )}

        {showDetails && !narrow && active && (
          <ChatDetails
            conversation={active}
            messages={messages}
            tracks={tracks}
            isBlocked={blocked}
            onPlayTrack={playTrack}
            onBlock={block}
            onUnblock={unblock}
            onMute={toggleMute}
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
