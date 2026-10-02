// Free web hosts (Render's free plan, for one) put an app to sleep after about 15 minutes without inbound
// traffic, and a sleeping app loses its temporary disk. This sends the app's own public address a tiny
// request every few minutes so it never looks idle.
//
// It is switched on with KEEP_AWAKE=true and does nothing unless the public address is known (Render
// provides it as RENDER_EXTERNAL_URL). An external uptime monitor pointed at /api/health does the same job
// and can wake the app after a restart, so using both is fine.
//
// The catch with staying awake: Render's free plan gives a workspace 750 instance hours a month, and a
// 31-day month has 744 of them. An app kept awake around the clock therefore uses the whole allowance on
// its own, and Render suspends every free service in the workspace as soon as it runs out — the site is
// simply gone until the 1st of the next month. KEEP_AWAKE_HOURS narrows the pinging to the hours people
// actually use the app ("6-24" keeps it up from 6am to midnight and lets it sleep from midnight to 6am),
// which makes running out impossible and costs nothing but a cold start on the first visit of the day.
// Render spins the app up again on its own the moment anyone visits.
//
// The hours are read in PULSE_TIMEZONE (an IANA name such as Africa/Lagos) so they mean local time no
// matter what clock the server keeps.

/** The value that keeps the app awake around the clock: no restriction at all. */
export const DEFAULT_WAKE_HOURS = '0-24';

export function keepAwakeTarget(env = process.env) {
  if (String(env.KEEP_AWAKE || '').trim().toLowerCase() !== 'true') return null;
  const base = String(env.KEEP_AWAKE_URL || env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/]+/i.test(base) ? `${base}/api/health` : null;
}

/**
 * Reads KEEP_AWAKE_HOURS ("<start>-<end>", 24-hour clock, start inclusive, end exclusive).
 * Returns null when there is no restriction — the default, anything unparseable, and "0-24" all mean
 * "around the clock", because a typo should never leave the app unexpectedly asleep.
 */
export function parseWakeHours(value) {
  const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || start > 24 || end < 0 || end > 24) return null;
  if (start === end) return null;
  if (start === 0 && end === 24) return null; // the whole day, i.e. the default
  return { start, end };
}

/** True when `hour` (0–23) is inside the window. Windows may wrap past midnight ("22-6"). */
export function inWakeHours(hour, window) {
  if (!window) return true;
  return window.start < window.end
    ? hour >= window.start && hour < window.end
    : hour >= window.start || hour < window.end;
}

/** The current hour in PULSE_TIMEZONE (IANA name), or on the host's own clock when it isn't set. */
export function hourInZone(now, timeZone) {
  if (!timeZone) return now.getHours();
  try {
    // en-GB gives a 24-hour clock; % 24 turns the "24" some builds return at midnight into 0.
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hour12: false }).format(now);
    return Number(hour) % 24;
  } catch {
    return now.getHours(); // a typo'd timezone must not stop the app from waking up
  }
}

/** "06:00–24:00", for the log line and the docs. */
export function formatWakeHours(window) {
  const two = (n) => String(n).padStart(2, '0');
  return window ? `${two(window.start)}:00–${two(window.end)}:00` : 'around the clock';
}

/** Everything the keep-awake loop needs, or null when it is switched off (or has nowhere to ping). */
export function keepAwakeConfig(env = process.env) {
  const url = keepAwakeTarget(env);
  if (!url) return null;
  return {
    url,
    hours: parseWakeHours(env.KEEP_AWAKE_HOURS),
    timeZone: String(env.PULSE_TIMEZONE || '').trim() || null
  };
}

export function startKeepAwake({
  url,
  hours = null, // null = ping around the clock, which is what KEEP_AWAKE_HOURS defaults to
  timeZone = null,
  now = () => new Date(),
  intervalMs = 5 * 60 * 1000, // well inside the 15-minute idle limit, so one missed ping is harmless
  firstDelayMs = 60 * 1000,
  timeoutMs = 15 * 1000,
  fetchImpl = fetch,
  log = console
} = {}) {
  let failures = 0;
  let timer = null;
  let stopped = false;
  let saidAsleep = false;

  const schedule = (delay) => {
    if (stopped) return;
    timer = setTimeout(ping, delay);
    timer.unref?.(); // never keeps the process alive on its own
  };

  async function ping() {
    if (!inWakeHours(hourInZone(now(), timeZone), hours)) {
      // Outside the awake hours on purpose: let the host put the app to sleep, so the free instance
      // hours are spent on the hours that matter. The next visitor wakes it again.
      if (!saidAsleep) {
        log.log(`[pulse] Keep-awake pause: outside ${formatWakeHours(hours)}${timeZone ? ` ${timeZone}` : ''}; the app may sleep until morning.`);
        saidAsleep = true;
      }
      schedule(intervalMs);
      return;
    }
    saidAsleep = false;
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
