# Pulse — the world's first global music sharing app

Pulse lets people upload their music for other users to see and listen to. It is a full-stack
app (React + Express + SQLite) with a polished dashboard, albums and playlists, offline
downloads and a shared catalog that is built entirely from what people upload.

**Pulse starts empty.** Nothing is seeded, generated or imported: there are no demo accounts,
sample tracks, albums, playlists or shows, and the first page stays blank until someone uploads
a song. Everything you will ever see in the app was uploaded by a real user.

## Tech stack

- **Frontend:** React 18 + React Router + Vite, custom CSS design system (dark theme)
- **Backend:** Node.js 24 (LTS) + Express
- **Database:** SQLite (`better-sqlite3`) — persistent storage in `data/pulse.db`, optionally copied
  to a bucket by Litestream so it survives hosts that wipe their disk
- **Auth:** JWT (bearer tokens) + bcrypt password hashing, done on a worker thread so a sign-in never
  freezes the server
- **Uploads:** Multer (audio + cover images), streamed with HTTP Range support. Only
  `data/uploads/` is served at `/media/uploads/…` — the database next to it is never exposed. On hosts
  with a temporary disk the files live in an S3-compatible bucket (Cloudflare R2) instead, and
  `/media/uploads/…` sends listeners to a short-lived signed link there.

## Getting in

- **Landing page.** A signed-out visitor who opens `/` sees *Welcome to Pulse, the world's first
  global music sharing app*, a line of small print explaining that Pulse allows users to upload
  their music for other users to see, and **Get started** / **Sign in** buttons. It shows no
  catalog data. Signed-in users get Home at `/` instead.
- **Links keep working.** Following a link to an inner page while signed out sends you to sign
  in first and then to that page.
- **"Sharing is caring" prompt.** Right after someone signs in or signs up, a dialog invites
  them to upload their music: *Choose music files* opens the file picker and takes the chosen
  files to the Upload page, ready to publish. It is only an invitation: *Maybe later* (or Esc,
  the × button, a click outside) dismisses it, and nothing else changes — everything other users
  have shared stays fully available. It is not shown again on page reloads, it is skipped when
  you are already on the Upload page or offline, and it comes back on the next sign-in.

## How the catalog fills up

Pulse has **one shared catalog** that grows with every upload:

1. **A fresh install is blank.** Home shows a single empty state with an *Upload* button — no
   stats, no placeholder rows, no sample tracks.
2. **The first upload becomes the catalog.** The first person to sign up and upload a track
   fills the app; every user who signs in afterwards sees that track on Home and in search
   without having to upload anything themselves.
3. **Every further upload is added** (newest first) — a second user's track joins the first
   one's, and so on. Home arranges the tracks into *Your uploads*, *Recently added*,
   *Made for you*, *Community uploads* and *Top tracks*, and skips a row when all of its tracks
   are already shown above it.
4. **Uploads are public by default.** A track marked *private* stays visible only to the person
   who uploaded it (and site admins); it is left out of everyone else's Home, search, genre
   lists and stats.

## Liking tracks

The **heart in the player bar** (also on the Now Playing screen and on every track row) adds the
playing track to *Liked Songs* and takes it out again. Every heart shares one source of truth
(`client/src/context/FavoritesContext.jsx`), so liking a track in the bar immediately updates its
row in the list you are looking at, the *Liked Songs* page and the *Your Library* card, and the
other way round. The heart flips straight away and is rolled back with a message if the server
cannot be reached; quick repeated clicks are sent in order, so the screen and the server always
end up agreeing. Signing in as someone else never inherits the previous person's hearts.

On the server, `POST /api/favorites/:songId` only accepts tracks the caller is allowed to see: a
private track of someone else and a track that doesn't exist both answer `404` (so ids can't be
probed), and an id that is not a plain positive integer answers `400`. Liking and un-liking are
idempotent.

## Search

The search bar at the top of every page filters the uploaded catalog by **artist**,
**track title** or **genre** — results update as you type, and Enter, the clear (×) button
and `Esc` work as you would expect. Press `/` anywhere to jump to it.

- Every word has to match the title, artist or genre of a track, so `luna pop` narrows the
  results instead of widening them.
- Matching ignores case, accents and punctuation: `beyonce` finds *Beyoncé*, `kpop` finds *K-Pop*,
  `hip hop` finds *Hip-Hop*.
