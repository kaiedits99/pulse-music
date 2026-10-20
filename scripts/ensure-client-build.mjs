// Pulse is one service: Express hosts the API and the built React app (client/dist). The build is
// generated, not committed, so a checkout that has never been built served nothing at all — every
// page answered a bare "Cannot GET /" while /api/health still said the instance was healthy.
//
// Before the server starts listening it checks for client/dist/index.html and, when it is missing,
// installs the client's dependencies (only if they are absent) and runs its build. It costs one
// existsSync when there is nothing to do, never throws, and can be switched off with
// PULSE_SKIP_CLIENT_BUILD=true (a host that builds the client itself, or the test suite).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const clientSourceDir = path.join(repoRoot, 'client');

/** Where the built app lives: PULSE_CLIENT_DIR, or client/dist next to the server. */
export function clientDir(env = process.env) {
  return env.PULSE_CLIENT_DIR ? path.resolve(env.PULSE_CLIENT_DIR) : path.join(clientSourceDir, 'dist');
}

/** The one file that has to exist before there is a site to serve. */
export function clientIndexPath(env = process.env) {
  return path.join(clientDir(env), 'index.html');
}

export function isClientBuilt(env = process.env) {
  return fs.existsSync(clientIndexPath(env));
}

const skipBuild = (env = process.env) => String(env.PULSE_SKIP_CLIENT_BUILD || '').trim().toLowerCase() === 'true';

/**
 * Make sure a built web app exists. Returns { ok, built, skipped?, reason? } and never throws:
 * the API must come up even when the web app cannot be built.
 */
export function ensureClientBuild({ env = process.env, log = console, run = null } = {}) {
  if (skipBuild(env)) return { ok: true, built: false, skipped: true };
  if (isClientBuilt(env)) return { ok: true, built: false };

  if (!fs.existsSync(path.join(clientSourceDir, 'package.json'))) {
    const reason = `the web app's sources were not found at ${clientSourceDir}`;
    log.warn?.(`[pulse] ${reason}`);
    return { ok: false, built: false, reason };
  }

  const npm = run || ((args, cwd) => spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
    { cwd, stdio: 'inherit', env }
  ).status === 0);

  log.log?.('[pulse] The web app has not been built yet — building it now (this happens once per checkout).');

  if (!fs.existsSync(path.join(clientSourceDir, 'node_modules', 'vite'))) {
    log.log?.('[pulse] Installing the web app’s dependencies…');
    const args = fs.existsSync(path.join(clientSourceDir, 'package-lock.json'))
      ? ['ci', '--no-audit', '--no-fund']
      : ['install', '--no-audit', '--no-fund'];
    if (!npm(args, clientSourceDir)) {
      const reason = 'installing the web app’s dependencies failed (this step needs network access once)';
      log.warn?.(`[pulse] ${reason}`);
      return { ok: false, built: false, reason };
    }
  }

  log.log?.('[pulse] Building the web app…');
  if (!npm(['run', 'build'], clientSourceDir) || !isClientBuilt(env)) {
    const reason = 'the web app build failed';
    log.warn?.(`[pulse] ${reason}`);
    return { ok: false, built: false, reason };
  }

  log.log?.('[pulse] The web app is built.');
  return { ok: true, built: true };
}

/** The page served instead of a bare 404 when there is no build to serve. */
export function missingBuildPage(reason = 'the web app has not been built') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — the web app needs building</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d12; color: #e9ecf5;
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 32px; }
  main { max-width: 560px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: #a8b0c3; margin: 0 0 18px; }
  code, pre { background: #151925; border: 1px solid #232a3b; border-radius: 10px; color: #d7dcf0; }
  code { padding: 2px 6px; font-size: 14px; }
  pre { padding: 14px 16px; overflow-auto; font-size: 14px; }
  a { color: #8fb4ff; }
</style></head>
<body><main>
  <h1>The web app is not built yet</h1>
  <p>The API is running, but there is no site to serve (${reason}). Build it once, then reload this page:</p>
  <pre>cd client &amp;&amp; npm install &amp;&amp; npm run build</pre>
  <p>Restarting the server with <code>npm start</code> also does this automatically when the build is missing.
     The API itself is fine: <a href="/api/health">/api/health</a>.</p>
</main></body></html>`;
}
