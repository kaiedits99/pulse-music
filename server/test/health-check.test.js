// scripts/health-check.mjs: what it says about a running deployment. A local stand-in server plays
// the part of a Pulse instance — including Render's "Application loading" page while a free one wakes
// — so no real deployment or bucket is involved.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { root } from './helpers.js';

const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

/** A server whose reply to each request is decided by `respond(hitNumber, res)`. */
async function listen(respond) {
  let hits = 0;
  const server = http.createServer((req, res) => respond(++hits, res));
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}` };
}

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Render's loading page: HTML, matching the marker the script looks for. */
const loadingPage = (res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><head><title>Render - Application loading</title></head><body>Application loading</body></html>');
};

// Run asynchronously: spawnSync would block this process's event loop, and the stand-in server
// lives in this very process, so the child would wait forever for an answer we cannot give.
function run(args, env = {}) {
  const clean = { ...process.env };
  for (const key of ['PULSE_URL', 'RENDER_EXTERNAL_URL', 'KEEP_AWAKE_URL', 'HEALTH_TIMEOUT_SECONDS', 'HEALTH_POLL_SECONDS']) delete clean[key];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/health-check.mjs', ...args], {
      cwd: root,
      env: { ...clean, HEALTH_TIMEOUT_SECONDS: '8', HEALTH_POLL_SECONDS: '0.2', ...env }
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test('a healthy deployment on a bucket is reported as all good', async () => {
  const app = await listen((_n, res) => json(res, { status: 'ok', storage: 'bucket', uptime: 300, time: new Date().toISOString() }));
  const { code, output } = await run([app.url]);
  assert.equal(code, 0, output);
  assert.match(output, /Uploads are kept in the bucket/);
  assert.match(output, /All good\./);
});

test('keeps waiting through the loading page a waking free instance serves', async () => {
  const app = await listen((n, res) => (n <= 2 ? loadingPage(res) : json(res, { status: 'ok', storage: 'bucket', uptime: 3 })));
  const { code, output } = await run([app.url]);
  assert.equal(code, 0, output);
  assert.match(output, /asleep and starting up/, 'it explains the wait instead of failing');
  assert.match(output, /it was just woken up/);
});

test('storage "local" is called out, with the fix', async () => {
  const app = await listen((_n, res) => json(res, { status: 'ok', storage: 'local', uptime: 42 }));
  const { code, output } = await run([app.url]);
  assert.equal(code, 1);
  assert.match(output, /own disk, which hosts with a temporary disk/);
  assert.match(output, /Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY/);
});

test('a server that never wakes up is reported, not left hanging', async () => {
  const app = await listen((_n, res) => loadingPage(res));
  const { code, output } = await run([app.url], { HEALTH_TIMEOUT_SECONDS: '1' });
  assert.equal(code, 1, output);
  assert.match(output, /still starting after the time allowed/);
});

test('an address that does not exist is explained', async () => {
  const { code, output } = await run(['http://pulse-does-not-exist.invalid']);
  assert.equal(code, 1);
  assert.match(output, /Could not reach/);
});

test('with no address, it shows how to use it', async () => {
  const { code, output } = await run([]);
  assert.equal(code, 1);
  assert.match(output, /npm run health -- https:\/\//);
});

test('a non-Pulse answer is not mistaken for a healthy app', async () => {
  const app = await listen((_n, res) => json(res, { hello: 'world' }));
  const { code, output } = await run([app.url]);
  assert.equal(code, 1, output);
  assert.match(output, /does not look like Pulse/);
});
