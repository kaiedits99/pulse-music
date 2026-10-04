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

1. Push this project to GitHub. The **Build Android APK** workflow runs automatically on
   pushes and pull requests; you can also start it from **Actions → Build Android APK → Run workflow**.
2. When the run finishes, open it and download the **`pulse-apk`** artifact. Unzip it to get
   `app-debug.apk`.
3. Copy the APK to your phone and tap it to install (you may need to allow "install unknown
   apps" for your file manager).

The workflow builds the web app, generates the Capacitor Android project, assembles the APK,
and uploads it as a 14-day artifact. The generated `client/android` project is not checked in.

To bake in a backend URL, add a GitHub Actions **repository variable** named `VITE_API_URL`
under **Settings → Secrets and variables → Actions → Variables**. If it is not set, users can
enter the backend URL in the app's **Backend server URL** setting after installation.

---

## Option B — Build locally with Android Studio

Install **Android Studio** (free), then generate and open the native project from the repo root:

```bash
cd client
npm ci
npm run build
npx cap add android  # one-time: creates client/android
npx cap open android
```

Let Gradle sync in Android Studio, then choose **Build → Build APK(s)**. The APK appears in
`client/android/app/build/outputs/apk/debug/app-debug.apk`.

For later builds, run `npm run build && npx cap sync android` from `client` before building in
Android Studio. A terminal build also works with JDK 21 and the Android SDK installed:

```bash
cd client/android
./gradlew assembleDebug
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
- A new server starts with an **empty catalog** — there is no sample data. Sign up in the app and
  upload a track; it becomes the shared catalog that every other user sees.
