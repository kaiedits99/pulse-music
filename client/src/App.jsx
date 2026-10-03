import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { PlayerProvider } from './context/PlayerContext.jsx';
import { FavoritesProvider } from './context/FavoritesContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ChatUnreadProvider } from './chat.jsx';
import Layout from './components/Layout.jsx';
import OfflineRouteManager from './components/OfflineRouteManager.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Icon from './components/Icon.jsx';
import { Spinner } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Overview from './pages/Overview.jsx';
import Search from './pages/Search.jsx';
import Library from './pages/Library.jsx';
import Albums from './pages/Albums.jsx';
import AlbumDetail from './pages/AlbumDetail.jsx';
import Artists from './pages/Artists.jsx';
import ArtistDetail from './pages/ArtistDetail.jsx';
import Playlists from './pages/Playlists.jsx';
import Podcasts from './pages/Podcasts.jsx';
import PodcastDetail from './pages/PodcastDetail.jsx';
import PlaylistDetail from './pages/PlaylistDetail.jsx';
import Favorites from './pages/Favorites.jsx';
import Downloads from './pages/Downloads.jsx';
import Upload from './pages/Upload.jsx';
import Settings from './pages/Settings.jsx';
import OfflinePlayer from './pages/OfflinePlayer.jsx';
import Messages from './pages/Messages.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="boot-screen">
        <div className="brand-logo big"><Icon name="wave" size={28} /></div>
        <Spinner size={24} />
      </div>
    );
  }
  const offlineRoute = location.pathname === '/offline-player' || (typeof navigator !== 'undefined' && navigator.onLine === false);
  if (!user && !offlineRoute) {
    // The front door: a signed-out visitor sees the landing page at "/", and is sent to sign in anywhere
    // else (remembering where they were headed, so a shared link still works once they are in).
    if (location.pathname === '/') return <Landing />;
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <ChatUnreadProvider>
              <FavoritesProvider>
                <PlayerProvider>
                  <OfflineRouteManager />
                  <Routes>
                    {/* the keys make /login and /signup remount, so each opens on its own tab */}
                    <Route path="/login" element={<AuthPage key="login" initialMode="login" />} />
                    <Route path="/signup" element={<AuthPage key="signup" initialMode="register" />} />
                    <Route element={<RequireAuth><Layout /></RequireAuth>}>
                      <Route path="/" element={<Overview />} />
                      <Route path="/search" element={<Search />} />
                      {/* legacy path kept so old links and bookmarks keep working */}
                      <Route path="/songs" element={<Search />} />
                      <Route path="/library" element={<Library />} />
                      <Route path="/albums" element={<Albums />} />
                      <Route path="/albums/:id" element={<AlbumDetail />} />
                      <Route path="/artists" element={<Artists />} />
                      <Route path="/artists/:id" element={<ArtistDetail />} />
                      <Route path="/playlists" element={<Playlists />} />
                      <Route path="/playlists/:id" element={<PlaylistDetail />} />
                      <Route path="/podcasts" element={<Podcasts />} />
                      <Route path="/podcasts/:id" element={<PodcastDetail />} />
                      <Route path="/favorites" element={<Favorites />} />
                      <Route path="/downloads" element={<Downloads />} />
                      <Route path="/offline-player" element={<OfflinePlayer />} />
                      <Route path="/upload" element={<Upload />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/messages" element={<Messages />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </PlayerProvider>
              </FavoritesProvider>
              </ChatUnreadProvider>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
