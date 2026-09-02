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
   - Build: `npm install && cd client && npm install && npm run build && cd ..`
   - Start: `npm start`
3. Open the `.onrender.com` URL and sign up (or use a demo artist account from the README).
4. *(Optional)* To enable "Continue with Google", set the `GOOGLE_CLIENT_ID`
   env var in the Render dashboard (public OAuth client ID — see README).

Or manually: **New → Web Service** with the commands above (Runtime: Node, Build Command and
Start Command as listed).

> ⚠️ Free Render instances sleep after inactivity and **restart with a fresh filesystem**,
> so the SQLite DB and uploaded audio can reset on redeploy. For durable data on the free
> tier, Railway/Render with a disk, or a real database, is better. For a demo it's fine.

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
| Frontend on Netlify | Static build + redirects | `netlify.toml`, `client/public/_redirects` |
| Android app | Capacitor + Android Studio | ask me to scaffold |
| Desktop app | Electron | ask me to scaffold |
