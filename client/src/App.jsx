import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
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
const Landing = lazy(() => import('./pages/Landing.jsx'));
const AuthPage = lazy(() => import('./pages/AuthPage.jsx'));
const AuthEmailAction = lazy(() => import('./pages/AuthEmailAction.jsx'));
const Privacy = lazy(() => import('./pages/legal/Privacy.jsx'));
const Terms = lazy(() => import('./pages/legal/Terms.jsx'));
const Cookies = lazy(() => import('./pages/legal/Cookies.jsx'));
import CookieConsent from './components/CookieConsent.jsx';
const Overview = lazy(() => import('./pages/Overview.jsx'));
const Search = lazy(() => import('./pages/Search.jsx'));
const Library = lazy(() => import('./pages/Library.jsx'));
const Albums = lazy(() => import('./pages/Albums.jsx'));
const AlbumDetail = lazy(() => import('./pages/AlbumDetail.jsx'));
const Artists = lazy(() => import('./pages/Artists.jsx'));
const ArtistDetail = lazy(() => import('./pages/ArtistDetail.jsx'));
const Playlists = lazy(() => import('./pages/Playlists.jsx'));
const Podcasts = lazy(() => import('./pages/Podcasts.jsx'));
const PodcastDetail = lazy(() => import('./pages/PodcastDetail.jsx'));
const PlaylistDetail = lazy(() => import('./pages/PlaylistDetail.jsx'));
const Favorites = lazy(() => import('./pages/Favorites.jsx'));
const Downloads = lazy(() => import('./pages/Downloads.jsx'));
const Upload = lazy(() => import('./pages/Upload.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const OfflinePlayer = lazy(() => import('./pages/OfflinePlayer.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

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
    if (location.pathname === '/') return <Landing />;
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return children;
}

function RouteMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    const exact = {
      '/': 'Home', '/login': 'Sign in', '/signup': 'Create account', '/search': 'Search',
      '/songs': 'Music', '/library': 'Your library', '/albums': 'Albums', '/artists': 'Artists',
      '/playlists': 'Playlists', '/podcasts': 'Podcasts', '/favorites': 'Favourites',
      '/downloads': 'Downloads', '/offline-player': 'Offline player', '/upload': 'Upload music', '/settings': 'Settings',
      '/messages': 'Messages', '/admin': 'Admin', '/forgot-password': 'Reset password', '/reset-password': 'Choose a new password', '/verify-email': 'Verify email', '/privacy': 'Privacy policy',
      '/terms': 'Terms of service', '/cookies': 'Cookie policy'
    };
    const section = pathname.match(/^\/(albums|artists|playlists|podcasts)\/[^/]+$/)?.[1];
    const title = exact[pathname] || (pathname.startsWith('/messages/') ? 'Messages'
      : section ? section[0].toUpperCase() + section.slice(1, -1) : 'Page not found');
    document.title = `${title} · Pulse`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = `Discover and share music on Pulse. ${title} for independent artists and listeners.`;
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <main className="route-not-found">
      <span className="route-not-found-code">404</span>
      <h1>This page isn’t here</h1>
      <p>The link may be out of date, or the page may have moved.</p>
      <div className="route-not-found-actions">
        <Link className="btn btn-primary" to="/">Go to Pulse</Link>
        <Link className="btn btn-ghost" to="/search">Discover music</Link>
      </div>
    </main>
  );
}

function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="boot-screen">
        <div className="brand-logo big"><Icon name="wave" size={28} /></div>
        <Spinner size={24} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <RouteMetadata />
          <ToastProvider>
            <AuthProvider>
              <ChatUnreadProvider>
              <FavoritesProvider>
                <PlayerProvider>
                  <OfflineRouteManager />
                  <a href="#main-content" className="sr-only" style={{ position: 'absolute', top: -999, left: -999 }}>Skip to main content</a>
                  <CookieConsent />
                  <Suspense fallback={<div className="boot-screen"><Spinner size={24} /></div>}>
                  <Routes>
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/cookies" element={<Cookies />} />
                    <Route path="/login" element={<AuthPage key="login" initialMode="login" />} />
                    <Route path="/signup" element={<AuthPage key="signup" initialMode="register" />} />
                    <Route path="/forgot-password" element={<AuthEmailAction action="request" />} />
                    <Route path="/verify-email" element={<AuthEmailAction action="verify" />} />
                    <Route path="/reset-password" element={<AuthEmailAction action="reset" />} />
                    <Route element={<RequireAuth><Layout /></RequireAuth>}>
                      <Route path="/" element={<Overview />} />
                      <Route path="/search" element={<Search />} />
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
                      <Route path="/messages/:handle" element={<Messages />} />
                      <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
                    </Route>
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                  </Suspense>
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
