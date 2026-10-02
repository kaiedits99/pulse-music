import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { ArtistCard, LibraryRow } from '../components/Cards.jsx';
import { PageHero, SectionHead, SortMenu, ViewToggle, EmptyState, GridSkeleton } from '../components/ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { formatNumber } from '../format.js';

const SORTS = [
  { id: 'followers', label: 'Most followers' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'tracks', label: 'Most tracks' },
  { id: 'genre', label: 'By genre' }
];

export default function Artists() {
  const { toast } = useToast();
  const { play } = usePlayer();

  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('followers');
  const [view, setView] = useState('grid');
  const [genre, setGenre] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // A profile is created at sign-up; it only belongs on this page once there is music to hear.
      const all = await api.get('/api/artists');
      setArtists(all.filter((a) => (a.song_count || 0) > 0));
    }
    catch (err) { toast(err.message || 'Could not load artists', 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const playArtist = async (a) => {
    try {
      const detail = await api.get(`/api/artists/${a.id}`);
      if (detail.songs?.length) { play(detail.songs, 0); toast(`Playing ${a.name}`); }
      else toast('This artist has no tracks yet', 'info');
    } catch (err) { toast(err.message || 'Could not play artist', 'error'); }
  };

  const genres = useMemo(() => {
    const set = new Set(artists.map((a) => a.genre).filter(Boolean));
    return Array.from(set).sort();
  }, [artists]);

  const sorted = useMemo(() => {
    let list = genre ? artists.filter((a) => a.genre === genre) : [...artists];
    list = [...list];
    if (sort === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'tracks') list.sort((a, b) => (b.song_count || 0) - (a.song_count || 0));
    else if (sort === 'genre') list.sort((a, b) => (a.genre || '').localeCompare(b.genre || ''));
    else list.sort((a, b) => (b.followers || 0) - (a.followers || 0));
    return list;
  }, [artists, sort, genre]);

  const totalFollowers = artists.reduce((t, a) => t + (a.followers || 0), 0);

  return (
    <div className="page">
      <PageHero
        icon="artist"
        iconVariant="round"
        title="Artists"
        chip={`${artists.length} on Pulse`}
        subtitle={`${formatNumber(totalFollowers)} combined listeners across ${genres.length} genre${genres.length === 1 ? '' : 's'}.`}
        actions={<Link className="btn btn-primary" to="/upload"><Icon name="upload" size={17} /> Publish as artist</Link>}
      />

      <div className="toolbar">
        <div className="chip-row chip-row--scroll">
          <button className={`chip ${!genre ? 'active' : ''}`} onClick={() => setGenre('')}>All genres</button>
          {genres.map((g) => (
            <button key={g} className={`chip ${genre === g ? 'active' : ''}`} onClick={() => setGenre(g)}>{g}</button>
          ))}
        </div>
        <div className="toolbar-right">
          <SortMenu options={SORTS} value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      <section className="section">
        <SectionHead
          title={genre || 'All artists'}
          note={loading ? 'Loading…' : `Showing ${sorted.length} item${sorted.length === 1 ? '' : 's'}`}
        />

        {loading ? (
          <GridSkeleton count={8} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon="artist"
            title="No artists here"
            description={genre ? `Nobody is tagged with “${genre}” yet.` : 'Artists appear as soon as music is published on Pulse.'}
            action={genre
              ? <button className="btn btn-ghost" onClick={() => setGenre('')}>Clear filter</button>
              : <Link className="btn btn-primary" to="/upload"><Icon name="upload" size={16} /> Upload music</Link>}
          />
        ) : view === 'grid' ? (
          <div className="collection-grid">
            {sorted.map((a) => <ArtistCard key={a.id} artist={a} onPlay={playArtist} />)}
          </div>
        ) : (
          <div className="library-list">
            {sorted.map((a) => (
              <LibraryRow
                key={a.id}
                to={`/artists/${a.id}`}
                cover={a.avatar_url}
                round
                title={a.name}
                subtitle={`${a.genre || 'Artist'}${a.country ? ` • ${a.country}` : ''}`}
                meta={`${formatNumber(a.followers)} listeners`}
                onPlay={() => playArtist(a)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
