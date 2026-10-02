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
   - Build: `npm ci && cd client && npm ci && npm run build`, on **Node 24** (pinned in
     `render.yaml`, `package.json` and `.node-version` — see [If the build
     fails](#if-the-build-fails) if a deploy ever picks a different version)
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

- Open `https://<your-app>.onrender.com/api/health`, or run the same check from your machine (it
  waits out a sleeping free instance's cold start and explains the answer in plain words):

  ```bash
  npm run health -- https://<your-app>.onrender.com
  ```

  It should say `"storage":"bucket"`. (`"local"` means the bucket settings didn't reach the service —
  and on a host with a temporary disk, that means uploads are lost on the next restart.) A healthy
  answer looks like:

  ```json
  {"status":"ok","storage":"bucket","uptime":42,"time":"2026-10-02T15:04:05.678Z"}
  ```
- In the Render logs, look for `Uploads are kept on bucket "…"` and Litestream's
  `replicating to` line.
- Upload a track, then in Render choose **Manual Deploy → Deploy latest commit**. When it is
  back, your account and the track should still be there. The log says `restoring snapshot` when
  the database came back from the bucket.

### 5. Keep it awake during the hours people use it

Render's free service falls asleep after about 15 minutes without a visitor, and takes up to a minute
to wake. Two things stop that, and using both is best:

- **Built in:** with `KEEP_AWAKE=true` (already in `render.yaml`) the app requests its own
  `/api/health` every 5 minutes, but only inside `KEEP_AWAKE_HOURS` (also already set, to `6-24`,
  read in `PULSE_TIMEZONE`). It needs no account.
- **An outside monitor:** it comes from outside Render's network and also wakes the app up if it ever
  does stop. For example [UptimeRobot](https://uptimerobot.com) (free): add an *HTTP(s)* monitor for
  `https://<your-app>.onrender.com/api/health` with a 5-minute interval. Its free plan is for
  personal, non-commercial use. If you use one, give it the same awake hours as above (UptimeRobot
  calls this the monitor's *alert/check schedule*), or it will keep the app up all night.

#### Why the awake hours matter (don't skip this)

Render grants a workspace **750 free instance hours per calendar month** and a month is only about
**730** hours long, so an app kept awake around the clock spends the entire allowance by itself. When
the hours run out, Render **suspends every free service in the workspace until the 1st of the next
month** — not a bill, but the site is simply gone, which is exactly the kind of interruption a public
share link can't afford.

`KEEP_AWAKE_HOURS=6-24` keeps the app awake from 06:00 to midnight and lets it sleep for the quiet
six hours. That is roughly **550–560 instance hours a month**, which cannot run out, and the only cost
is that the first visitor of the morning pays the one-minute cold start — Render wakes the app by
itself the moment anyone opens the link. Every hour you take off the schedule buys back margin.

- `KEEP_AWAKE_HOURS=0-24` (or leaving it out, or a typo) means "around the clock". That fits inside
  750 hours only if the service is the *only* free service in the workspace and the month is short:
  a 31-day month is 744 hours, so there are about **six hours of margin**, and every deploy briefly
  runs the old and new instance at once, which eats into it. Any second always-on free service in the
  same workspace will run the hours out mid-month. Render's dashboard → **Billing → Free instance
  hours** shows where the workspace stands.
- `PULSE_TIMEZONE` (IANA name, e.g. `Africa/Lagos`) is the clock those hours are read in. Without it
  they mean the server's time, which is UTC on Render — `6-24` would start at 07:00 Lagos time. Set
  it in the dashboard under **Environment** if it isn't already there; the boot log prints the
  schedule it is using, for example
  `[pulse] Keep-awake ping enabled (https://…/api/health, 06:00–24:00 Africa/Lagos).`

#### What a sleep (or a suspension) does and does not touch

The sleep is only about instance hours. Nothing that matters is on the instance's disk:

- **Uploads are in the bucket from the moment they arrive.** With bucket settings configured, each
  upload is copied there *before* the database records it, and the temporary local copy is deleted as
  soon as the upload finishes (see `keepUploads` in `server/media.js`). `/media/uploads/…` always
  sends the listener to a signed bucket link, so playing, seeking and downloading never depend on the
  instance, and waking up cannot lose a file. `GET /api/health` reporting `"storage":"bucket"` is the
  proof this is on; `"local"` means every sleep will wipe uploads.
- **The database is restored at every boot.** Each wake is a fresh container: `npm run start:render`
  copies `pulse.db` back from the bucket before the server listens, so accounts, tracks, playlists and
  the IDs behind share links are all there. Litestream copies changes every ~5 seconds, so an
  unannounced kill can lose at most the last few seconds of changes, and on a graceful stop the app
  stays up 7 extra seconds to flush first.
- **The share link itself** is just a URL on the service. While it is asleep a visitor sees Render's
  loading page for up to a minute, then the page and its media load normally.

The one thing a wipe *does* lose: uploads made while Pulse ran without bucket settings (or files from
before a bucket was configured) — those live on the instance disk only. If `/api/health` reports
`"storage":"local"`, fix that before worrying about awake hours.


### If the build fails

Nearly always this is the **Node.js version**. Pulse's database driver, `better-sqlite3`, is a
*native* module: for the Node versions its publisher supports it downloads a ready-made binary, and
for any other version it tries to **compile itself**, which fails once Node's C++ API has moved on.
If the build log shows a `node-gyp` failure, `make failed with exit code`, or an error inside
`node_modules/better-sqlite3`, that is what happened — it is not a problem with your code or your
bucket settings.

That is why Pulse pins Node **24** (the current LTS) in three files that must agree, and why
`npm test` (run by `server/test/node-version.test.js`) fails if they are ever changed apart:

| Where | Value |
|-------|-------|
| `package.json` → `engines.node` | `24.x` |
| `.node-version` | `24` |
| `render.yaml` → `NODE_VERSION` | `"24"` |

If a deploy still uses another version, something is overriding the pin. Render chooses the version
in this order, first match wins: the `NODE_VERSION` environment variable, then `.node-version`, then
`.nvmrc`, then `engines.node`. So check the service's **Environment** page for a leftover
`NODE_VERSION` (change it to `24`, or delete it), and remember Render only applies a version change
on a **new deploy** — press *Manual Deploy → Deploy latest commit* afterwards.

To move to a newer Node later: check that `better-sqlite3` publishes prebuilt binaries for it (its
GitHub releases list them per Node version), update the three places above, and run `npm test`.

If a Blueprint created the service, `render.yaml` is the source of truth: after pulling these
changes, open the Blueprint on Render and apply the sync so the new `NODE_VERSION` reaches the
service.

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
| Check a running deployment (is it up? are uploads on the bucket?) | `npm run health -- https://your-app.onrender.com` | `scripts/health-check.mjs` |
| Stop a free service falling asleep (during chosen hours) | `KEEP_AWAKE=true` + `KEEP_AWAKE_HOURS` + `PULSE_TIMEZONE`, plus an outside monitor on `/api/health` | `server/keepalive.js` |
| Keep everything on the server instead | Render Disk mounted on `data/` (or `PULSE_DATA_DIR` on a volume) | `render.yaml` (commented `disk:` block), `server/db.js` |
| Start from a blank catalog | Nothing to do — Pulse never seeds data | `server/index.js` |
| Frontend on Netlify | Static build + redirects | `netlify.toml`, `client/public/_redirects` |
| Android app | Capacitor + Android Studio | ask me to scaffold |
| Desktop app | Electron | ask me to scaffold |
