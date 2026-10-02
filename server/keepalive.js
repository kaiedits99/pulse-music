// Free web hosts (Render's free plan, for one) put an app to sleep after about 15 minutes without inbound
// traffic, and a sleeping app loses its temporary disk. This sends the app's own public address a tiny
// request every few minutes so it never looks idle.
//
// It is switched on with KEEP_AWAKE=true and does nothing unless the public address is known (Render
// provides it as RENDER_EXTERNAL_URL). An external uptime monitor pointed at /api/health does the same job
// and can wake the app after a restart, so using both is fine.

export function keepAwakeTarget(env = process.env) {
  if (String(env.KEEP_AWAKE || '').trim().toLowerCase() !== 'true') return null;
  const base = String(env.KEEP_AWAKE_URL || env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/]+/i.test(base) ? `${base}/api/health` : null;
}

export function startKeepAwake({
  url,
  intervalMs = 5 * 60 * 1000, // well inside the 15-minute idle limit, so one missed ping is harmless
  firstDelayMs = 60 * 1000,
  timeoutMs = 15 * 1000,
  fetchImpl = fetch,
  log = console
} = {}) {
  let failures = 0;
  let timer = null;
  let stopped = false;

  const schedule = (delay) => {
    if (stopped) return;
    timer = setTimeout(ping, delay);
    timer.unref?.(); // never keeps the process alive on its own
  };

  async function ping() {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'pulse-keep-awake' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      await res.text(); // read the tiny body so the connection is released
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (failures > 0) log.log('[pulse] Keep-awake ping is working again.');
      failures = 0;
    } catch (err) {
      failures += 1;
      // Say so on the first failure and then now and then, without flooding the log.
      if (failures === 1 || failures % 12 === 0) {
        log.warn(`[pulse] Keep-awake ping to ${url} failed (${err.message}); the app may fall asleep when idle.`);
      }
    }
    schedule(intervalMs);
  }

  schedule(firstDelayMs);
  return () => { stopped = true; clearTimeout(timer); };
}
