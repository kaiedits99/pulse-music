import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import { CollectionCard } from '../components/Cards.jsx';
import {
  PageHero, SectionHead, FilterChips, SortMenu, ViewToggle,
  EmptyState, GridSkeleton, RowSkeleton
} from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import SongFormModal from '../components/SongFormModal.jsx';
import { useAddToPlaylistDialog } from '../components/Forms.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNumber } from '../format.js';

const SORTS = [
  { id: 'recent', label: 'Recently added' },
  { id: 'plays', label: 'Most played' },
  { id: 'downloads', label: 'Most downloaded' },
  { id: 'title', label: 'A–Z' }
];

const MOOD_COLORS = [
  ['#5b21b6', '#a855f7'], ['#065f46', '#22c55e'], ['#9f1239', '#fb7185'],
  ['#075985', '#38bdf8'], ['#6b21a8', '#d946ef'], ['#92400e', '#f59e0b'],
  ['#9d174d', '#ec4899'], ['#166534', '#4ade80'], ['#1e293b', '#94a3b8'],
  ['#3730a3', '#818cf8'], ['#7c2d12', '#fb923c'], ['#134e4a', '#2dd4bf']
];

const VIEW_KEY = 'pulse_search_view';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const genre = params.get('genre') || '';
  const artistId = params.get('artist') || '';
  const mineOnly = params.get('mine') === '1';
  const sort = params.get('sort') || 'recent';

  const { user, artist } = useAuth();
  const { play } = usePlayer();
  const { toast } = useToast();
  const { open: openAdd, dialog: addDialog } = useAddToPlaylistDialog();

  const [songs, setSongs] = useState([]);
  const [artists, setArtists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || 'list'; } catch { return 'list'; }
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (genre) sp.set('genre', genre);
      if (artistId) sp.set('artist_id', artistId);
      if (sort !== 'recent') sp.set('sort', sort);
      if (mineOnly) sp.set('mine', '1');
      setSongs(await api.get(`/api/songs?${sp.toString()}`));
    } catch (err) {
      toast(err.message || 'Search failed', 'error');
    } finally {
      setLoading(false);
    }
  }, [q, genre, artistId, sort, mineOnly, toast]);

  useEffect(() => { loadSongs(); }, [loadSongs]);

  useEffect(() => {
    api.get('/api/artists').then(setArtists).catch(() => {});
    api.get('/api/albums').then(setAlbums).catch(() => {});
    api.get('/api/stats').then((d) => setGenres(d?.genres || [])).catch(() => {});
  }, []);

  /* ------------------------------------------------------------ helpers */
  const patch = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => {
      if (v === null || v === '' || v === false) next.delete(k);
      else next.set(k, v);
    });
    setParams(next, { replace: true });
  };

  const canEdit = (song) => user && (user.role === 'admin' || (artist && artist.id === song.artist_id));

  const handleDelete = async (song) => {
    try {
      await api.del(`/api/songs/${song.id}`);
      setSongs((s) => s.filter((x) => x.id !== song.id));
      toast('Track deleted');
    } catch (err) { toast(err.message || 'Could not delete track', 'error'); }
  };

  /* Matching artists / albums shown above the tracks when searching. */
  const matchedArtists = useMemo(() => {
    if (!q) return [];
    const needle = q.toLowerCase();
    return artists.filter((a) => a.name.toLowerCase().includes(needle)).slice(0, 6);
  }, [q, artists]);

  const matchedAlbums = useMemo(() => {
    if (!q) return [];
    const needle = q.toLowerCase();
    return albums.filter((a) => a.title.toLowerCase().includes(needle) || (a.artist_name || '').toLowerCase().includes(needle)).slice(0, 6);
  }, [q, albums]);

  const genreOptions = useMemo(() => ([
    { id: '', label: 'All genres' },
    ...genres.map((g) => ({ id: g.genre, label: g.genre }))
  ]), [genres]);

  const setSort = (value) => patch({ sort: value === 'recent' ? null : value });
  const activeArtist = useMemo(
    () => artists.find((a) => String(a.id) === String(artistId)) || null,
    [artists, artistId]
  );

  const hasQuery = Boolean(q || genre || mineOnly || artistId);
  const heroTitle = mineOnly
    ? 'Your Uploads'
    : q
      ? `Results for “${q}”`
      : activeArtist
        ? `${activeArtist.name} — catalog`
        : genre || 'Search';
  const heroSub = loading
    ? 'Searching the catalog…'
    : mineOnly
      ? `${songs.length} track${songs.length === 1 ? '' : 's'} published by you`
      : hasQuery
        ? `${songs.length} track${songs.length === 1 ? '' : 's'}${matchedArtists.length ? ` • ${matchedArtists.length} artist${matchedArtists.length === 1 ? '' : 's'}` : ''}${matchedAlbums.length ? ` • ${matchedAlbums.length} album${matchedAlbums.length === 1 ? '' : 's'}` : ''}`
        : `Browse ${formatNumber(songs.length)} tracks across ${genres.length} genres — or type in the search bar above.`;

  const playAll = () => {
    if (!songs.length) return;
    play(songs, 0);
    toast(`Playing ${songs.length} track${songs.length === 1 ? '' : 's'}`);
  };

  return (
    <div className="page">
      <PageHero
        icon={mineOnly ? 'broadcast' : 'search'}
        title={heroTitle}
        chip={mineOnly ? 'Your catalog' : hasQuery ? `${songs.length} found` : 'Explore'}
        subtitle={heroSub}
        actions={(
          <>
            {songs.length > 0 && (
              <button className="btn btn-play" onClick={playAll}>
                <Icon name="play" size={17} /> Play all
              </button>
            )}
            <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Icon name="plus" size={17} /> Add track
            </button>
          </>
        )}
      />

      {/* ---------------------------- toolbar ---------------------------- */}
      <div className="toolbar">
        <div className="chip-row chip-row--scroll">
          {q && (
            <button className="chip active" onClick={() => patch({ q: null })}>
              <Icon name="search" size={13} /> “{q}”
              <span className="chip-close"><Icon name="close" size={13} /></span>
            </button>
          )}
          {activeArtist && (
            <button className="chip active" onClick={() => patch({ artist: null })}>
              <Icon name="artist" size={13} /> {activeArtist.name}
              <span className="chip-close"><Icon name="close" size={13} /></span>
            </button>
          )}
          {user && (
            <button className={`chip ${mineOnly ? 'active' : ''}`} onClick={() => patch({ mine: mineOnly ? null : '1' })}>
              <Icon name="artist" size={14} /> My music
            </button>
          )}
          {genreOptions.slice(0, 9).map((opt) => (
            <button
              key={opt.id || 'all'}
              className={`chip ${genre === opt.id ? 'active' : ''}`}
              onClick={() => patch({ genre: opt.id || null })}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <SortMenu options={SORTS} value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      {/* ------------------ matching artists / albums -------------------- */}
      {matchedArtists.length > 0 && (
        <section className="section">
          <SectionHead icon="artist" title="Artists" note={`${matchedArtists.length} match${matchedArtists.length === 1 ? '' : 'es'}`} />
          <div className="collection-grid">
            {matchedArtists.map((a) => (
              <CollectionCard
                key={a.id}
                to={`/artists/${a.id}`}
                type="Artist"
                cover={a.avatar_url}
                round
                title={a.name}
                subtitle={`${a.genre || 'Artist'} • ${formatNumber(a.followers)} listeners`}
                meta={{ icon: 'music', text: `${a.song_count ?? 0} tracks` }}
                onPlay={async () => {
                  const d = await api.get(`/api/artists/${a.id}`).catch(() => null);
                  if (d?.songs?.length) play(d.songs, 0); else toast('No tracks for this artist yet', 'info');
                }}
              />
            ))}
          </div>
        </section>
      )}

      {matchedAlbums.length > 0 && (
        <section className="section">
          <SectionHead icon="album" title="Albums" note={`${matchedAlbums.length} match${matchedAlbums.length === 1 ? '' : 'es'}`} />
          <div className="collection-grid">
            {matchedAlbums.map((a) => (
              <CollectionCard
                key={a.id}
                to={`/albums/${a.id}`}
                type="Album"
                cover={a.cover_url}
                title={a.title}
                subtitle={`${a.artist_name} • ${a.release_year || ''}`}
                meta={{ icon: 'disc', text: `${a.track_count || 0} tracks` }}
                onPlay={async () => {
                  const d = await api.get(`/api/albums/${a.id}`).catch(() => null);
                  if (d?.songs?.length) play(d.songs, 0); else toast('This album has no tracks yet', 'info');
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------ browse by genre ------------------------ */}
      {!hasQuery && genres.length > 0 && (
        <section className="section">
          <SectionHead title="Browse all" note={`${genres.length} genres`} />
          <div className="genre-tile-grid">
            {genres.map((g, i) => {
              const c = MOOD_COLORS[i % MOOD_COLORS.length];
              return (
                <Link
                  key={g.genre}
                  to={`/search?genre=${encodeURIComponent(g.genre)}`}
                  className="genre-tile"
                  style={{ background: `linear-gradient(135deg, ${c[0]} 0%, ${c[1]} 100%)` }}
                >
                  <span className="genre-tile-name">{g.genre}</span>
                  <span className="genre-tile-count">{g.c} tracks</span>
                  <Icon name="music" size={44} className="genre-tile-art" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------------------------- results ---------------------------- */}
      <section className="section">
        <SectionHead
          icon="music"
          title={hasQuery ? 'Tracks' : 'All tracks'}
          note={loading ? 'Loading…' : `${songs.length} item${songs.length === 1 ? '' : 's'}`}
        />

        {loading ? (
          view === 'grid' ? <GridSkeleton count={10} /> : <RowSkeleton count={8} />
        ) : view === 'grid' ? (
          songs.length === 0 ? (
            <EmptyState
              icon="music"
              title={hasQuery ? 'No tracks match' : 'No tracks yet'}
              description={hasQuery ? 'Try a different search term, genre or filter.' : 'Upload your first track to get started.'}
              action={<Link className="btn btn-primary" to="/upload"><Icon name="upload" size={16} /> Upload a track</Link>}
            />
          ) : (
            <div className="collection-grid">
              {songs.map((s, i) => (
                <CollectionCard
                  key={s.id}
                  type="Track"
                  cover={s.cover_url || s.album_cover}
                  title={s.title}
                  subtitle={s.artist_name}
                  meta={{ icon: 'playCircle', text: `${formatNumber(s.plays)} plays` }}
                  onPlay={() => play(songs, i)}
                  playLabel={`Play ${s.title}`}
                />
              ))}
            </div>
          )
        ) : (
          <SongTable
            songs={songs}
            onEdit={(s) => { setEditing(s); setFormOpen(true); }}
            onDelete={(s) => setDeleting(s)}
            onAddToPlaylist={openAdd}
            canManage={canEdit}
            emptyFallback={(
              <EmptyState
                icon="music"
                title={hasQuery ? 'No tracks match' : 'No tracks yet'}
                description={hasQuery ? 'Try a different search term, genre or filter.' : 'Upload your first track to get started.'}
                action={<Link className="btn btn-primary" to="/upload"><Icon name="upload" size={16} /> Upload a track</Link>}
              />
            )}
          />
        )}
      </section>

      <SongFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={loadSongs}
        song={editing}
        artists={artists}
        albums={albums}
        defaultArtistId={artist?.id}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && handleDelete(deleting)}
        title="Delete track"
        message={deleting ? `Delete “${deleting.title}”? This cannot be undone.` : ''}
      />
      {addDialog}
    </div>
  );
}
