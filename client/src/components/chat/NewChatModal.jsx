import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import Icon from '../Icon.jsx';
import { Cover, Spinner } from '../ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { chatApi } from '../../chat.jsx';

/** Pick someone to talk to. Blocked pairs never appear — the server filters them out. */
export default function NewChatModal({ open, onClose, onPick }) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      chatApi.people(query)
        .then((rows) => { if (!cancelled) setPeople(rows || []); })
        .catch(() => { if (!cancelled) setPeople([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query]);

  const start = async (person) => {
    setStarting(person.id);
    try {
      const conversation = await chatApi.openDm(person.id);
      onPick(conversation);
      onClose();
      setQuery('');
    } catch (err) {
      // The one likely failure is a block, and its message explains itself.
      toast(err.message || 'Could not start that conversation', 'error');
    } finally {
      setStarting(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New message" width={460}>
      <div className="new-chat">
        <label className="field">
          <span>Find someone</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or @username"
          />
        </label>

        <div className="new-chat-list">
          {loading && <div className="pad"><Spinner size={18} /></div>}
          {!loading && people.length === 0 && (
            <p className="muted pad">{query ? 'Nobody matches that name' : 'No other accounts yet'}</p>
          )}
          {!loading && people.map((person) => (
            <button key={person.id} className="new-chat-row" onClick={() => start(person)} disabled={starting === person.id}>
              <Cover src={person.avatar_url} alt={person.name} size={40} round />
              <span className="cd-row-meta">
                <strong>{person.name}</strong>
                {person.username && <em>@{person.username}</em>}
              </span>
              {starting === person.id ? <Spinner size={16} /> : <Icon name="arrowRight" size={17} />}
            </button>
          ))}
        </div>

        <p className="cd-foot">
          <Icon name="info" size={13} /> Anyone on Pulse can be messaged, and anything you send is deleted
          24 hours after it is read.
        </p>
      </div>
    </Modal>
  );
}
