// Asks a running Pulse deployment how it is doing, in plain words:
//
//   npm run health -- https://pulse-music.onrender.com
//
// It reads GET /api/health — the same address Render uses as the service's health check — and
// explains the answer. The interesting field is "storage": "bucket" means uploads live in the bucket
// and survive this machine being wiped (what a host like Render's free plan does on every restart or
// sleep), while "local" means they sit on a disk that may not come back.
//
// A free host puts the app to sleep when nobody visits, so the first request lands on Render's
// "Application loading" page while the instance starts. This waits that out (up to HEALTH_TIMEOUT
// seconds, 120 by default) instead of reporting a false alarm.
//
// Without an argument it uses RENDER_EXTERNAL_URL / KEEP_AWAKE_URL / PULSE_URL when one is set.
import process from 'node:process';

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('\nUsage: npm run health -- <address of your app>\n\nExample: npm run health -- https://pulse-music.onrender.com\n');
  process.exit(0);
}

const rawTarget = (argv.find((arg) => !arg.startsWith('-'))
  || process.env.PULSE_URL
  || process.env.RENDER_EXTERNAL_URL
  || process.env.KEEP_AWAKE_URL
  || '').trim();

if (!rawTarget) {
  console.log('\nWhich Pulse? Give the address of the running app:\n');
  console.log('  npm run health -- https://pulse-music.onrender.com\n');
  process.exit(1);
}

let base;
try {
  base = new URL(rawTarget.includes('://') ? rawTarget : `https://${rawTarget}`);
} catch {
  console.log(`\nThat is not an address I can open: ${rawTarget}\n`);
  process.exit(1);
}
const url = `${base.origin}/api/health`;

const timeoutMs = Math.max(1, Number(process.env.HEALTH_TIMEOUT_SECONDS || 120)) * 1000;
const pollMs = Math.max(50, Number(process.env.HEALTH_POLL_SECONDS || 5) * 1000);
const perRequestMs = Math.min(30_000, timeoutMs);

const good = (message) => console.log(`  ✔ ${message}`);
const bad = (message) => console.log(`  ✖ ${message}`);
const note = (message) => console.log(`  ! ${message}`);

/** One request. Returns {kind:'json'|'starting'|'http'|'error', ...}. Never throws. */
async function ask() {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'pulse-health-check' }, signal: AbortSignal.timeout(perRequestMs) });
  } catch (err) {
    const code = err.cause?.code || err.name;
    return { kind: 'error', code, message: err.message };
  }
  const body = await res.text().catch(() => '');
  if (res.ok) {
    try {
      return { kind: 'json', body: JSON.parse(body), status: res.status };
    } catch {
      // Render serves its own "Application loading" page while a spun-down instance starts.
    }
  }
  if (/application loading|spinning up/i.test(body) || (res.headers.get('content-type') || '').includes('text/html')) {
    return { kind: 'starting', status: res.status };
  }
  return { kind: 'http', status: res.status, body: body.slice(0, 200) };
}

console.log(`\nAsking ${url}\n`);

const deadline = Date.now() + timeoutMs;
let answer = await ask();
let waited = false;
while (answer.kind === 'starting' && Date.now() < deadline) {
  if (!waited) {
    note('The app is asleep and starting up (Render shows its loading page while a free instance wakes).');
    note(`Waiting up to ${Math.round(timeoutMs / 1000)}s for it…`);
    waited = true;
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
  answer = await ask();
}

if (answer.kind === 'starting') {
  bad('It is still starting after the time allowed. A free instance can take a minute; try again in a moment.');
  note('If it never finishes, open the service\'s Logs on Render — a crash on boot shows up there.');
  process.exit(1);
}

if (answer.kind === 'error') {
  bad(`Could not reach ${url} (${answer.code}).`);
  if (answer.code === 'ENOTFOUND' || answer.code === 'EAI_AGAIN') {
    note('The address does not exist. Check the spelling against the one Render shows for the service.');
  } else if (answer.code === 'TimeoutError' || answer.code === 'UND_ERR_CONNECT_TIMEOUT') {
    note('The request timed out. A sleeping free instance can take about a minute; try again.');
  } else {
    note('Check that the service is running on Render and that the address is right.');
  }
  process.exit(1);
}

if (answer.kind === 'http') {
  bad(`The app answered HTTP ${answer.status}.`);
  if (answer.status === 404) note('Nothing is served at /api/health, so this may not be a Pulse app (or an older version).');
  else note('Open the service\'s Logs on Render to see why the server is unhappy.');
  process.exit(1);
}

const health = answer.body || {};
if (health.status && health.status !== 'ok') bad(`The app reports its status as "${health.status}".`);

if (health.storage === 'bucket') {
  good('The app is running.');
  good('Uploads are kept in the bucket, so a restart, redeploy or sleep does not lose them.');
  if (typeof health.uptime === 'number') note(`It has been up for ${health.uptime}s${health.uptime < 120 ? ' (it was just woken up)' : ''}.`);
  if (health.commit) {
    note(`Built from commit ${health.commit}${health.node ? ` on Node ${health.node}` : ''} — check it matches the commit you deployed.`);
  } else {
    note(`No commit recorded${health.node ? ` (Node ${health.node})` : ''}, so this is not a Render build — or it is an older version of Pulse that predates this field.`);
  }
  console.log('\nAll good.\n');
  process.exit(0);
}

if (health.storage === 'local') {
  good('The app is running.');
  bad('Uploads are kept on this machine\'s own disk, which hosts with a temporary disk (such as Render\'s free plan) wipe on every restart, redeploy and sleep.');
  note('Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY on the service, then redeploy.');
  note('If this app has a real, persistent disk of its own, "local" is fine — that is what a self-hosted Pulse looks like.');
  console.log('\nOne thing to fix.\n');
  process.exit(1);
}

if (health.status === 'ok' && health.storage === undefined) {
  // Exactly what an older Pulse answered before uploads could live in a bucket: {status, uptime, time}.
  bad('This is an OLD version of Pulse — one that predates bucket storage.');
  note('Its accounts and uploads sit on the instance\'s own disk, so a sleep, restart or redeploy wipes them.');
  note('Deploy the current version (see DEPLOY.md) and check again: the answer must include "storage".');
  process.exit(1);
}

bad('That answer does not look like Pulse: ' + JSON.stringify(health).slice(0, 120));
process.exit(1);
