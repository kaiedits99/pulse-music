// Client side of messaging.
//
// Two things here are deliberate and worth keeping if this file is ever rewritten:
//   - attachments are fetched through an authorised, no-store route with the token in the query
//     (an <img> cannot send an Authorization header), so an expired attachment simply stops loading
//   - nothing about a conversation is written to localStorage or the offline cache: these messages
//     are meant to disappear, and a device copy would outlive them
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getToken } from './api.js';
import { apiUrl } from './config.js';
import { useAuth } from './context/AuthContext.jsx';

/** Where an attachment lives. The token is required: media is never public. */
export const chatMediaUrl = (name) => (name ? apiUrl(`/api/chat/media/${encodeURIComponent(name)}?t=${encodeURIComponent(getToken() || '')}`) : null);

export const chatApi = {
  conversations: () => api.get('/api/chat/conversations'),
  conversation: (id) => api.get(`/api/chat/conversations/${id}`),
  messages: (id, { before, limit = 50 } = {}) => api.get(
    `/api/chat/conversations/${id}/messages?limit=${limit}${before ? `&before=${before}` : ''}`
  ),
  // Address people by id or by artist tag; the tag is what someone can read off a profile.
  openDm: (userId) => api.post('/api/chat/conversations', { user_id: userId }),
  openDmByHandle: (handle) => api.post('/api/chat/conversations', { handle }),
  person: (handle) => api.get(`/api/chat/people/${encodeURIComponent(String(handle).replace(/^@+/, ''))}`),
  people: (q = '') => api.get(`/api/chat/people?q=${encodeURIComponent(q)}`),
  unread: () => api.get('/api/chat/unread'),
  read: (id, upTo) => api.post(`/api/chat/conversations/${id}/read`, upTo ? { up_to: upTo } : {}),
  mute: (id, muted) => api.patch(`/api/chat/conversations/${id}`, { muted }),
  rename: (id, title) => api.patch(`/api/chat/conversations/${id}`, { title }),
  react: (messageId, emoji) => api.post(`/api/chat/messages/${messageId}/react`, { emoji }),
  unsend: (messageId) => api.del(`/api/chat/messages/${messageId}`),
  report: (messageId, reason) => api.post(`/api/chat/messages/${messageId}/report`, { reason }),
  block: (userId) => api.post(`/api/chat/users/${userId}/block`, {}),
  unblock: (userId) => api.del(`/api/chat/users/${userId}/block`),
  send: (id, form) => api.upload(`/api/chat/conversations/${id}/messages`, form),

  // Parties
  createParty: (title, userIds) => api.post('/api/chat/groups', { title, user_ids: userIds }),
  addMember: (id, { userId, handle } = {}) => api.post(`/api/chat/conversations/${id}/members`, {
    user_id: userId, handle
  }),
  leave: (id) => api.del(`/api/chat/conversations/${id}/members/me`),

  // Channels: the owner posts, everyone else reads.
  channels: (q = '') => api.get(`/api/chat/channels?q=${encodeURIComponent(q)}`),
  createChannel: (title) => api.post('/api/chat/channels', { title }),
  joinChannel: (id) => api.post(`/api/chat/channels/${id}/join`, {}),

  // Notes: a one-day status line, not a message.
  notes: () => api.get('/api/chat/notes'),
  postNote: (body, emoji) => api.put('/api/chat/notes', { body, emoji }),
  clearNote: () => api.del('/api/chat/notes'),

  // Listening rooms: a shared queue of track ids. The audio stays in the catalogue.
  room: (id) => api.get(`/api/chat/conversations/${id}/room`),
  queueTrack: (id, trackId) => api.post(`/api/chat/conversations/${id}/room/queue`, { track_id: trackId }),
  unqueue: (id, entryId) => api.del(`/api/chat/conversations/${id}/room/queue/${entryId}`),
  roomPlaying: (id, payload) => api.post(`/api/chat/conversations/${id}/room/playing`, payload),
  roomNext: (id) => api.post(`/api/chat/conversations/${id}/room/next`, {})
};

/* ------------------------------------------------------------------ unread -- */

const UnreadContext = createContext({ unread: 0, refresh: () => {} });

/**
 * The sidebar badge. Polls gently (and only while the tab is visible) because a free instance
 * should not be kept awake by a badge.
 */
export function ChatUnreadProvider({ children }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    if (!user || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    chatApi.unread().then((data) => setUnread(data.unread || 0)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) { setUnread(0); return undefined; }
    refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(tick, 20000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pulse-chat-changed', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pulse-chat-changed', refresh);
    };
  }, [user, refresh]);

  return <UnreadContext.Provider value={{ unread, refresh }}>{children}</UnreadContext.Provider>;
}

export const useChatUnread = () => useContext(UnreadContext);

/** Tell the badge (and anything else listening) that conversations have changed. */
export const notifyChatChanged = () => window.dispatchEvent(new CustomEvent('pulse-chat-changed'));

/* ------------------------------------------------------------------- time --- */

/** "14:26" for today, "Yesterday", or a short date — the way a chat list reads. */
export function formatChatTime(value) {
  if (!value) return '';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return then.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** "TODAY" / "YESTERDAY" / "12 MARCH" dividers inside a thread. */
export function dayLabel(value) {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();
  if (then.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return then.toLocaleDateString([], { day: 'numeric', month: 'long' });
}

/** How long an attachment (or a message) has left before it goes. */
export function timeLeft(expiresAt) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'gone';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}
