import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import { CollectionCard } from '../components/Cards.jsx';
import { PageHero, SectionHead, SortMenu, ViewToggle, EmptyState, RowSkeleton, GridSkeleton } from '../components/ui.jsx';
import { useAddToPlaylistDialog } from '../components/Forms.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useFavorites } from '../context/FavoritesContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatLongDuration, formatNumber } from '../format.js';
import { downloadSong as saveOffline, hasPlayableAudio, isSongDownloaded, OFFLINE_EVENT } from '../offline.js';

const SORTS = [
  { id: 'recent', label: 'Recently liked' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'artist', label: 'By artist' },
  { id: 'plays', label: 'Most played' }
];

export default function Favorites() {
  const { toast } = useToast();
  const { play } = usePlayer();
  const { open: openAdd, dialog: addDialog } = useAddToPlaylistDialog();
  const { isLiked, revision } = useFavorites();

  const [fetched, setFetched] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState('list');
  const [downloading, setDownloading] = useState(false);
  const [, setOfflineTick] = useState(0);

  // A background refresh keeps what is on screen if it fails, and never flashes the skeleton.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setFetched(await api.get('/api/favorites')); }
    catch (err) { if (!silent) toast(err.message || 'Could not load your liked songs', 'error'); }
    finally { if (!silent) setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Hearts clicked elsewhere (player bar, other pages) change this list: refresh once the server has confirmed.
  useEffect(() => { if (revision) load(true); }, [revision, load]);

  // What is shown follows the hearts immediately: un-liking a track drops it from the list at once.
  const songs = useMemo(() => fetched.filter(isLiked), [fetched, isLiked]);

  useEffect(() => {
    const cb = () => setOfflineTick((t) => t + 1);
    window.addEventListener(OFFLINE_EVENT, cb);
    return () => window.removeEventListener(OFFLINE_EVENT, cb);
  }, []);

  const sorted = useMemo(() => {
    const list = [...songs];
    if (sort === 'alpha') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'artist') list.sort((a, b) => (a.artist_name || '').localeCompare(b.artist_name || ''));
    else if (sort === 'plays') list.sort((a, b) => (b.plays || 0) - (a.plays || 0));
    return list;
  }, [songs, sort]);

  const totalDuration = useMemo(() => songs.reduce((t, s) => t + (s.duration_seconds || 0), 0), [songs]);
  const downloadedCount = songs.filter((s) => isSongDownloaded(s.id)).length;

  const downloadAll = async () => {
    const playable = songs.filter(hasPlayableAudio);
    if (!playable.length) { toast('None of these tracks have an audio file yet', 'error'); return; }
    setDownloading(true);
    let done = 0;
    for (const song of playable) {
      // eslint-disable-next-line no-await-in-loop
      const res = await saveOffline(song);
      if (res !== 'failed') done += 1;
    }
    setDownloading(false);
    toast(`Saved ${done} track${done === 1 ? '' : 's'} for offline`);
  };

  return (
    <div className="page">
      <PageHero
        icon="heartFill"
        title="Liked Songs"
        chip="Auto-updating"
        subtitle={loading
          ? 'Loading your saved tracks…'
          : `${songs.length} song${songs.length === 1 ? '' : 's'} saved • ${formatLongDuration(totalDuration)}${downloadedCount ? ` • ${downloadedCount} offline` : ''}`}
        actions={(
          <>
            {songs.length > 0 && (
              <>
                <button className="btn btn-play" onClick={() => play(sorted, 0)}>
                  <Icon name="play" size={17} /> Play
                </button>
                <button className="btn btn-ghost" onClick={downloadAll} disabled={downloading}>
                  <Icon name="download" size={16} />
                  {downloading ? 'Downloading…' : 'Download all'}
                </button>
              </>
            )}
          </>
        )}
      />

      <div className="toolbar">
        <div className="chip-row">
          <Link className="chip" to="/library"><Icon name="library" size={14} /> Your Library</Link>
          <Link className="chip" to="/downloads"><Icon name="download" size={14} /> Downloads</Link>
        </div>
        <div className="toolbar-right">
          <SortMenu options={SORTS} value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      <section className="section">
        <SectionHead
          icon="heart"
          title="Saved tracks"
          note={loading ? 'Loading…' : `Showing ${sorted.length} item${sorted.length === 1 ? '' : 's'}`}
        />

        {loading ? (
          view === 'grid' ? <GridSkeleton count={8} /> : <RowSkeleton count={7} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon="heart"
            title="No liked songs yet"
            description="Tap the heart on any track and it lands here — plus it stays in sync across the player and your library."
            action={<Link className="btn btn-primary" to="/search"><Icon name="search" size={16} /> Find music</Link>}
          />
        ) : view === 'grid' ? (
          <div className="collection-grid">
            {sorted.map((s, i) => (
              <CollectionCard
                key={s.id}
                type="Track"
                cover={s.cover_url || s.album_cover}
                title={s.title}
                subtitle={s.artist_name}
                meta={isSongDownloaded(s.id)
                  ? { icon: 'checkCircle', text: 'Downloaded', tone: 'green' }
                  : { icon: 'playCircle', text: `${formatNumber(s.plays)} plays` }}
                onPlay={() => play(sorted, i)}
                playLabel={`Play ${s.title}`}
              />
            ))}
          </div>
        ) : (
          <SongTable songs={sorted} onAddToPlaylist={openAdd} />
        )}
      </section>

      {addDialog}
    </div>
  );
}
