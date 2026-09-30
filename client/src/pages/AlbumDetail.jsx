import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import SongTable from '../components/SongTable.jsx';
import DiscoverRow from '../components/DiscoverRow.jsx';
import { Cover, Skeleton, EmptyState, SectionHead, Spinner } from '../components/ui.jsx';
import { useAddToPlaylistDialog } from '../components/Forms.jsx';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatLongDuration } from '../format.js';
import { downloadSong as saveOffline, hasPlayableAudio, isSongDownloaded, OFFLINE_EVENT } from '../offline.js';

export default function AlbumDetail() {
  const { id } = useParams();
  const { play } = usePlayer();
  const { toast } = useToast();
  const { open: openAdd, dialog: addDialog } = useAddToPlaylistDialog();

  const [album, setAlbum] = useState(null);
  const [moreFrom, setMoreFrom] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dl, setDl] = useState({ running: false, done: 0, total: 0 });
  const [, setOfflineTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/api/albums/${id}`)
      .then((d) => {
        if (!alive) return;
        setAlbum(d);
        setLoading(false);
        if (d.artist_id) {
          api.get(`/api/songs?artist_id=${d.artist_id}`).then((songs) => {
            if (!alive) return;
            const own = new Set((d.songs || []).map((s) => s.id));
            setMoreFrom((songs || []).filter((s) => !own.has(s.id)));
          }).catch(() => {});
        }
      })
      .catch((e) => { if (alive) { toast(e.message, 'error'); setLoading(false); } });

    api.get('/api/songs/recommended')
      .then((d) => { if (alive) setRecommended(d?.recommendations || []); })
      .catch(() => {});

    return () => { alive = false; };
  }, [id, toast]);

  useEffect(() => {
    const cb = () => setOfflineTick((t) => t + 1);
    window.addEventListener(OFFLINE_EVENT, cb);
    return () => window.removeEventListener(OFFLINE_EVENT, cb);
  }, []);

  const songs = useMemo(() => album?.songs || [], [album]);
  const totalDuration = useMemo(() => songs.reduce((t, s) => t + (s.duration_seconds || 0), 0), [songs]);
  const offlineCount = songs.filter((s) => isSongDownloaded(s.id)).length;

  const downloadAll = useCallback(async () => {
    const playable = songs.filter(hasPlayableAudio);
    if (!playable.length) { toast('No downloadable audio in this album yet', 'error'); return; }
    setDl({ running: true, done: 0, total: playable.length });
    let done = 0;
    for (const song of playable) {
      // eslint-disable-next-line no-await-in-loop
      const res = await saveOffline(song);
      if (res !== 'failed') done += 1;
      setDl({ running: true, done, total: playable.length });
    }
    setDl({ running: false, done: 0, total: 0 });
    toast(`Saved ${done} track${done === 1 ? '' : 's'} for offline`);
  }, [songs, toast]);

  const shuffle = () => {
    if (!songs.length) return;
    play(songs, Math.floor(Math.random() * songs.length));
  };

  if (loading) {
    return (
      <div className="page">
        <div className="detail-hero">
          <Skeleton w={208} h={208} r={16} />
          <div className="stack" style={{ flex: 1 }}>
            <Skeleton w="60%" h={40} /><Skeleton w="40%" h={16} /><Skeleton w="50%" h={16} />
          </div>
        </div>
      </div>
    );
  }
  if (!album) return <div className="page"><EmptyState icon="album" title="Album not found" description="This release may have been removed." action={<Link className="btn btn-primary" to="/albums">Back to albums</Link>} /></div>;

  return (
    <div className="page">
      <Link to="/albums" className="back-link"><Icon name="arrowLeft" size={16} /> Albums</Link>

      <div className="detail-hero">
        <div className="detail-hero-art">
          <Cover src={album.cover_url} alt={album.title} size="100%" />
        </div>
        <div className="detail-hero-info">
          <span className="eyebrow"><Icon name="album" size={13} /> Album</span>
          <h1>{album.title}</h1>
          <p className="detail-hero-sub">
            <Link to={`/artists/${album.artist_id}`}>{album.artist_name}</Link>
            <span className="cc-meta-dot" />
            {album.release_year || '—'}
            {album.genre && <><span className="cc-meta-dot" /><span className="tag tag-accent">{album.genre}</span></>}
            <span className="cc-meta-dot" />
            {songs.length} track{songs.length === 1 ? '' : 's'}
            {totalDuration > 0 && <><span className="cc-meta-dot" />{formatLongDuration(totalDuration)}</>}
            {offlineCount > 0 && <><span className="cc-meta-dot" /><span className="tag tag-green">{offlineCount} offline</span></>}
          </p>
          <div className="detail-actions">
            <button className="btn btn-play" onClick={() => songs.length && play(songs, 0)} disabled={!songs.length}>
              <Icon name="play" size={18} /> Play
            </button>
            <button className="btn btn-ghost btn-pill" onClick={shuffle} disabled={!songs.length}>
              <Icon name="shuffle" size={16} /> Shuffle
            </button>
            <button className="btn btn-ghost btn-pill" onClick={downloadAll} disabled={dl.running || !songs.length}>
              {dl.running ? <><Spinner size={15} /> {dl.done}/{dl.total}</> : <><Icon name="download" size={16} /> Download</>}
            </button>
          </div>
        </div>
      </div>

      <section className="section">
        <SectionHead icon="music" title="Tracks" note={`${songs.length} in this release`} />
        <SongTable
          songs={songs}
          showAlbum={false}
          onAddToPlaylist={openAdd}
          emptyFallback={<EmptyState icon="music" title="No tracks in this album yet" description="Tracks added to this album will show up here." action={<Link className="btn btn-primary" to="/upload"><Icon name="upload" size={16} /> Upload a track</Link>} />}
        />
      </section>

      {moreFrom.length > 0 && (
        <DiscoverRow title={`More from ${album.artist_name}`} icon="artist" songs={moreFrom} onPlay={play} seeAll={`/artists/${album.artist_id}`} />
      )}
      {recommended.length > 0 && (
        <DiscoverRow title="Recommended for you" icon="sparkle" songs={recommended} onPlay={play} />
      )}

      {addDialog}
    </div>
  );
}