- Matching artists, albums and podcast shows are listed above the tracks.
- The same search is available from the API: `GET /api/songs?q=…` (tracks by title, artist or
  genre), `GET /api/albums?q=…` and `GET /api/artists?q=…`. Combine it with `genre=`,
  `artist_id=`, `sort=` and `visibility=`. Search never reveals another user's private tracks.

## Google sign-in (optional)

Pulse supports "Continue with Google" using the Google Identity Services
**credential (ID token) flow**: the browser gets a Google-signed ID token and
the server verifies it at `POST /api/auth/google`, returning the same
`{ token, user }` shape as password login. There is **no OAuth client secret**
anywhere — only the public client ID is configured. Login and signup are the
same call: an existing email signs in, an unknown email gets an account (artist
role + auto-created artist profile, no usable password — they keep signing in
via Google). The private admin passphrase login is untouched by all this.

Setup:

1. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
   create an **OAuth client ID** of type **Web application**.
2. Configure the OAuth consent screen (External is fine) and add every origin
   that will serve the client to **Authorized JavaScript origins**, e.g.
   `http://localhost:5173`, `http://localhost:8080`, your production URL
   (`https://pulse-music.onrender.com`), and any preview URL you test from.
   (No redirect URIs are needed for this flow.)
3. Copy the client ID and start the server with it — the login screen shows the
   Google button automatically once the backend advertises it:

```bash
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com npm start
```

Without the env var the endpoint returns `503` and the button hides itself —
the app behaves exactly as before.

## Where the data lives

Everything Pulse stores sits in one directory (default `./data`):

```
data/
├── pulse.db        # SQLite database (users, tracks, albums, playlists, …)
└── uploads/        # audio and cover files that users uploaded
```

Set `PULSE_DATA_DIR` to keep it somewhere else — for example a mounted volume:

```bash
PULSE_DATA_DIR=/var/lib/pulse npm start
```

`GET /api/health` is an unauthenticated liveness probe (used as the Render health check); it
deliberately does no database work. It also reports where uploads are kept, `"storage":"local"` or
`"storage":"bucket"`.

### Hosts that wipe their disk (Render's free plan)

Container hosts such as Render's free tier restart with a wiped filesystem, which would delete the
database **and** every upload. Two optional pieces keep the data somewhere else. Both are off
until you give Pulse a bucket, and `DEPLOY.md` has the step-by-step setup (about 20 minutes, no cost
for a small community):

- **Uploads go to an S3-compatible bucket** (Cloudflare R2 is the free option it is documented
  against). Each upload is copied there as it arrives, *before* the track is added to the catalog,
  so the database never points at a file that wasn't stored. If the bucket can't be reached, the
  upload fails with a clear message and nothing half-saved is left behind. `/media/uploads/<file>`
  then redirects to a signed link that lasts 6 hours (or straight to `S3_PUBLIC_BASE_URL`, if you
  connect a custom domain to the bucket), so playing and seeking happen between the listener
  and the bucket and never use the app server's bandwidth. Deleting a track, episode, show, album
  or artist, or replacing a file, deletes the stored copy too, but only once nothing else refers
  to it. The bucket stays private.
- **The database is copied to the same bucket by [Litestream](https://litestream.io)** (under
  `litestream/`). `npm run start:render` restores it on boot if the machine has none, then runs the
  server under Litestream, which copies every change within about 5 seconds. If the saved copy
  can't be restored, Pulse refuses to start rather than begin with an empty database that would
  replace it. When the host asks the app to stop, the app waits 7 seconds before exiting so the
  last changes are copied first (Litestream copies on a timer only).

Two smaller helpers make the free plan comfortable: `KEEP_AWAKE=true` makes the app request its own
`/api/health` every 5 minutes, inside `KEEP_AWAKE_HOURS` (default `0-24`, and `render.yaml` sets
`6-24` read in `PULSE_TIMEZONE`), so the host doesn't put it to sleep during the hours people use it —
important, because keeping a free Render service awake around the clock burns the whole 750-hour
monthly allowance and gets **every** free service in the workspace suspended until the 1st (an outside
uptime monitor on the same address does the same job, and also wakes the app after a restart). Password
hashing runs on a worker thread, so a sign-in doesn't hold up everyone else's requests.

