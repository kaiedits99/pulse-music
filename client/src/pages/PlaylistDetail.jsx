import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import { Cover, Skeleton, EmptyState, Spinner, SectionHead } from '../components/ui.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { PlaylistFormModal, useAddToPlaylistDialog } from '../components/Forms.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatLongDuration } from '../format.js';
import {
  downloadPlaylist,
  removePlaylistDownloads,
  isPlaylistDownloaded,
  downloadedPlaylists,
  OFFLINE_EVENT
} from '../offline.js';

export default function PlaylistDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { play } = usePlayer();
  const { toast } = useToast();
  const { user } = useAuth();
  const { open: openAdd, dialog: addDialog } = useAddToPlaylistDialog();

  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineView, setOfflineView] = useState(false); // rendered from a downloaded snapshot
  const [dl, setDl] = useState({ state: 'idle', done: 0, total: 0 }); // idle|running|done
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, setOfflineTick] = useState(0);

  const plId = Number(id);
  const isOwner = playlist && user && (user.role === 'admin' || playlist.user_id === user.id);
  const downloaded = playlist ? isPlaylistDownloaded(plId) : false;

  const load = useCallback(async () => {
    try {
      setPlaylist(await api.get(`/api/playlists/${id}`));
      setOfflineView(false);
    } catch (err) {
      // Offline (or gone): fall back to the downloaded snapshot.
      try {
        const snap = downloadedPlaylists().find((p) => p.id === plId);
        if (snap) {
          setPlaylist({ id: snap.id, name: snap.name, description: snap.description, cover_url: snap.cover_url, user_id: snap.user_id, songs: snap.songs });
          setOfflineView(true);
        } else {
          toast(err.message || 'Could not load playlist', 'error');
        }
      } catch { toast(err.message || 'Could not load playlist', 'error'); }
    } finally { setLoading(false); }
  }, [id, plId, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const cb = () => setOfflineTick((t) => t + 1);
    window.addEventListener(OFFLINE_EVENT, cb);
    return () => window.removeEventListener(OFFLINE_EVENT, cb);
  }, []);

  const songs = useMemo(() => playlist?.songs || [], [playlist]);
  const totalDuration = useMemo(() => songs.reduce((t, s) => t + (s.duration_seconds || 0), 0), [songs]);
  const empty = songs.length === 0;

  const toggleDownload = async () => {
    if (dl.state === 'running') return;
    if (downloaded) {
      await removePlaylistDownloads(plId);
      setDl({ state: 'idle', done: 0, total: 0 });
      toast('Removed from Downloads');
      return;
    }
    setDl({ state: 'running', done: 0, total: songs.length });
    try {
      const res = await downloadPlaylist(playlist, ({ done, total }) => setDl({ state: 'running', done, total }));
      setDl({ state: 'done', done: res.downloaded, total: res.downloaded });
      toast(res.downloaded
        ? `Downloaded ${res.downloaded} track(s) for offline${res.skipped ? ` · ${res.skipped} without audio skipped` : ''}`
        : 'Nothing to download — no tracks with audio yet', res.downloaded ? 'success' : 'error');
    } catch {
      setDl({ state: 'idle', done: 0, total: 0 });
      toast('Download failed', 'error');
    }
  };

  const removeSong = async (song) => {
    try {
      await api.del(`/api/playlists/${id}/songs/${song.id}`);
      setPlaylist((p) => ({ ...p, songs: p.songs.filter((s) => s.id !== song.id) }));
      toast('Removed from playlist');
    } catch (err) { toast(err.message, 'error'); }
  };

  const doDelete = async () => {
    try {
      await api.del(`/api/playlists/${id}`);
      await removePlaylistDownloads(plId).catch(() => {});
      window.dispatchEvent(new CustomEvent('pulse-playlists-changed'));
      toast('Playlist deleted');
      navigate('/playlists');
    } catch (err) { toast(err.message, 'error'); }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="detail-hero">
          <Skeleton w={208} h={208} r={16} />
          <div className="stack" style={{ flex: 1 }}>
            <Skeleton w="50%" h={40} /><Skeleton w="40%" h={16} /><Skeleton w="30%" h={16} />
          </div>
        </div>
      </div>
    );
  }
  if (!playlist) {
    return (
      <div className="page">
        <EmptyState
          icon="playlist"
          title="Playlist not found"
          description="It may have been deleted, or it was never downloaded for offline use."
          action={<Link className="btn btn-primary" to="/playlists">Back to playlists</Link>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/playlists" className="back-link"><Icon name="arrowLeft" size={16} /> Playlists</Link>

      {offlineView && (
        <div className="offline-banner"><Icon name="download" size={14} /> Offline — playing your downloaded copy of this playlist</div>
      )}

      <div className="detail-hero">
        <div className="detail-hero-art">
          <Cover src={playlist.cover_url} alt={playlist.name} size="100%" />
        </div>
        <div className="detail-hero-info">
          <span className="eyebrow"><Icon name="playlist" size={13} /> Playlist</span>
          <h1>{playlist.name}</h1>
          {playlist.description && <p className="detail-hero-bio">{playlist.description}</p>}
          <p className="detail-hero-sub">
            {playlist.creator_name && <>{playlist.creator_name}<span className="cc-meta-dot" /></>}
            {songs.length} track{songs.length === 1 ? '' : 's'}
            {totalDuration > 0 && <><span className="cc-meta-dot" />{formatLongDuration(totalDuration)}</>}
            {downloaded && <span className="downloaded-chip"><Icon name="check" size={12} /> Downloaded</span>}
          </p>
          <div className="detail-actions">
            <button className="btn btn-play" onClick={() => !empty && play(songs, 0)} disabled={empty}>
              <Icon name="play" size={18} /> Play
            </button>
            <button
              className="btn btn-ghost btn-pill"
              onClick={() => !empty && play(songs, Math.floor(Math.random() * songs.length))}
              disabled={empty}
            >
              <Icon name="shuffle" size={16} /> Shuffle
            </button>
            {!offlineView && (
              <button
                className={`btn btn-pill ${downloaded ? 'btn-downloaded' : 'btn-ghost'}`}
                onClick={toggleDownload}
                disabled={dl.state === 'running' || empty}
                title={downloaded ? 'Remove all downloads for this playlist' : 'Save every track for offline listening'}
              >
                {dl.state === 'running' ? (
                  <><Spinner size={15} /> {dl.done}/{dl.total}…</>
                ) : downloaded ? (
                  <><Icon name="checkCircle" size={16} /> Downloaded</>
                ) : (
                  <><Icon name="download" size={16} /> Download</>
                )}
              </button>
            )}
            {isOwner && !offlineView && (
              <>
                <button className="icon-btn" onClick={() => setEditOpen(true)} aria-label="Edit playlist" title="Edit details">
                  <Icon name="edit" size={17} />
                </button>
                <button className="icon-btn danger" onClick={() => setConfirmDelete(true)} aria-label="Delete playlist" title="Delete playlist">
                  <Icon name="trash" size={17} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <section className="section">
        <SectionHead icon="music" title="Tracks" note={empty ? 'Nothing here yet' : `${songs.length} in this playlist`} />
        <SongTable
          songs={songs}
          showAlbum
          showPlays={false}
          onAddToPlaylist={openAdd}
          onDelete={isOwner && !offlineView ? (s) => removeSong(s) : undefined}
          emptyFallback={(
            <EmptyState
              icon="playlist"
              title="This playlist is empty"
              description="Add tracks from Search, an album page, or the ⋮ menu on any row."
              action={<Link className="btn btn-primary" to="/search"><Icon name="search" size={16} /> Find tracks</Link>}
            />
          )}
        />
      </section>

      {addDialog}
      <PlaylistFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => { load(); window.dispatchEvent(new CustomEvent('pulse-playlists-changed')); }} playlist={playlist} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={doDelete} title="Delete playlist" message={`Delete “${playlist.name}”? This also removes its offline downloads.`} />
    </div>
  );
}
