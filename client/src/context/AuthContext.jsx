import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from '../api';

const AuthContext = createContext(null);
const CACHED_USER_KEY = 'pulse_cached_user_v1';
const CACHED_ARTIST_KEY = 'pulse_cached_artist_v1';

function readCached(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function cacheSession(user, artist) {
  try {
    if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_USER_KEY);
    if (artist) localStorage.setItem(CACHED_ARTIST_KEY, JSON.stringify(artist));
    else localStorage.removeItem(CACHED_ARTIST_KEY);
  } catch { /* cached identity is best-effort for offline mode */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readCached(CACHED_USER_KEY));
  const [artist, setArtist] = useState(() => readCached(CACHED_ARTIST_KEY));
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setUser(readCached(CACHED_USER_KEY));
      setArtist(readCached(CACHED_ARTIST_KEY));
      setLoading(false);
      return;
    }
    try {
      const data = await api.get('/api/auth/me');
      setUser(data.user);
      setArtist(data.artist);
      cacheSession(data.user, data.artist);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        setToken(null);
        cacheSession(null, null);
        setUser(null);
        setArtist(null);
      } else {
        // Keep a previously authenticated offline session when the API cannot
        // be reached; the offline player itself never depends on an API call.
        setUser(readCached(CACHED_USER_KEY));
        setArtist(readCached(CACHED_ARTIST_KEY));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = useCallback(async (identifier, password) => {
    const data = await api.post('/api/auth/login', { identifier, email: identifier, password });
    setToken(data.token);
    setUser(data.user);
    cacheSession(data.user, null);
    try {
      const me = await api.get('/api/auth/me');
      setArtist(me.artist);
      cacheSession(me.user || data.user, me.artist);
    } catch { /* ignore */ }
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.post('/api/auth/register', payload);
    setToken(data.token);
    setUser(data.user);
    cacheSession(data.user, null);
    try {
      const me = await api.get('/api/auth/me');
      setArtist(me.artist);
      cacheSession(me.user || data.user, me.artist);
    } catch { /* ignore */ }
    return data.user;
  }, []);

  const loginWithGoogle = useCallback(async (credential) => {
    const data = await api.post('/api/auth/google', { credential });
    setToken(data.token);
    setUser(data.user);
    cacheSession(data.user, null);
    try {
      const me = await api.get('/api/auth/me');
      setArtist(me.artist);
      cacheSession(me.user || data.user, me.artist);
    } catch { /* ignore */ }
    return data.user;
  }, []);

  const updatePreferences = useCallback(async (payload) => {
    const data = await api.put('/api/auth/preferences', payload);
    setUser(data.user);
    cacheSession(data.user, artist);
    return data.user;
  }, [artist]);

  const logout = useCallback(() => {
    setToken(null);
    cacheSession(null, null);
    setUser(null);
    setArtist(null);
  }, []);

  const refreshArtist = useCallback(async () => {
    try {
      const me = await api.get('/api/auth/me');
      setUser(me.user);
      setArtist(me.artist);
      cacheSession(me.user, me.artist);
    } catch { /* ignore */ }
  }, []);

  return (
    <AuthContext.Provider value={{ user, artist, loading, login, loginWithGoogle, register, logout, refreshArtist, updatePreferences }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
