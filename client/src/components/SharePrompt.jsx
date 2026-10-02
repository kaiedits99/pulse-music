import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { AUDIO_ACCEPT, stashFiles } from '../uploadHandoff.js';

/**
 * Shown once, right after someone signs in or signs up: an invitation to share some music.
 * It is only an invitation. Saying "Maybe later" (or pressing Esc, or clicking outside) changes nothing
 * about what the person can do: everything other users have shared stays fully available.
 */
export default function SharePrompt() {
  const { sharePrompt, dismissSharePrompt } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pickerRef = useRef(null);

  // No point asking someone who is already uploading, or who has no connection to upload with.
  const unneeded = pathname.startsWith('/upload') || (typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    if (sharePrompt && unneeded) dismissSharePrompt();
  }, [sharePrompt, unneeded, dismissSharePrompt]);

  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // so the same file can be chosen again later
    if (!files.length) return; // the picker was cancelled: keep the prompt open, "Maybe later" is still there
    stashFiles(files);
    dismissSharePrompt();
    navigate('/upload'); // the Upload page picks the files up and shows them ready to publish
  };

  return (
    <Modal open={sharePrompt && !unneeded} onClose={dismissSharePrompt} title="Sharing is caring" width={470}>
      <div className="share-prompt">
        <div className="share-prompt-icon" aria-hidden="true"><Icon name="upload" size={26} /></div>
        <p className="share-prompt-lead">
          Got music of your own? Upload it and everyone on Pulse can discover and play it. That's how this
          community grows.
        </p>
        <div className="share-prompt-actions">
          <button type="button" className="btn btn-primary btn-lg" data-autofocus onClick={() => pickerRef.current?.click()}>
            <Icon name="upload" size={18} /> Choose music files
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={dismissSharePrompt}>Maybe later</button>
        </div>
        <p className="share-prompt-note">
          Totally optional. You'll still have full access to everything other users have shared, and you choose
          whether each track you upload is public or private.
        </p>
        <input ref={pickerRef} type="file" multiple accept={AUDIO_ACCEPT} hidden onChange={onPick} />
      </div>
    </Modal>
  );
}
