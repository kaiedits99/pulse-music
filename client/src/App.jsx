import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { PlayerProvider } from './context/PlayerContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import Icon from './components/Icon.jsx';
import { Spinner } from './components/ui.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Overview from './pages/Overview.jsx';
import Songs from './pages/Songs.jsx';
import Albums from './pages/Albums.jsx';
import AlbumDetail from './pages/AlbumDetail.jsx';
import Artists from './pages/Artists.jsx';
import ArtistDetail from './pages/ArtistDetail.jsx';
import Playlists from './pages/Playlists.jsx';
import PlaylistDetail from './pages/PlaylistDetail.jsx';
import Favorites from './pages/Favorites.jsx';
import Upload from './pages/Upload.jsx';
import Settings from './pages/Settings.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="boot-screen">
        <div className="brand-logo big"><Icon name="wave" size={26} /></div>
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <PlayerProvider>
            <Routes>
              <Route path="/login" element={<AuthPage />} />
              <Route element={<RequireAuth><Layout /></RequireAuth>}>
                <Route path="/" element={<Overview />} />
                <Route path="/songs" element={<Songs />} />
                <Route path="/albums" element={<Albums />} />
                <Route path="/albums/:id" element={<AlbumDetail />} />
                <Route path="/artists" element={<Artists />} />
                <Route path="/artists/:id" element={<ArtistDetail />} />
                <Route path="/playlists" element={<Playlists />} />
                <Route path="/playlists/:id" element={<PlaylistDetail />} />
                <Route path="/favorites" element={<Favorites />} />
                <Route path="/upload" element={<Upload />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PlayerProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
