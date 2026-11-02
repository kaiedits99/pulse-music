// Shared by the end-to-end tests: boot the real server in a child process, talk to it over HTTP.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check()` returns something truthy (and returns it), or fails after `timeoutMs`. */
export async function waitFor(check, { timeoutMs = 5000, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(40);
  }
}

/** Starts server/index.js on a free port with its own data folder. `env` adds or overrides variables. */
export async function startServer(dataDir, env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    // Tests never build the web app: that is a deploy concern, and a real Vite build per test
    // process would dwarf the suite. A test that cares points PULSE_CLIENT_DIR at its own folder.
    env: {
      ...process.env,
      PORT: String(port),
      PULSE_DATA_DIR: dataDir,
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret',
      PULSE_APP_URL: `http://127.0.0.1:${port}`,
      PULSE_TEST_EMAIL_DIR: path.join(dataDir, 'test-mail'),
      PULSE_SKIP_CLIENT_BUILD: 'true',
      ...env
    }
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const deadline = Date.now() + 15000;
  while (!log.includes('Server running')) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`server did not start:\n${log}`);
    await sleep(50);
  }
  return { url: `http://127.0.0.1:${port}`, testMailDir: path.join(dataDir, 'test-mail'), logs: () => log, stop: () => child.kill() };
}

export async function takeTestEmail(server, email, purpose) {
  const names = (await fs.readdir(server.testMailDir)).filter((name) => name.endsWith('.json')).sort().reverse();
  for (const name of names) {
    const file = path.join(server.testMailDir, name);
    const mail = JSON.parse(await fs.readFile(file, 'utf8'));
    if (mail.to.toLowerCase() === email.toLowerCase() && mail.purpose === purpose) {
      await fs.unlink(file);
      const match = mail.text.match(/https?:\/\/\S+/);
      if (!match) throw new Error(`test email did not contain an action URL (${purpose})`);
      return new URL(match[0]).searchParams.get('token');
    }
  }
  return null;
}

export async function verifyEmailFromTestOutbox(server, email) {
  const token = await takeTestEmail(server, email, 'verify-email');
  if (!token) throw new Error(`verification email for ${email} was not captured`);
  const response = await fetch(`${server.url}/api/auth/verify-email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`test email verification failed: ${body.error}`);
  return body;
}

/** A tiny but valid mono 16-bit WAV (0.25 s). */
export function wavBytes() {
  const samples = 2000;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

/** A valid 1x1 PNG, for cover art. */
export const pngBytes = () => Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** `call(server)(method, route, { token, json, form })` -> { status, body, headers } */
export const call = (server) => async (method, route, { token, json, form } = {}) => {
  const res = await fetch(server.url + route, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : form
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (method === 'POST' && route === '/api/auth/register' && res.status === 201 && body.requiresVerification) {
    await verifyEmailFromTestOutbox(server, json.email);
    const signedIn = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: json.email, password: json.password })
    });
    const session = await signedIn.json();
    if (!signedIn.ok) throw new Error(`test sign-in after email verification failed: ${session.error}`);
    return { status: 201, body: session, headers: signedIn.headers };
  }
  return { status: res.status, body, headers: res.headers };
};
