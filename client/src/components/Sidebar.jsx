import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { initials } from '../format.js';

const NAV = [
  { to: '/', icon: 'home', label: 'Overview', end: true },
  { to: '/songs', icon: 'music', label: 'Songs' },
  { to: '/albums', icon: 'album', label: 'Albums' },
  { to: '/artists', icon: 'artist', label: 'Artists' },
  { to: '/playlists', icon: 'playlist', label: 'Playlists' },
  { to: '/favorites', icon: 'heart', label: 'Favorites' },
  { to: '/upload', icon: 'upload', label: 'Upload Music' }
];

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-logo"><Icon name="wave" size={22} /></div>
          <span className="brand-name">Pulse</span>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <NavLink to="/settings" onClick={onClose} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Icon name="settings" size={19} />
            <span>Settings</span>
          </NavLink>
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
