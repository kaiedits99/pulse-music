# Deploy Pulse — your options

Pulse is a **full-stack web app**: a React frontend + a Node/Express backend + a SQLite
database + audio files. That means it can't run as a plain static file — it needs a server
that stays running. Here are your realistic options, easiest first.

---

## Option 1 — Render / Railway / Fly.io (recommended, 5 min)

The whole app (frontend + API + database + audio) runs on **one** free Node host with zero
code changes.

### Render (one-click blueprint)

1. Push this project to a GitHub repo (or upload as a zip).
2. In Render → **New → Blueprint**, point it at the repo. It reads `render.yaml` automatically.
   - Build: `npm ci && cd client && npm ci && npm run build`
   - Start: `npm start`
   - Health check: `GET /api/health` (unauthenticated, no DB work — Render only routes
     traffic once the instance answers)
3. Open the `.onrender.com` URL and sign up. A new deployment is **blank** — there is no sample
   data. The first track anyone uploads becomes the shared catalog that every later user sees.
4. *(Optional)* To enable "Continue with Google", set the `GOOGLE_CLIENT_ID`
   env var in the Render dashboard (public OAuth client ID — see README).

> **Upgrading an older deployment?** Earlier versions seeded demo users, tracks, albums,
> playlists and shows, and read a `SEED_DEMO_DATA` env var. That variable no longer does
> anything (delete it in the dashboard if you set it). If the deployment still has a database
> from those versions, the demo content is removed automatically on the next boot — real
> uploads are left alone — and the log says what was removed.

Or manually: **New → Web Service** with the commands above (Runtime: Node, Build Command and
Start Command as listed, Health Check Path `/api/health`).

### Ephemeral filesystem: what resets

> ⚠️ Free Render instances sleep after inactivity and **restart with a fresh filesystem**.

Pulse keeps everything in one place — the SQLite database (`pulse.db`) and the uploaded audio
and covers (`uploads/`) — and nothing is generated or re-created on boot. So when the
filesystem is wiped, **the whole catalog goes with it**: accounts, tracks, playlists and
favorites vanish and the app is blank again until someone signs up and uploads.

That is fine for trying Pulse out. For anything people should come back to, keep the data on a
persistent disk, as below.

### Keeping uploads and accounts for real

Attach a **Render Disk** (paid plans) and mount it over the app's `data/` directory — `db.js`
creates that tree on boot, and everything (SQLite DB and uploads) then persists across
restarts. `render.yaml` ships the block commented out at the bottom of the service;
uncomment it (disks require a paid instance):

```yaml
    disk:
      name: pulse-data
      mountPath: /opt/render/project/src/data
      sizeGB: 1
```

Render mounts disks at `/opt/render/project/src`, which is the repo root, so that `mountPath`
is exactly the `data/` folder the app already uses — no code or env changes needed. (To keep the
data somewhere else, point the `PULSE_DATA_DIR` env var at that directory instead.) On the free
tier there are no disks, so use one of the paid options for anything durable, or move off SQLite
to a managed database.

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
| Keep the catalog across restarts | Render Disk mounted on `data/` (or `PULSE_DATA_DIR` on a volume) | `render.yaml` (commented `disk:` block), `server/db.js` |
| Start from a blank catalog | Nothing to do — Pulse never seeds data | `server/index.js` |
| Frontend on Netlify | Static build + redirects | `netlify.toml`, `client/public/_redirects` |
| Android app | Capacitor + Android Studio | ask me to scaffold |
| Desktop app | Electron | ask me to scaffold |
