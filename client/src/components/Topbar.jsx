import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { initials } from '../format.js';
import { downloadedPlaylists, downloadedSongs, OFFLINE_EVENT } from '../offline.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

// Pages that show catalog search results, and how long to wait after the last keystroke
// before the results page is updated.
const SEARCH_PATHS = ['/search', '/songs'];
const SEARCH_DEBOUNCE_MS = 250;

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
  const compact = useMediaQuery('(max-width: 600px)'); // narrow pill: use the short placeholder

  const onSearchPage = SEARCH_PATHS.includes(location.pathname);
  const urlQuery = onSearchPage ? (new URLSearchParams(location.search).get('q') || '') : '';

  const [q, setQ] = useState(urlQuery);
  const [notifOpen, setNotifOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const notifRef = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);       // pending (debounced) search navigation
  const pushedRef = useRef(urlQuery);  // the query this field last wrote to the address bar
  const latestRef = useRef({ onSearchPage, search: location.search });
  useEffect(() => { latestRef.current = { onSearchPage, search: location.search }; });
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  /* The address bar owns ?q= on the search page. A change this field made itself is ignored
     (so a late echo can never overwrite what has been typed since); anything else — back/forward,
     a chip's “×”, a link, leaving the search page — replaces the field's text. This is a layout
     effect so the old text never gets painted for a frame after navigating. */
  useLayoutEffect(() => {
    if (urlQuery === pushedRef.current) return;
    pushedRef.current = urlQuery;
    window.clearTimeout(timerRef.current);
    setQ(urlQuery);
  }, [urlQuery]);

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
      const t = e.target;
      const inField = !!(t && typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"]'));
      if (e.key !== '/' || inField) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* Show results for `value`. From another page this opens the search page; once there, further
     keystrokes replace the history entry (so Back leaves search) and keep the page's other filters. */
  const goSearch = useCallback((value) => {
    const term = value.trim();
    const { onSearchPage: onPage, search } = latestRef.current;
    if (!onPage && !term) return; // nothing to clear
    const current = new URLSearchParams(onPage ? search : '');
    const next = new URLSearchParams(current);
    if (term) next.set('q', term); else next.delete('q');
    if (onPage && (next.get('q') || '') === (current.get('q') || '')) return; // already showing it
    pushedRef.current = term;
    const qs = next.toString();
    navigate({ pathname: '/search', search: qs ? `?${qs}` : '' }, { replace: onPage });
  }, [navigate]);

  const onSearchChange = (value) => {
    setQ(value);
    window.clearTimeout(timerRef.current);
    if (!value.trim()) { goSearch(''); return; } // clearing is instant
    timerRef.current = window.setTimeout(() => goSearch(value), SEARCH_DEBOUNCE_MS);
  };

  const submit = (e) => {
    e.preventDefault();
    window.clearTimeout(timerRef.current);
    if (!q.trim() && !onSearchPage) navigate('/search'); // an empty search opens the page, as before
    else goSearch(q);
  };

  const onSearchKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    if (q) { e.preventDefault(); onSearchChange(''); } else e.currentTarget.blur();
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
          type="search"
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={compact ? 'Artist, track or genre' : 'Search by artist, track or genre'}
          aria-label="Search the catalog by artist, track title or genre"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        {q && (
          <button
            type="button"
            className="search-pill-clear"
            onClick={() => { onSearchChange(''); inputRef.current?.focus(); }}
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
