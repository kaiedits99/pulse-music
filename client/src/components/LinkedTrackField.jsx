import { useState } from 'react';
import Icon from './Icon.jsx';
import { Spinner } from './ui.jsx';
import { api } from '../api.js';

/**
 * Paste a track link → ask the server whether it can be played.
 *
 * YouTube links come back resolved (title, channel, artwork) and are stored as a
 * linked track that plays in YouTube's own player. Everything else — Spotify, Apple
 * Music, Audiomack … — is refused with the reason, instead of being saved as a track
 * that silently fails to play.
 */
export default function LinkedTrackField({ linked, onResolved, onClear }) {
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const check = async () => {
    const value = url.trim();
    if (!value) { setError('Paste a link first.'); return; }
    setChecking(true);
    setError('');
    try {
      const preview = await api.post('/api/link-preview', { url: value });
      onResolved(preview);
      setUrl('');
    } catch (err) {
      setError(err.message || 'That link could not be used.');
    } finally {
      setChecking(false);
    }
  };

  if (linked && linked.external_id) {
    return (
      <div className="linked-field linked-field--ready">
        {linked.cover_url
          ? <img className="linked-thumb" src={linked.cover_url} alt="" />
          : <span className="linked-thumb linked-thumb--empty"><Icon name="music" size={20} /></span>}
        <div className="linked-meta">
          <strong>{linked.title || 'YouTube video'}</strong>
          <span>{linked.artist || 'YouTube'}</span>
          <span className="linked-note">
            {linked.metadata_found === false
              ? "YouTube didn't return the video's details — add a title and artist below."
              : "Plays in YouTube's player · no offline download"}
          </span>
        </div>
        <button type="button" className="icon-btn" onClick={onClear} title="Remove linked track" aria-label="Remove linked track">
          <Icon name="close" size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="linked-field">
      <div className="linked-input-row">
        <input
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); if (error) setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } }}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="Track link"
        />
        <button type="button" className="btn btn-ghost btn-sm btn-pill" onClick={check} disabled={checking}>
          {checking ? <><Spinner size={15} /> Checking</> : <><Icon name="search" size={15} /> Check link</>}
        </button>
      </div>
      {error
        ? <small className="linked-error" role="alert">{error}</small>
        : <small className="muted">YouTube videos play through YouTube's embedded player. Spotify, Apple Music and other streaming links can't be played — upload that audio instead.</small>}
    </div>
  );
}
