// Cross-platform helpers that work both in the normal web app and inside the
// Capacitor Android wrapper.

/**
 * True when the Android app is showing the bundled copy of the interface (the WebView's own
 * https://localhost), rather than the live website. In the bundled copy the backend address has to
 * be entered by hand; when the app loads the site, its own origin *is* the server.
 */
export function isBundledShell() {
  try {
    return isNative() && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  } catch {
    return false;
  }
}

export function isNative() {
  try {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

// Open a URL in the system browser (needed for downloads inside the Android app,
// where window.open doesn't behave like a desktop browser).
export async function openExternal(url) {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    // fallback for the plain web app
    window.open(url, '_blank', 'noopener');
  }
}
