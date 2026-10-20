# Build Pulse as an Android app (APK)

Pulse is now a **Capacitor** project. The React app is wrapped in a native Android shell,
and the backend stays hosted (Glitch/Render/etc.) — the app talks to it over the internet.

**Two ways to get an APK** — pick one:

- **A. GitHub Actions (no Android Studio, recommended)** — push to GitHub and it builds the APK for you.
- **B. Android Studio (build locally)** — if you want to run/develop on your own machine.

---

## How updates work (important)

Pulse has one server and three doors, and they update in different ways:

| Where | What you see | How it updates |
|-------|--------------|----------------|
| **Website** | the live app | automatically, on every deploy |
| **Windows app** | the live website in a window | automatically, on every deploy |
| **Android app** | see below | depends on the build |

For the Android app there are two modes, chosen by whether `PULSE_APP_URL` (or `VITE_API_URL`)
is set when it is built:

- **Live mode (recommended).** The app opens your website directly. Every fix to the site reaches
  installed phones on the next deploy — no new APK. If the site can't be reached, the app shows a
  bundled "can't reach Pulse" page with a retry button. The *Backend server URL* setting disappears,
  because the site's own address is the server.
- **Bundled mode (no address set).** The app carries its own copy of the interface and asks for the
  backend address on first launch. It works offline out of the box, but **a new APK is needed for
  every interface change**.

In both modes, **Settings → About Pulse** shows the version and a *Check for updates* button, and
when a newer release exists the app shows a "Pulse x.y.z is ready" banner inside the app. Android
only lets the Play Store install silently, so that button opens the APK download and the system
installer asks you to confirm — about three taps, no GitHub account needed.

**Why did my fix not show up?** If the phone runs bundled mode, the APK you installed has the code
it was built with. Install the newest APK from
[Releases](https://github.com/kaiedits99/pulse-music/releases), or switch to live mode by setting
`PULSE_APP_URL` so future fixes arrive by themselves.

---

## How the app connects to your backend

The Android app needs to know where your backend lives. There are two ways:

1. **At runtime (easiest, no rebuild):** open the app → the **Backend server URL** setting opens
   by itself on first launch when no address is saved → paste the address of your Pulse website
   (e.g. `https://pulse-music.onrender.com`) → Save. The app remembers it, and from then on it is
   the same Pulse as the website: the same catalog, the same accounts, the same messages.
   The setting stays available on the login screen if you ever need to change it.
2. **At build time:** set the `VITE_API_URL` variable (GitHub Actions variable, or a `.env`
   file for local builds) to that same website address, so a fresh install is already connected.

> The backend must be deployed first. Use the Render Blueprint (`render.yaml`) or Glitch —
> see `DEPLOY.md`. Then copy its public URL into the app.

---

## Option A — Build the APK with GitHub Actions (no Android Studio)

1. Push this project to GitHub. The **Build Android APK** workflow runs automatically on
   pushes and pull requests; you can also start it from **Actions → Build Android APK → Run workflow**.
2. **Easiest — no GitHub login:** open <https://github.com/kaiedits99/pulse-music/releases> and
   download `Pulse-<version>-android.apk` from the newest release. Releases are published when a
   `v*` tag is pushed or the workflow is run with **publish_release** ticked, and they never expire.
   (The **`pulse-apk`** artifact on the run page contains the same `app-debug.apk`; it needs a login
   and is kept for 14 days.)
3. Copy the APK to the phone and tap it. Every push to the repo builds a new one.
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
