import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import { Cover, EmptyState, PageHeader } from '../components/ui.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  downloadedPlaylists,
  downloadedSongs,
  removePlaylistDownloads,
  removeSong,
  clearAllDownloads,
  OFFLINE_EVENT
} from '../offline.js';

/* Your Downloads — everything saved for offline, like Spotify's Downloads.
   Reads only from the local store, so this page works with no network. */
export default function Downloads() {
  const { play } = usePlayer();
  const { toast } = useToast();
  const [playlists, setPlaylists] = useState([]);
  const [songs, setSongs] = useState([]);
  const [tab, setTab] = useState('playlists');

  const load = useCallback(() => {
    setPlaylists(downloadedPlaylists());
    setSongs(downloadedSongs());
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(OFFLINE_EVENT, load);
    return () => window.removeEventListener(OFFLINE_EVENT, load);
  }, [load]);

  const dropPlaylist = async (pl) => {
    await removePlaylistDownloads(pl.id);
    load();
    toast(`Removed "${pl.name}" from Downloads`);
  };

  const dropSong = async (song) => {
    await removeSong(song.id);
    load();
    toast('Removed from Downloads');
  };

  const clearAll = async () => {
    await clearAllDownloads();
    load();
    toast('Downloads cleared');
  };

  const total = playlists.length + songs.length;

  return (
    <div className="page">
      <PageHeader
        title="Downloads"
        subtitle={navigator.onLine
          ? 'Playlists and tracks you saved to this device — available even with no internet.'
          : 'You are offline — playing your downloaded library.'}
        actions={total > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={clearAll}>
            <Icon name="trash" size={15} /> Clear all
          </button>
        )}
      />

      {total === 0 ? (
        <EmptyState
          icon="download"
          title="No downloads yet"
          description='Hit "Download" on any playlist, or pick "Save to offline" from a track’s ⋮ menu. Downloaded items play anywhere — plane mode included.'
          action={<Link className="btn btn-primary" to="/playlists"><Icon name="playlist" size={16} /> Browse playlists</Link>}
        />
      ) : (
        <>
          <div className="auth-tabs downloads-tabs">
            <button className={`tab ${tab === 'playlists' ? 'active' : ''}`} onClick={() => setTab('playlists')}>Playlists ({playlists.length})</button>
            <button className={`tab ${tab === 'songs' ? 'active' : ''}`} onClick={() => setTab('songs')}>Songs ({songs.length})</button>
          </div>

          {tab === 'playlists' ? (
            playlists.length === 0 ? (
              <EmptyState icon="playlist" title="No playlists downloaded" description="Open a playlist and press Download to save it for offline." />
            ) : (
              <div className="media-grid">
                {playlists.map((pl) => (
                  <div key={pl.id} className="media-card offline-card">
                    <Link to={`/playlists/${pl.id}`} className="media-cover">
                      <Cover src={pl.cover_url} alt={pl.name} size="100%" />
                      <button
                        className="cover-play"
                        onClick={(e) => { e.preventDefault(); if (pl.songs?.length) play(pl.songs, 0); }}
                        aria-label="Play offline"
                        title="Play offline"
                      >
                        <Icon name="play" size={20} />
                      </button>
                      <div className="cover-count"><Icon name="download" size={13} />{pl.songs?.length || 0}</div>
                    </Link>
                    <div className="media-title-row">
                      <Link to={`/playlists/${pl.id}`} className="media-title">{pl.name}</Link>
                      <button className="icon-btn icon-btn-sm" onClick={() => dropPlaylist(pl)} aria-label="Remove download" title="Remove from downloads">
                        <Icon name="close" size={15} />
                      </button>
                    </div>
                    <div className="media-sub">Saved {new Date(pl.at).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <SongTable
              songs={songs.map((s) => ({
                id: s.id,
                title: s.title,
                artist_name: s.artist_name,
                cover_url: s.cover_url,
                duration_seconds: s.duration_seconds,
                file_path: s.audioUrl ? s.audioUrl.replace(window.location.origin, '') : null,
                plays: 0,
                downloads: 0
              }))}
              emptyFallback={<EmptyState icon="music" title="No single tracks downloaded" description="Use “Save to offline” in a track’s ⋮ menu." />}
              onDelete={(s) => dropSong(s)}
            />
          )}
        </>
      )}
    </div>
  );
}
