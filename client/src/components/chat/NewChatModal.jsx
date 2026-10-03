import { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import Modal from '../Modal.jsx';
import { Cover, Spinner } from '../ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { chatApi } from '../../chat.jsx';

const TABS = [
  { id: 'dm', label: 'Direct', icon: 'mail' },
  { id: 'party', label: 'Party', icon: 'users' },
  { id: 'channel', label: 'Channel', icon: 'podcast' }
];

/**
 * Starting a conversation, by artist tag or by name.
 *
 *  Direct  — find one person and open the 1:1 chat
 *  Party   — find several and name the group
 *  Channel — start a broadcast, or join one
 *
 * Blocked pairs never appear: the server filters them out of every list here.
 */
export default function NewChatModal({ open, onClose, onPick }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('dm');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [channels, setChannels] = useState([]);
  const [picked, setPicked] = useState([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      const work = tab === 'channel'
        ? chatApi.channels(query).then((rows) => { if (!cancelled) setChannels(rows || []); })
        : chatApi.people(query).then((rows) => { if (!cancelled) setPeople(rows || []); });
      work.catch(() => { if (!cancelled) { setPeople([]); setChannels([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, tab]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setTitle('');
      setPicked([]);
      setTab('dm');
    }
  }, [open]);

  const finish = (conversation) => {
    onPick(conversation);
    onClose();
  };

  const startDm = async (person) => {
    setBusy(person.id);
    try {
      finish(await chatApi.openDm(person.id));
    } catch (err) {
      toast(err.message || 'Could not start that conversation', 'error');
    } finally {
      setBusy(null);
    }
  };

  const startParty = async () => {
    if (!picked.length) return toast('Add at least one person to the party', 'error');
    setBusy('party');
    try {
      finish(await chatApi.createParty(title.trim() || 'New party', picked.map((person) => person.id)));
    } catch (err) {
      toast(err.message || 'Could not start that party', 'error');
    } finally {
      setBusy(null);
    }
  };

  const startChannel = async () => {
    if (title.trim().length < 2) return toast('Give the channel a name', 'error');
    setBusy('channel');
    try {
      finish(await chatApi.createChannel(title.trim()));
    } catch (err) {
      toast(err.message || 'Could not create that channel', 'error');
    } finally {
      setBusy(null);
    }
  };

  const join = async (channel) => {
    setBusy(channel.id);
    try {
      finish(await chatApi.joinChannel(channel.id));
    } catch (err) {
      toast(err.message || 'Could not join that channel', 'error');
    } finally {
      setBusy(null);
    }
  };

  const togglePicked = (person) => {
    setPicked((current) => (
      current.some((row) => row.id === person.id)
        ? current.filter((row) => row.id !== person.id)
        : [...current, person]
    ));
  };

  return (
    <Modal open={open} onClose={onClose} title="New conversation" width={480}>
      <div className="new-chat">
        <div className="new-chat-tabs">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              className={`chat-chip ${tab === entry.id ? 'active' : ''}`}
              onClick={() => { setTab(entry.id); setQuery(''); }}
            >
              <Icon name={entry.icon} size={13} /> {entry.label}
            </button>
          ))}
        </div>

        {tab === 'party' && picked.length > 0 && (
          <div className="party-picked">
            {picked.map((person) => (
              <button key={person.id} className="party-chip" onClick={() => togglePicked(person)}>
                <Cover src={person.avatar_url} alt={person.name} size={22} round />
                {person.name}
                <Icon name="close" size={12} />
              </button>
            ))}
          </div>
        )}

        {tab !== 'channel' && (
          <label className="field">
            <span>Find someone by name or artist tag</span>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="@artisttag or name"
            />
          </label>
        )}

        {tab === 'channel' && (
          <>
            <label className="field">
              <span>Start a channel</span>
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Channel name, e.g. Pulse Radio"
              />
            </label>
            <label className="field">
              <span>Or find one to join</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search channels"
              />
            </label>
          </>
        )}

        {tab !== 'channel' && (
          <div className="new-chat-list">
            {loading && <div className="pad"><Spinner size={18} /></div>}
            {!loading && people.length === 0 && (
              <p className="muted pad">{query ? 'Nobody matches that' : 'No other accounts yet'}</p>
            )}
            {!loading && people.map((person) => {
              const active = picked.some((row) => row.id === person.id);
              return (
                <button
                  key={person.id}
                  className={`new-chat-row ${active ? 'active' : ''}`}
                  onClick={() => (tab === 'party' ? togglePicked(person) : startDm(person))}
                  disabled={busy === person.id}
                >
                  <Cover src={person.avatar_url} alt={person.name} size={40} round />
                  <span className="cd-row-meta">
                    <strong>{person.name}</strong>
                    {person.username && <em>@{person.username}</em>}
                  </span>
                  {busy === person.id
                    ? <Spinner size={16} />
                    : <Icon name={tab === 'party' ? (active ? 'check' : 'plus') : 'arrowRight'} size={17} />}
                </button>
              );
            })}
          </div>
        )}

        {tab === 'channel' && (
          <>
            <button className="btn btn-primary btn-pill" onClick={startChannel} disabled={busy === 'channel'}>
              {busy === 'channel' ? <Spinner size={15} /> : <Icon name="plus" size={15} />} Create channel
            </button>
            <div className="new-chat-list">
              {loading && <div className="pad"><Spinner size={18} /></div>}
              {!loading && channels.filter((row) => !row.joined).length > 0 && (
                <span className="cd-label">Or join one</span>
              )}
              {!loading && channels.filter((row) => !row.joined).map((channel) => (
                <button key={channel.id} className="new-chat-row" onClick={() => join(channel)} disabled={busy === channel.id}>
                  <span className="channel-avatar"><Icon name="podcast" size={18} /></span>
                  <span className="cd-row-meta">
                    <strong>{channel.title}</strong>
                    <em>{channel.member_count} {channel.member_count === 1 ? 'member' : 'members'}</em>
                  </span>
                  {busy === channel.id ? <Spinner size={16} /> : <Icon name="plus" size={17} />}
                </button>
              ))}
              {!loading && channels.filter((row) => !row.joined).length === 0 && (
                <p className="muted pad">No other channels to join yet — start one.</p>
              )}
            </div>
          </>
        )}

        {tab === 'party' && (
          <div className="party-footer">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Party name (optional)"
              aria-label="Party name"
            />
            <button className="btn btn-primary btn-pill" onClick={startParty} disabled={busy === 'party'}>
              {busy === 'party' ? <Spinner size={15} /> : <Icon name="users" size={15} />} Start party
            </button>
          </div>
        )}

        <p className="cd-foot">
          <Icon name="info" size={13} /> Anyone on Pulse can be messaged by their artist tag, and anything
          you send is deleted 24 hours after it is read.
        </p>
      </div>
    </Modal>
  );
}
