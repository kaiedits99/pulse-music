import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import PlayerBar from './PlayerBar.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import AccountDrawer from './AccountDrawer.jsx';
import SharePrompt from './SharePrompt.jsx';
import UpdateNotice from './UpdateNotice.jsx';
import DataSafetyBanner from './DataSafetyBanner.jsx';

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
    // Element.scrollTo is missing on some older webviews, and an exception thrown inside an
    // effect would unmount the whole signed-in app. Feature-detect, then fall back.
    const content = document.querySelector('.content');
    if (!content) return;
    if (typeof content.scrollTo === 'function') content.scrollTo({ top: 0, behavior: 'auto' });
    else content.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="app-main">
        <Topbar onMenu={() => setMenuOpen(true)} onAccount={() => setAccountOpen(true)} />
        <main className="content" id="main-content" tabIndex={-1}>
          <ErrorBoundary>
            <DataSafetyBanner />
            <UpdateNotice />
            <Outlet />
            <footer className="legal-footer-min" style={{ marginTop: 28, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-faint)' }}>
              <span>© {new Date().getFullYear()} Pulse Music</span>
              <a href="/privacy" style={{ color: 'var(--text-faint)', textDecoration: 'underline' }}>Privacy</a>
              <a href="/terms" style={{ color: 'var(--text-faint)', textDecoration: 'underline' }}>Terms</a>
              <a href="/cookies" style={{ color: 'var(--text-faint)', textDecoration: 'underline' }}>Cookies</a>
              <a href="mailto:inputname9@aol.com" style={{ color: 'var(--text-faint)', textDecoration: 'underline' }}>Contact</a>
            </footer>
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
