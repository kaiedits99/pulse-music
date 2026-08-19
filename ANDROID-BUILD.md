# Build Pulse as an Android app (APK)

Pulse is now a **Capacitor** project. The React app is wrapped in a native Android shell,
and the backend stays hosted (Glitch/Render/etc.) — the app talks to it over the internet.

**Two ways to get an APK** — pick one:

- **A. GitHub Actions (no Android Studio, recommended)** — push to GitHub and it builds the APK for you.
- **B. Android Studio (build locally)** — if you want to run/develop on your own machine.

---

## How the app connects to your backend

The Android app needs to know where your backend lives. There are two ways:

1. **At runtime (easiest, no rebuild):** open the app → on the login screen tap
   **"Backend server URL"** → paste your backend URL (e.g. `https://your-project.glitch.me`)
   → Save. The app remembers it.
2. **At build time:** set the `VITE_API_URL` variable (GitHub Actions variable, or a `.env`
   file for local builds).

> The backend must be deployed first. Use the Render Blueprint (`render.yaml`) or Glitch —
> see `DEPLOY.md`. Then copy its public URL into the app.

---

## Option A — Build the APK with GitHub Actions (no Android Studio)

1. Push this project to a GitHub repo (see `UPLOAD-CHECKLIST.md` for the file list — the
   new files `client/capacitor.config.json`, `client/android/**`, `.github/workflows/**` are included).
2. Open the repo → **Actions** tab. The **"Build Android APK"** workflow runs automatically.
3. When it finishes (green check), open the run → scroll to **Artifacts** → download
   **`pulse-apk`** → unzip → you have `app-debug.apk`.
4. Copy the `.apk` to your phone and tap it to install (you may need to allow
   "install unknown apps" for your file manager).

> The first build takes ~5–10 minutes (it downloads Gradle + Android SDK). Later builds are faster.

---

## Option B — Build locally with Android Studio

1. Install **Android Studio** (free) and open the `client/android` folder.
2. Let Gradle sync. Then **Build → Build APK(s)**.
3. The APK appears in `client/android/app/build/outputs/apk/debug/app-debug.apk`.

Or from a terminal (with JDK 21 + Android SDK installed):

```bash
cd client
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

---

## Everyday dev loop (optional)

- Change React code → `cd client && npm run build && npx cap sync android`
- Rebuild the APK (or run live with `npm run dev` + `npx cap open android` for hot reload).

---

## Notes & limitations

- **Backend can't live in the APK.** The phone app is the UI + player; music/DB are on your server.
- **Downloads** open in the system browser (via the Capacitor Browser plugin) so they save correctly.
- **App ID** is `com.pulse.music`; **min Android** is 6.0 (API 23).
- This is a **debug APK**. To publish on the Play Store you'd sign it and build a release
  version (`assembleRelease` + a keystore) — ask me if you want that set up.
- First launch auto-seeds demo data on the server, so the app looks alive immediately.
