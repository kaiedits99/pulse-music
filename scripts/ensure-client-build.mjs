// Pulse is one service: the Express server hosts both the API and the built React app
// (client/dist, produced by Vite). The build is deliberately not committed — it is generated —
// so a machine that has never run it (a fresh clone, a preview sandbox, a host whose build step
// was skipped or failed) had nothing to serve: every page answered with a bare
// "Cannot GET /", which is indistinguishable from the site being down.
//
// This closes that hole. Before the server listens it checks for client/dist/index.html and, if
// it is missing, installs the web app's dependencies (only when they are not installed) and runs
// the client build — so `npm start` produces a working site on any checkout, whatever the host.
//
// It costs one fs.existsSync when there is nothing to do, never throws, and can be switched off
// with PULSE_SKIP_CLIENT_BUILD=true (a host that builds the client itself, or the test suite).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the built app lives: PULSE_CLIENT_DIR, or client/dist next to the server. */
export function clientDir(env = process.env) {
  return env.PULSE_CLIENT_DIR ? path.resolve(env.PULSE_CLIENT_DIR) : path.join(repoRoot, 'client', 'dist');
}

/** The file that has to exist for the server to have a site to serve. */
export function clientIndexPath(env = process.env) {
  return path.join(clientDir(env), 'index.html');
}

/** True when there is a built app to serve. */
export function isClientBuilt(env = process.env) {
  return fs.existsSync(clientIndexPath(env));
}

/** Where the web app's own sources and lockfile live. */
export const clientSourceDir = path.join(repoRoot, 'client');

/** Runs an npm command in `cwd`. Returns true on success. */
function runNpm(args, cwd) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd,
    stdio: 'inherit',
    env: process.env
  });
  return result.status === 0;
}

/**
 * Makes sure a built web app exists before the server starts serving.
 * Returns { ok, built, skipped?, reason? } — never throws.
 */
export function ensureClientBuild({ log = console, env = process.env, run = runNpm } = {}) {
  if (String(env.PULSE_SKIP_CLIENT_BUILD || '').trim().toLowerCase() === 'true') {
    return { ok: true, built: false, skipped: true };
  }
  if (isClientBuilt(env)) return { ok: true, built: false };

  if (!fs.existsSync(path.join(clientSourceDir, 'package.json'))) {
    const reason = `the web app's sources were not found at ${clientSourceDir}`;
    log.warn(`[pulse] ${reason}`);
    return { ok: false, built: false, reason };
  }

  log.log('[pulse] The web app has not been built yet — building it now (this happens once per checkout).');

  if (!fs.existsSync(path.join(clientSourceDir, 'node_modules', 'vite'))) {
    log.log('[pulse] Installing the web app’s dependencies…');
    const installArgs = fs.existsSync(path.join(clientSourceDir, 'package-lock.json'))
      ? ['ci', '--no-audit', '--no-fund']
      : ['install', '--no-audit', '--no-fund'];
    if (!run(installArgs, clientSourceDir)) {
      const reason = 'installing the web app’s dependencies failed (this step needs network access once)';
      log.warn(`[pulse] ${reason}`);
      return { ok: false, built: false, reason };
    }
  }

  log.log('[pulse] Building the web app…');
  if (!run(['run', 'build'], clientSourceDir)) {
    const reason = 'the web app build failed';
    log.warn(`[pulse] ${reason}`);
    return { ok: false, built: false, reason };
  }
  if (!isClientBuilt(env)) {
    const reason = `the build reported success but produced no ${path.relative(repoRoot, clientIndexPath(env))}`;
    log.warn(`[pulse] ${reason}`);
    return { ok: false, built: false, reason };
  }

  log.log('[pulse] Web app built — serving it from ' + path.relative(repoRoot, clientDir(env)) + '.');
  return { ok: true, built: true };
}
