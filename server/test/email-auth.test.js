import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { emailConfigurationErrors } from '../email.js';
import { startServer, call, takeTestEmail, verifyEmailFromTestOutbox } from './helpers.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-email-auth-'));
let server;
let api;
before(async () => { server = await startServer(dataDir); api = call(server); });
after(() => { server?.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('production email configuration requires HTTPS links and SMTP settings', () => {
  const valid = {
    NODE_ENV: 'production', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587',
    SMTP_FROM: 'Pulse <no-reply@example.test>', PULSE_APP_URL: 'https://pulse.example.test'
  };
  assert.deepEqual(emailConfigurationErrors(valid), []);
  assert.ok(emailConfigurationErrors({ ...valid, PULSE_APP_URL: 'http://pulse.example.test' }).some((error) => /HTTPS/.test(error)));
  assert.deepEqual(emailConfigurationErrors({ NODE_ENV: 'production' }), [
    'SMTP_HOST', 'SMTP_FROM', 'PULSE_APP_URL is required for account email links'
  ]);
});

async function register(email, username) {
  const response = await action('POST', '/api/auth/register', {
    name: username, username, email, password: 'secret123', artistName: username, favoriteGenres: ['Pop']
  });
  return { status: response.status, body: await response.json() };
}

async function action(method, route, body) {
  return fetch(`${server.url}${route}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

test('password signup stays pending until a one-time verification link is used', async () => {
  const email = 'verify-me@example.test';
  const created = await register(email, 'verify_me');
  assert.equal(created.status, 201);
  assert.equal(created.body.requiresVerification, true);
  assert.equal(created.body.token, undefined);
  assert.equal(created.body.user, undefined);

  const denied = await api('POST', '/api/auth/login', { json: { email, password: 'secret123' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'EMAIL_NOT_VERIFIED');

  const token = await takeTestEmail(server, email, 'verify-email');
  assert.match(token, /^[a-f0-9]{64}$/);
  const database = new Database(path.join(dataDir, 'pulse.db'));
  try {
    const row = database.prepare("SELECT token_hash FROM auth_tokens WHERE purpose = 'verify-email'").get();
    assert.ok(row);
    assert.notEqual(row.token_hash, token, 'only a hash of the action token is stored');
  } finally { database.close(); }

  const verified = await action('POST', '/api/auth/verify-email', { token });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).ok, true);
  const replay = await action('POST', '/api/auth/verify-email', { token });
  assert.equal(replay.status, 400, 'verification links are single use');
  assert.equal((await api('POST', '/api/auth/login', { json: { email, password: 'secret123' } })).status, 200);
});

test('resend and reset requests avoid account enumeration; password reset expires and revokes old sessions', async () => {
  const email = 'reset-me@example.test';
  const created = await register(email, 'reset_me');
  assert.equal(created.status, 201);
  await verifyEmailFromTestOutbox(server, email);
  const oldSession = await api('POST', '/api/auth/login', { json: { email, password: 'secret123' } });
  assert.equal(oldSession.status, 200);

  const resetKnown = await api('POST', '/api/auth/password-reset/request', { json: { email } });
  const resetUnknown = await api('POST', '/api/auth/password-reset/request', { json: { email: 'not-here@example.test' } });
  assert.equal(resetKnown.status, 202);
  assert.equal(resetUnknown.status, 202);
  assert.deepEqual(resetKnown.body, resetUnknown.body, 'unknown and known addresses get the same response');

  const resetToken = await takeTestEmail(server, email, 'password-reset');
  assert.match(resetToken, /^[a-f0-9]{64}$/);
  const db = new Database(path.join(dataDir, 'pulse.db'));
  try {
    const row = db.prepare("SELECT token_hash, expires_at FROM auth_tokens WHERE purpose = 'password-reset'").get();
    assert.notEqual(row.token_hash, resetToken);
    assert.ok(Date.parse(row.expires_at) > Date.now());
  } finally { db.close(); }

  const changed = await action('POST', '/api/auth/password-reset/confirm', { token: resetToken, password: 'new-secret-987' });
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal((await changed.json()).ok, true);
  assert.equal((await api('GET', '/api/auth/me', { token: oldSession.body.token })).status, 401, 'reset invalidates existing JWT sessions');
  assert.equal((await api('POST', '/api/auth/login', { json: { email, password: 'secret123' } })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { json: { email, password: 'new-secret-987' } })).status, 200);
  assert.equal((await action('POST', '/api/auth/password-reset/confirm', { token: resetToken, password: 'another-secret' })).status, 400, 'reset tokens are single use');
});

test('expired verification links are rejected', async () => {
  const email = 'expired@example.test';
  assert.equal((await register(email, 'expired_user')).status, 201);
  const token = await takeTestEmail(server, email, 'verify-email');
  const db = new Database(path.join(dataDir, 'pulse.db'));
  try {
    db.prepare('UPDATE auth_tokens SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() - 1000).toISOString(), (await import('node:crypto')).createHash('sha256').update(token).digest('hex'));
  } finally { db.close(); }
  assert.equal((await action('POST', '/api/auth/verify-email', { token })).status, 400);
  assert.equal((await api('POST', '/api/auth/login', { json: { email, password: 'secret123' } })).status, 403);

  const resendKnown = await api('POST', '/api/auth/verification/resend', { json: { email } });
  const resendUnknown = await api('POST', '/api/auth/verification/resend', { json: { email: 'absent@example.test' } });
  assert.equal(resendKnown.status, 202);
  assert.deepEqual(resendKnown.body, resendUnknown.body, 'verification resend does not disclose whether an address is registered');
  const freshToken = await takeTestEmail(server, email, 'verify-email');
  assert.ok(freshToken);
  assert.equal((await action('POST', '/api/auth/verify-email', { token: freshToken })).status, 200);
});

test('expired password-reset links cannot change a password', async () => {
  const email = 'expired-reset@example.test';
  assert.equal((await register(email, 'expired_reset')).status, 201);
  await verifyEmailFromTestOutbox(server, email);
  await api('POST', '/api/auth/password-reset/request', { json: { email } });
  const token = await takeTestEmail(server, email, 'password-reset');
  const hash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex');
  const db = new Database(path.join(dataDir, 'pulse.db'));
  try { db.prepare('UPDATE auth_tokens SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() - 1000).toISOString(), hash); }
  finally { db.close(); }
  assert.equal((await action('POST', '/api/auth/password-reset/confirm', { token, password: 'replacement-123' })).status, 400);
  assert.equal((await api('POST', '/api/auth/login', { json: { email, password: 'secret123' } })).status, 200);
});
