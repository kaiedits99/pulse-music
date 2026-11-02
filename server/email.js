import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

function configuredUrl(env = process.env) {
  const raw = String(env.PULSE_APP_URL || '').trim();
  if (!raw) throw new Error('PULSE_APP_URL is required for account email links');
  let url;
  try { url = new URL(raw); } catch { throw new Error('PULSE_APP_URL must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('PULSE_APP_URL must be an HTTP(S) origin or base path without credentials, query, or fragment');
  }
  if ((String(env.NODE_ENV).toLowerCase() === 'production' || env.RENDER) && url.protocol !== 'https:') {
    throw new Error('PULSE_APP_URL must use HTTPS in production');
  }
  return url.toString().replace(/\/+$/, '');
}

export function emailConfigurationErrors(env = process.env) {
  const errors = [];
  if (!env.SMTP_HOST) errors.push('SMTP_HOST');
  if (!env.SMTP_FROM) errors.push('SMTP_FROM');
  if (!env.PULSE_APP_URL) errors.push('PULSE_APP_URL');
  if ((env.SMTP_USER && !env.SMTP_PASS) || (!env.SMTP_USER && env.SMTP_PASS)) errors.push('SMTP_USER and SMTP_PASS must be set together');
  try { configuredUrl(env); } catch (error) { errors.push(error.message); }
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('SMTP_PORT must be a valid TCP port');
  return errors;
}

export function assertEmailConfiguration(env = process.env) {
  const errors = emailConfigurationErrors(env);
  if (errors.length) throw new Error(`Account email delivery is not configured: ${errors.join(', ')}`);
}

let transport;
function smtpTransport(env = process.env) {
  if (transport) return transport;
  const port = Number(env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    requireTLS: port !== 465 && String(env.SMTP_SECURE || '').toLowerCase() !== 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2' }
  });
  return transport;
}

async function deliver({ purpose, to, subject, text, html }) {
  if (process.env.NODE_ENV === 'test') {
    const outbox = process.env.PULSE_TEST_EMAIL_DIR;
    if (!outbox) throw new Error('PULSE_TEST_EMAIL_DIR is required in tests');
    await fs.mkdir(outbox, { recursive: true, mode: 0o700 });
    const filename = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.json`;
    await fs.writeFile(path.join(outbox, filename), JSON.stringify({ purpose, to, subject, text, html }), { mode: 0o600, flag: 'wx' });
    return;
  }
  assertEmailConfiguration();
  await smtpTransport().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function sendActionEmail({ purpose, to, token, heading, message, action, route, expiry }) {
  const base = configuredUrl();
  const url = new URL(route, `${base}/`);
  url.searchParams.set('token', token);
  const safeUrl = escapeHtml(url.toString());
  const text = `${heading}\n\n${message}\n\n${action}: ${url}\n\nThis link expires in ${expiry}. If you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h1>${heading}</h1><p>${escapeHtml(message)}</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#6548e8;color:#fff;text-decoration:none;border-radius:8px">${escapeHtml(action)}</a></p><p>Or copy this link into your browser:<br><a href="${safeUrl}">${safeUrl}</a></p><p>This link expires in ${escapeHtml(expiry)}. If you did not request this, you can ignore this email.</p></div>`;
  await deliver({ purpose, to, subject: `${heading} · Pulse`, text, html });
}

export function sendVerificationEmail({ to, token }) {
  return sendActionEmail({
    purpose: 'verify-email', to, token,
    heading: 'Verify your email address',
    message: 'Confirm this email address to finish creating your Pulse account.',
    action: 'Verify email', route: '/verify-email', expiry: '24 hours'
  });
}

export function sendPasswordResetEmail({ to, token }) {
  return sendActionEmail({
    purpose: 'password-reset', to, token,
    heading: 'Reset your Pulse password',
    message: 'A password reset was requested for your Pulse account.',
    action: 'Choose a new password', route: '/reset-password', expiry: '1 hour'
  });
}
