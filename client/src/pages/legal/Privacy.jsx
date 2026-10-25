import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import './Legal.css';

export default function Privacy() {
  return (
    <div className="legal-page">
      <Link to="/" className="legal-back"><Icon name="arrowLeft" size={14} /> Back to Pulse</Link>
      <div className="legal-hero">
        <h1>Privacy Policy</h1>
        <p>Pulse is a free, global music-sharing community. This policy explains what we collect, why, and what rights you have. We minimise data by design and we never sell it.</p>
        <div className="legal-meta">Effective: 25 October 2026 · Last updated: 25 October 2026</div>
      </div>

      <section className="legal-card">
        <h2><Icon name="shield" size={18} /> 1 · Who we are</h2>
        <p><strong>Data controller:</strong> Pulse Music (“Pulse”, “we”, “us”). For privacy questions or Data Subject Requests email <a href="mailto:inputname9@aol.com">inputname9@aol.com</a> or use the <Link to="/settings">Settings → Your data &amp; privacy</Link> controls. Pulse is operated from Lagos, Nigeria and serves users globally.</p>
        <p>If you are in the EEA/UK, you have GDPR rights; if you are in California, you have CCPA rights — both are honoured for all users. Our lawful bases are <strong>contract</strong> (to run your account and catalogue), <strong>legitimate interest</strong> (security, abuse prevention, service improvement) and <strong>consent</strong> (optional analytics / cookies, marketing — which we do not send).</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="database" size={18} /> 2 · What we collect — and what we don’t</h2>
        <p>We practice <strong>data minimisation</strong>. We only ask for what Pulse needs to work:</p>
        <ul>
          <li><strong>Account information:</strong> display name, username/handle (e.g. <code>@kai99</code>), email, password hash (bcrypt, never plaintext), 1–3 favourite genres (for recommendations), optional artist profile fields (bio, genre, country) and avatar URL.</li>
          <li><strong>Content you provide:</strong> audio files, cover art, album/playlist titles, podcast episodes, messages and group/DM membership, reactions. You choose whether each song/album/playlist is <em>public</em> or <em>private</em>.</li>
          <li><strong>Usage data:</strong> play counts, likes/favourites, follow actions, and anonymous aggregate stats (total tracks/artists) shown on the sign-in screen. No personalised ad profiles.</li>
          <li><strong>Technical data:</strong> device IP (used for rate-limiting and abuse prevention, not stored beyond logs), browser/app version, and any bug report you voluntarily send. Location is never asked for.</li>
        </ul>
        <h3>What we deliberately do not collect</h3>
        <ul>
          <li>No phone numbers, home addresses, government IDs, payment cards, or financial data — Pulse has no paid tier.</li>
          <li>No precise location, contacts, call logs, or advertising IDs.</li>
          <li>No third-party marketing trackers, pixels, or cross-site behavioural profiling.</li>
          <li>No biometric data, health data, or special-category data.</li>
        </ul>
        <div className="legal-note">If a form ever asks for more than the above, it is a bug — please report it and do not submit it.</div>
      </section>

      <section className="legal-card">
        <h2><Icon name="cookie" size={18} /> 3 · Cookies, local storage &amp; similar</h2>
        <p>Pulse uses <strong>no third-party cookies for advertising</strong>. See our full <Link to="/cookies">Cookie Policy</Link> for details.</p>
        <ul>
          <li><strong>Essential storage:</strong> <code>pulse_token</code> (your JWT in <code>localStorage</code>), <code>pulse_api_url</code> (when you self-host), theme and offline indexes. Without these you cannot stay signed in or play downloads.</li>
          <li><strong>Cache Storage &amp; IndexedDB:</strong> offline tracks/covers you explicitly download (Cache <code>pulse-offline-v1</code>). Controlled in <Link to="/settings">Settings → App &amp; offline storage</Link> and by your browser’s site-data settings.</li>
          <li><strong>Session helpers:</strong> ephemeral keys like “saw data-safety banner” in <code>sessionStorage</code>.</li>
        </ul>
        <p>We do not set non-essential analytics cookies without consent. If we ever add optional analytics, the Cookie Consent banner will ask first and your choice is stored in <code>pulse_cookie_consent</code>.</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="users" size={18} /> 4 · How we use your data</h2>
        <ul>
          <li>To create and sign you in, personalise recommendations from your chosen genres, and let you upload / stream / download.</li>
          <li>To deliver messages and community features (DMs, parties, channels — messages auto-expire: 24 h after read or 30 days max).</li>
          <li>To keep the service secure: rate-limiting, abuse detection, and security headers.</li>
          <li>To show aggregate, anonymised counters (e.g. “1,240 Tracks”) — no individual is identifiable.</li>
        </ul>
        <p>We <strong>do not</strong> sell personal information, run ads, or subject you to automated decision-making that produces legal effects.</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="external" size={18} /> 5 · Third-party SDKs &amp; processors (audited)</h2>
        <p>We audit every dependency we ship and keep the list below publicly documented so you know where data could flow:</p>
        <table className="legal-table">
          <thead><tr><th>Service</th><th>Purpose</th><th>Data shared</th></tr></thead>
          <tbody>
            <tr><td>Cloud storage (S3-compatible, e.g. R2) when configured</td><td>Store uploaded audio/covers and Litestream DB snapshots</td><td>Audio bytes, image bytes, encrypted DB snapshot — accessed via signed URLs</td></tr>
            <tr><td>Google Identity Services (optional, only if the operator sets <code>GOOGLE_CLIENT_ID</code>)</td><td>“Continue with Google” sign-in</td><td>Google-issued ID token; verified server-side. No contacts imported.</td></tr>
            <tr><td>YouTube oEmbed (keyless, <code>youtube.com/oembed</code>)</td><td>Preview a pasted YouTube link so you can save it as an embed</td><td>Video ID only; no watch history sent</td></tr>
            <tr><td>Capacitor (native apps) + Google Fonts (Inter)</td><td>Android / desktop shell and typefaces</td><td>No personal data. Fonts served from <code>fonts.googleapis.com</code> with cache; you can block fonts and the app still works.</td></tr>
          </tbody>
        </table>
        <p>When a third-party is not configured (e.g. you self-host without a bucket or Google), that row does not run — there is no silent fallback to another tracker. We pin dependency versions and run <code>npm audit</code> in CI (currently <strong>0 vulnerabilities</strong>).</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="clock" size={18} /> 6 · Retention</h2>
        <ul>
          <li>Account &amp; profile: until you delete your account.</li>
          <li>Uploaded tracks/playlists: until you delete them (or your account).</li>
          <li>Messages: end-to-end lifecycle is 24 h after every member has read them, capped at 30 days; channel posts 7 days. Expired messages are hidden immediately and storage reclaimed by a periodic cleaner.</li>
          <li>Backups: Litestream continuous replication and fallback snapshots (when enabled) retain the latest copy only. Deleting your account removes you from the next snapshot.</li>
        </ul>
      </section>

      <section className="legal-card">
        <h2><Icon name="check" size={18} /> 7 · Your rights</h2>
        <p>Wherever you live, you can:</p>
        <ul>
          <li><strong>Access &amp; export:</strong> <Link to="/settings">Settings → Your data &amp; privacy → Export your data</Link> (or email us) — we provide a JSON copy of your profile, uploads, playlists and follows.</li>
          <li><strong>Rectify:</strong> edit name, handle, bio and genres in Settings; email corrections to inputname9@aol.com.</li>
          <li><strong>Erase / deletion request:</strong> <Link to="/settings">Settings → Delete my account</Link> or email inputname9@aol.com. We delete your account, auth credentials, follows and privately-owned content and revoke offline blob URLs. Content you made <em>public</em> may remain visible as “deleted user” if required to preserve other users’ playlists — we will tell you before we keep it.</li>
          <li><strong>Object / restrict &amp; withdraw consent:</strong> toggle genres, delete downloads, or clear site data in your browser. Cookie preferences can be changed at any time in the consent banner (re-openable from the Cookie Policy page).</li>
        </ul>
        <p>We respond within <strong>30 days</strong> (EEA/UK GDPR) and without fee unless requests are manifestly unfounded or excessive. To exercise rights, email <a href="mailto:inputname9@aol.com">inputname9@aol.com</a> with the email address on the account.</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="users" size={18} /> 8 · Children (age 13+)</h2>
        <p>Pulse is not directed to children under 13 and we do not knowingly collect their data. You must be <strong>at least 13 years old</strong> (or 16 where the law requires) to create an account. If we learn a child under the applicable age has provided personal data, we delete it. See Section 9 of the <Link to="/terms">Terms</Link> for COPPA/EEA handling.</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="lock" size={18} /> 9 · Security</h2>
        <ul>
          <li>Passwords stored as bcrypt hashes, never plaintext; JWTs expire after 7 days and are required on all write endpoints.</li>
          <li>Rate-limiting on sign-in/registration, strict content-type validation, 60 MB upload cap, and object-storage signed URLs.</li>
          <li>HTTPS only; security headers (<code>X-Content-Type-Options</code>, <code>X-Frame-Options: SAMEORIGIN</code>, HSTS) are sent.</li>
        </ul>
        <p>We notify affected users and the competent authority of notifiable breaches within 72 hours.</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="globe" size={18} /> 10 · International transfers</h2>
        <p>Servers and storage may be in a different country from you (for example an S3 bucket in the EU/US). Transfers use contractual safeguards (Standard Contractual Clauses / encryption at rest) and are minimised — offline cache lives on your device, not abroad.</p>
      </section>

      <section className="legal-card">
        <h2><Icon name="info" size={18} /> 11 · Changes to this policy</h2>
        <p>We will update this page and the in-app “Last updated” date when our practices change and, for material changes, surface a notice on sign-in. Review it periodically.</p>
      </section>

      <div className="legal-footer-links">
        <Link to="/terms">Terms of Service</Link>
        <Link to="/cookies">Cookie Policy</Link>
        <Link to="/settings">Manage data &amp; privacy</Link>
        <a href="mailto:inputname9@aol.com">inputname9@aol.com</a>
      </div>
    </div>
  );
}
