import { useEffect, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api.js';
import { initials } from '../format.js';

/* Spotify-style primary navigation */
const PRIMARY_NAV = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/songs', icon: 'search', label: 'Search' }
];

const LIBRARY_NAV = [
  { to: '/albums', icon: 'album', label: 'Albums' },
  { to: '/artists', icon: 'artist', label: 'Artists' },
  { to: '/playlists', icon: 'playlist', label: 'Playlists' },
  { to: '/favorites', icon: 'heart', label: 'Favorites' }
];

const GENRE_COLORS = [
  'linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)',
  'linear-gradient(135deg, #0ea5e9 0%, #22d3ee 100%)',
  'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
  'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #fb7185 100%)'
];

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const [playlists, setPlaylists] = useState([]);

  useEffect(() => {
    let alive = true;
    if (!user) return;
    api.get('/api/playlists').then((d) => { if (alive) setPlaylists(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, [user]);

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        {/* Brand / logo */}
        <div className="sidebar-brand">
          <div className="brand-logo"><Icon name="wave" size={22} /></div>
          <span className="brand-name">Pulse</span>
        </div>

        {/* Primary nav (Home, Search) */}
        <nav className="sidebar-nav sidebar-nav-primary" aria-label="Primary">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Suno-inspired "Create / Upload" action */}
        <Link to="/upload" onClick={onClose} className="sidebar-create-btn">
          <span className="scb-icon"><Icon name="plus" size={18} /></span>
          <span className="scb-text">
            <strong>Upload music</strong>
            <small>Add your latest track</small>
          </span>
        </Link>

        {/* Your Library */}
        <div className="sidebar-library-head">
          <Icon name="playlist" size={16} />
          <span>Your Library</span>
        </div>
        <nav className="sidebar-nav" aria-label="Library">
          {LIBRARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <NavLink
            to="/settings"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon name="settings" size={19} />
            <span>Settings</span>
          </NavLink>
        </nav>

        {/* Playlist list (Spotify "Your Playlists") */}
        {playlists.length > 0 && (
          <div className="sidebar-playlists">
            <div className="sidebar-library-head">
              <Icon name="heart" size={15} />
              <span>Playlists</span>
            </div>
            <div className="playlist-chips">
              {playlists.slice(0, 12).map((p, i) => (
                <Link
                  key={p.id}
                  to={`/playlists/${p.id}`}
                  onClick={onClose}
                  className="playlist-chip"
                  style={{ '--pc': GENRE_COLORS[i % GENRE_COLORS.length] }}
                >
                  <span className="pc-dot" />
                  {p.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* User footer */}
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <div className="avatar">{user ? initials(user.name) : '?'}</div>
            <div className="sidebar-user-info">
              <span className="su-name">{user?.name || 'Guest'}</span>
              <span className="su-role">{user?.role === 'admin' ? 'Admin' : 'Artist'}</span>
            </div>
            <button className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out"><Icon name="logout" size={18} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
