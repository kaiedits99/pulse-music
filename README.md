# Pulse — Music Streaming Platform for Artists

A full-stack music streaming platform where artists can upload tracks, manage albums and
playlists, stream their catalog, and download tracks — with a polished dashboard and
realistic demo data so it feels alive on first load.

## Tech stack

- **Frontend:** React 18 + React Router + Vite, custom CSS design system (dark theme)
- **Backend:** Node.js + Express
- **Database:** SQLite (`better-sqlite3`) — persistent storage in `data/pulse.db`
- **Auth:** JWT (bearer tokens) + bcrypt password hashing
- **Uploads:** Multer (audio + cover images), Range-aware streaming via Express static
- **Seeded audio:** tracks are procedurally synthesized lo-fi loops (real playable WAVs),
  covers are generated SVG art — no external assets required

## Demo accounts

| Role   | Email             | Password |
|--------|-------------------|----------|
| Artist | `amara@pulse.app` | `demo123` |

> The admin account is not a demo account. It is only reachable privately from the
> login screen (credentials intentionally not documented here — see `server/routes.js`).
> There is no one-click demo login button.

## Featured artist catalogs

`server/catalog.js` auto-seeds featured artist catalogs (metadata only — titles,
durations, genre, generated covers) on **every server start**; it is idempotent and
backfills only what is missing. Featured artists: **Thalia Falcon** (R&B / Soul,
23 tracks) and **ŻYŃY** (Electronic, 20 tracks — the Polish artist behind
"Zyny"). No playable audio is attached —
artists upload real WAV/MP3 files separately through the normal upload flow.

## Features

- **Authentication** — register (creates an artist profile), login, JWT sessions, sign out
- **Dashboard layout** — fixed sidebar navigation, topbar with search, bottom "now playing" bar
- **Full CRUD** for the core resources:
  - **Songs** — upload (drag & drop), edit, delete, stream, download, favorite
  - **Albums** — create, edit, delete, album detail with tracklist
  - **Artists** — profiles with bio, genre, followers, popular tracks
  - **Playlists** — create, rename, delete, add/remove tracks
- **Music player** — play/pause, next/prev, seek, volume, shuffle, repeat (spacebar shortcut)
- **Downloads** — per-track download counter + attachment download
- **Stats overview** — total plays, downloads, top tracks, recent releases, genre breakdown
- **Search & filters** — search across songs/artists, filter by genre, sort, "My music" toggle
- **Polish** — loading skeletons, empty states, toasts, optimistic favorite toggle,
  confirm dialogs, responsive layout (mobile sidebar drawer)

## Running locally

```bash
# 1. backend deps
npm install

# 2. (optional, happens automatically if DB is empty) seed demo data
npm run seed

# 3. build the client
cd client && npm install && npm run build && cd ..

# 4. start (serves API + built client on :8080)
npm start
```

Open http://localhost:8080 and sign up, or use a demo artist account above.

## Project structure

```
music-app/
├── server/
│   ├── index.js      # Express app: API + static media + SPA serve
│   ├── routes.js     # all REST endpoints (auth, songs, albums, artists, playlists, stats)
│   ├── db.js         # SQLite schema + connection
│   ├── auth.js       # JWT + bcrypt helpers, auth middleware
│   ├── seed.js       # demo data (users, artists, albums, songs, playlists)
│   ├── catalog.js    # featured-artist catalogs, auto-seeded every start (metadata only)
│   ├── import-thalia.js / import-zyny.js  # one-off wrappers around catalog.js
│   ├── synth.js      # procedural WAV audio generator for seed tracks
│   └── cover.js      # SVG cover-art generator
├── client/           # React + Vite SPA
│   └── src/
│       ├── pages/        # Overview, Songs, Albums, Artists, Playlists, Upload, Settings…
│       ├── components/   # Sidebar, Topbar, PlayerBar, SongTable, Modals, Forms…
│       └── context/      # Auth, Player, Toast state
└── data/             # SQLite DB + generated audio/covers/uploads (persisted)
```

## API surface

```
POST /api/auth/register · POST /api/auth/login · GET /api/auth/me
GET /api/stats
GET|POST /api/songs · GET|PUT|DELETE /api/songs/:id
POST /api/songs/:id/play · GET /api/songs/:id/download
GET|POST|DELETE /api/favorites · POST|DELETE /api/favorites/:songId
GET|POST /api/albums · GET|PUT|DELETE /api/albums/:id
GET|POST /api/artists · GET|PUT|DELETE /api/artists/:id
GET|POST /api/playlists · GET|PUT|DELETE /api/playlists/:id
POST /api/playlists/:id/songs · DELETE /api/playlists/:id/songs/:songId
```
