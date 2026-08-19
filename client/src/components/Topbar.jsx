import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';

const TITLES = {
  '/': 'Overview',
  '/songs': 'Songs',
  '/albums': 'Albums',
  '/artists': 'Artists',
  '/playlists': 'Playlists',
  '/favorites': 'Favorites',
  '/upload': 'Upload Music',
  '/settings': 'Settings'
};

export default function Topbar({ onMenu }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');

  const baseTitle = TITLES[location.pathname] || '';

  useEffect(() => {
    // sync search box with ?q param when on songs page
    const params = new URLSearchParams(location.search);
    if (location.pathname === '/songs') setQ(params.get('q') || '');
  }, [location]);

  const submit = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/songs?q=${encodeURIComponent(q.trim())}` : '/songs');
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Menu"><Icon name="menu" size={20} /></button>
        <h2 className="topbar-title">{baseTitle}</h2>
      </div>
      <form className="search-box" onSubmit={submit}>
        <Icon name="search" size={17} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search songs, artists…"
          aria-label="Search"
        />
      </form>
    </header>
  );
}
