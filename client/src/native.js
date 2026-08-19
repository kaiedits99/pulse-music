// Cross-platform helpers that work both in the normal web app and inside the
// Capacitor Android wrapper.

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
