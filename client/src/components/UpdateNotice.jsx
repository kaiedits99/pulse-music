import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { checkForUpdate, APP_VERSION, RELEASES_PAGE } from '../appVersion.js';
import { isNative, openExternal } from '../native.js';

const DISMISS_KEY = 'pulse_update_dismissed_v1';

/** Remembered so "not now" means not now — but a *newer* release will speak up again. */
function dismissedVersion() {
  try { return localStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
}

function dismiss(version) {
  try { localStorage.setItem(DISMISS_KEY, version); } catch { /* ignore */ }
}

/**
 * "A newer Pulse is ready."
 *
 * Only shown inside the installed Android app: the website and the Windows app are always the newest
 * version because they load the live site, while the phone app carries its interface inside the APK
 * and can only be updated by installing a new one. The install prompt itself belongs to Android, so
 * the button opens the APK download and the system installer takes over.
 */
export default function UpdateNotice() {
  const [update, setUpdate] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isNative()) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      checkForUpdate().then((found) => {
        if (!alive || !found) return;
        if (dismissedVersion() === found.version) return;
        setUpdate(found);
      });
    }, 2500); // after the first screen has painted: an update is never urgent
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  if (!isNative() || !update || hidden) return null;

  const open = async () => {
    setChecking(true);
    await openExternal(update.url || RELEASES_PAGE);
    setChecking(false);
  };

  return (
    <div className="update-notice" role="status">
      <span className="un-icon"><Icon name="download" size={16} /></span>
      <div className="un-copy">
        <strong>Pulse {update.version} is ready</strong>
        <span>You have {APP_VERSION}. Installing it takes a moment and keeps your account and downloads.</span>
      </div>
      <div className="un-actions">
        <button type="button" className="btn btn-primary btn-sm btn-pill" onClick={open} disabled={checking}>
          {checking ? 'Opening…' : 'Download'}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => { dismiss(update.version); setHidden(true); }}
          title="Not now"
          aria-label="Not now"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
