import { useCallback, useEffect, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../api.js';
import { PlaylistFormModal } from './Forms.jsx';
import { isPlaylistDownloaded, OFFLINE_EVENT } from '../offline.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

const PRIMARY_NAV = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/library', icon: 'library', label: 'Your Library' },
  { to: '/library?filter=uploads', icon: 'upload', label: 'Your Uploads', isUploads: true },
  { to: '/podcasts', icon: 'podcast', label: 'Podcasts' }
];

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const { canInstall, installed, promptInstall } = useInstallPrompt();

  const [playlists, setPlaylists] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [, setOfflineTick] = useState(0);

  const loadPlaylists = useCallback(() => {
    if (!user) return;
    api.get('/api/playlists').then((d) => setPlaylists(d || [])).catch(() => {});
  }, [user]);

  useEffect(() => { loadPlaylists(); }, [loadPlaylists]);

  // Keep the sidebar in sync when a playlist is created/deleted elsewhere.
  useEffect(() => {
    const refresh = () => loadPlaylists();
    window.addEventListener('pulse-playlists-changed', refresh);
    return () => window.removeEventListener('pulse-playlists-changed', refresh);
  }, [loadPlaylists]);

  // Re-render the green "downloaded" badges when the offline store changes.
  useEffect(() => {
    const cb = () => setOfflineTick((t) => t + 1);
    window.addEventListener(OFFLINE_EVENT, cb);
    return () => window.removeEventListener(OFFLINE_EVENT, cb);
  }, []);

  const handleInstall = async () => {
    const result = await promptInstall();
    if (result === 'accepted') toast('Installing Pulse…');
    else if (result === 'dismissed') toast('Install cancelled', 'info');
    else {
      toast(
        installed
          ? 'Pulse is already installed on this device'
          : 'Use your browser menu → “Install app” / “Add to Home Screen”',
        'info'
      );
    }
  };

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        {/* ---------- Primary navigation panel ---------- */}
        <div className="side-panel side-panel--nav">
          <Link to="/" className="brand" onClick={onClose}>
            <span className="brand-logo"><Icon name="wave" size={19} /></span>
            <span className="brand-name">Pulse</span>
          </Link>

          <nav className="side-nav" aria-label="Primary">
            {PRIMARY_NAV.map((item) => {
              const isUploadsLink = item.isUploads;
              const isCurrentUploads = location.pathname === '/library' && location.search.includes('filter=uploads');
              const isPlainLibrary = location.pathname === '/library' && !location.search.includes('filter=uploads');

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  className={({ isActive }) => {
                    let active = isActive;
                    if (isUploadsLink) active = isCurrentUploads;
                    else if (item.to === '/library') active = isPlainLibrary;
                    return `side-nav-item ${active ? 'active' : ''}`;
                  }}
                >
                  <Icon name={item.icon} size={20} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* ---------- Playlists panel ---------- */}
        <div className="side-panel side-panel--library">
          <div className="lib-head">
            <span className="lib-head-title">Playlists</span>
            <button
              className="lib-add-btn"
              onClick={() => setNewOpen(true)}
              title="Create playlist"
              aria-label="Create playlist"
            >
              <Icon name="plus" size={16} />
            </button>
          </div>

          <div className="lib-list scroll-thin">
            <NavLink
              to="/favorites"
              onClick={onClose}
              className={({ isActive }) => `lib-item ${isActive ? 'active' : ''}`}
            >
              <span className="lib-item-name">Liked Songs</span>
            </NavLink>

            {playlists.map((p) => (
              <Link
                key={p.id}
                to={`/playlists/${p.id}`}
                onClick={onClose}
                className={`lib-item ${location.pathname === `/playlists/${p.id}` ? 'active' : ''}`}
              >
                <span className="lib-item-name">{p.name}</span>
                {isPlaylistDownloaded(p.id) && (
                  <Icon name="download" size={13} className="lib-item-badge" title="Downloaded" />
                )}
              </Link>
            ))}

            {playlists.length === 0 && (
              <p className="lib-empty">
                No playlists yet — hit <strong>+</strong> to make your first one.
              </p>
            )}
          </div>

          <button className="install-app-btn" onClick={handleInstall}>
            <Icon name="downloadCircle" size={18} />
            <span>{installed ? 'App installed' : 'Install App'}</span>
          </button>
        </div>

        <PlaylistFormModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          onSaved={() => { loadPlaylists(); window.dispatchEvent(new CustomEvent('pulse-playlists-changed')); }}
          playlist={null}
        />
      </aside>
    </>
  );
}
