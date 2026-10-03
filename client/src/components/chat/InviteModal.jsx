import { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import Modal from '../Modal.jsx';
import { Cover, Spinner } from '../ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { chatApi } from '../../chat.jsx';

/** Invite someone into a party, by artist tag or by name. Members can invite. */
export default function InviteModal({ open, onClose, conversation, onInvited }) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!open) { setQuery(''); return undefined; }
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

  const inParty = new Set((conversation?.members || []).map((person) => person.id));

  const invite = async (person) => {
    setBusy(person.id);
    try {
      // The tag is what the server matches on, so sending it keeps one code path for both.
      const result = await chatApi.addMember(conversation.id, { userId: person.id });
      toast(result.added ? `${person.name} was added` : `${person.name} is already in the party`);
      onInvited?.(result.conversation);
    } catch (err) {
      toast(err.message || 'Could not add that person', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Invite to ${conversation?.title || 'the party'}`} width={440}>
      <div className="new-chat">
        <label className="field">
          <span>Find someone by name or artist tag</span>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="@artisttag or name" />
        </label>
        <div className="new-chat-list">
          {loading && <div className="pad"><Spinner size={18} /></div>}
          {!loading && people.length === 0 && <p className="muted pad">{query ? 'Nobody matches that' : 'No other accounts yet'}</p>}
          {!loading && people.map((person) => (
            <button
              key={person.id}
              className="new-chat-row"
              onClick={() => invite(person)}
              disabled={busy === person.id || inParty.has(person.id)}
            >
              <Cover src={person.avatar_url} alt={person.name} size={40} round />
              <span className="cd-row-meta">
                <strong>{person.name}</strong>
                {person.username && <em>@{person.username}</em>}
              </span>
              {inParty.has(person.id)
                ? <span className="muted">in the party</span>
                : busy === person.id ? <Spinner size={16} /> : <Icon name="plus" size={17} />}
            </button>
          ))}
        </div>
        <p className="cd-foot">
          <Icon name="info" size={13} /> Anyone you add starts seeing the party's messages — and its
          24-hour clock.
        </p>
      </div>
    </Modal>
  );
}
