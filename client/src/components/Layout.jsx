import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import PlayerBar from './PlayerBar.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import AccountDrawer from './AccountDrawer.jsx';

const MOBILE_NAV = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/library', icon: 'library', label: 'Library' },
  { to: '/podcasts', icon: 'podcast', label: 'Podcasts' },
  { to: '/upload', icon: 'upload', label: 'Upload' },
  { to: '/offline-player', icon: 'headphones', label: 'Offline' }
];

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const location = useLocation();

  /* Close the mobile drawer on navigation and scroll content back to the top. */
  useEffect(() => {
    setMenuOpen(false);
    document.querySelector('.content')?.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="app-main">
        <Topbar onMenu={() => setMenuOpen(true)} onAccount={() => setAccountOpen(true)} />
        <main className="content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <ErrorBoundary minimal>
        <PlayerBar />
      </ErrorBoundary>

      <nav className="mobile-nav" aria-label="Primary">
        {MOBILE_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <AccountDrawer open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
