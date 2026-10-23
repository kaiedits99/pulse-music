import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiUrl } from '../config.js';

const SEEN_KEY = 'pulse_data_warning_hidden';

/**
 * "Your host is throwing your data away."
 *
 * When Pulse runs somewhere with a temporary disk and no bucket, every deploy, restart or sleep
 * empties the database: accounts stop existing, songs vanish from the catalogue. Nothing in the app
 * looks broken while it happens, so the only way to catch it is to say it plainly, in the app, to the
 * one person who can fix it (the admin). Hidden for the session once dismissed.
 */
export default function DataSafetyBanner() {
  const { user } = useAuth();
  const [safety, setSafety] = useState(null);
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (!user || user.role !== 'admin' || hidden) return undefined;
    let alive = true;
    fetch(apiUrl('/api/health'))
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (alive && body && body.data) setSafety(body.data); })
      .catch(() => { /* a health check that cannot answer has nothing to report */ });
    return () => { alive = false; };
  }, [user, hidden]);

  if (hidden || !safety || safety.persistent !== false) return null;

  return (
    <div className="data-safety" role="alert">
      <span className="ds-icon"><Icon name="warning" size={17} /></span>
      <div className="ds-copy">
        <strong>Your server is not keeping its data</strong>
        <span>{safety.message}</span>
        <span className="ds-fine">
          This is why previous accounts disappeared and uploaded songs went missing after an update — the
          host wipes the disk on every deploy. Attaching storage fixes it permanently; nothing else in Pulse
          needs to change.
        </span>
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Hide for now"
        aria-label="Hide for now"
        onClick={() => {
          try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
          setHidden(true);
        }}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
