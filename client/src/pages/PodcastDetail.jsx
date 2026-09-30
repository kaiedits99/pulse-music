import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import EpisodeRow from '../components/EpisodeRow.jsx';
import { CollectionCard } from '../components/Cards.jsx';
import { Cover, EmptyState, SectionHead, Skeleton, SortMenu } from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { PodcastFormModal, EpisodeFormModal } from '../components/PodcastForms.jsx';
import { api } from '../api.js';
import { apiUrl } from '../config.js';
import { openExternal } from '../native.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useEpisodeSaveToggle } from '../hooks/useEpisodeActions.js';
import { EPISODES_EVENT, episodesToTracks, resumeAt, setPodcastSubscribed } from '../episodes.js';
import { formatLongDuration, formatNumber, timeAgo } from '../format.js';

const ORDERS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' }
];

export default function PodcastDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { play, current, isPlaying, togglePlay } = usePlayer();
  const { toast } = useToast();
  const { user } = useAuth();
  const toggleSave = useEpisodeSaveToggle();

  const [show, setShow] = useState(null);
  const [others, setOthers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState('newest');
  const [editOpen, setEditOpen] = useState(false);
  const [episodeOpen, setEpisodeOpen] = useState(false);
  const [deletingShow, setDeletingShow] = useState(false);
  const [deletingEpisode, setDeletingEpisode] = useState(null);

  /* ------------------------------------------------------------- loading */
  const load = useCallback(async () => {
    try {
      const detail = await api.get(`/api/podcasts/${id}?order=${order}`);
      setShow(detail);
    } catch (err) {
      toast(err.message || 'Could not load this show', 'error');
      setShow(null);
    } finally {
      setLoading(false);
    }
  }, [id, order, toast]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    api.get('/api/podcasts?sort=popular')
      .then((d) => setOthers((d?.podcasts || []).filter((p) => String(p.id) !== String(id)).slice(0, 6)))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    const cb = () => load();
    window.addEventListener(EPISODES_EVENT, cb);
    return () => window.removeEventListener(EPISODES_EVENT, cb);
  }, [load]);

  /* ------------------------------------------------------------- actions */
  const episodes = useMemo(() => show?.episodes || [], [show]);
  const isCurrent = (episode) => current?.kind === 'episode' && current.episode_id === episode.id;

  const playEpisode = useCallback((episode) => {
    if (!episode.file_path) { toast('This episode has no audio yet', 'error'); return; }
    if (isCurrent(episode)) { togglePlay(); return; }
    const queue = episodesToTracks(episodes, show);
    const index = Math.max(0, queue.findIndex((t) => t.episode_id === episode.id));
    play(queue, index, resumeAt(episode));
    toast(resumeAt(episode) > 0 ? `Resuming “${episode.title}”` : `Playing “${episode.title}”`);
  }, [episodes, show, current, play, togglePlay, toast]);

  const playLatest = useCallback(() => {
    const first = episodes[0];
    if (!first) { toast('This show has no episodes yet', 'info'); return; }
    playEpisode(first);
  }, [episodes, playEpisode, toast]);

  const toggleSubscribe = useCallback(async () => {
    if (!show) return;
    const next = !show.subscribed;
    setShow((s) => ({ ...s, subscribed: next, subscribers: (s.subscribers || 0) + (next ? 1 : -1) }));
    try {
      await setPodcastSubscribed(show.id, next);
      toast(next ? `Following “${show.title}”` : `Unfollowed “${show.title}”`, next ? 'success' : 'info');
    } catch (err) {
      setShow((s) => ({ ...s, subscribed: !next }));
      toast(err.message || 'Could not update this subscription', 'error');
    }
  }, [show, toast]);

  const downloadEpisode = useCallback((episode) => {
    openExternal(apiUrl(`/api/episodes/${episode.id}/download`));
    toast(`Downloading “${episode.title}”`);
  }, [toast]);

  const shareShow = useCallback(async () => {
    if (!show) return;
    const url = `${window.location.origin}/podcasts/${show.id}`;
    try {
      if (navigator.share) { await navigator.share({ title: show.title, text: `${show.title} on Pulse`, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    } catch { toast('Could not share this show', 'error'); }
  }, [show, toast]);

  const deleteEpisode = useCallback(async (episode) => {
    try {
      await api.del(`/api/episodes/${episode.id}`);
      toast(`Deleted “${episode.title}”`, 'info');
      load();
    } catch (err) { toast(err.message || 'Could not delete this episode', 'error'); }
  }, [load, toast]);

  const deleteShow = useCallback(async () => {
    try {
      await api.del(`/api/podcasts/${show.id}`);
      toast(`Deleted “${show.title}”`, 'info');
      navigate('/podcasts');
    } catch (err) { toast(err.message || 'Could not delete this show', 'error'); }
  }, [show, navigate, toast]);

  /* -------------------------------------------------------------- render */
  if (loading) {
    return (
      <div className="page">
        <div className="detail-hero">
          <Skeleton w={208} h={208} r={16} />
          <div className="stack" style={{ flex: 1 }}>
            <Skeleton w="55%" h={40} /><Skeleton w="35%" h={16} /><Skeleton w="45%" h={16} />
          </div>
        </div>
      </div>
    );
  }

  if (!show) {
    return (
      <div className="page">
        <EmptyState
          icon="podcast"
          title="Show not found"
          description="This podcast may have been removed."
          action={<Link className="btn btn-primary" to="/podcasts">Back to podcasts</Link>}
        />
      </div>
    );
  }

  const played = episodes.filter((e) => e.completed).length;

  return (
    <div className="page">
      <Link to="/podcasts" className="back-link"><Icon name="arrowLeft" size={16} /> Podcasts</Link>

      <div className="detail-hero">
        <div className="detail-hero-art">
          <Cover src={show.cover_url} alt={show.title} size="100%" />
        </div>
        <div className="detail-hero-info">
          <span className="eyebrow"><Icon name="podcast" size={13} /> Podcast</span>
          <h1>{show.title}</h1>
          <p className="detail-hero-sub">
            {show.publisher || 'Independent'}
            {show.category && <><span className="cc-meta-dot" /><span className="tag tag-accent">{show.category}</span></>}
            <span className="cc-meta-dot" />
            {show.episode_count} episode{show.episode_count === 1 ? '' : 's'}
            {show.total_duration > 0 && <><span className="cc-meta-dot" />{formatLongDuration(show.total_duration)}</>}
            <span className="cc-meta-dot" />
            {formatNumber(show.subscribers || 0)} follower{show.subscribers === 1 ? '' : 's'}
            {played > 0 && <><span className="cc-meta-dot" /><span className="tag tag-green">{played} played</span></>}
          </p>
          {show.description && <p className="detail-hero-bio">{show.description}</p>}

          <div className="detail-actions">
            <button className="btn btn-play" onClick={playLatest} disabled={!episodes.length}>
              <Icon name="play" size={18} /> Play latest
            </button>
            {user && (
              <button
                className={`btn btn-pill ${show.subscribed ? 'btn-soft' : 'btn-ghost'}`}
                onClick={toggleSubscribe}
              >
                <Icon name={show.subscribed ? 'checkCircle' : 'plus'} size={16} />
                {show.subscribed ? 'Following' : 'Follow'}
              </button>
            )}
            <button className="btn btn-ghost btn-pill" onClick={shareShow}>
              <Icon name="share" size={16} /> Share
            </button>
            {show.can_manage && (
              <>
                <button className="btn btn-ghost btn-pill" onClick={() => setEpisodeOpen(true)}>
                  <Icon name="upload" size={16} /> New episode
                </button>
                <button className="hero-icon-btn" onClick={() => setEditOpen(true)} title="Edit show" aria-label="Edit show">
                  <Icon name="edit" size={17} />
                </button>
                <button className="hero-icon-btn danger" onClick={() => setDeletingShow(true)} title="Delete show" aria-label="Delete show">
                  <Icon name="trash" size={17} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <section className="section">
        <SectionHead
          icon="mic"
          title="Episodes"
          note={show.latest_published_at ? `Latest ${timeAgo(show.latest_published_at) || 'recently'}` : `${episodes.length} total`}
          action={<SortMenu options={ORDERS} value={order} onChange={setOrder} label="Order" />}
        />

        {episodes.length === 0 ? (
          <EmptyState
            icon="mic"
            title="No episodes yet"
            description={show.can_manage
              ? 'Upload your first episode and it will appear here instantly.'
              : 'This show has not published an episode yet. Follow it to hear the first one.'}
            action={show.can_manage
              ? <button className="btn btn-primary" onClick={() => setEpisodeOpen(true)}><Icon name="upload" size={16} /> Upload episode</button>
              : user ? <button className="btn btn-primary" onClick={toggleSubscribe}><Icon name="plus" size={16} /> Follow show</button> : null}
          />
        ) : (
          <div className="episode-list">
            {episodes.map((ep) => (
              <EpisodeRow
                key={ep.id}
                episode={ep}
                showLink={false}
                isCurrent={isCurrent(ep)}
                isPlaying={isPlaying}
                onPlay={playEpisode}
                onToggleSave={user ? ((e) => toggleSave(e).then(load)) : undefined}
                onDownload={downloadEpisode}
                onDelete={setDeletingEpisode}
                canManage={!!show.can_manage}
              />
            ))}
          </div>
        )}
      </section>

      {others.length > 0 && (
        <section className="section">
          <SectionHead icon="compass" title="More shows to follow" note="Popular on Pulse" />
          <div className="collection-grid">
            {others.map((other) => (
              <CollectionCard
                key={other.id}
                to={`/podcasts/${other.id}`}
                type="Podcast"
                typeTone="accent"
                cover={other.cover_url}
                title={other.title}
                subtitle={`${other.publisher || 'Independent'}${other.category ? ` • ${other.category}` : ''}`}
                meta={{ icon: 'mic', text: `${other.episode_count} episode${other.episode_count === 1 ? '' : 's'}` }}
                chip={other.subscribed ? 'FOLLOWING' : undefined}
                onPlay={() => navigate(`/podcasts/${other.id}`)}
                playLabel={`Open ${other.title}`}
              />
            ))}
          </div>
        </section>
      )}

      <PodcastFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => load()}
        podcast={show}
      />
      <EpisodeFormModal
        open={episodeOpen}
        onClose={() => setEpisodeOpen(false)}
        onSaved={() => load()}
        podcast={show}
      />
      <ConfirmDialog
        open={deletingShow}
        onClose={() => setDeletingShow(false)}
        onConfirm={deleteShow}
        title="Delete show"
        message={`Delete “${show.title}” and all of its episodes? This cannot be undone.`}
      />
      <ConfirmDialog
        open={!!deletingEpisode}
        onClose={() => setDeletingEpisode(null)}
        onConfirm={() => deletingEpisode && deleteEpisode(deletingEpisode)}
        title="Delete episode"
        message={deletingEpisode ? `Delete “${deletingEpisode.title}”? This cannot be undone.` : ''}
      />
    </div>
  );
}
