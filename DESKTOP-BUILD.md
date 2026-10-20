# Build Pulse for Windows (.exe)

Pulse for Windows is the same Pulse, not a copy of it. The `.exe` is an Electron window onto your
Pulse **website**, so the desktop app, the browser and the Android app are looking at one catalog,
one set of accounts and one set of conversations. Nothing is synced between them because nothing is
duplicated: every device reads and writes the same server.

```
website  ─┐
Android  ─┼──►  your Pulse server (Express + SQLite)  ◄── the one source of truth
Windows  ─┘
```

## Get the .exe

**The easy way — a download link, no GitHub login:**

1. Open **<https://github.com/kaiedits99/pulse-music/releases>**.
2. Under the newest **Pulse for Windows** release, download:
   - `Pulse-Setup-1.0.0.exe` — the installer (Start Menu and desktop shortcuts)
   - `Pulse-Portable-1.0.0.exe` — one file, runs without installing (good for a USB stick)
3. Run it. Windows may say *“Windows protected your PC”* because the build is unsigned:
   **More info → Run anyway**.
4. Enter your Pulse website address on the first screen and press **Connect**.

Releases are published by the workflow when it is run with **publish_release** ticked
(*Actions → Build Windows app → Run workflow*), or by pushing a tag that starts with `v`.

**The build-artifact way** (needs a GitHub login, kept for 14 days): open
**Actions → Build Windows app**, pick a green run, and download the **`pulse-windows`** artifact at
the bottom of the run page. It contains the same two files.

Signing it properly needs a paid code-signing certificate; see [Signing](#signing-optional) below.

## Tell the app which website to open

Either:

- **Bake it in (recommended).** In GitHub: **Settings → Secrets and variables → Actions →
  Variables → New repository variable**, name `PULSE_APP_URL`, value your site (for example
  `https://pulse-music.onrender.com`). The build writes it into `desktop/config.json`, so every
  installer that comes out is already connected. `VITE_API_URL` works too — the same variable
  configures the Android build — and `PULSE_APP_URL` wins if both are set.
- **Or let the app ask.** With no variable set, the first launch shows a **Connect to your Pulse
  website** screen. Paste the address, press Connect, and it is remembered in
  `%APPDATA%\Pulse\config.json`. You can change it later from **File → Change Pulse website**.

The address must be a real, reachable website. `http://` is accepted only for `localhost` /
`127.0.0.1` (a dev server on the same machine); any other site must be `https://`, so a password is
never sent in the clear — the setup screen says so instead of silently accepting it.

## Build it yourself

On Windows (easiest — no cross-compiling):

```bat
cd desktop
npm ci
npm start          :: runs the app against the address in config.json / %APPDATA%
npm run dist       :: writes release\Pulse-Setup-*.exe and release\Pulse-Portable-*.exe
```

To point a local build at a dev server before running, either edit `desktop/config.json` or:

```bat
set PULSE_APP_URL=http://localhost:8080
npm start
```

Start the Pulse server first (`npm start` in the repository root); the app opens whatever address it
is given, including `http://localhost:8080`.

`npm run dist:dir` builds an unpacked folder (`desktop/release/win-unpacked/Pulse.exe`) instead of
installers — handy for a quick look without producing a setup file.

Cross-building from macOS or Linux works with `electron-builder --win` for the portable target but
needs Wine for the NSIS installer, so the GitHub Actions workflow (which runs on `windows-latest`)
is the reliable path.

## What the desktop app does

- **One window, no browser chrome.** Sign-in, dashboard, sidebar, player — exactly the website's UI,
  so nothing has to be built twice.
- **First-run setup** and a **connection page** that explains what happened (offline, wrong address,
  site asleep) with *Try again*, *Change website* and *Open in browser* instead of a blank window.
- **Links stay where they belong.** Google sign-in and shared links open in your normal browser;
  only your Pulse site opens inside the app.
- **Microphone works.** Voice notes in Messages need it, so that permission is granted (along with
  notifications and clipboard); location, serial ports and MIDI are refused.
- **Downloads** (a track's ⋮ → *Download*) go through the normal save dialog and land in your
  Downloads folder, with a confirmation when the file is complete.
- **Music keeps playing** when the window is in the background (page throttling is off, as a music
  app should be).
- **One instance.** Launching the app again focuses the window that is already open.

## Layout

```
desktop/
├── main.js         # Electron main process: window, menu, permissions, navigation, config
├── preload.js      # the only bridge to the app's own pages (no Node in the page)
├── url.js          # address parsing — the one piece worth unit-testing
├── url.test.cjs    # npm test
├── setup.html      # first-run "Connect to your Pulse website"
├── offline.html    # "can't reach the site" with retry / change / open in browser
├── config.json     # default address (CI fills this from PULSE_APP_URL)
└── build/icon.ico  # app + installer icon, derived from client/public/icon.svg
```

## Security notes

The app renders your own website, but it is still a webview: `contextIsolation` is on,
`nodeIntegration` is off, the renderer is sandboxed, and the preload exposes only five actions
(read state, save address, retry, open setup, open a link) — no filesystem or shell access.

## Signing (optional)

To remove the SmartScreen warning you need a code-signing certificate (an OV/EV one, or Azure Trusted
Signing). Put the certificate in repository secrets and electron-builder picks it up:

| Secret | What it is |
|--------|------------|
| `CSC_LINK` | base64 of your `.pfx`, or a path/URL to it |
| `CSC_KEY_PASSWORD` | the password for that `.pfx` |

Then drop `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from `.github/workflows/windows.yml`. Without the
secrets the build is simply unsigned and still runs.

## Releasing a new version

Bump `version` in `desktop/package.json`, push, download the new artifact. The app's version is shown
in **Help → About Pulse**, so you can tell at a glance which build someone is running.

## Related

- [`ANDROID-BUILD.md`](ANDROID-BUILD.md) — the phone app (Capacitor, same backend)
- [`DEPLOY.md`](DEPLOY.md) — hosting the website the app connects to
