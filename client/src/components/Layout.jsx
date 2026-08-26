import { useState } from 'react';
import { Outlet } from 'react-router-dom';
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
      <AccountDrawer open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
