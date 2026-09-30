import { useCallback, useEffect, useState } from 'react';

/**
 * Real PWA install support.
 *
 * Chrome/Edge fire `beforeinstallprompt` when the app is installable; we stash
 * the event so a button can call `.prompt()` later (the spec requires the call
 * to happen inside a user gesture, which is exactly what our onClick gives us).
 *
 * Browsers that never fire the event (Safari, Firefox, or an already-installed
 * app) get `canInstall: false` — callers then show install instructions instead
 * of silently doing nothing.
 */

let deferredPrompt = null;
const listeners = new Set();

function broadcast() {
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    broadcast();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    broadcast();
  });
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function useInstallPrompt() {
  const [ready, setReady] = useState(() => !!deferredPrompt);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const update = () => {
      setReady(!!deferredPrompt);
      setInstalled(isStandalone());
    };
    listeners.add(update);
    update();
    return () => { listeners.delete(update); };
  }, []);

  /** Returns 'accepted' | 'dismissed' | 'unavailable'. */
  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return 'unavailable';
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      broadcast();
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      return 'unavailable';
    }
  }, []);

  return { canInstall: ready && !installed, installed, promptInstall };
}
