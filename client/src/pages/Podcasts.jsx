import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import {
  PageHero, SectionHead, FilterChips, SortMenu, ViewToggle,
  EmptyState, GridSkeleton, RowSkeleton
} from '../components/ui.jsx';
import { CollectionCard, LibraryRow } from '../components/Cards.jsx';
import EpisodeRow from '../components/EpisodeRow.jsx';
import { PodcastFormModal } from '../components/PodcastForms.jsx';
import { api } from '../api.js';
import { apiUrl } from '../config.js';
import { openExternal } from '../native.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useEpisodeSaveToggle } from '../hooks/useEpisodeActions.js';
import {
  EPISODES_EVENT, episodeToTrack, episodesToTracks, resumeAt, setPodcastSubscribed
} from '../episodes.js';
import { formatLongDuration, formatNumber } from '../format.js';

const FILTERS = [
  { id: 'all', label: 'All Shows' },
  { id: 'subscribed', label: 'Following', icon: 'check', iconGreen: true },
  { id: 'saved', label: 'Your Episodes' },
  { id: 'mine', label: 'Your Shows' }
];

const SORTS = [
  { id: 'newest', label: 'Newest episode' },
  { id: 'title', label: 'A–Z' },
  { id: 'episodes', label: 'Most episodes' },
  { id: 'popular', label: 'Most followed' }
];

const VIEW_KEY = 'pulse_podcasts_view';

