// Stopping the server: finish what is in flight, and (under Litestream) stay up long enough for the last
// database changes to be copied out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { root, freePort, waitFor, sleep } from './helpers.js';
import { shutdownDelayMs } from '../shutdown.js';

async function boot(env = {}) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-stop-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), PULSE_DATA_DIR: dir, JWT_SECRET: 'test', ...env }
  });
  let log = '';
  child.stdout.on('data', (c) => { log += c; });
  child.stderr.on('data', (c) => { log += c; });
  await waitFor(() => log.includes('Server running'), { timeoutMs: 15000, what: 'server start' });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() })));
  return { port, child, logs: () => log, exited, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('the wait is read from PULSE_SHUTDOWN_DELAY_SECONDS and kept within what hosts allow', () => {
  assert.equal(shutdownDelayMs(undefined), 0);
  assert.equal(shutdownDelayMs(''), 0);
  assert.equal(shutdownDelayMs('abc'), 0);
  assert.equal(shutdownDelayMs('-4'), 0);
  assert.equal(shutdownDelayMs('7'), 7000);
  assert.equal(shutdownDelayMs(7), 7000);
  assert.equal(shutdownDelayMs('600'), 25000, 'a host forces a stop after about 30 seconds');
});

test('by default it stops straight away and cleanly', async () => {
  const server = await boot();
  const stoppedAt = Date.now();
  server.child.kill('SIGTERM');
  const { code, at } = await server.exited;
  assert.equal(code, 0);
  assert.ok(at - stoppedAt < 3000, `took ${at - stoppedAt} ms`);
  assert.match(server.logs(), /SIGTERM received, shutting down\./);
  server.cleanup();
});

test('under Litestream it stops taking requests at once but stays up for the configured wait', async () => {
  const server = await boot({ PULSE_SHUTDOWN_DELAY_SECONDS: '2' });
  const stoppedAt = Date.now();
  server.child.kill('SIGTERM');
  await sleep(300);
  await assert.rejects(() => fetch(`http://127.0.0.1:${server.port}/api/health`), 'no new requests are accepted');
  const { code, at } = await server.exited;
  assert.equal(code, 0);
  assert.ok(at - stoppedAt >= 1900, `exited after only ${at - stoppedAt} ms`);
  assert.ok(at - stoppedAt < 7000, `took ${at - stoppedAt} ms`);
  assert.match(server.logs(), /staying up 2s more so the latest database changes are copied first/);
  server.cleanup();
});

test('a request that is already being handled still gets its answer', async () => {
  const server = await boot();
  const answer = new Promise((resolve, reject) => {
    const body = JSON.stringify({ email: 'nobody@example.test', password: 'whatever' });
    const req = http.request({
      host: '127.0.0.1', port: server.port, path: '/api/auth/login', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(body.slice(0, 10)); // the rest of the request is still on its way
    setTimeout(() => req.end(body.slice(10)), 700);
  });
  await sleep(250);
  server.child.kill('SIGTERM');
  assert.equal(await answer, 401, 'the in-flight sign-in attempt was answered, not dropped');
  const { code } = await server.exited;
  assert.equal(code, 0);
  server.cleanup();
});

test('a second signal does not restart the countdown', async () => {
  const server = await boot({ PULSE_SHUTDOWN_DELAY_SECONDS: '1' });
  server.child.kill('SIGTERM');
  await sleep(200);
  server.child.kill('SIGINT');
  const { code } = await server.exited;
  assert.equal(code, 0);
  assert.equal((server.logs().match(/received, shutting down/g) || []).length, 1);
  server.cleanup();
});