`npm run storage:check` tries your bucket settings for real (write, signed read, delete, CORS, and
Litestream's own connection) and explains anything that is wrong. Once the app is deployed,
`npm run health -- https://your-app.onrender.com` asks it how it is doing — whether it is awake and
whether uploads really are on the bucket — waiting out the cold start of a sleeping free instance.

### Configuration

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `8080` (Render sets its own) | Port the server listens on |
| `PULSE_DATA_DIR` | `./data` | Where the database and local uploads live |
| `JWT_SECRET` | built-in dev value | Signs sign-in tokens. **Set your own in production** (`render.yaml` generates one) |
| `GOOGLE_CLIENT_ID` | unset | Enables "Continue with Google" |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset | Keep uploads (and, with `start:render`, the database copy) in a bucket. **All four or none**: a partial set stops the app from starting |
| `S3_REGION` | `auto` | Bucket region (`auto` is right for R2) |
| `S3_PUBLIC_BASE_URL` | unset | Permanent public address of the bucket, for example a custom domain connected to it. Playback then uses it directly instead of signed links |
| `S3_SIGNED_URL_TTL_SECONDS` | `21600` (6 h) | How long signed links last (60 to 604800) |
| `KEEP_AWAKE` | unset | `true` makes the app request its own `/api/health` every 5 minutes (needs `RENDER_EXTERNAL_URL`, which Render sets, or `KEEP_AWAKE_URL`) |
| `KEEP_AWAKE_URL` | `RENDER_EXTERNAL_URL` | Public address of the app, if it isn't on Render |
| `KEEP_AWAKE_HOURS` | `0-24` (around the clock) | Hours the keep-awake ping runs, `"<start>-<end>"` on the 24-hour clock, e.g. `6-24` for 6am to midnight. Anything unparseable means around the clock. **An always-awake free Render service uses the workspace's whole 750-hour monthly allowance and gets suspended until the 1st** — see DEPLOY.md, step 5 |
| `PULSE_TIMEZONE` | host clock (UTC on Render) | IANA name such as `Africa/Lagos`; the timezone `KEEP_AWAKE_HOURS` is read in |
| `PULSE_DB_SYNC_SECONDS` | `5` | How often Litestream copies the database (1 to 20). Smaller means less to lose in a crash and more writes to the bucket |
| `LITESTREAM_DISABLED` | unset | `true` runs without database copies even though a bucket is set |
| `LITESTREAM_BIN`, `LITESTREAM_CONFIG` | the npm-installed program, `litestream.yml` | Advanced: use a different Litestream program or settings file |

**Upgrading from a version that shipped demo data.** Earlier versions seeded sample users,
artists, albums, tracks, playlists and podcast shows (plus generated audio and cover art).
On boot, `server/legacy-demo-cleanup.js` removes exactly that content from an existing
database and deletes the generated files, then logs what it removed. Real uploads — and
everything attached to them, such as an artist profile a real track points at — are never
touched, and an old demo account that owns real data is kept (with a warning in the log) rather
than deleted. On a fresh install it does nothing.

Devices clean up after themselves too: the first time the new app starts on a device, it removes
any demo audio and covers an older version had saved there for offline listening (only the old
generated `/media/audio/…` and `/media/covers/…` files; real uploads and everything else the
person saved are left alone), including from saved playlists.

## Features

- **Authentication** — register (creates an artist profile), login, JWT sessions, sign out
- **Dashboard layout** — floating two-panel sidebar (nav + playlists + Install App), pill topbar
  with live catalog search (artist, track or genre), notifications, theme switch and account
  drawer, and a 92px "now playing" bar
- **Full CRUD** for the core resources:
  - **Songs** — upload (drag & drop, bulk import), edit, delete, stream, download, favorite
  - **Linked tracks** — paste a YouTube link (Upload page → *Link a YouTube track*, or the
    track dialog) and Pulse stores only the video id: the track plays through YouTube's own
    embeddable player, with title, channel and artwork filled in from YouTube's public oEmbed
    endpoint. Nothing is downloaded, ripped or re-hosted, so linked tracks have no offline
    download and no waveform of their own. Pasting a Spotify, Apple Music, Audiomack or other
    streaming page asks you to upload the file instead — a stored link like that would only
    ever fail to play.
  - **Albums** — create, edit, delete, album detail with tracklist
  - **Artists** — profiles with bio, genre, followers, popular tracks
  - **Playlists** — every signed-in user can create/edit/delete their own lists (creator- or
    admin-only mutations, viewing is shared), with a Spotify-style "Add to this playlist?"
    dialog that shows check states and creates new playlists inline
- **Offline downloads** — "Download" toggle on any playlist and "Save to offline" on any track
  (⋮ menu, Now Playing sheet): audio + covers are cached (Cache Storage) and the playlist's
  track list is snapshotted, so the **Downloads** page (`/downloads`) opens, lists, and plays
  everything with no network — like Spotify/YouTube offline. Downloaded tracks prefer the local
  copy even online (instant, zero-bandwidth playback). A service worker also caches the app
  shell. "Download" (file) on a row still saves the actual file to the device — in the Android
  app that lands in the phone's downloads via the system browser.
- **Offline Player** (`/offline-player`) — automatically opens when the browser goes offline and
  returns to the previous page when connectivity comes back. Its single queue combines Pulse
  downloads with audio files the user explicitly imports from a folder or file picker. Imported
  audio is stored locally in IndexedDB, never uploaded, and playback never falls back to streaming.
  Folder selection depends on browser support; on phones, selecting multiple audio files is the
  most reliable option.
- **Messages** (`/messages`) — a Snapchat-style 24-hour inbox, not a permanent one. Every
  message is deleted **24 hours after it is read** (30 days if nobody ever opens it), and
  attachments go with it: photos and voice notes (with waveform and playback speed), reactions,
  shared tracks that play straight into the Pulse player, read receipts, unread badges in the
  sidebar, blocking and reporting. Messages live in their **own database** (`chat.db`) with secure
  deletion, no-store attachment links, a 6-hour replica history and a cleaner that reclaims the
  space — so the ephemerality can never touch the catalogue. Anything reported keeps a copy for
  review; that is the only exception, and the app says so before you confirm. See
  [`docs/chat-retention.md`](docs/chat-retention.md) for exactly what is deleted, when, and what
  cannot be promised.
- **Artist tags** — every account has one (`@name`, set in Settings). Search `@name` anywhere —
  the messages list, the new-conversation picker, an invite — and an exact tag always comes first.
  `/messages/@name` opens that chat directly, starting one if there is none. Anyone signed in can
  be messaged; blocking and reporting are one tap away.
- **Notes** — the row of faces above the chat list: a one-day status line with an emoji. It is not
  a message and not addressed to anyone, so it lives 24 hours from posting and is shown only to
  you and the people you already talk to.
- **Parties** — group chats that start with a name and a few `@tags`. The 24-hour clock waits for
  the *last* member to read, members can invite more people, rename the party, or leave.
- **Channels** — broadcasts in one direction: the owner posts, everyone else reads and reacts,
  and posts are deleted **7 days** after they go out (a broadcast has no "everyone has read it").
  Browse and join from the same picker.
- **Listening rooms** — a party can listen together: a shared queue of track ids with a
  "N online" count, join/leave, play, pause and next. Nothing is streamed between browsers — each
  member's own player follows the room — so it needs no WebRTC server, no TURN relay and no
  bandwidth the free instance cannot afford.
- **Podcasts & Shows** (`/podcasts`, `/podcasts/:id`) — a section of its own, not a re-skin of
  uploads. Shows and episodes live in their own tables (`podcasts`, `episodes`,
  `podcast_subscriptions`, `saved_episodes`, `episode_progress`) with their own routes, so an
  episode is never mistaken for a song. Browse or search shows, filter by category, follow a
  show, save episodes to **Your Episodes**, publish your own show and upload episodes to it,
  and pick up any episode where you stopped — resume positions are written back to the server
  while you listen, and **Continue listening** shows how much is left. Episodes play in the
  same player (with an "Episode" badge, 15s/30s skips and show links) and can be cached for
  offline exactly like tracks.
- **Music player** — play/pause, next/prev, seek, volume, shuffle, repeat (spacebar shortcut)
- **Downloads** — per-track download counter + attachment download
- **Stats overview** — total plays, downloads, top tracks, recent releases, genre breakdown
- **Search page** (`/search`) — one place for query, genre chips, artist filter, sort and
  grid/list views, with matching artists and albums surfaced above the tracks; the topbar search
  box drives it from any page
- **Your Library** (`/library`) — pinned hubs (Liked Songs, Your Uploads, Your Episodes, Offline Library),
  content-type filter chips, sort menu, grid/list toggle and a live offline-storage summary
- **Polish** — loading skeletons, empty states, toasts, optimistic favorite toggle,
  confirm dialogs, responsive layout (mobile sidebar drawer)

## Running locally

Pulse runs on **Node.js 24** in production. The version is pinned in three places that must agree —
`package.json` (`engines.node`), `.node-version` and `render.yaml` — because the database driver
(`better-sqlite3`) is a native module that only works on Node versions it has a prebuilt binary for;
`npm test` checks that the three pins match. Any Node 22+ works for development too (you'll just see
an `EBADENGINE` warning from npm).

```bash
# 1. backend deps
npm install

# 2. build the client
cd client && npm install && npm run build && cd ..

# 3. start (serves API + built client on :8080)
npm start
```

Open http://localhost:8080, create an account and upload a track — the app is blank until you
do. Run the server tests with `npm test` (they use throw-away data directories, never `./data`).

## Project structure

```
pulse-music/
├── server/
│   ├── index.js      # Express app: API + /media/uploads + SPA serve + boot-time legacy cleanup
│   ├── routes.js     # all REST endpoints (health, auth, songs, albums, artists, playlists, stats)
│   ├── db.js         # SQLite schema + connection (exports dataDir/uploadsDir; PULSE_DATA_DIR)
│   ├── auth.js       # JWT helpers, auth middleware
│   ├── passwords.js  # bcrypt on a worker thread (password-worker.js) so sign-ins never freeze the server
│   ├── storage.js    # where uploads live: local disk or an S3-compatible bucket (signed links)
│   ├── media.js      # keeps uploads in the bucket, redirects /media/uploads to it, cleans up after deletes
│   ├── keepalive.js  # optional self-ping so a free host doesn't put the app to sleep
│   ├── shutdown.js   # graceful stop (waits for Litestream's last copy)
│   ├── search.js     # catalog search: case/accent/punctuation-insensitive matching
│   ├── legacy-demo-cleanup.js  # removes demo content left by older versions (no-op when fresh)
│   └── test/         # node:test suite — `npm test`
├── scripts/          # start-with-litestream.sh (restore + replicate), storage-check.mjs, litestream-path.mjs
├── litestream.yml    # settings for copying the database to the bucket
├── docs/r2-cors.json # CORS policy to paste into the bucket (needed for offline downloads)
├── client/           # React + Vite SPA
│   └── src/
│       ├── pages/        # Landing, Overview, Search, Library, Albums, Artists, Playlists, Upload, Settings…
│       ├── components/   # Sidebar, Topbar, PlayerBar, NowPlaying, SharePrompt, Cards, SongTable, Modals, Forms…
│       ├── styles/       # design system: base.css, shell.css, components.css, pages.css (+ landing.css)
│       ├── hooks/        # useInstallPrompt (PWA install), useMediaQuery
│       ├── context/      # Auth, Player, Favorites (likes), Theme, Toast state
│       └── search.js     # browser twin of server/search.js (kept identical by a test)
└── data/             # created at runtime: pulse.db + uploads/ (git-ignored; see PULSE_DATA_DIR)
```

## API surface

```
GET /api/health                                   # unauthenticated liveness probe (Render health check); reports storage: local|bucket
POST /api/auth/register · POST /api/auth/login · GET /api/auth/me
GET /api/stats
GET|POST /api/songs · GET|PUT|DELETE /api/songs/:id        # GET ?q= searches title, artist and genre
POST /api/songs/:id/play · GET /api/songs/:id/download     # download redirects to a "save as" link when files live in a bucket
GET|POST|DELETE /api/favorites · POST|DELETE /api/favorites/:songId
GET|POST /api/albums · GET|PUT|DELETE /api/albums/:id
GET|POST /api/artists · GET|PUT|DELETE /api/artists/:id
GET|POST /api/playlists · GET|PUT|DELETE /api/playlists/:id
POST /api/playlists/:id/songs · DELETE /api/playlists/:id/songs/:songId

# podcasts & shows
GET /api/podcasts?q=&category=&subscribed=1&mine=1&sort=   # + category counts
GET|POST /api/podcasts · GET|PUT|DELETE /api/podcasts/:id  # detail includes episodes + can_manage
POST|DELETE /api/podcasts/:id/subscribe
POST /api/podcasts/:id/episodes                            # multipart audio (+ cover)
GET /api/episodes?podcast_id=&saved=1&continue=1&q=&limit= · GET|DELETE /api/episodes/:id
POST /api/episodes/:id/play · POST|DELETE /api/episodes/:id/save
PUT /api/episodes/:id/progress · GET /api/episodes/:id/download
```
