// Password hashing runs without freezing the server, and sign-ups stay unique when they overlap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import bcrypt from 'bcryptjs';
import { createPasswordService, hashPassword, verifyPassword, stopPasswordThread } from '../passwords.js';
import { startServer, call } from './helpers.js';

const apiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-auth-api-'));

let server;
let api;
before(async () => { server = await startServer(apiDir); api = call(server); });
after(async () => {
  server?.stop();
  await stopPasswordThread();
  fs.rmSync(apiDir, { recursive: true, force: true });
});

test('hashing and checking passwords work, and existing accounts keep working', async () => {
  const hash = await hashPassword('correct horse');
  assert.match(hash, /^\$2[aby]\$10\$/);
  assert.equal(await verifyPassword('correct horse', hash), true);
  assert.equal(await verifyPassword('wrong horse', hash), false);
  // Accounts made before hashing became asynchronous have hashes from the synchronous call; same format.
  assert.equal(await verifyPassword('legacy pass', bcrypt.hashSync('legacy pass', 10)), true);
  assert.equal(bcrypt.compareSync('correct horse', hash), true, 'and the other way round');
});

test('while passwords are being hashed, the server keeps handling other work', async () => {
  await hashPassword('warm up'); // starts the helper thread
  const began = performance.now();
  await hashPassword('time a single hash');
  const oneHash = performance.now() - began;

  let turns = 0;
  let longestStall = 0;
  let last = performance.now();
  let running = true;
  const spin = () => {
    if (!running) return;
    const now = performance.now();
    longestStall = Math.max(longestStall, now - last);
    last = now;
    turns += 1;
    setImmediate(spin);
  };
  setImmediate(spin);
  await Promise.all(Array.from({ length: 6 }, (_, i) => hashPassword(`password number ${i}`)));
  running = false;

  // Hashing on the main thread would stall it for at least one whole hash (and for all six if they overlap).
  assert.ok(turns > 100, `the event loop only got ${turns} turns`);
  assert.ok(longestStall < oneHash * 0.75, `the server stalled for ${longestStall.toFixed(0)} ms while hashing (one hash takes ${oneHash.toFixed(0)} ms)`);
});

test('overlapping requests each get their own answer, and a wrong password fails', async () => {
  const people = Array.from({ length: 5 }, (_, i) => `password ${i}`);
  const hashes = await Promise.all(people.map((p) => hashPassword(p)));
  const checks = await Promise.all(hashes.flatMap((hash, i) => [verifyPassword(people[i], hash), verifyPassword(people[(i + 1) % 5], hash)]));
  assert.deepEqual(checks, [true, false, true, false, true, false, true, false, true, false]);
  await assert.rejects(() => verifyPassword(undefined, hashes[0]), /Illegal arguments/, 'bad input is an error, not a silent "no"');
});

test('the helper thread comes back by itself if it is stopped', async () => {
  const hash = await hashPassword('before');
  await stopPasswordThread();
  assert.equal(await verifyPassword('before', hash), true);
  assert.match(await hashPassword('after'), /^\$2[aby]\$10\$/);
});

test('if threads cannot be used at all, sign-ins still work (just in the slow way)', async () => {
  const noThreads = createPasswordService({ createWorker: () => { throw new Error('no threads on this host'); } });
  const hash = await noThreads.hashPassword('fallback');
  assert.match(hash, /^\$2[aby]\$10\$/);
  assert.equal(await noThreads.verifyPassword('fallback', hash), true);
  assert.equal(await noThreads.verifyPassword('other', hash), false);
});

test('if the helper thread dies in the middle of a request, that request is still answered', async () => {
  class Doomed extends EventEmitter {
    postMessage() { setImmediate(() => this.emit('exit', 1)); }
    unref() {}
    terminate() { return Promise.resolve(); }
  }
  const service = createPasswordService({ createWorker: () => new Doomed() });
  const hash = await service.hashPassword('survive');
  assert.equal(await service.verifyPassword('survive', hash), true);
});

const person = (n) => ({ name: `Person ${n}`, username: `person${n}`, email: `person${n}@example.test`, password: 'secret123', artistName: `Person ${n}`, favoriteGenres: ['Pop'] });

test('people signing up at the same moment all get their own account', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => api('POST', '/api/auth/register', { json: person(i) })));
  assert.deepEqual(results.map((r) => r.status), Array(8).fill(201));
  assert.equal(new Set(results.map((r) => r.body.user.id)).size, 8);
});

test('two sign-ups for the same email or username at the same moment cannot both succeed', async () => {
  const sameEmail = await Promise.all(Array.from({ length: 5 }, (_, i) => api('POST', '/api/auth/register', {
    json: { ...person(100), username: `racer${i}` }
  })));
  assert.equal(sameEmail.filter((r) => r.status === 201).length, 1, JSON.stringify(sameEmail.map((r) => r.status)));
  assert.ok(sameEmail.filter((r) => r.status !== 201).every((r) => r.status === 400 && /already exists/.test(r.body.error)));

  const sameName = await Promise.all(Array.from({ length: 5 }, (_, i) => api('POST', '/api/auth/register', {
    json: { ...person(200 + i), username: 'oneandonly' }
  })));
  assert.equal(sameName.filter((r) => r.status === 201).length, 1, JSON.stringify(sameName.map((r) => r.status)));
  assert.ok(sameName.filter((r) => r.status !== 201).every((r) => r.status === 400 && /already taken/.test(r.body.error)));
});

test('signing in still works, and a wrong password is still refused', async () => {
  const good = await api('POST', '/api/auth/login', { json: { email: 'person0@example.test', password: 'secret123' } });
  assert.equal(good.status, 200);
  assert.ok(good.body.token);
  const bad = await api('POST', '/api/auth/login', { json: { email: 'person0@example.test', password: 'not-it' } });
  assert.equal(bad.status, 401);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => api('POST', '/api/auth/login', {
    json: { email: `person${i}@example.test`, password: i % 2 ? 'secret123' : 'nope-nope' }
  })));
  assert.deepEqual(burst.map((r) => r.status), [401, 200, 401, 200, 401, 200], 'overlapping sign-ins each get their own right answer');
});
