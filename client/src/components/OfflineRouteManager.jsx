import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const OFFLINE_RETURN_KEY = 'pulse_offline_return_path_v1';
const OFFLINE_ROUTE = '/offline-player';

function saveReturnPath(path) {
  try {
    if (!sessionStorage.getItem(OFFLINE_RETURN_KEY)) sessionStorage.setItem(OFFLINE_RETURN_KEY, path);
  } catch { /* route return is a convenience, not required for playback */ }
}

function takeReturnPath() {
  try {
    const path = sessionStorage.getItem(OFFLINE_RETURN_KEY) || '';
    sessionStorage.removeItem(OFFLINE_RETURN_KEY);
    return path;
  } catch {
    return '';
  }
}

export default function OfflineRouteManager() {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  const hasEnteredOfflineMode = useRef(false);

  useEffect(() => {
    locationRef.current = location;
    if (location.pathname === OFFLINE_ROUTE) hasEnteredOfflineMode.current = true;

    const canManageDownloads = hasEnteredOfflineMode.current && location.pathname === '/downloads';
    if (navigator.onLine === false && location.pathname !== OFFLINE_ROUTE && !canManageDownloads) {
      saveReturnPath(`${location.pathname}${location.search}${location.hash}`);
      hasEnteredOfflineMode.current = true;
      navigate(OFFLINE_ROUTE, { replace: true });
    }
  }, [location, navigate]);

  useEffect(() => {
    const goToOfflinePlayer = () => {
      const current = locationRef.current;
      if (current.pathname === OFFLINE_ROUTE) return;
      saveReturnPath(`${current.pathname}${current.search}${current.hash}`);
      hasEnteredOfflineMode.current = true;
      navigate(OFFLINE_ROUTE, { replace: true });
    };

    const returnOnline = () => {
      const current = locationRef.current;
      if (current.pathname !== OFFLINE_ROUTE && current.pathname !== '/downloads') return;
      const returnPath = takeReturnPath();
      hasEnteredOfflineMode.current = false;
      if (returnPath && !returnPath.startsWith(OFFLINE_ROUTE)) navigate(returnPath, { replace: true });
    };

    window.addEventListener('offline', goToOfflinePlayer);
    window.addEventListener('online', returnOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) goToOfflinePlayer();

    return () => {
      window.removeEventListener('offline', goToOfflinePlayer);
      window.removeEventListener('online', returnOnline);
    };
  }, [navigate]);

  return null;
}
