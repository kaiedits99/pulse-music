# Deploy Pulse — your options

Pulse is a **full-stack web app**: a React frontend + a Node/Express backend + a SQLite
database + audio files. That means it can't run as a plain static file — it needs a server
that stays running. Here are your realistic options, easiest first.

---

## Option 1 — Render free plan + Cloudflare R2 (a small community, no monthly bill)

Render's free web service runs the whole app (frontend + API) with zero code changes, but its
disk is **wiped whenever the service restarts, redeploys or goes to sleep**. Pulse copes by
keeping its data *outside* Render, in a free Cloudflare R2 bucket:

| What | Where it lives | How |
|------|----------------|-----|
| Uploaded audio and covers | the R2 bucket, under `uploads/` | each upload is copied there as it arrives. Listeners are sent to short-lived signed links, so audio streams straight from the bucket and never uses Render's bandwidth |
| The database (accounts, tracks, playlists, …) | the same bucket, under `litestream/` | [Litestream](https://litestream.io) copies every change within about 5 seconds, and Pulse restores it when it boots |
| The service itself | Render free | pinged every 5 minutes, so it doesn't fall asleep |

Nothing about this changes how Pulse works for people using it, and if you run Pulse without the
bucket settings it behaves exactly as before (data in `./data`).

### 1. Create the bucket (Cloudflare, about 5 minutes)

1. Sign in at <https://dash.cloudflare.com> and open **R2 Object Storage**. Cloudflare may ask
   for a payment method before it turns R2 on. Nothing is charged within the free allowance
   (10 GB stored, 1 million writes and 10 million reads a month, free downloads), which is far
   more than a small community uses.
2. **Create bucket**, for example `pulse-music`. Keep it **private**: don't switch on the public
   `r2.dev` address. Listeners reach files through signed links instead.
3. On the R2 overview page choose **Manage API tokens → Create API token**. Give it
   **Object Read & Write**, limited to that bucket. Copy the **Access Key ID** and the
   **Secret Access Key** (it is shown only once). The page also shows your **S3 endpoint**, which
   looks like `https://<account-id>.r2.cloudflarestorage.com`.
4. In the bucket's **Settings → CORS policy**, add the policy in [`docs/r2-cors.json`](docs/r2-cors.json).
   Playing music works without it; **Download for offline** needs it, because the browser saves
   the file with its own request.

### 2. Try the settings from your computer (optional, 1 minute)

```bash
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com S3_BUCKET=pulse-music \
S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... PULSE_ORIGIN=https://<your-app>.onrender.com \
npm run storage:check
```

It writes, reads and deletes a small test file, checks that browsers on your site may read from
the bucket, and checks that Litestream can reach it too. Anything wrong is explained in plain
words. It never prints your keys.

### 3. Deploy on Render

1. Push this project to a GitHub repo (or upload as a zip).
2. In Render → **New → Blueprint**, point it at the repo. It reads `render.yaml` automatically
   and asks for the four bucket values: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
   `S3_SECRET_ACCESS_KEY`. (Set all four or none: a partly filled set stops the app from starting,
   on purpose, rather than quietly using a disk that gets wiped.)
   - Build: `npm ci && cd client && npm ci && npm run build`
   - Start: `npm run start:render`. It restores the database from the bucket if this machine
     doesn't have one, then runs the server under Litestream.
   - Health check: `GET /api/health` (unauthenticated, no DB work: Render only routes
     traffic once the instance answers).
3. Open the `.onrender.com` URL and sign up. A new deployment is **blank**: there is no sample
   data. The first track anyone uploads becomes the shared catalog that every later user sees.
4. *(Optional)* To enable "Continue with Google", set the `GOOGLE_CLIENT_ID`
   env var in the Render dashboard (public OAuth client ID — see README).

> **Upgrading an older deployment?** Earlier versions seeded demo users, tracks, albums,
> playlists and shows, and read a `SEED_DEMO_DATA` env var. That variable no longer does
> anything (delete it in the dashboard if you set it). If the deployment still has a database
> from those versions, the demo content is removed automatically on the next boot — real
> uploads are left alone — and the log says what was removed.

Or manually: **New → Web Service** (Runtime: Node, the Build Command above, Start Command
`npm run start:render`, Health Check Path `/api/health`), then add the environment variables from
the [configuration table in the README](README.md#configuration), including `KEEP_AWAKE=true`.

### 4. Check that it is working

- Open `https://<your-app>.onrender.com/api/health`. It should say `"storage":"bucket"`.
  (`"local"` means the bucket settings didn't reach the service.)
- In the Render logs, look for `Uploads are kept on bucket "…"` and Litestream's
  `replicating to` line.
- Upload a track, then in Render choose **Manual Deploy → Deploy latest commit**. When it is
  back, your account and the track should still be there. The log says `restoring snapshot` when
  the database came back from the bucket.

### 5. Keep it awake

Render's free service falls asleep after about 15 minutes without a visitor and takes up to a
minute to wake. Two things stop that, and using both is best:

- **Built in:** with `KEEP_AWAKE=true` (already in `render.yaml`) the app requests its own
  `/api/health` every 5 minutes. It needs no account.
- **An outside monitor:** it comes from outside Render's network and also wakes the app up if it ever
  does stop. For example [UptimeRobot](https://uptimerobot.com) (free): add an *HTTP(s)* monitor for
  `https://<your-app>.onrender.com/api/health` with a 5-minute interval. Its free plan is for
  personal, non-commercial use.

Free web services get **750 instance-hours a month** across your whole Render workspace. One
service that never sleeps uses about 744 of them, so it fits, but a second always-on free service in
the same workspace would not.

### What to expect on the free plan

- **Restarts happen** (Render may restart a free service at any time, and every deploy restarts
  it). Accounts, tracks and files all survive them. The first request afterwards can take a minute while
  the instance starts and the database is restored.
- **A few seconds of changes can be lost in a crash or at a deploy.** Litestream copies changes
  every 5 seconds. When Render *asks* the app to stop, the app stays up for 7 more seconds so the last
  changes are copied first, so nothing is lost. But when an instance is killed outright, the last 5
  seconds or so are gone, and during a deploy the old and the new instance overlap briefly, so a
  change made in that window can be lost. Avoid uploading while a deploy is in progress.
- **Cost stays at zero for a small community.** Copying the database is capped at about 520,000
  writes a month (R2 includes 1,000,000) and in practice uses far fewer, because nothing is
  copied while nobody is changing anything. Downloads from R2 are free.
- **Render's bandwidth is barely used.** Audio and covers come straight from the bucket. Only the app
  itself and its small API answers pass through Render (the free workspace has a small monthly
  allowance, which this fits within comfortably).
- **Files uploaded before you switched on the bucket** stay on the server's disk. They are still
  served from there, but they won't survive a wipe. To move them, copy `data/uploads/*` into the
  bucket under `uploads/` with any S3 tool (the file names must stay the same).

### If something looks wrong

| You see | Likely cause and fix |
|---------|----------------------|
| `/api/health` says `"storage":"local"` | The four `S3_*` values aren't set on the service. Set them and redeploy. |
| The deploy fails with *Object storage is only partly configured* | One of the four `S3_*` values is missing or empty. |
| The deploy fails with *could not restore the database from the bucket* | Wrong endpoint, bucket or keys, or R2 is unreachable. Run `npm run storage:check` with the same values. Pulse refuses to start rather than begin with an empty database that would replace your saved one. |
| **Download for offline** says *Download failed* | The bucket's CORS policy is missing. Add [`docs/r2-cors.json`](docs/r2-cors.json). |
| Uploads fail with *Could not store the upload right now* | The bucket can't be reached or the API token can't write to it (check **Object Read & Write** and that it includes this bucket). |
| The app is blank after a restart, and the log says *running on Render without a bucket* | No bucket settings, so the temporary disk is all there is. See step 1 and step 3. |

### Outgrowing the free plan

If the community gets big, or you would rather not depend on the free tier, a paid Render
instance with a **Render Disk** keeps everything on the server itself, with no bucket needed.
`render.yaml` ships the block commented out at the bottom of the service. Uncomment it (disks
require a paid instance) and set the start command back to `npm start`:

```yaml
    disk:
      name: pulse-data
      mountPath: /opt/render/project/src/data
      sizeGB: 1
```

Render mounts disks at `/opt/render/project/src`, which is the repo root, so that `mountPath`
is exactly the `data/` folder the app already uses — no code or env changes needed. (To keep the
data somewhere else, point the `PULSE_DATA_DIR` env var at that directory instead.)

---

## Option 2 — Netlify (frontend) + a Node backend (split)

Netlify is a **static** host — it serves files but does **not** run your Express server or
SQLite database. To use Netlify you split the app:

1. **Backend** — deploy the server to Render/Railway/Fly (Option 1, but keep only the API).
2. **Frontend** — build with the API URL baked in, then drag-and-drop the build to Netlify:

   ```bash
   cd client
   VITE_API_URL=https://your-backend.onrender.com npm run build
   ```

   Then drag the `client/dist` folder onto Netlify (or connect the repo — `netlify.toml`
   and `client/public/_redirects` are already included for SPA routing).

> This is more moving parts than Option 1. I'd only pick it if you specifically want Netlify.

---

## What about an APK (Android) or EXE (Windows)?

Both are possible in principle, but they're **native wrappers**, not simple exports, and they
need toolchains this environment doesn't have:

- **APK** — needs the Android SDK + Gradle + Java and a web-container like **Capacitor**, plus
  code-signing. Your backend also can't live inside an APK easily (no phone runs a SQLite
  Node server for a shared app) — you'd need to host the backend and point the app at it.
- **EXE** — needs **Electron** (bundles Chromium + Node, ~100MB+) and a Windows build
  environment (or Wine) to produce a signed installer.

If you want, I can:
- **Convert this to a Capacitor project** so you can build an APK locally with Android Studio, or
- **Wrap it in Electron** so you can build a Windows/macOS/Linux desktop app locally.

Just say which and I'll scaffold it (you'd run the final native build on your own machine,
since app-store signing and OS toolchains can't run here).

---

## Quick reference

| Goal | What to use | File(s) |
|------|-------------|---------|
| Whole app, one click | Render blueprint | `render.yaml` |
| Deploy liveness probe | `GET /api/health` (no auth, no DB) | `render.yaml`, `server/routes.js` |
| Keep uploads on a host with a temporary disk | An S3-compatible bucket (Cloudflare R2) via the `S3_*` settings | `server/storage.js`, `server/media.js`, `docs/r2-cors.json` |
| Keep the database on a host with a temporary disk | Litestream copying it to the same bucket | `litestream.yml`, `scripts/start-with-litestream.sh` |
| Check the bucket settings before relying on them | `npm run storage:check` | `scripts/storage-check.mjs` |
| Stop a free service falling asleep | `KEEP_AWAKE=true` plus an outside monitor on `/api/health` | `server/keepalive.js` |
| Keep everything on the server instead | Render Disk mounted on `data/` (or `PULSE_DATA_DIR` on a volume) | `render.yaml` (commented `disk:` block), `server/db.js` |
| Start from a blank catalog | Nothing to do — Pulse never seeds data | `server/index.js` |
| Frontend on Netlify | Static build + redirects | `netlify.toml`, `client/public/_redirects` |
| Android app | Capacitor + Android Studio | ask me to scaffold |
| Desktop app | Electron | ask me to scaffold |
