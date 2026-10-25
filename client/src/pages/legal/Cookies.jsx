import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import './Legal.css';

export default function Cookies() {
  const [testNote, setTestNote] = useState('');
  const hasConsent = (() => {
    try { return localStorage.getItem('pulse_cookie_consent'); } catch { return null; }
  })();
  const clearConsent = () => {
    try { localStorage.removeItem('pulse_cookie_consent'); } catch {}
    setTestNote('Consent reset — the banner will reappear on your next visit/reload.');
  };

  return (
    <div className="legal-page">
      <Link to="/" className="legal-back"><Icon name="arrowLeft" size={14} /> Back to Pulse</Link>
      <div className="legal-hero">
        <h1>Cookie Policy</h1>
        <p>Pulse uses no advertising cookies and no cross-site tracking. This page explains the small amount of storage we do use and how you control it.</p>
        <div className="legal-meta">Effective: 25 October 2026 · Related: <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms</Link></div>
      </div>

      <section className="legal-card">
        <h2>At a glance</h2>
        <p>When most policies say “cookies” they really mean <strong>any browser storage set by a site</strong>: HTTP cookies, <code>localStorage</code>, <code>sessionStorage</code> and <code>Cache Storage</code>. Pulse uses the last three for essential functions and <strong>does not set non-essential advertising/tracking cookies</strong> in its current free operation. If we ever add optional analytics, we will ask for consent first via the Cookie Consent banner described below.</p>
        <div className="legal-note">Quick test: open DevTools → Application → Storage and you will see only the keys listed below. Nothing for ads or third-party trackers.</div>
      </section>

      <section className="legal-card">
        <h2><Icon name="cookie" size={18} /> What Pulse stores on this device</h2>
        <table className="legal-table">
          <thead><tr><th>Key / store</th><th>Purpose</th><th>Lifetime</th><th>Essential?</th></tr></thead>
          <tbody>
            <tr><td><code>pulse_token</code> <span className="muted">(localStorage)</span></td><td>Your signed-in session (JWT). Without it you must re-enter password on every fetch.</td><td>Until you sign out / clear site data (JWT itself expires 7 days)</td><td>Yes</td></tr>
            <tr><td><code>pulse_api_url</code> <span className="muted">(localStorage)</span></td><td>Self-hosters &amp; bundled apps: the address of the Pulse server you chose via <em>Settings → Website address</em>.</td><td>Until you reset it on the offline-splash / Settings</td><td>Yes (for hosted mode)</td></tr>
            <tr><td>User, genre &amp; theme prefs <span className="muted">(localStorage)</span></td><td>Cached display of your handle, chosen genres, light/dark theme, which onboarding demo content was purged.</td><td>Persistent until you log out / reset</td><td>Yes</td></tr>
            <tr><td><code>pulse_offline_index_v1</code> &amp; <code>pulse-offline-v1</code> <span className="muted">(localStorage + Cache Storage)</span></td><td>Index + bytes for tracks/playlists you tapped “Save offline”.</td><td>Until you remove from Downloads or Settings → Clear all downloads</td><td>Yes (your explicit request to download)</td></tr>
            <tr><td><code>pulse_cookie_consent</code> <span className="muted">(localStorage)</span></td><td>Your choice on the banner: <code>accepted</code> / <code>rejected</code>.</td><td>6 months, then re-prompted</td><td>Yes (to respect choice)</td></tr>
            <tr><td>Ephemeral session keys <span className="muted">(sessionStorage)</span></td><td>One-off UI state: “saw data-safety banner”, return-path after offline navigation.</td><td>Until tab closes</td><td>Yes</td></tr>
          </tbody>
        </table>
        <p>We do <strong>not</strong> use <code>document.cookie</code> HTTP cookies for session or tracking. On native shells (Capacitor) the <em>CapacitorCookies</em> bridge is bundled but disabled by default and unused by Pulse.</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="shield" size={18} /> Third-party storage that may appear</h2>
        <ul>
          <li><strong>Google Fonts (Inter):</strong> loaded from <code>fonts.googleapis.com</code> / <code>fonts.gstatic.com</code>. Google may set cache headers; you can block this host and Pulse still renders with system fonts.</li>
          <li><strong>Google Identity Services:</strong> only if you click “Continue with Google” and the site operator enabled it. Then Google’s own cookies/localStorage are governed by Google’s cookie policy.</li>
          <li><strong>YouTube oEmbed:</strong> fetched only when you paste a YouTube link; response is not stored as a cookie, just metadata in our DB.</li>
          <li><strong>Cloud storage signed URLs:</strong> ephemeral URL params, not cookies.</li>
        </ul>
        <p>No other third-party SDK that writes storage or runs trackers is bundled. See <Link to="/privacy">Privacy §5</Link> for the full audited list.</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="check" size={18} /> Consent banner — how it works</h2>
        <p>On your first visit (or 6 months after the last choice) a banner at the bottom of the screen asks:</p>
        <blockquote style={{ borderLeft: '3px solid var(--accent)', padding: '8px 14px', margin: '10px 0', color: 'var(--text-2)', background: 'var(--card-2)', borderRadius: '10px', fontSize: '13.5px' }}>
          “Pulse uses only essential storage to stay signed in and save your offline downloads. We set no ad or tracking cookies. Allow optional anonymous usage analytics to help us improve? You can change this anytime in the Cookie Policy.”
          <br />Buttons: <strong>Accept optional analytics</strong> · <strong>Only essential</strong> · link to this page.
        </blockquote>
        <ul>
          <li><strong>“Only essential”</strong> stores <code>pulse_cookie_consent = rejected</code> and we do not enable any analytics.</li>
          <li><strong>“Accept optional analytics”</strong> today is effectively the same as “Only essential” — we ship with analytics off. The toggle exists so future optional analytics can be gated without changing copy.</li>
          <li>Your choice is honoured in every shell (web, Android, desktop) on that browser/profile.</li>
        </ul>
        <p>Current saved choice on this browser: <strong>{hasConsent ? hasConsent : '— not yet chosen (banner will show)'}</strong></p>
        <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearConsent}><Icon name="trash" size={15} /> Reset consent (show banner again)</button>
          {testNote && <span className="muted" style={{ fontSize: 13 }}>{testNote}</span>}
        </div>
      </section>

      <section className="legal-card">
        <h2><Icon name="sun" size={18} /> Managing storage</h2>
        <ul>
          <li><strong>In Pulse:</strong> <Link to="/settings">Settings → App &amp; offline storage → Clear all downloads</Link> removes cached tracks; <em>Sign out</em> removes <code>pulse_token</code>; the offline-splash <em>Change website</em> removes <code>pulse_api_url</code>.</li>
          <li><strong>In your browser:</strong> Settings → Privacy → Cookies and site data → Clear “pulse.music / localhost” — removes everything above at once. The service worker cache can also be cleared via DevTools → Application → Cache Storage.</li>
          <li><strong>Do Not Track / Global Privacy Control:</strong> Pulse does not track, so these signals are respected by default.</li>
        </ul>
      </section>

      <section className="legal-card">
        <h2><Icon name="info" size={18} /> Questions</h2>
        <p>Contact <a href="mailto:inputname9@aol.com">inputname9@aol.com</a> with subject “Cookie Question”.</p>
      </section>

      <div className="legal-footer-links">
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Service</Link>
        <Link to="/settings">Manage data &amp; privacy</Link>
      </div>
    </div>
  );
}
