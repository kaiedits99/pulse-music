import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

/**
 * One source of truth for "is this track liked?".
 *
 * Every list, the player queue and the Now Playing screen get their own copy of a track, each carrying
 * the `is_favorite` flag it was fetched with. Flipping that flag on whichever copy was clicked left all
 * the other copies stale (like the heart in the player bar vs. the row on the page). Instead, the likes
 * changed during this session live here, keyed by song id, and every heart asks `isLiked(track)`:
 * the id's entry if there is one, otherwise the flag the track arrived with.
 *
 * Toggling is optimistic (the heart flips at once) and the requests for one song are sent one at a time,
 * in click order, so a quick double-click can never leave the server disagreeing with the screen.
 */
const FavoritesContext = createContext(null);

/** Only catalog songs can be liked. Podcast episodes have "Save", and local files have no server id. */
export const isLikeable = (track) => !!track && track.id != null && (track.kind === undefined || track.kind === 'song');

export function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [overrides, setOverrides] = useState(() => new Map()); // song id -> liked?
  const [revision, setRevision] = useState(0);                 // bumps after the server confirms a change
  const overridesRef = useRef(overrides);                      // same map, readable synchronously in handlers
  const confirmedRef = useRef(new Map());                      // song id -> what the server last acknowledged
  const tailRef = useRef(new Map());                           // song id -> last queued request (per-song ordering)
  const sessionRef = useRef(0);                                // changes on sign-in/out so late responses are ignored

  const setLiked = useCallback((id, value) => {
    overridesRef.current = new Map(overridesRef.current).set(id, value);
    setOverrides(overridesRef.current);
  }, []);

  // A different person signing in must never inherit the previous person's hearts.
  useEffect(() => {
    sessionRef.current += 1;
    overridesRef.current = new Map();
    confirmedRef.current = new Map();
    tailRef.current = new Map();
    setOverrides(overridesRef.current);
  }, [user?.id]);

  const isLiked = useCallback((track) => {
    if (!isLikeable(track)) return false;
    return overrides.has(track.id) ? overrides.get(track.id) : !!track.is_favorite;
  }, [overrides]);

  /** Send whatever the heart currently says to the server, unless the server already agrees. */
  const sync = useCallback(async (id, session) => {
    if (session !== sessionRef.current) return;
    const wanted = overridesRef.current.get(id);
    if (wanted === confirmedRef.current.get(id)) return; // e.g. liked, then un-liked before the first request went out

    try {
      if (wanted) await api.post(`/api/favorites/${id}`);
      else await api.del(`/api/favorites/${id}`);
    } catch (err) {
      if (session !== sessionRef.current) return;
      // Put the heart back to what the server really holds, unless the person has clicked again since.
      if (overridesRef.current.get(id) === wanted) setLiked(id, confirmedRef.current.get(id));
      toast(err?.status === 404 ? 'This track is no longer available' : 'Could not update Liked Songs — check your connection', 'error');
      return;
    }

    if (session !== sessionRef.current) return;
    confirmedRef.current.set(id, wanted);
    setRevision((n) => n + 1);
    if (overridesRef.current.get(id) === wanted) {
      toast(wanted ? 'Added to Liked Songs' : 'Removed from Liked Songs', wanted ? 'success' : 'info');
    }
  }, [setLiked, toast]);

  const toggleLike = useCallback((track) => {
    if (!isLikeable(track)) return Promise.resolve();
    const id = track.id;
    const before = overridesRef.current.has(id) ? overridesRef.current.get(id) : !!track.is_favorite;
    if (!confirmedRef.current.has(id)) confirmedRef.current.set(id, before);

    setLiked(id, !before); // optimistic: every heart on screen flips now

    const session = sessionRef.current;
    const task = (tailRef.current.get(id) || Promise.resolve()).then(() => sync(id, session));
    tailRef.current.set(id, task);
    return task;
  }, [setLiked, sync]);

  const value = useMemo(() => ({ isLiked, toggleLike, revision }), [isLiked, toggleLike, revision]);
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

/** `{ isLiked(track), toggleLike(track), revision }` — `revision` changes whenever a like is confirmed. */
export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used inside <FavoritesProvider>');
  return ctx;
}
