import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { initials } from '../format.js';
import { downloadedPlaylists, downloadedSongs, OFFLINE_EVENT } from '../offline.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

/** Live activity feed built from things the app actually knows about. */
function useNotifications() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const build = () => {
      const songs = downloadedSongs();
      const lists = downloadedPlaylists();
      const next = [];

      [...lists]
        .sort((a, b) => b.at - a.at)
        .slice(0, 3)
        .forEach((pl) => next.push({
          id: `pl-${pl.id}`,
          icon: 'download',
          green: true,
          title: `“${pl.name}” is available offline`,
          sub: `${pl.songs?.length || 0} tracks saved to this device`,
          to: `/playlists/${pl.id}`
        }));

      [...songs]
        .sort((a, b) => b.at - a.at)
        .slice(0, 3)
        .forEach((s) => next.push({
          id: `song-${s.id}`,
          icon: 'checkCircle',
          green: true,
          title: `“${s.title}” downloaded`,
          sub: s.artist_name || 'Ready to play offline',
          to: '/downloads'
        }));

      if (!next.length) {
        next.push({
          id: 'empty',
          icon: 'sparkle',
          title: 'Nothing new right now',
          sub: 'Download a playlist and updates will show up here.',
          to: '/library'
        });
      }
      setItems(next);
    };

    build();
    window.addEventListener(OFFLINE_EVENT, build);
    return () => window.removeEventListener(OFFLINE_EVENT, build);
  }, []);

  return items;
}

export default function Topbar({ onMenu, onAccount }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const notifications = useNotifications();

  const [q, setQ] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const notifRef = useRef(null);
  const inputRef = useRef(null);

  /* keep the field in sync with ?q= on the search page */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (location.pathname === '/search' || location.pathname === '/songs') {
      setQ(params.get('q') || '');
    }
  }, [location]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (!notifOpen) return undefined;
    const onDoc = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [notifOpen]);

  /* "/" focuses search, Spotify-style */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
  };

  const onSearchChange = (value) => {
    setQ(value);
    // live search while already on the results page
    if (location.pathname === '/search') {
      navigate(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : '/search', { replace: true });
    }
  };

  const handleInstall = async () => {
    const result = await promptInstall();
    if (result === 'accepted') toast('Installing Pulse…');
    else if (result === 'dismissed') toast('Install cancelled', 'info');
    else toast(installed ? 'Pulse is already installed' : 'Use your browser menu → “Install app”', 'info');
  };

  const isDark = theme === 'dark';

  return (
    <header className="topbar">
      <div className="topbar-nav">
        <button className="round-btn menu-btn" onClick={onMenu} aria-label="Open menu">
          <Icon name="menu" size={19} />
        </button>
        <button className="round-btn" onClick={() => navigate(-1)} aria-label="Go back">
          <Icon name="chevronLeft" size={18} />
        </button>
        <button className="round-btn" onClick={() => navigate(1)} aria-label="Go forward">
          <Icon name="chevronRight" size={18} />
        </button>
      </div>

      <form className="search-pill" onSubmit={submit} role="search">
        <Icon name="search" size={17} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="What do you want to play?"
          aria-label="Search music"
        />
        {q && (
          <button
            type="button"
            className="search-pill-clear"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
          >
            <Icon name="close" size={15} />
          </button>
        )}
      </form>

      <div className="topbar-right">
        {!online && (
          <span className="offline-pill" title="No network — your downloads still play">
            <Icon name="download" size={12} /> Offline
          </span>
        )}

        <button
          className="premium-btn"
          onClick={() => navigate('/settings#premium')}
          title="Explore Pulse Premium"
        >
          <Icon name="crown" size={14} />
          <span>Explore Premium</span>
        </button>

        {!installed && (
          <button className="install-btn" onClick={handleInstall} title="Install Pulse as an app">
            <Icon name="downloadCircle" size={16} />
            <span>Install</span>
          </button>
        )}

        <button
          className="icon-round"
          onClick={toggleTheme}
          title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          <Icon name={isDark ? 'sun' : 'moon'} size={17} />
        </button>

        <div className="topbar-pop-wrap" ref={notifRef}>
          <button
            className={`icon-round ${notifOpen ? 'active' : ''}`}
            onClick={() => { setNotifOpen((o) => !o); setSeen(true); }}
            aria-label="Notifications"
            aria-expanded={notifOpen}
          >
            <Icon name="bell" size={17} />
            {!seen && notifications.length > 0 && notifications[0].id !== 'empty' && <span className="notif-dot" />}
          </button>

          {notifOpen && (
            <div className="notif-pop" role="menu">
              <div className="notif-pop-head">
                <h4>Activity</h4>
                <button className="link-btn" onClick={() => setNotifOpen(false)}>Close</button>
              </div>
              {notifications.map((n) => (
                <button
                  key={n.id}
                  className="notif-item"
                  onClick={() => { setNotifOpen(false); navigate(n.to); }}
                >
                  <span className={`notif-item-icon ${n.green ? 'green' : ''}`}>
                    <Icon name={n.icon} size={16} />
                  </span>
                  <span className="notif-item-body">
                    <strong>{n.title}</strong>
                    <small>{n.sub}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="avatar-btn" onClick={onAccount} aria-label="Open account menu">
          {initials(user?.name)}
        </button>
      </div>
    </header>
  );
}
