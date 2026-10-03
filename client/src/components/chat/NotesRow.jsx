import { useState } from 'react';
import Icon from '../Icon.jsx';
import { Cover, Spinner } from '../ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { chatApi, timeLeft } from '../../chat.jsx';

const NOTE_EMOJI = ['🎧', '🔥', '🎶', '✨', '🌊', '🎤', '💜', '🪩', '☕', '🌙'];

/**
 * The row of notes above the chat list. A note is a one-day status line, not a message: it is not
 * addressed to anyone, so it lives 24 hours from posting whether or not anyone looks at it.
 * Yours sits first — that is also where you post or clear it.
 */
export default function NotesRow({ notes = [], me, onOpenConversation, onChanged }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState('');
  const [saving, setSaving] = useState(false);

  const mine = notes.find((note) => note.mine) || null;

  const open = (note) => {
    if (note.mine) {
      setText(note.body || '');
      setEmoji(note.emoji || '');
      setEditing((value) => !value);
      return;
    }
    onOpenConversation(note);
  };

  const save = async () => {
    if (!text.trim() && !emoji) return;
    setSaving(true);
    try {
      await chatApi.postNote(text.trim(), emoji);
      setEditing(false);
      setText('');
      setEmoji('');
      onChanged();
    } catch (err) {
      toast(err.message || 'Could not post that note', 'error');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await chatApi.clearNote();
      setEditing(false);
      onChanged();
    } catch (err) {
      toast(err.message || 'Could not clear that note', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notes-wrap">
      <div className="notes-row scroll-thin">
        <button className={`note-card ${mine ? 'note-card--mine' : ''}`} onClick={() => open({ mine: true })}>
          <span className="note-face">
            <Cover src={me?.avatar_url} alt={me?.name || 'You'} size={48} round />
            <span className="note-emoji">{mine?.emoji || (editing ? '✎' : '+')}</span>
          </span>
          <span className="note-meta">
            <strong>{mine ? 'Your note' : 'Add a note'}</strong>
            <em>{mine ? (mine.body || 'just an emoji') : `@${me?.username || 'you'}`}</em>
          </span>
        </button>

        {notes.filter((note) => !note.mine).map((note) => (
          <button key={note.user.id} className="note-card" onClick={() => open(note)}>
            <span className="note-face">
              <Cover src={note.user.avatar_url} alt={note.user.name} size={48} round />
              {note.emoji && <span className="note-emoji">{note.emoji}</span>}
            </span>
            <span className="note-meta">
              <strong>{note.user.name}</strong>
              <em>{note.body || ' '}</em>
            </span>
            <span className="note-left">{timeLeft(note.expires_at).replace(' left', '')}</span>
          </button>
        ))}
      </div>

      {editing && (
        <div className="note-editor">
          <div className="note-editor-row">
            <span className="note-editor-face">
              <Cover src={me?.avatar_url} alt="You" size={44} round />
              <span className="note-emoji">{emoji || '✎'}</span>
            </span>
            <div className="note-editor-body">
              <input
                autoFocus
                value={text}
                maxLength={80}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') save(); }}
                placeholder="What are you listening to?"
              />
              <div className="note-emoji-row">
                {NOTE_EMOJI.map((entry) => (
                  <button
                    key={entry}
                    className={entry === emoji ? 'active' : ''}
                    onClick={() => setEmoji(entry === emoji ? '' : entry)}
                  >{entry}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="note-editor-actions">
            <span className="muted">Deletes itself 24 hours after you post it.</span>
            <div className="row-gap">
              {mine && (
                <button className="btn btn-ghost btn-sm" onClick={clear} disabled={saving}>Clear</button>
              )}
              <button className="btn btn-primary btn-sm btn-pill" onClick={save} disabled={saving || (!text.trim() && !emoji)}>
                {saving ? <Spinner size={14} /> : <Icon name="check" size={14} />} {mine ? 'Update note' : 'Post note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
