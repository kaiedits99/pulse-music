// Recovery page logic for /offline.html.
//
// This lives in a file rather than inline in the HTML because the Pulse server sends a
// Content-Security-Policy of `script-src 'self'` with no 'unsafe-inline'. An inline <script> is
// therefore refused by the browser and by the Android WebView: the page painted, and every button
// on it was dead. A separate same-origin file is allowed by that policy and by the local server
// Capacitor uses for the bundled copy, so the retry works in both places.
(() => {
  const runtime = window.PULSE_CAPACITOR_RUNTIME || {};
  const target = String(runtime.remoteUrl || '').trim();
  const retry = document.getElementById('retry');
  const status = document.getElementById('retry-status');
  const info = document.getElementById('server-info');
  const settings = document.getElementById('change-server');
  const localShell = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  function healthUrl(site) {
    const base = new URL(site);
    const path = base.pathname.replace(/\/+$/, '');
    base.pathname = `${path}/api/health`;
    base.search = '';
    base.hash = '';
    return base;
  }

  async function wakeSite() {
    if (!target) { window.location.reload(); return; }
    let health;
    try { health = healthUrl(target); }
    catch { status.textContent = 'The saved website address is invalid. Open app settings to change it.'; return; }

    retry.disabled = true;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      retry.textContent = 'Waking Pulse…';
      status.textContent = `Checking the website (${attempt} of 8). A sleeping host may take a minute to wake.`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(health, { method: 'GET', cache: 'no-store', credentials: 'omit', signal: controller.signal });
        const data = await response.json().catch(() => null);
        if (response.ok && data?.status === 'ok') {
          status.textContent = 'Pulse is awake. Reconnecting…';
          window.location.replace(target);
          return;
        }
      } catch { /* offline, waking, or temporarily unreachable — retry below */ }
      finally { clearTimeout(timeout); }
      if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    retry.disabled = false;
    retry.textContent = 'Try again';
    status.textContent = 'Pulse still isn’t responding. Check your connection and try again in a moment.';
  }

  retry.addEventListener('click', wakeSite);
  try {
    const stored = localStorage.getItem('pulse_api_url') || '';
    const showing = target || stored;
    if (showing) {
      info.style.display = 'block';
      info.textContent = 'Website: ' + showing;
    }
    if (localShell) {
      settings.style.display = 'inline-block';
      settings.addEventListener('click', () => {
        window.location.href = '/login?settings=server';
      });
      if (!target && !stored) {
        document.getElementById('hint').textContent = 'This app needs the address of your Pulse website. Open app settings to enter it.';
      }
    }
  } catch { /* storage disabled — the retry button still works */ }
})();
