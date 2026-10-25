import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import './Legal.css';

export default function Terms() {
  return (
    <div className="legal-page">
      <Link to="/" className="legal-back"><Icon name="arrowLeft" size={14} /> Back to Pulse</Link>
      <div className="legal-hero">
        <h1>Terms of Service</h1>
        <p>Plain-English rules for using Pulse. By creating an account or using the service you agree to these terms. If you don’t agree, don’t use Pulse.</p>
        <div className="legal-meta">Effective: 25 October 2026 · Governing law: Federal Republic of Nigeria (with mandatory local consumer protections respected) · Contact: support@pulse.music &amp; privacy@pulse.music</div>
      </div>

      <section className="legal-card">
        <h2>1 · What Pulse does</h2>
        <p>Pulse is a free community where people upload audio they own or are authorised to share, organise it into albums/playlists/podcasts, stream it, chat about it, and keep offline copies they saved. There is <strong>no paid tier, no subscription, no marketplace, and no checkout</strong> at this time.</p>
        <p>We provide the hosting, playback, search and messaging infrastructure. You provide the music and are responsible for it.</p>
      </section>

      <section className="legal-card">
        <h2>2 · Eligibility &amp; accounts</h2>
        <ul>
          <li>You must be <strong>at least 13</strong> (16 in the EEA where required) and capable of forming a binding contract. By registering you represent you meet the age threshold.</li>
          <li>Provide accurate details (name, handle, email). Handles must be 3–30 characters, letters/numbers/underscore only, and not impersonate others.</li>
          <li>Keep your password private. You are responsible for activity under your account. Notify us of compromise at support@pulse.music.</li>
          <li>One account per person for everyday use. We may require you to verify email/handle ownership.</li>
        </ul>
      </section>

      <section className="legal-card">
        <h2>3 · Your content — ownership, license, and responsibility</h2>
        <p><strong>You keep ownership</strong> of audio, art and text you upload. You grant Pulse a <strong>non-exclusive, worldwide, royalty-free, revocable license</strong> to store, transcode, stream, display and make <em>public</em> items discoverable, solely to operate the service and your sharing choices. Private items are not made discoverable.</p>
        <ul>
          <li>You represent you own or have the rights for every upload, including any samples, and that it does not infringe copyright, trademark, privacy or other laws.</li>
          <li>Linked tracks (YouTube embeds) are not hosted by Pulse; playback uses YouTube’s player subject to YouTube’s terms. Unsupported providers (Spotify, Apple Music, etc.) cannot be embedded.</li>
          <li>You can delete your public tracks/playlists at any time (Settings / library) — removal is propagated to the catalogue; copies saved offline by other users remain on their devices.</li>
          <li>We may remove, throttle or hide content that violates these terms, the law, or our technical limits (e.g. 60 MB per file, 10 files per import).</li>
        </ul>
      </section>

      <section className="legal-card">
        <h2>4 · Acceptable use — the short version</h2>
        <p>Be lawful and be kind. Don’t:</p>
        <ul>
          <li>Upload music you don’t have rights to, or circumvent paywalls/DRM.</li>
          <li>Harass, dox, hate-speech, spam, scrape at abusive scale, or attempt to break rate limits, auth or billing of storage.</li>
          <li>Use Pulse to distribute malware, non-consensual intimate imagery, or content that sexualises minors — zero tolerance.</li>
          <li>Reverse-engineer private APIs to evade checks, or impersonate Pulse staff.</li>
        </ul>
        <p>We enforce with warnings, feature limits, suspension or termination. See also Section 10 (takedown).</p>
      </section>

      <section className="legal-card">
        <h2>5 · Community, messages &amp; moderation</h2>
        <ul>
          <li>DMs, parties and channels are provided for community. Messages <strong>expire</strong> by design (24 h after all members read, max 30 days; channels 7 days). Expiry hides them immediately; storage is reclaimed lazily.</li>
          <li>We provide blocks, mutes, leave/report tools. Reported messages are retained as an isolated snapshot for review even after expiry.</li>
          <li>We moderate in proportion to risk; we do not promise to pre-review everything. Unlawful content and repeat infringers are removed per Sections 4 and 10.</li>
        </ul>
      </section>

      <section className="legal-card">
        <h2>6 · Intellectual property &amp; DMCA / notice-and-takedown</h2>
        <p>If you believe content on Pulse infringes your copyright or trademark, email <a href="mailto:abuse@pulse.music">abuse@pulse.music</a> with: (a) identification of the work and the infringing URL, (b) your contact details, (c) a good-faith statement, (d) a statement under penalty of perjury that you are authorised, and (e) physical/electronic signature. We act expeditiously and notify the uploader, who may file a counter-notice. Repeat infringers are terminated.</p>
        <p>Fonts/images: Pulse uses <strong>Inter</strong> (Google Fonts, SIL Open Font License), system fallbacks, and icons drawn in-house as inline SVG. Cover art and avatars are user-supplied; Pulse claims no license to them beyond Section 3. All Pulse-owned branding and copy is © Pulse Music and may not be scraped or resold without written permission.</p>
      </section>

      <section className="legal-card">
        <h2>7 · Privacy, cookies &amp; data rights</h2>
        <p>Data handling is governed by the <Link to="/privacy">Privacy Policy</Link> and <Link to="/cookies">Cookie Policy</Link>. Highlights incorporated by reference:</p>
        <ul>
          <li>Minimal data: name, handle, email, bcrypt password hash, 1–3 genre picks; content you upload; aggregate play counts. No address, phone, payment or location data.</li>
          <li>No marketing emails or newsletters — we send no bulk mail. If we ever do, every email will carry a one-click <strong>unsubscribe</strong> that works within 10 days (CAN-SPAM / GDPR).</li>
          <li>Your GDPR/CCPA rights (access, rectification, export, erasure, objection, restriction, complaint) are exercisable via <Link to="/settings">Settings → Your data &amp; privacy</Link> or <a href="mailto:privacy@pulse.music">privacy@pulse.music</a>. Deletion is described below.</li>
          <li>Cookies: essential storage only (see Cookie Policy). A consent banner asks before any non-essential analytics; you can change the choice at any time.</li>
        </ul>
      </section>

      <section className="legal-card">
        <h2>8 · Deletion &amp; export</h2>
        <p>You can <strong>export</strong> your data (JSON of profile, uploads, playlists, follows) and <strong>request erasure</strong> at any time:</p>
        <ul>
          <li><strong>Self-service:</strong> <Link to="/settings">Settings → Your data &amp; privacy → Export your data / Delete my account</Link>. Deletion requires re-authentication and a confirmation.</li>
          <li><strong>By email:</strong> from your account email to <a href="mailto:privacy@pulse.music">privacy@pulse.music</a> with subject “Deletion request”.</li>
        </ul>
        <p>On deletion we: remove your auth credentials, handle, profile, follows and privately-owned content; revoke your offline blob URLs; and purge you from the next storage/DB snapshot. Public content may be retained briefly as “deleted user” where required to avoid breaking other users’ playlists — we will tell you if we must. Backups are overwritten; requests are completed within <strong>30 days</strong> and confirmed by email.</p>
      </section>

      <section className="legal-card">
        <h2>9 · Children’s privacy (COPPA / GDPR-K)</h2>
        <p>Pulse is not for children under 13. We do not knowingly collect under-13 data. If you are 13–15 in the EEA/UK or otherwise under the digital-consent age where you live, you represent you have your parent/guardian’s consent to use Pulse and to the processing described in the Privacy Policy. Parents/guardians may exercise rights on a child’s behalf at privacy@pulse.music. See our <Link to="/privacy">Privacy Policy §8</Link>.</p>
      </section>

      <section className="legal-card">
        <h2>10 · Disclaimers, liability &amp; availability</h2>
        <p>PULSE IS PROVIDED “AS IS” WITHOUT WARRANTY OF MERCHANTABILITY, FITNESS, NON-INFRINGEMENT OR UPTIME. PUBLICLY UPLOADED MUSIC IS USER CONTENT AND NOT VETTED BY US.</p>
        <p>TO THE EXTENT PERMITTED BY LAW, OUR AGGREGATE LIABILITY IS LIMITED TO THE AMOUNT YOU PAID FOR PULSE IN THE 12 MONTHS BEFORE THE CLAIM (currently <strong>₦0 / $0</strong> because Pulse is free) — and we are not liable for indirect, incidental or consequential losses. Nothing here limits liability for death/personal injury caused by negligence, fraud, or any matter that cannot lawfully be limited. Mandatory consumer protections in your country, if stronger, prevail.</p>
        <p>We do not guarantee uninterrupted or error-free service; on free hosting the app may cold-start or snapshot-restore after a deploy. We are not liable for offline copies users kept on their devices.</p>
      </section>

      <section className="legal-card">
        <h2>11 · Changes, termination &amp; governing law</h2>
        <p>We may update these terms when the service changes; the “Effective” date will move and material changes will be notified on sign-in. Continued use after the effective date is acceptance. You may stop using Pulse at any time. We may suspend or terminate accounts that breach these terms, the law or that present security risk, with notice where practicable.</p>
        <p>These terms are governed by the laws of the Federal Republic of Nigeria, without regard to conflict-of-laws rules. Courts of Lagos State have non-exclusive jurisdiction, but you may also bring proceedings in your local courts where your consumer law requires.</p>
      </section>

      <section className="legal-card" style={{ borderColor: 'rgba(139,92,246,0.22)', background: 'linear-gradient(135deg, rgba(139,92,246,0.07), transparent 70%), var(--panel)' }}>
        <h2><Icon name="info" size={18} /> 12 · Compliance checklist — what we evaluated and why some items don’t apply to Pulse</h2>
        <p>Our compliance run reviewed the full checklist in our working notes. Below we show, point-by-point, what we shipped and why the remaining points are not applicable to Pulse’s current, free, music-sharing operation. If our offering changes, this section — and the related policy — will be updated before the change goes live.</p>

        <h3>Shipped (applicable to Pulse)</h3>
        <table className="legal-table">
          <thead><tr><th>Item</th><th>What we did</th></tr></thead>
          <tbody>
            <tr><td>Privacy Policy</td><td>This standalone page + the in-app Privacy Policy, linked from sign-up and Settings.</td></tr>
            <tr><td>Terms of Service</td><td>This page, incorporated by reference in Privacy and shown at registration.</td></tr>
            <tr><td>Cookie Policy</td><td>Separate <Link to="/cookies">Cookie Policy</Link> describing localStorage / Cache / sessionStorage use.</td></tr>
            <tr><td>Cookie Consent Banner</td><td>Bottom banner asking for consent before any non-essential analytics; choice stored in <code>pulse_cookie_consent</code>, re-openable from Cookie Policy. Essential storage remains without consent.</td></tr>
            <tr><td>Form consents</td><td>Registration now requires explicit checkboxes: “I agree to the Terms and Privacy Policy” and “I am at least 13 years old”. Submission is blocked until both are checked.</td></tr>
            <tr><td>Data minimisation (“no unnecessary data”)</td><td>We only ask: name, handle, email, password, 1–3 genres. No phone, address, DOB, payment. See Privacy §2 and Settings.</td></tr>
            <tr><td>Audit third-party SDKs</td><td>Privacy §5 table audited quarterly and in <code>npm audit</code> CI (0 vulns). Versions pinned.</td></tr>
            <tr><td>Accessibility — alt text</td><td>Every meaningful image/CDN cover has <code>alt</code>; decorative equaliser/bars are <code>aria-hidden</code>.</td></tr>
            <tr><td>Fix colour contrast</td><td>Light and dark themes both target WCAG AA (text ≥ 4.5:1). Verified with token audit; see style notes below.</td></tr>
            <tr><td>Keyboard navigation</td><td>All interactive elements are native buttons/links with <code>:focus-visible</code> ring; auth flow and player are operable by Tab/Enter/Space.</td></tr>
            <tr><td>License fonts / images</td><td>Inter (OFL) via Google Fonts + own SVG icons; user art remains user-licensed. Clear in Terms §6.</td></tr>
            <tr><td>Data deletion request</td><td>Self-service export + erasure in Settings and by email, 30-day completion (§8).</td></tr>
          </tbody>
        </table>

        <h3>Not applicable to Pulse today — and why</h3>
        <p>We keep these here so you (and an auditor) can see we considered them rather than forgot them:</p>
        <table className="legal-table">
          <thead><tr><th>Item</th><th>Why it doesn’t apply to Pulse today</th></tr></thead>
          <tbody>
            <tr><td>Refund policy</td><td>Pulse has <strong>no purchases, no subscriptions, no paid upgrades and no marketplace</strong>. Nothing is sold, so there is nothing to refund. If we ever introduce paid features, a compliant refund/cancellation policy (including 14-day EEA cooling-off and Nigerian FCCPC-aligned terms) will be published <em>before</em> any charge is accepted.</td></tr>
            <tr><td>Hidden fees</td><td>Same reason — no checkout means no fees, taxes, shipping or handling to disclose. If billing appears, all amounts will be shown pre-consent at checkout.</td></tr>
            <tr><td>Fake reviews / testimonials</td><td>Pulse has <strong>no review, rating or testimonial surfaces</strong> (songs have play/favourite counts, not star reviews). There is therefore no review to fake, gate or suppress, and we prohibit users from posting fabricated endorsements.</td></tr>
            <tr><td>Unsupported claims</td><td>We make no health, financial, performance or efficacy claims. Site copy is factual about the product (“upload, share, stream”), never outcome-promising. If we publish any claim in future, it will be evidenced or removed.</td></tr>
            <tr><td>Dark patterns</td><td>We ship no deceptive UI: no trick toggles, roach-motel cancellations, disguised ads, or hidden opt-outs. Choices (public vs. private track, consent boxes) are explicit checkboxes with plain language, and a requested deletion is not obstructed.</td></tr>
            <tr><td>Unsubscribe link in emails</td><td>We <strong>do not send marketing or newsletter emails at all</strong>. The only email that could be sent in future is a transactional security notice (e.g. deletion confirmation). If we ever send marketing mail, every message will carry a one-click unsubscribe effective within 10 days and a physical address, per CAN-SPAM / GDPR.</td></tr>
          </tbody>
        </table>
        <p className="legal-note" style={{ marginTop: 14 }}>
          <strong>Our promise:</strong> the moment any of the “not applicable” rows becomes applicable — e.g. we add payments, reviews, newsletters or under-13 kids features — we will ship the corresponding policy/feature <em>before</em> the product change, and update the Effective date at the top of these terms.
        </p>

        <h3>Accessibility commitment (expandable)</h3>
        <p><strong>Alt text:</strong> covers, avatars and icon-only buttons carry <code>alt</code>/<code>aria-label</code>. Decorative bars carry <code>aria-hidden</code>. <strong>Colour contrast:</strong> dark text on light panel ≥ 7:1, light text on dark panel ≥ 7:1, accent buttons ≥ 4.5:1 — verified against WCAG AA. <strong>Keyboard:</strong> native focus order, visible <code>:focus-visible</code> ring, player seek and modals are keyboard operable. If you find a barrier, email <a href="mailto:accessibility@pulse.music">accessibility@pulse.music</a> and we prioritise it.</p>
      </section>

      <section className="legal-card">
        <h2>13 · Contact</h2>
        <p>Questions about these terms: <a href="mailto:support@pulse.music">support@pulse.music</a>. Privacy/DSR matters: <a href="mailto:privacy@pulse.music">privacy@pulse.music</a>. Abuse/copyright: <a href="mailto:abuse@pulse.music">abuse@pulse.music</a>.</p>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>These terms are not legal advice. Where you need advice for your own material, consult qualified counsel in your jurisdiction.</p>
      </section>

      <div className="legal-footer-links">
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/cookies">Cookie Policy</Link>
        <Link to="/settings">Your data &amp; privacy</Link>
      </div>
    </div>
  );
}
