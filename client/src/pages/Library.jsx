import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import {
  PageHero, SectionHead, FilterChips, SortMenu, ViewToggle,
  EmptyState, GridSkeleton, SummaryPanel
} from '../components/ui.jsx';
import { CollectionCard, LibraryRow } from '../components/Cards.jsx';
import { PlaylistFormModal, AlbumFormModal } from '../components/Forms.jsx';
import SongFormModal from '../components/SongFormModal.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes, formatLongDuration, formatNumber, timeAgo } from '../format.js';
import { episodesToTracks, resumeAt } from '../episodes.js';
import {
  downloadSong as saveOffline,
  downloadedPlaylists,
  downloadedSongs,
  isPlaylistDownloaded,
  isSongDownloaded,
  hasPlayableAudio,
  OFFLINE_EVENT
} from '../offline.js';

const FILTERS = [
  { id: 'all', label: 'All Content' },
  { id: 'uploads', label: 'My Uploads', icon: 'upload' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' },
  { id: 'albums', label: 'Albums' },
  { id: 'podcasts', label: 'Podcasts & Shows' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'downloaded', label: 'Downloaded', icon: 'check', iconGreen: true }
];

const SORTS = [
  { id: 'recents', label: 'Recents' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'type', label: 'Type' },
  { id: 'size', label: 'Most tracks' }
];

const VIEW_KEY = 'pulse_library_view';

export default function Library() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { play } = usePlayer();
  const { toast } = useToast();
  const { user, artist } = useAuth();

  const filter = params.get('filter') || 'all';
  const [sort, setSort] = useState('recents');
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || 'grid'; } catch { return 'grid'; }
  });

  const [playlists, setPlaylists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [songs, setSongs] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [myTracks, setMyTracks] = useState([]);
  const [podcasts, setPodcasts] = useState([]);
  const [savedEpisodes, setSavedEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [uploadTab, setUploadTab] = useState('all'); // 'all' | 'public' | 'private'
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [songFormOpen, setSongFormOpen] = useState(false);
  const [editingTrack, setEditingTrack] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingTrack, setDeletingTrack] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [storage, setStorage] = useState({ usage: 0, quota: 0 });
  const [, setOfflineTick] = useState(0);

  /* ------------------------------------------------------------- loading */
  const load = useCallback(async () => {
    setLoading(true);
    const [pl, al, ar, sg, fav, mine, pods, eps] = await Promise.all([
      api.get('/api/playlists').catch(() => []),
      api.get('/api/albums').catch(() => []),
      api.get('/api/artists').catch(() => []),
      api.get('/api/songs').catch(() => []),
      api.get('/api/favorites').catch(() => []),
      api.get('/api/songs?mine=1').catch(() => []),
      api.get('/api/podcasts').catch(() => ({ podcasts: [] })),
      api.get('/api/episodes?saved=1&limit=50').catch(() => [])
    ]);
    setPlaylists(pl || []);
    setAlbums(al || []);
    setArtists(ar || []);
    setSongs(sg || []);
    setFavorites(fav || []);
    setMyTracks(mine || []);
    setPodcasts(pods?.podcasts || []);
    setSavedEpisodes(eps || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const cb = () => setOfflineTick((t) => t + 1);
    window.addEventListener(OFFLINE_EVENT, cb);
    return () => window.removeEventListener(OFFLINE_EVENT, cb);
  }, []);

  /* Real device storage usage for the ring */
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        if (alive && est) setStorage({ usage: est.usage || 0, quota: est.quota || 0 });
      } catch { /* not supported — ring falls back to item counts */ }
    };
    read();
    window.addEventListener(OFFLINE_EVENT, read);
    return () => { alive = false; window.removeEventListener(OFFLINE_EVENT, read); };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  /* ------------------------------------------------------------- actions */
  const playPlaylist = async (pl) => {
    try {
      const detail = await api.get(`/api/playlists/${pl.id}`);
      if (detail.songs?.length) { play(detail.songs, 0); toast(`Playing “${pl.name}”`); }
      else toast('This playlist is empty', 'info');
    } catch (err) { toast(err.message || 'Could not play playlist', 'error'); }
  };

  const playAlbum = async (album) => {
    try {
      const detail = await api.get(`/api/albums/${album.id}`);
      if (detail.songs?.length) { play(detail.songs, 0); toast(`Playing “${album.title}”`); }
      else toast('This album has no tracks yet', 'info');
    } catch (err) { toast(err.message || 'Could not play album', 'error'); }
  };

  const playArtist = async (a) => {
    try {
      const detail = await api.get(`/api/artists/${a.id}`);
      if (detail.songs?.length) { play(detail.songs, 0); toast(`Playing ${a.name}`); }
      else toast('This artist has no tracks yet', 'info');
    } catch (err) { toast(err.message || 'Could not play artist', 'error'); }
  };

  const playPodcast = async (show) => {
    try {
      const detail = await api.get(`/api/podcasts/${show.id}`);
      const episodes = detail.episodes || [];
      if (!episodes.length) { toast('This show has no episodes yet', 'info'); return; }
      play(episodesToTracks(episodes, detail), 0, resumeAt(episodes[0]));
      toast(`Playing “${show.title}”`);
    } catch (err) { toast(err.message || 'Could not play this show', 'error'); }
  };

  const deletePlaylist = async (pl) => {
    try {
      await api.del(`/api/playlists/${pl.id}`);
      setPlaylists((p) => p.filter((x) => x.id !== pl.id));
      window.dispatchEvent(new CustomEvent('pulse-playlists-changed'));
      toast(`Deleted “${pl.name}”`);
    } catch (err) { toast(err.message || 'Could not delete playlist', 'error'); }
  };

  const deleteSong = async (song) => {
    try {
      await api.del(`/api/songs/${song.id}`);
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
      setMyTracks((prev) => prev.filter((s) => s.id !== song.id));
      setDeletingTrack(null);
      toast('Track deleted');
    } catch (err) { toast(err.message || 'Could not delete track', 'error'); }
  };

  const toggleTrackVisibility = async (song) => {
    const nextVal = song.is_public === 0 ? 1 : 0;
    try {
      const updated = await api.patch(`/api/songs/${song.id}/visibility`, { is_public: nextVal });
      setSongs((prev) => prev.map((s) => (s.id === song.id ? { ...s, is_public: nextVal } : s)));
      setMyTracks((prev) => prev.map((s) => (s.id === song.id ? { ...s, is_public: nextVal } : s)));
      toast(nextVal ? `“${song.title}” is now Public (published to everyone) 🌐` : `“${song.title}” is now Private 🔒`);
    } catch (err) {
      toast(err.message || 'Could not update visibility', 'error');
    }
  };

  const downloadAllLiked = async () => {
    const playable = favorites.filter(hasPlayableAudio);
    if (!playable.length) {
      toast('None of your liked songs have an audio file yet', 'error');
      return;
    }
    setDownloadingAll(true);
    let done = 0;
    for (const song of playable) {
      // eslint-disable-next-line no-await-in-loop
      const res = await saveOffline(song);
      if (res !== 'failed') done += 1;
    }
    setDownloadingAll(false);
    toast(`Saved ${done} liked song${done === 1 ? '' : 's'} for offline`);
  };

  /* -------------------------------------------------------------- derived */
  const dlPlaylists = downloadedPlaylists();
  const dlSongs = downloadedSongs();

  const likedDuration = useMemo(
    () => favorites.reduce((t, s) => t + (s.duration_seconds || 0), 0),
    [favorites]
  );

  const publicUploadsCount = useMemo(() => myTracks.filter((s) => s.is_public !== 0).length, [myTracks]);
  const privateUploadsCount = useMemo(() => myTracks.filter((s) => s.is_public === 0).length, [myTracks]);

  /** Normalise every entity into one shape the grid/list can render. */
  const items = useMemo(() => {
    const out = [];

    playlists.forEach((p) => out.push({
      key: `pl-${p.id}`,
      kind: 'playlists',
      type: 'Playlist',
      typeTone: 'accent',
      to: `/playlists/${p.id}`,
      cover: p.cover_url,
      title: p.name,
      subtitle: p.creator_name ? `By ${p.creator_name} • ${p.track_count ?? 0} songs` : `${p.track_count ?? 0} songs`,
      meta: isPlaylistDownloaded(p.id)
        ? { icon: 'download', text: 'Downloaded', tone: 'green' }
        : { icon: 'clock', text: timeAgo(p.created_at) || 'Playlist' },
      sortDate: p.created_at ? new Date(`${p.created_at}Z`).getTime() : 0,
      size: p.track_count ?? 0,
      downloaded: isPlaylistDownloaded(p.id),
      onPlay: () => playPlaylist(p),
      canDelete: user && (user.role === 'admin' || p.user_id === user.id),
      raw: p
    }));

    albums.forEach((a) => out.push({
      key: `al-${a.id}`,
      kind: 'albums',
      type: 'Album',
      to: `/albums/${a.id}`,
      cover: a.cover_url,
      title: a.title,
      subtitle: `${a.artist_name || 'Unknown artist'}${a.release_year ? ` • ${a.release_year}` : ''}`,
      meta: { icon: 'disc', text: `${a.track_count || 0} tracks` },
      sortDate: (a.release_year || 0) * 1000,
      size: a.track_count || 0,
      onPlay: () => playAlbum(a),
      raw: a
    }));

    artists.forEach((a) => out.push({
      key: `ar-${a.id}`,
      kind: 'artists',
      type: 'Artist',
      to: `/artists/${a.id}`,
      cover: a.avatar_url,
      round: true,
      title: a.name,
      subtitle: `${a.genre || 'Artist'} • ${formatNumber(a.followers)} listeners`,
      chip: a.song_count > 0 ? 'FOLLOWING' : undefined,
      sortDate: a.followers || 0,
      size: a.song_count || 0,
      onPlay: () => playArtist(a),
      raw: a
    }));

    podcasts.forEach((p) => out.push({
      key: `pod-${p.id}`,
      kind: 'podcasts',
      type: 'Podcast',
      typeTone: 'accent',
      to: `/podcasts/${p.id}`,
      cover: p.cover_url,
      title: p.title,
      subtitle: `${p.publisher || 'Independent'}${p.category ? ` • ${p.category}` : ''}`,
      meta: p.subscribed
        ? { icon: 'check', text: 'Following', tone: 'green' }
        : { icon: 'mic', text: `${p.episode_count || 0} episode${p.episode_count === 1 ? '' : 's'}` },
      chip: p.subscribed ? 'FOLLOWING' : undefined,
      sortDate: p.latest_published_at ? new Date(p.latest_published_at).getTime() : 0,
      size: p.episode_count || 0,
      onPlay: () => playPodcast(p),
      raw: p
    }));

    // Ensure all songs (including user's own uploads) are processed
    const renderedSongIds = new Set();
    const allSongList = [...myTracks, ...songs];

    allSongList.forEach((s) => {
      if (renderedSongIds.has(s.id)) return;
      renderedSongIds.add(s.id);

      const downloaded = isSongDownloaded(s.id);
      const isMine = myTracks.some((m) => m.id === s.id) || (user && s.uploaded_by === user.id) || (artist && s.artist_id === artist.id);
      const isPrivate = s.is_public === 0;

      out.push({
        key: `sg-${s.id}`,
        kind: isMine ? 'uploads' : 'tracks',
        type: isMine ? (isPrivate ? 'Private Track' : 'Public Track') : 'Track',
        typeTone: isMine ? (isPrivate ? 'accent' : 'green') : '',
        cover: s.cover_url || s.album_cover,
        title: s.title,
        subtitle: `${s.artist_name}${s.album_title ? ` • ${s.album_title}` : ''}`,
        meta: isMine
          ? {
              icon: isPrivate ? 'lock' : 'globe',
              text: isPrivate ? 'Private' : 'Public',
              tone: isPrivate ? '' : 'green'
            }
          : downloaded
            ? { icon: 'checkCircle', text: 'Downloaded', tone: 'green' }
            : { icon: 'playCircle', text: `${formatNumber(s.plays)} plays` },
        chip: isMine ? (isPrivate ? 'PRIVATE' : 'PUBLIC') : undefined,
        sortDate: s.created_at ? new Date(`${s.created_at}Z`).getTime() : 0,
        size: s.plays || 0,
        downloaded,
        isUpload: isMine,
        isPrivate,
        canEdit: isMine,
        canDelete: isMine || (user && user.role === 'admin'),
        onPlay: () => { play([s], 0); toast(`Playing “${s.title}”`); },
        raw: s
      });
    });

    return out;
  }, [playlists, albums, artists, songs, myTracks, podcasts, user, artist, play, toast]);

  const filtered = useMemo(() => {
    let list = items;
    if (filter === 'downloaded') {
      list = items.filter((i) => i.downloaded);
    } else if (filter === 'uploads' || filter === 'local') {
      list = items.filter((i) => i.isUpload);
      if (uploadTab === 'public') list = list.filter((i) => !i.isPrivate);
      else if (uploadTab === 'private') list = list.filter((i) => i.isPrivate);
    } else if (filter === 'tracks') {
      list = items.filter((i) => i.kind === 'tracks' || i.isUpload);
    } else if (filter !== 'all') {
      list = items.filter((i) => i.kind === filter);
    }

    const sorted = [...list];
    if (sort === 'alpha') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'type') sorted.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
    else if (sort === 'size') sorted.sort((a, b) => b.size - a.size);
    else sorted.sort((a, b) => b.sortDate - a.sortDate);
    return sorted;
  }, [items, filter, sort, uploadTab]);

  const totalCollections = playlists.length + albums.length + artists.length;
  const offlineCount = dlSongs.length;
  const storagePct = storage.quota > 0
    ? Math.min(100, (storage.usage / storage.quota) * 100)
    : Math.min(100, offlineCount * 4);

  const setFilter = (id) => {
    const nextParams = new URLSearchParams(params);
    if (id === 'all') nextParams.delete('filter'); else nextParams.set('filter', id);
    setParams(nextParams, { replace: true });
  };

  return (
    <div className="page">
      {/* ============================ HERO ============================ */}
      <PageHero
        icon="library"
        title="Your Library"
        chip="Cloud Sync"
        subtitle={`${totalCollections} curated collection${totalCollections === 1 ? '' : 's'} • ${formatNumber(offlineCount)} synchronized offline audio track${offlineCount === 1 ? '' : 's'}`}
        actions={(
          <>
            <button className="btn btn-primary" onClick={() => setNewPlaylistOpen(true)}>
              <Icon name="plus" size={17} /> New Playlist
            </button>
            <button className="hero-icon-btn" onClick={() => setNewAlbumOpen(true)} title="New album" aria-label="New album">
              <Icon name="folderPlus" size={19} />
            </button>
            <button className="hero-icon-btn" onClick={() => navigate('/search')} title="Search your library" aria-label="Search your library">
              <Icon name="search" size={19} />
            </button>
          </>
        )}
      />

      {/* ========================== TOOLBAR =========================== */}
      <div className="toolbar">
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Filter library" />
        <div className="toolbar-right">
          <SortMenu options={SORTS} value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      {(filter === 'uploads' || filter === 'local') && (
        <div className="uploads-sub-bar">
          <div className="chip-row">
            <button
              className={`chip ${uploadTab === 'all' ? 'active' : ''}`}
              onClick={() => setUploadTab('all')}
            >
              All Uploads ({myTracks.length})
            </button>
            <button
              className={`chip ${uploadTab === 'public' ? 'active' : ''}`}
              onClick={() => setUploadTab('public')}
            >
              <Icon name="globe" size={13} /> Public ({publicUploadsCount})
            </button>
            <button
              className={`chip ${uploadTab === 'private' ? 'active' : ''}`}
              onClick={() => setUploadTab('private')}
            >
              <Icon name="lock" size={13} /> Private ({privateUploadsCount})
            </button>
          </div>
          <Link to="/upload" className="btn btn-primary btn-sm btn-pill">
            <Icon name="upload" size={15} /> Upload music
          </Link>
        </div>
      )}

      {/* ======================== PINNED HUBS ========================= */}
      <section className="section">
        <SectionHead icon="pin" title="Pinned Hubs" note="Fast access" />
        <div className="hub-grid">
          <Link to="/favorites" className="hub-card hub-card--accent">
            <div className="hub-top">
              <span className="hub-icon"><Icon name="heart" size={24} /></span>
              <span className="hub-chip">Pinned</span>
            </div>
            <div className="hub-bottom">
              <span className="hub-eyebrow">Auto-updating playlist</span>
              <h3>Liked Songs</h3>
              <p>{favorites.length} song{favorites.length === 1 ? '' : 's'} saved • {formatLongDuration(likedDuration)}</p>
            </div>
          </Link>

          <button
            type="button"
            className="hub-card text-left"
            onClick={() => setFilter('uploads')}
            style={{ textAlign: 'left', background: 'var(--card-2)', cursor: 'pointer' }}
          >
            <div className="hub-top">
              <span className="hub-icon"><Icon name="broadcast" size={24} /></span>
              <span className="hub-chip">{artist ? 'Artist' : 'Catalog'}</span>
            </div>
            <div className="hub-bottom">
              <span className="hub-eyebrow">Your own releases</span>
              <h3>Your Uploads</h3>
              <p>{myTracks.length} track{myTracks.length === 1 ? '' : 's'} • {publicUploadsCount} public, {privateUploadsCount} private</p>
            </div>
          </button>

          <Link to="/podcasts?filter=saved" className="hub-card">
            <div className="hub-top">
              <span className="hub-icon"><Icon name="podcast" size={24} /></span>
              <span className="hub-chip">{podcasts.filter((p) => p.subscribed).length} following</span>
            </div>
            <div className="hub-bottom">
              <span className="hub-eyebrow">Podcasts &amp; shows</span>
              <h3>Your Episodes</h3>
              <p>{savedEpisodes.length} episode{savedEpisodes.length === 1 ? '' : 's'} saved • {podcasts.length} show{podcasts.length === 1 ? '' : 's'} on Pulse</p>
            </div>
          </Link>

          <Link to="/downloads" className="hub-card hub-card--green">
            <div className="hub-top">
              <span className="hub-icon"><Icon name="folderImage" size={24} /></span>
              <span className="hub-chip green"><span className="hub-chip-dot" /> Ready</span>
            </div>
            <div className="hub-bottom">
              <span className="hub-eyebrow">Local storage</span>
              <h3>Offline Library</h3>
              <p>{offlineCount} track{offlineCount === 1 ? '' : 's'} and {dlPlaylists.length} playlist{dlPlaylists.length === 1 ? '' : 's'} available offline</p>
            </div>
          </Link>
        </div>
      </section>

      {/* ===================== RECENT COLLECTIONS ===================== */}
      <section className="section">
        <SectionHead
          title="Recent Collections"
          note={loading ? 'Loading…' : `Showing ${filtered.length} item${filtered.length === 1 ? '' : 's'}`}
        />

        {loading ? (
          <GridSkeleton count={12} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={filter === 'uploads' || filter === 'local' ? 'upload' : 'library'}
            title={filter === 'uploads' || filter === 'local' ? 'No uploads found' : 'Nothing here yet'}
            description={
              filter === 'downloaded'
                ? 'Download a playlist or track and it will appear here, ready to play offline.'
                : filter === 'uploads' || filter === 'local'
                  ? uploadTab === 'private'
                    ? 'You have no private uploads yet. Upload music privately or switch any existing track to private.'
                    : uploadTab === 'public'
                      ? 'You have no public uploads yet. Publish your music publicly for everyone on Pulse to discover!'
                      : 'You haven’t uploaded any music yet. Drop tracks to publish publicly or save privately to your library.'
                  : 'Create a playlist, add an album, or upload a track to start building your library.'
            }
            action={(
              <div className="row">
                <Link className="btn btn-primary" to="/upload"><Icon name="upload" size={16} /> Upload music</Link>
                {filter !== 'uploads' && (
                  <button className="btn btn-ghost" onClick={() => setNewPlaylistOpen(true)}>
                    <Icon name="plus" size={16} /> New Playlist
                  </button>
                )}
              </div>
            )}
          />
        ) : view === 'grid' ? (
          <div className="collection-grid">
            {filtered.map((item) => (
              <CollectionCard
                key={item.key}
                to={item.to}
                type={item.type}
                typeTone={item.typeTone}
                cover={item.cover}
                round={item.round}
                title={item.title}
                subtitle={item.subtitle}
                meta={item.meta}
                chip={item.chip}
                onPlay={item.onPlay}
                playLabel={`Play ${item.title}`}
                actions={(
                  <div className="row-actions-group">
                    {item.isUpload && (
                      <>
                        <button
                          className="icon-btn icon-btn-sm"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleTrackVisibility(item.raw); }}
                          title={item.isPrivate ? 'Make Public (Publish)' : 'Make Private'}
                          aria-label={item.isPrivate ? 'Make Public' : 'Make Private'}
                        >
                          <Icon name={item.isPrivate ? 'globe' : 'lock'} size={14} />
                        </button>
                        <button
                          className="icon-btn icon-btn-sm"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingTrack(item.raw); setSongFormOpen(true); }}
                          title="Edit track"
                          aria-label="Edit track"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                      </>
                    )}
                    {item.canDelete && (
                      <button
                        className="icon-btn icon-btn-sm danger"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (item.isUpload) setDeletingTrack(item.raw);
                          else setDeleting(item.raw);
                        }}
                        aria-label={`Delete ${item.title}`}
                        title="Delete"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                )}
              />
            ))}
          </div>
        ) : (
          <div className="library-list">
            {filtered.map((item) => (
              <LibraryRow
                key={item.key}
                to={item.to}
                cover={item.cover}
                round={item.round}
                title={item.title}
                subtitle={`${item.type} • ${item.subtitle}`}
                meta={item.meta?.text}
                metaTone={item.meta?.tone}
                onPlay={item.onPlay}
                actions={(
                  <div className="row-actions-group">
                    {item.isUpload && (
                      <>
                        <button
                          className="icon-btn icon-btn-sm"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleTrackVisibility(item.raw); }}
                          title={item.isPrivate ? 'Make Public (Publish)' : 'Make Private'}
                        >
                          <Icon name={item.isPrivate ? 'globe' : 'lock'} size={14} />
                        </button>
                        <button
                          className="icon-btn icon-btn-sm"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingTrack(item.raw); setSongFormOpen(true); }}
                          title="Edit track"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                      </>
                    )}
                    {item.canDelete && (
                      <button
                        className="icon-btn icon-btn-sm danger"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (item.isUpload) setDeletingTrack(item.raw);
                          else setDeleting(item.raw);
                        }}
                        aria-label={`Delete ${item.title}`}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                )}
              />
            ))}
          </div>
        )}
      </section>

      {/* ======================= STORAGE SUMMARY ====================== */}
      <SummaryPanel
        percent={storagePct}
        title="Offline Storage"
        subtitle={storage.quota
          ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} used`
          : `${offlineCount} track${offlineCount === 1 ? '' : 's'} cached on this device`}
        stats={[
          { value: playlists.length, label: 'Playlists' },
          { value: albums.length, label: 'Albums' },
          { value: artists.length, label: 'Artists' },
          { value: songs.length, label: 'Tracks' },
          { value: podcasts.length, label: 'Shows' }
        ]}
        actions={(
          <>
            <button className="btn btn-ghost btn-sm" onClick={downloadAllLiked} disabled={downloadingAll}>
              <Icon name="download" size={15} />
              {downloadingAll ? 'Downloading…' : 'Download Liked Songs'}
            </button>
            <Link className="btn btn-ghost btn-sm" to="/downloads">
              <Icon name="storage" size={15} /> Manage Storage
            </Link>
          </>
        )}
      />

      {/* ============================ MODALS ========================== */}
      <PlaylistFormModal
        open={newPlaylistOpen}
        onClose={() => setNewPlaylistOpen(false)}
        onSaved={() => { load(); window.dispatchEvent(new CustomEvent('pulse-playlists-changed')); }}
        playlist={null}
      />
      <AlbumFormModal
        open={newAlbumOpen}
        onClose={() => setNewAlbumOpen(false)}
        onSaved={load}
        album={null}
        artists={artists}
        defaultArtistId={artist?.id}
      />
      <SongFormModal
        open={songFormOpen}
        onClose={() => { setSongFormOpen(false); setEditingTrack(null); }}
        onSaved={() => { load(); }}
        song={editingTrack}
        artists={artists}
        albums={albums}
        defaultArtistId={artist?.id}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deletePlaylist(deleting)}
        title="Delete playlist"
        message={deleting ? `Delete “${deleting.name}”? This cannot be undone.` : ''}
      />
      <ConfirmDialog
        open={!!deletingTrack}
        onClose={() => setDeletingTrack(null)}
        onConfirm={() => deletingTrack && deleteSong(deletingTrack)}
        title="Delete track"
        message={deletingTrack ? `Delete “${deletingTrack.title}”? This cannot be undone.` : ''}
      />
    </div>
  );
}
