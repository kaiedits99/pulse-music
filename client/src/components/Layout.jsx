import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import PlayerBar from './PlayerBar.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import AccountDrawer from './AccountDrawer.jsx';
import SharePrompt from './SharePrompt.jsx';

const MOBILE_NAV = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/library', icon: 'library', label: 'Library' },
  { to: '/podcasts', icon: 'podcast', label: 'Podcasts' },
  { to: '/messages', icon: 'mail', label: 'Messages' },
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
    const content = document.querySelector('.content');
    if (!content) return;
    // Element.scrollTo is missing on older browsers/webviews. Falling back to scrollTop keeps
    // that from throwing inside an effect — an exception here would unmount the whole signed-in
    // app and show nothing but the error boundary.
    if (typeof content.scrollTo === 'function') content.scrollTo({ top: 0, behavior: 'auto' });
    else content.scrollTop = 0;
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
      <SharePrompt />
    </div>
  );
}
