import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import PlayerBar from './PlayerBar.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import AccountDrawer from './AccountDrawer.jsx';

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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
      <nav className="mobile-nav" aria-label="Primary navigation">{[['/','music','Music'],['/songs','search','Search'],['/artists','artist','Artists'],['/favorites','heart','Favorites'],['/upload','upload','Upload']].map(([to, icon, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''}><Icon name={icon} size={22}/><span>{label}</span></NavLink>)}</nav>
      <AccountDrawer open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
