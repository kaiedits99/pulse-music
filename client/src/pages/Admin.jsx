import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { PageHero, SectionHead, EmptyState, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../api.js';
import { formatNumber, timeAgo } from '../format.js';

function StatCard({ icon, label, value, sub, tone }) {
  return (
    <div className="hub-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: tone === 'green' ? 'rgba(34,197,94,0.15)' : tone === 'accent' ? 'rgba(139,92,246,0.15)' : 'var(--card-2)', color: tone === 'green' ? '#22c55e' : tone === 'accent' ? '#8b5cf6' : 'var(--muted)' }}>
          <Icon name={icon} size={18} />
        </span>
        <span style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div> : null}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      className={active ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
      style={{ gap: 6 }}
    >
      <Icon name={icon} size={15} /> {children}
    </button>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState('analysis'); // analysis | technical
  const [techSub, setTechSub] = useState('songs'); // songs | users | health

  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState('');

  const [songs, setSongs] = useState([]);
  const [songsTotal, setSongsTotal] = useState(0);
  const [songsQ, setSongsQ] = useState('');
  const [songsVisibility, setSongsVisibility] = useState('all');
  const [songsLoading, setSongsLoading] = useState(false);

  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersQ, setUsersQ] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  const [editing, setEditing] = useState(null); // song being edited
  const [editForm, setEditForm] = useState({ title: '', genre: '', artist_name: '', is_public: 1 });
  const [savingEdit, setSavingEdit] = useState(false);

  const isAdmin = user?.role === 'admin';

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true); setOverviewError('');
    try {
      const data = await api.get('/api/admin/overview');
      setOverview(data);
    } catch (e) {
      setOverviewError(e.message || 'Failed to load overview');
    } finally { setLoadingOverview(false); }
  }, []);

  const loadSongs = useCallback(async () => {
    setSongsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (songsQ.trim()) qs.set('q', songsQ.trim());
      if (songsVisibility !== 'all') qs.set('visibility', songsVisibility);
      qs.set('limit', '50');
      const data = await api.get(`/api/admin/songs?${qs.toString()}`);
      setSongs(data.songs || []); setSongsTotal(data.total || 0);
    } catch (e) { toast(e.message || 'Failed to load songs', 'error'); }
    finally { setSongsLoading(false); }
  }, [songsQ, songsVisibility, toast]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const qs = new URLSearchParams();
      if (usersQ.trim()) qs.set('q', usersQ.trim());
      qs.set('limit', '50');
      const data = await api.get(`/api/admin/users?${qs.toString()}`);
      setUsers(data.users || []); setUsersTotal(data.total || 0);
    } catch (e) { toast(e.message || 'Failed to load users', 'error'); }
    finally { setUsersLoading(false); }
  }, [usersQ, toast]);

  useEffect(() => { if (isAdmin) loadOverview(); }, [isAdmin, loadOverview]);
  useEffect(() => { if (isAdmin && tab === 'technical' && techSub === 'songs') loadSongs(); }, [isAdmin, tab, techSub, loadSongs]);
  useEffect(() => { if (isAdmin && tab === 'technical' && techSub === 'users') loadUsers(); }, [isAdmin, tab, techSub, loadUsers]);

  if (!isAdmin) {
    return (
      <div className="page">
        <PageHero icon="shield" title="Admin" subtitle="Restricted area" />
        <section className="section">
          <EmptyState icon="lock" title="Admin only" description="You need an admin account (Kelechi / kai99) to view this page." action={<Link className="btn btn-primary" to="/">Back to home</Link>} />
        </section>
      </div>
    );
  }

  const c = overview?.counts;

  const handleEditOpen = (song) => {
    setEditing(song);
    setEditForm({ title: song.title || '', genre: song.genre || '', artist_name: song.artist_name || '', is_public: song.is_public ? 1 : 0 });
  };

  const handleEditSave = async () => {
    if (!editing) return;
    const title = editForm.title.trim();
    if (!title) { toast('Title cannot be empty', 'error'); return; }
    setSavingEdit(true);
    try {
      const updated = await api.put(`/api/admin/songs/${editing.id}`, {
        title,
        genre: editForm.genre.trim(),
        artist_name: editForm.artist_name.trim(),
        is_public: Number(editForm.is_public)
      });
      setSongs(prev => prev.map(s => s.id === editing.id ? { ...s, ...updated.song } : s));
      // If we have overview, patch recent songs as well
      setOverview(o => o ? { ...o, recentSongs: (o.recentSongs || []).map(s => s.id === editing.id ? { ...s, title, genre: editForm.genre.trim(), artist_name: editForm.artist_name.trim() || s.artist_name, is_public: Number(editForm.is_public) } : s) } : o);
      toast('Track updated');
      setEditing(null);
    } catch (e) { toast(e.message || 'Failed to update track', 'error'); }
    finally { setSavingEdit(false); }
  };

  const handleBanToggle = async (song) => {
    const willBan = Number(song.is_public) === 1;
    try {
      if (willBan) await api.post(`/api/admin/songs/${song.id}/ban`);
      else await api.post(`/api/admin/songs/${song.id}/unban`);
      setSongs(prev => prev.map(s => s.id === song.id ? { ...s, is_public: willBan ? 0 : 1 } : s));
      toast(willBan ? `Banned “${song.title}” (now hidden)` : `Unbanned “${song.title}” (now public)`);
    } catch (e) { toast(e.message || 'Action failed', 'error'); }
  };

  const handleDeleteSong = async (song) => {
    if (!confirm(`Delete “${song.title}” permanently? This cannot be undone.`)) return;
    try {
      await api.del(`/api/admin/songs/${song.id}`);
      setSongs(prev => prev.filter(s => s.id !== song.id));
      setOverview(o => o ? { ...o, counts: { ...o.counts, songs: Math.max(0, (o.counts.songs || 1) - 1) } } : o);
      toast(`Deleted “${song.title}”`);
    } catch (e) { toast(e.message || 'Failed to delete', 'error'); }
  };

  const handleDeleteUser = async (u) => {
    if (!confirm(`Delete user “${u.username || u.name}” and all their content? This cannot be undone.`)) return;
    try {
      await api.del(`/api/admin/users/${u.id}`);
      setUsers(prev => prev.filter(x => x.id !== u.id));
      setOverview(o => o ? { ...o, counts: { ...o.counts, users: Math.max(0, (o.counts.users || 1) - 1) } } : o);
      toast(`Deleted user ${u.username || u.name}`);
    } catch (e) { toast(e.message || 'Failed to delete user', 'error'); }
  };

  return (
    <div className="page">
      <PageHero
        icon="shield"
        title="Admin"
        chip={`Kelechi · kai99`}
        subtitle="Analysis & technical controls. Edit any track, ban or delete songs, audit users, and monitor health."
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { loadOverview(); if (techSub === 'songs') loadSongs(); if (techSub === 'users') loadUsers(); }} title="Refresh">
              <Icon name="refresh" size={15} /> Refresh
            </button>
            <Link className="btn btn-ghost btn-sm" to="/settings"><Icon name="settings" size={15} /> Settings</Link>
          </>
        }
      />

      <div className="toolbar" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <TabButton active={tab === 'analysis'} onClick={() => setTab('analysis')} icon="trending">Analysis</TabButton>
          <TabButton active={tab === 'technical'} onClick={() => setTab('technical')} icon="settings">Technical</TabButton>
        </div>
        <div className="toolbar-right" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
          {overview?.generated_at ? <span>Updated {timeAgo(overview.generated_at)} ago</span> : null}
          <span className="pill" style={{ background: 'var(--card-2)', padding: '4px 8px', borderRadius: 999 }}><Icon name="users" size={12} /> {c ? formatNumber(c.users) : '—'} users · {c ? formatNumber(c.songs) : '—'} tracks</span>
        </div>
      </div>

      {tab === 'analysis' ? (
        <>
          {loadingOverview ? (
            <div style={{ padding: 40, display: 'grid', placeItems: 'center' }}><Spinner size={22} /></div>
          ) : overviewError ? (
            <section className="section">
              <EmptyState icon="warning" title="Could not load analytics" description={overviewError} action={<button className="btn btn-primary btn-sm" onClick={loadOverview}>Retry</button>} />
            </section>
          ) : (
            <>
              <section className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 12 }}>
                <StatCard icon="users" label="Total users" value={formatNumber(c.users)} sub="Registered accounts" />
                <StatCard icon="music" label="Total songs" value={formatNumber(c.songs)} sub={`${formatNumber(c.publicSongs)} public · ${formatNumber(c.privateSongs)} private`} tone={c.privateSongs ? 'accent' : undefined} />
                <StatCard icon="playCircle" label="Total plays" value={formatNumber(c.plays)} sub="All-time stream count" tone="green" />
                <StatCard icon="download" label="Downloads" value={formatNumber(c.downloads)} sub="All-time" />
                <StatCard icon="artist" label="Artists" value={formatNumber(c.artists)} sub={`${formatNumber(c.albums)} albums`} />
                <StatCard icon="playlist" label="Playlists" value={formatNumber(c.playlists)} sub={`${formatNumber(c.podcasts)} podcasts · ${formatNumber(c.episodes)} episodes`} />
                <StatCard icon="heart" label="Favorites" value={formatNumber(c.favorites)} sub="Likes / saves" />
                <StatCard icon="broadcast" label="People on site" value={formatNumber(c.users)} sub={`Total accounts · ${overview?.recentUsers?.length || 0} recent sign-ups`} tone="accent" />
              </section>

              <section className="section" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(280px,.9fr)', gap: 16 }}>
                <div className="panel" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
                  <SectionHead icon="trending" title="Site usage" note={`${formatNumber(c.plays)} plays · ${formatNumber(c.downloads)} downloads`} />
                  <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)' }}><span>Public tracks</span><span style={{ fontWeight: 700, color: 'var(--text)' }}>{formatNumber(c.publicSongs)} / {formatNumber(c.songs)}</span></div>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--card-2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${c.songs ? Math.round((c.publicSongs / c.songs) * 100) : 0}%`, background: 'linear-gradient(90deg,#8b5cf6,#06b6d4)', borderRadius: 999 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      {(overview.topGenres || []).map(g => (
                        <span key={g.genre} className="chip" style={{ fontSize: 12 }}>{g.genre} · {g.c}</span>
                      ))}
                      {(!overview.topGenres || !overview.topGenres.length) ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>No genre data yet.</span> : null}
                    </div>
                    <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ background: 'var(--card-2)', borderRadius: 12, padding: 12 }}>
                        <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Storage / persistence</div>
                        <div style={{ marginTop: 6, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {overview.storage?.durable ? <Icon name="checkCircle" size={14} /> : <Icon name="warning" size={14} />}
                          <span style={{ fontWeight: 600 }}>{overview.storage?.describe || overview.storage?.kind || '—'}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{overview.storage?.persistent ? 'Durable (Litestream or fallback)' : 'Ephemeral — will lose data on restart'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{overview.storage?.uploadsOnDisk != null ? `${overview.storage.uploadsOnDisk} files on disk` : null} {c?.uploadsOnDisk != null ? `· ${c.uploadsOnDisk} uploads on disk` : ''}</div>
                      </div>
                      <div style={{ background: 'var(--card-2)', borderRadius: 12, padding: 12 }}>
                        <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Recent activity</div>
                        <div style={{ fontSize: 13, marginTop: 6 }}>{overview.recentSongs?.length || 0} new tracks · {overview.recentUsers?.length || 0} new users (latest 10)</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Total plays {formatNumber(c.plays)} · avg {c.songs ? Math.round((c.plays || 0) / c.songs) : 0} plays / track</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 16 }}>
                  <div className="panel" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
                    <SectionHead icon="users" title="Recent users" note={`${overview.recentUsers?.length || 0} latest`} />
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                      {(overview.recentUsers || []).slice(0, 6).map(u => (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                          <span style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--card-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={u.role === 'admin' ? 'crown' : 'artist'} size={14} /></span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>@{u.username || '—'}</span> {u.role === 'admin' ? <span style={{ background: '#8b5cf6', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 999, verticalAlign: 'middle' }}>ADMIN</span> : null}</div>
                            <div style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email} · {timeAgo(u.created_at) || 'just now'}</div>
                          </div>
                        </div>
                      ))}
                      {(!overview.recentUsers || !overview.recentUsers.length) ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>No users yet.</div> : null}
                    </div>
                  </div>

                  <div className="panel" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
                    <SectionHead icon="music" title="Recent tracks" note={`${overview.recentSongs?.length || 0} latest`} />
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                      {(overview.recentSongs || []).slice(0, 6).map(s => (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                          <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--card-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="music" size={14} /></span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
                            <div style={{ color: 'var(--muted)', fontSize: 11 }}>{s.artist_name || 'Unknown'} · {s.genre || 'no genre'} · {s.is_public ? 'public' : 'private'} · {s.plays || 0} plays</div>
                          </div>
                        </div>
                      ))}
                      {(!overview.recentSongs || !overview.recentSongs.length) ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>No tracks yet.</div> : null}
                    </div>
                  </div>
                </div>
              </section>

              <section className="section panel" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
                <SectionHead icon="storage" title="How Pulse keeps your data safe" note={overview.storage?.durable ? 'Durable' : 'Check config'} />
                <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
                  Litestream continuously replicates the SQLite file to your bucket when <code>start:render</code> is used. A fallback bucket snapshot at <code>fallback/pulse.db</code> saves a copy every ~15 s if Litestream is not running.
                  Your audio lives wherever <code>media.js</code> says: S3/R2 when <code>PULSE_S3_BUCKET</code> is set, otherwise on the VM disk. Check <code>/api/health</code> for the live “durable / persistent” verdict.
                </p>
              </section>
            </>
          )}
        </>
      ) : (
        <>
          <div className="toolbar" style={{ gap: 8, marginTop: 4 }}>
            <div className="row" style={{ gap: 6 }}>
              <button className={techSub === 'songs' ? 'chip active' : 'chip'} onClick={() => setTechSub('songs')}><Icon name="music" size={13} /> Songs</button>
              <button className={techSub === 'users' ? 'chip active' : 'chip'} onClick={() => setTechSub('users')}><Icon name="users" size={13} /> Users</button>
              <button className={techSub === 'health' ? 'chip active' : 'chip'} onClick={() => setTechSub('health')}><Icon name="storage" size={13} /> Health &amp; System</button>
            </div>
            {techSub === 'songs' ? (
              <div className="toolbar-right" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative' }}>
                  <Icon name="search" size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                  <input value={songsQ} onChange={e => setSongsQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadSongs()} placeholder="Search title, artist, genre…" style={{ padding: '7px 10px 7px 28px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card-2)', fontSize: 13, width: 220 }} />
                </div>
                <select value={songsVisibility} onChange={e => setSongsVisibility(e.target.value)} style={{ padding: '7px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card-2)', fontSize: 13 }}>
                  <option value="all">All visibility</option>
                  <option value="public">Public only</option>
                  <option value="private">Private / banned</option>
                </select>
                <button className="btn btn-primary btn-sm" onClick={loadSongs}><Icon name="search" size={14} /> Search</button>
              </div>
            ) : techSub === 'users' ? (
              <div className="toolbar-right" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <Icon name="search" size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                  <input value={usersQ} onChange={e => setUsersQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadUsers()} placeholder="Search name, @handle, email…" style={{ padding: '7px 10px 7px 28px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card-2)', fontSize: 13, width: 240 }} />
                </div>
                <button className="btn btn-primary btn-sm" onClick={loadUsers}><Icon name="search" size={14} /> Search</button>
              </div>
            ) : null}
          </div>

          {techSub === 'songs' ? (
            <section className="section panel" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 800 }}>All tracks</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{songsTotal} total · edit any song metadata, ban (hide) or delete permanently</div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{songsLoading ? 'Loading…' : `${songs.length} shown`}</span>
              </div>
              {songsLoading ? (
                <div style={{ padding: 32, display: 'grid', placeItems: 'center' }}><Spinner size={20} /></div>
              ) : !songs.length ? (
                <div style={{ padding: 24 }}><EmptyState icon="music" title="No tracks match" description="Try a different search or visibility filter." /></div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Title / artist</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Genre</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Uploaded by</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Plays</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>Visibility</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {songs.map(s => (
                        <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: 700, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
                            <div style={{ color: 'var(--muted)', fontSize: 11, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.artist_name || 'Unknown'} {s.album_title ? `· ${s.album_title}` : ''} <span style={{ opacity: .6 }}>#{s.id}</span></div>
                          </td>
                          <td style={{ padding: '10px 12px' }}><span className="chip" style={{ fontSize: 11 }}>{s.genre || '—'}</span></td>
                          <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>{s.uploaded_by_username ? `@${s.uploaded_by_username}` : s.uploaded_by_name || '—'}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(s.plays || 0)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>{Number(s.is_public) ? <span style={{ fontSize: 11, background: 'rgba(34,197,94,.14)', color: '#16a34a', padding: '3px 8px', borderRadius: 999, fontWeight: 700 }}>PUBLIC</span> : <span style={{ fontSize: 11, background: 'rgba(239,68,68,.12)', color: '#dc2626', padding: '3px 8px', borderRadius: 999, fontWeight: 700 }}>BANNED / PRIVATE</span>}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => handleEditOpen(s)} title="Edit metadata"><Icon name="edit" size={13} /> Edit</button>
                              <button className={Number(s.is_public) ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'} onClick={() => handleBanToggle(s)} title={Number(s.is_public) ? 'Ban (hide from site)' : 'Unban (make public)'}>
                                <Icon name={Number(s.is_public) ? 'eyeOff' : 'eye'} size={13} /> {Number(s.is_public) ? 'Ban' : 'Unban'}
                              </button>
                              <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={() => handleDeleteSong(s)} title="Delete permanently"><Icon name="trash" size={13} /> Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Showing up to 50. Use search to find more.</span>
                <button className="btn btn-ghost btn-sm" onClick={loadSongs}><Icon name="refresh" size={13} /> Reload</button>
              </div>
            </section>
          ) : techSub === 'users' ? (
            <section className="section panel" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 800 }}>Users</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{usersTotal} total · search and delete any non-admin account</div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{usersLoading ? 'Loading…' : `${users.length} shown`}</span>
              </div>
              {usersLoading ? (
                <div style={{ padding: 32, display: 'grid', placeItems: 'center' }}><Spinner size={20} /></div>
              ) : !users.length ? (
                <div style={{ padding: 24 }}><EmptyState icon="users" title="No users match" description="Try a different search term." /></div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>User</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Email</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Role</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Joined</th>
                        <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: 700 }}>{u.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>@{u.username || '—'}</span> <span style={{ opacity: .5, fontSize: 11 }}>#{u.id}</span></div>
                            <div style={{ color: 'var(--muted)', fontSize: 11 }}>consent: {u.consent_terms_at ? '✓ terms' : '—'} {u.consent_age_at ? '✓ age' : ''}</div>
                          </td>
                          <td style={{ padding: '10px 12px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</td>
                          <td style={{ padding: '10px 12px' }}>{u.role === 'admin' ? <span style={{ background: '#8b5cf6', color: '#fff', fontSize: 10, padding: '3px 8px', borderRadius: 999, fontWeight: 800 }}>ADMIN</span> : <span style={{ background: 'var(--card-2)', padding: '3px 8px', borderRadius: 999, fontSize: 11 }}>{u.role}</span>}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{timeAgo(u.created_at) || u.created_at}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {u.id === user.id ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>You</span>
                            ) : u.role === 'admin' ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Protected</span>
                            ) : (
                              <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={() => handleDeleteUser(u)}><Icon name="trash" size={13} /> Delete</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Deleting a user removes their songs, albums, playlists and artist profile.</span>
                <button className="btn btn-ghost btn-sm" onClick={loadUsers}><Icon name="refresh" size={13} /> Reload</button>
              </div>
            </section>
          ) : (
            <section className="section" style={{ display: 'grid', gap: 16 }}>
              <div className="panel" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
                <SectionHead icon="storage" title="Health & system" note={overview ? (overview.storage?.durable ? 'Durable' : 'Not durable') : '—'} />
                {overview ? (
                  <div style={{ display: 'grid', gap: 12, marginTop: 12, fontSize: 13, lineHeight: 1.6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8 }}>
                      <span style={{ color: 'var(--muted)' }}>Replicated (Litestream)</span><span style={{ fontWeight: 700 }}>{String(overview.storage?.replicated)}</span>
                      <span style={{ color: 'var(--muted)' }}>Persistent disk</span><span style={{ fontWeight: 700 }}>{String(overview.storage?.persistentDisk)}</span>
                      <span style={{ color: 'var(--muted)' }}>Fallback bucket</span><span style={{ fontWeight: 700 }}>{String(overview.storage?.fallback)}</span>
                      <span style={{ color: 'var(--muted)' }}>Kind / describe</span><span><code style={{ background: 'var(--card-2)', padding: '2px 6px', borderRadius: 6 }}>{overview.storage?.kind}</code> · {overview.storage?.describe}</span>
                      <span style={{ color: 'var(--muted)' }}>Persistent?</span><span style={{ fontWeight: 700, color: overview.storage?.persistent ? '#16a34a' : '#dc2626' }}>{String(overview.storage?.persistent)}</span>
                      <span style={{ color: 'var(--muted)' }}>Durable?</span><span style={{ fontWeight: 700, color: overview.storage?.durable ? '#16a34a' : '#dc2626' }}>{String(overview.storage?.durable)}</span>
                      <span style={{ color: 'var(--muted)' }}>Disk uploads</span><span>{c.uploadsOnDisk} files in {`{dataDir}/uploads`}</span>
                    </div>
                    <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
                      The live verdict is also available at <Link to="/api/health" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>/api/health</Link> (unauthenticated). Expected in production: <code>replicated = true</code> via Litestream <em>or</em> <code>fallback = true</code> — both count as <em>durable</em> and pass the 55-test “persistent” suite.
                    </p>
                  </div>
                ) : (
                  <div style={{ padding: 20, display: 'grid', placeItems: 'center' }}><Spinner size={18} /></div>
                )}
              </div>
              <div className="panel" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
                <SectionHead icon="info" title="Admin privileges" note="What you can do on this page" />
                <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                  <li><strong style={{ color: 'var(--text)' }}>Change metadata</strong> of any song — title, genre, artist name, visibility (Songs → Edit).</li>
                  <li><strong style={{ color: 'var(--text)' }}>Ban / unban</strong> tracks — marks them private so regular listeners cannot see them (Ban button); unban restores public visibility.</li>
                  <li><strong style={{ color: 'var(--text)' }}>Delete</strong> any track or user (and all their uploads) — destructive, requires confirmation.</li>
                  <li><strong style={{ color: 'var(--text)' }}>Analysis</strong> — site-wide counts (users, tracks, plays, downloads, genres), recent sign-ups &amp; uploads, storage health, “people on site”.</li>
                  <li>Signed in as <strong style={{ color: 'var(--text)' }}>{user.name} (@{user.username})</strong> · <code style={{ background: 'var(--card-2)', padding: '2px 6px', borderRadius: 6 }}>inputname9@aol.com</code> · role <code>{user.role}</code>.</li>
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      {/* Edit modal */}
      {editing ? (
        <div role="dialog" aria-modal="true" aria-label={`Edit ${editing.title}`} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onClick={() => setEditing(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }} />
          <div className="panel" style={{ position: 'relative', width: 'min(560px,100%)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 18, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="edit" size={16} /> Edit track <span style={{ color: 'var(--muted)', fontWeight: 400 }}>#{editing.id}</span></h3>
              <button className="icon-btn" onClick={() => setEditing(null)} aria-label="Close"><Icon name="close" size={16} /></button>
            </div>
            <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>Title</span>
                <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} maxLength={200} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-2)', fontSize: 14 }} placeholder="Song title" />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>Genre</span>
                <input value={editForm.genre} onChange={e => setEditForm(f => ({ ...f, genre: e.target.value }))} maxLength={80} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-2)', fontSize: 14 }} placeholder="e.g. Afrobeats" />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>Artist name (updates the linked artist profile)</span>
                <input value={editForm.artist_name} onChange={e => setEditForm(f => ({ ...f, artist_name: e.target.value }))} maxLength={120} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-2)', fontSize: 14 }} placeholder="Artist display name" />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>Visibility</span>
                <select value={String(editForm.is_public)} onChange={e => setEditForm(f => ({ ...f, is_public: Number(e.target.value) }))} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-2)', fontSize: 14 }}>
                  <option value="1">Public — visible to everyone</option>
                  <option value="0">Banned / Private — hidden from site</option>
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={savingEdit}>Cancel</button>
                <button className="btn btn-primary" onClick={handleEditSave} disabled={savingEdit} style={{ minWidth: 110 }}>
                  {savingEdit ? 'Saving…' : 'Save changes'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>Admins can edit any track on Pulse. Changes apply immediately.</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
