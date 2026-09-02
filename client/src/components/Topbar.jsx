import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { initials } from '../format.js';

const TITLES = {
  '/': 'Home',
  '/songs': 'Search',
  '/albums': 'Albums',
  '/artists': 'Artists',
  '/playlists': 'Playlists',
  '/favorites': 'Favorites',
  '/upload': 'Upload Music',
  '/settings': 'Settings'
};

export default function Topbar({ onMenu, onAccount }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');

  const baseTitle = TITLES[location.pathname] || '';

  useEffect(() => {
    // sync search box with ?q param when on songs page
    const params = new URLSearchParams(location.search);
    if (location.pathname === '/songs') setQ(params.get('q') || '');
  }, [location]);

  const submit = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/songs?q=${encodeURIComponent(q.trim())}` : '/songs');
  };

  const isDark = theme === 'dark';

  return (
    <header className="topbar">
      {/* Spotify-style history nav */}
      <div className="topbar-nav">
        <button className="round-nav-btn" onClick={() => navigate(-1)} aria-label="Go back" disabled={!window.history?.length}>
          <Icon name="arrowLeft" size={18} />
        </button>
        <button className="round-nav-btn" onClick={() => navigate(1)} aria-label="Go forward">
          <Icon name="chevronRight" size={18} />
        </button>
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Menu"><Icon name="menu" size={20} /></button>
        <h2 className="topbar-title">{baseTitle}</h2>
      </div>
      <form className="search-box" onSubmit={submit}>
        <Icon name="search" size={17} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="What do you want to listen to?"
          aria-label="Search"
        />
      </form>
      <div className="topbar-actions">
        {!online && (
          <span className="offline-pill" title="No network — your downloads still play">
            <Icon name="download" size={13} /> Offline
          </span>
        )}
        <button
          className="icon-btn theme-toggle-btn"
          onClick={toggleTheme}
          title={`Switch to ${isDark ? 'light (white & purple)' : 'dark'} mode`}
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          <Icon name={isDark ? 'sun' : 'moon'} size={19} />
        </button>
        <button className="topbar-avatar avatar" onClick={onAccount} aria-label="Open account menu">{initials(user?.name)}</button>
      </div>
    </header>
  );
}
