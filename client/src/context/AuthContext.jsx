import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const data = await api.get('/api/auth/me');
      setUser(data.user);
      setArtist(data.artist);
    } catch {
      setToken(null);
      setUser(null);
      setArtist(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    // fetch artist profile too
    try {
      const me = await api.get('/api/auth/me');
      setArtist(me.artist);
    } catch { /* ignore */ }
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.post('/api/auth/register', payload);
    setToken(data.token);
    setUser(data.user);
    try {
      const me = await api.get('/api/auth/me');
      setArtist(me.artist);
    } catch { /* ignore */ }
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setArtist(null);
  }, []);

  const refreshArtist = useCallback(async () => {
    try {
      const me = await api.get('/api/auth/me');
      setArtist(me.artist);
    } catch { /* ignore */ }
  }, []);

  return (
    <AuthContext.Provider value={{ user, artist, loading, login, register, logout, refreshArtist }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
