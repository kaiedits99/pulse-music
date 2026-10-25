import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

const KEY = 'pulse_cookie_consent';
const EXPIRY_DAYS = 180;

function readConsent() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.value) return null;
    const ageMs = Date.now() - (parsed.at || 0);
    if (ageMs > EXPIRY_DAYS * 24 * 60 * 60 * 1000) return null;
    return parsed.value;
  } catch {
    return localStorage.getItem(KEY) || null;
  }
}

function writeConsent(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ value, at: Date.now() }));
  } catch {}
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [render, setRender] = useState(false);

  useEffect(() => {
    const current = readConsent();
    if (!current) {
      const t = setTimeout(() => { setRender(true); requestAnimationFrame(() => setVisible(true)); }, 650);
      return () => clearTimeout(t);
    }
  }, []);

  const choose = (value) => {
    writeConsent(value);
    setVisible(false);
    setTimeout(() => setRender(false), 320);
    window.dispatchEvent(new CustomEvent('pulse-cookie-consent', { detail: value }));
  };

  if (!render) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 500,
        padding: '14px 16px calc(14px + env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          maxWidth: 760,
          width: '100%',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '18px',
          boxShadow: 'var(--shadow-lg)',
          padding: '16px 16px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          transform: visible ? 'translateY(0)' : 'translateY(16px)',
          opacity: visible ? 1 : 0,
          transition: 'transform .28s ease, opacity .28s ease'
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', border: '1px solid rgba(139,92,246,0.18)', flexShrink: 0 }}>
            <Icon name="cookie" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em', marginBottom: 4 }}>We use only essential storage</div>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-dim)', margin: 0 }}>
              Pulse stays signed in and saves your offline downloads using <em>localStorage</em> and Cache Storage. No ad or cross-site tracking cookies. Allow optional anonymous usage analytics to help us improve? You can change this anytime in the <Link to="/cookies" style={{ color: 'var(--accent-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}>Cookie Policy</Link>.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => choose('rejected')}
            className="btn btn-ghost btn-sm"
            style={{ borderRadius: 999 }}
          >
            Only essential
          </button>
          <button
            type="button"
            onClick={() => choose('accepted')}
            className="btn btn-primary btn-sm"
            style={{ borderRadius: 999 }}
          >
            <Icon name="check" size={14} /> Accept optional analytics
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper for other components to re-open or check
export function hasCookieConsent() { return readConsent(); }
export function resetCookieConsent() {
  try { localStorage.removeItem(KEY); } catch {}
}