export default function Podcasts() {
  const [params, setParams] = useSearchParams();
  const { play, current, isPlaying, togglePlay } = usePlayer();
  const { toast } = useToast();
  const { user } = useAuth();
  const toggleSave = useEpisodeSaveToggle();

  const filter = params.get('filter') || 'all';
  const category = params.get('category') || 'all';
  const [sort, setSort] = useState('newest');
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || 'grid'; } catch { return 'grid'; }
  });

  const [shows, setShows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [latest, setLatest] = useState([]);
  const [continuing, setContinuing] = useState([]);
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  /* ------------------------------------------------------------- loading */
  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams();
    if (sort) query.set('sort', sort);
    if (category && category !== 'all') query.set('category', category);
    if (filter === 'subscribed') query.set('subscribed', '1');
    if (filter === 'mine') query.set('mine', '1');

    const [showData, latestEps, continueEps, savedEps] = await Promise.all([
      api.get(`/api/podcasts?${query.toString()}`).catch(() => ({ podcasts: [], categories: [] })),
      api.get('/api/episodes?limit=6').catch(() => []),
      api.get('/api/episodes?continue=1&limit=4').catch(() => []),
      api.get('/api/episodes?saved=1&limit=50').catch(() => [])
    ]);
    setShows(showData?.podcasts || []);
    setCategories(showData?.categories || []);
    setLatest(latestEps || []);
    setContinuing(continueEps || []);
    setSaved(savedEps || []);
    setLoading(false);
  }, [sort, category, filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const cb = () => load();
    window.addEventListener(EPISODES_EVENT, cb);
    return () => window.removeEventListener(EPISODES_EVENT, cb);
  }, [load]);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  /* ------------------------------------------------------------- actions */
  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (!value || value === fallback) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const playEpisode = useCallback((episode, list) => {
    const track = episodeToTrack(episode);
    if (!track?.file_path) { toast('This episode has no audio yet', 'error'); return; }
    if (current?.kind === 'episode' && current.episode_id === episode.id) { togglePlay(); return; }
    const queue = list && list.length ? episodesToTracks(list) : [track];
    const index = Math.max(0, queue.findIndex((t) => t.episode_id === episode.id));
    play(queue, index, resumeAt(episode));
    toast(resumeAt(episode) > 0 ? `Resuming “${episode.title}”` : `Playing “${episode.title}”`);
  }, [current, isPlaying, play, togglePlay, toast]);

  const playShow = useCallback(async (show) => {
    try {
      const detail = await api.get(`/api/podcasts/${show.id}`);
      const episodes = detail.episodes || [];
      if (!episodes.length) { toast('This show has no episodes yet', 'info'); return; }
      const queue = episodesToTracks(episodes, detail);
      play(queue, 0, resumeAt(episodes[0]));
      toast(`Playing “${show.title}”`);
    } catch (err) {
      toast(err.message || 'Could not play this show', 'error');
    }
  }, [play, toast]);

  const toggleSubscribe = useCallback(async (show) => {
    const next = !show.subscribed;
    setShows((list) => list.map((s) => (s.id === show.id ? { ...s, subscribed: next } : s)));
    try {
      await setPodcastSubscribed(show.id, next);
      toast(next ? `Following “${show.title}”` : `Unfollowed “${show.title}”`, next ? 'success' : 'info');
    } catch (err) {
      setShows((list) => list.map((s) => (s.id === show.id ? { ...s, subscribed: !next } : s)));
      toast(err.message || 'Could not update this subscription', 'error');
    }
  }, [toast]);

  const downloadEpisode = useCallback((episode) => {
    openExternal(apiUrl(`/api/episodes/${episode.id}/download`));
    toast(`Downloading “${episode.title}”`);
  }, [toast]);

  /* ------------------------------------------------------------- derived */
  const categoryOptions = useMemo(() => ([
    { id: 'all', label: 'All categories' },
    ...categories.map((c) => ({ id: c.category, label: `${c.category} (${c.count})` }))
  ]), [categories]);

  const totalEpisodes = useMemo(() => shows.reduce((t, s) => t + (s.episode_count || 0), 0), [shows]);
  const totalDuration = useMemo(() => shows.reduce((t, s) => t + (s.total_duration || 0), 0), [shows]);
  const following = useMemo(() => shows.filter((s) => s.subscribed).length, [shows]);

  const isCurrent = (episode) => current?.kind === 'episode' && current.episode_id === episode.id;

  const showingSaved = filter === 'saved';

  const emptyCopy = {
    subscribed: 'Follow a show and it lands here, with every new episode.',
    mine: 'Shows you publish appear here. Start one and upload your first episode.',
    saved: 'Save an episode for later and it waits for you here.',
    all: 'No shows match this filter yet.'
  }[filter];

  return (
    <div className="page">
      {/* ============================= HERO ============================= */}
      <PageHero
        icon="podcast"
        title="Podcasts & Shows"
        chip={`${shows.length} show${shows.length === 1 ? '' : 's'}`}
        subtitle={`${formatNumber(totalEpisodes)} episode${totalEpisodes === 1 ? '' : 's'} • ${formatLongDuration(totalDuration)} of listening • ${following} followed`}
        actions={(
          <>
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={17} /> Start a show
            </button>
            <Link className="hero-icon-btn" to="/podcasts?filter=saved" title="Your saved episodes" aria-label="Your saved episodes">
              <Icon name="headphones" size={19} />
            </Link>
          </>
        )}
      />

      {/* ============================ TOOLBAR =========================== */}
      <div className="toolbar">
        <FilterChips
          options={FILTERS}
          value={filter}
          onChange={(id) => setParam('filter', id, 'all')}
          ariaLabel="Filter podcasts"
        />
        <div className="toolbar-right">
          <SortMenu
            options={categoryOptions}
            value={category}
            onChange={(id) => setParam('category', id, 'all')}
            label="Category"
          />
          <SortMenu options={SORTS} value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      {/* ====================== CONTINUE LISTENING ====================== */}
      {!showingSaved && continuing.length > 0 && (
        <section className="section">
          <SectionHead icon="clock" title="Continue listening" note="Picks up where you stopped" />
          <div className="episode-list">
            {continuing.map((ep) => (
              <EpisodeRow
                key={`c-${ep.id}`}
                episode={ep}
                isCurrent={isCurrent(ep)}
                isPlaying={isPlaying}
                onPlay={(e) => playEpisode(e, continuing)}
                onToggleSave={user ? ((e) => toggleSave(e).then(load)) : undefined}
                onDownload={downloadEpisode}
              />
            ))}
          </div>
        </section>
      )}

      {/* =========================== SHOW GRID ========================== */}
      {showingSaved ? (
        <section className="section">
          <SectionHead
            icon="headphones"
            title="Your Episodes"
            note={`${saved.length} saved`}
            action={<Link className="btn btn-ghost btn-sm" to="/podcasts"><Icon name="podcast" size={15} /> Browse shows</Link>}
          />
          {loading ? <RowSkeleton count={4} /> : saved.length === 0 ? (
            <EmptyState
              icon="headphones"
              title="No saved episodes yet"
              description={emptyCopy}
              action={<Link className="btn btn-primary" to="/podcasts"><Icon name="podcast" size={16} /> Find a show</Link>}
            />
          ) : (
            <div className="episode-list">
              {saved.map((ep) => (
                <EpisodeRow
                  key={`s-${ep.id}`}
                  episode={ep}
                  isCurrent={isCurrent(ep)}
                  isPlaying={isPlaying}
                  onPlay={(e) => playEpisode(e, saved)}
                  onToggleSave={(e) => toggleSave(e).then(load)}
                  onDownload={downloadEpisode}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="section">
          <SectionHead
            icon="podcast"
            title={filter === 'subscribed' ? 'Shows you follow' : filter === 'mine' ? 'Your shows' : 'Browse shows'}
            note={loading ? 'Loading…' : `${shows.length} show${shows.length === 1 ? '' : 's'}`}
          />

          {loading ? (
            <GridSkeleton count={8} />
          ) : shows.length === 0 ? (
            <EmptyState
              icon="podcast"
              title="Nothing here yet"
              description={emptyCopy}
              action={(
                <div className="row">
                  <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                    <Icon name="plus" size={16} /> Start a show
                  </button>
                  <Link className="btn btn-ghost" to="/podcasts"><Icon name="compass" size={16} /> Browse all</Link>
                </div>
              )}
            />
          ) : view === 'grid' ? (
            <div className="collection-grid">
              {shows.map((show) => (
                <CollectionCard
                  key={show.id}
                  to={`/podcasts/${show.id}`}
                  type="Podcast"
                  typeTone="accent"
                  cover={show.cover_url}
                  title={show.title}
                  subtitle={`${show.publisher || 'Independent'}${show.category ? ` • ${show.category}` : ''}`}
                  meta={{ icon: 'mic', text: `${show.episode_count} episode${show.episode_count === 1 ? '' : 's'}` }}
                  chip={show.subscribed ? 'FOLLOWING' : undefined}
                  onPlay={() => playShow(show)}
                  playLabel={`Play ${show.title}`}
                  actions={user && (
                    <button
                      className={`icon-btn icon-btn-sm ${show.subscribed ? 'on-green' : ''}`}
                      onClick={(e) => { e.preventDefault(); toggleSubscribe(show); }}
                      title={show.subscribed ? 'Unfollow show' : 'Follow show'}
                      aria-label={show.subscribed ? `Unfollow ${show.title}` : `Follow ${show.title}`}
                    >
                      <Icon name={show.subscribed ? 'checkCircle' : 'plus'} size={15} />
                    </button>
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="library-list">
              {shows.map((show) => (
                <LibraryRow
                  key={show.id}
                  to={`/podcasts/${show.id}`}
                  cover={show.cover_url}
                  title={show.title}
                  subtitle={`Podcast • ${show.publisher || 'Independent'}${show.category ? ` • ${show.category}` : ''}`}
                  meta={`${show.episode_count} episode${show.episode_count === 1 ? '' : 's'}`}
                  metaTone={show.subscribed ? 'green' : undefined}
                  onPlay={() => playShow(show)}
                  actions={user && (
                    <button
                      className={`icon-btn icon-btn-sm ${show.subscribed ? 'on-green' : ''}`}
                      onClick={(e) => { e.preventDefault(); toggleSubscribe(show); }}
                      title={show.subscribed ? 'Unfollow show' : 'Follow show'}
                      aria-label={show.subscribed ? `Unfollow ${show.title}` : `Follow ${show.title}`}
                    >
                      <Icon name={show.subscribed ? 'checkCircle' : 'plus'} size={15} />
                    </button>
                  )}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ========================= LATEST EPISODES ====================== */}
      {!showingSaved && (
        <section className="section">
          <SectionHead
            icon="sparkle"
            title="Latest episodes"
            note="Fresh across every show"
            action={<Link className="btn btn-ghost btn-sm" to="/podcasts?filter=saved"><Icon name="headphones" size={15} /> Your Episodes</Link>}
          />
          {loading ? <RowSkeleton count={4} /> : latest.length === 0 ? (
            <EmptyState icon="mic" title="No episodes yet" description="Published episodes show up here as soon as they land." />
          ) : (
            <div className="episode-list">
              {latest.map((ep) => (
                <EpisodeRow
                  key={`l-${ep.id}`}
                  episode={ep}
                  isCurrent={isCurrent(ep)}
                  isPlaying={isPlaying}
                  onPlay={(e) => playEpisode(e, latest)}
                  onToggleSave={user ? ((e) => toggleSave(e).then(load)) : undefined}
                  onDownload={downloadEpisode}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <PodcastFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => load()}
        podcast={null}
      />
    </div>
  );
}
