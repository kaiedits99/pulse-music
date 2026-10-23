import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiUrl } from '../config.js';

const SEEN_KEY = 'pulse_data_warning_hidden';

/**
 * "Your host is throwing part of your data away."
 *
 * Pulse stores two things and keeps them two different ways: uploaded audio goes to a bucket as it
 * arrives, while accounts and songs live in the database, which only survives if it is on a real disk
 * or copied to the bucket by Litestream. A deployment can therefore report a healthy bucket while
 * losing every account — so the banner reports the two halves separately instead of a single verdict.
 *
 * Shown to the admin only (they are the one who can change the hosting), hidden for the session once
 * dismissed, and never shown when both halves are safe.
 */
function Half({ ok, label, detail }) {
  return (
    <div className={`ds-half ${ok ? 'ds-half-ok' : 'ds-half-bad'}`}>
      <Icon name={ok ? 'checkCircle' : 'warning'} size={14} />
      <span>
        <strong>{label}</strong> — {detail}
      </span>
    </div>
  );
}

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

  const uploadsOk = Boolean(safety.uploads?.durable);
  const databaseOk = Boolean(safety.database?.durable);
  const half = uploadsOk && !databaseOk;

  return (
    <div className="data-safety" role="alert">
      <span className="ds-icon"><Icon name="warning" size={17} /></span>
      <div className="ds-copy">
        <strong>
          {half
            ? 'Your uploaded audio is safe — your accounts and songs are not'
            : 'Your server is not keeping its data'}
        </strong>

        <div className="ds-halves">
          <Half
            ok={uploadsOk}
            label="Audio files"
            detail={uploadsOk ? `kept in ${safety.uploads.where === 'bucket' ? 'your bucket' : 'a disk'}` : 'erased on every deploy'}
          />
          <Half
            ok={databaseOk}
            label="Accounts, songs, messages"
            detail={databaseOk ? 'kept on a disk' : 'erased on every deploy'}
          />
        </div>

        <span>{safety.message}</span>
        <span className="ds-fine">
          {half
            ? 'This is why people had to sign up again after an update while some audio files were still '
              + 'there: the bucket kept the files, but nothing was keeping the database. Fixing the start '
              + 'command is a one-line change in Render.'
            : 'This is why previous accounts disappeared and uploaded songs went missing after an update — the '
              + 'host wipes the disk on every deploy. Attaching storage fixes it permanently; nothing else in '
              + 'Pulse needs to change.'}
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
