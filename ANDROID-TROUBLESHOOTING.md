# When the app shows "Can't reach Pulse"

The recovery screen means the app opened but the website behind it did not answer. It offers two
ways out, and both work with the phone offline:

- **Try again** reloads the website (waking a sleeping host first when it can).
- **Change the website address** opens a field on the same screen. Enter the address and it is saved
  and used immediately. Use this when the address baked into the app is wrong or the server has
  moved — it is the only way to correct it without installing a new APK.

  It used to open the app's local sign-in screen instead. That cannot work when the app loads the
  live site: Android has no address to reach there, so the navigation failed and landed straight
  back on this page — the button appeared to do nothing.

If neither works, the address itself is usually the problem, not the app.

## Check the address the app was built with

The address comes from the `PULSE_APP_URL` (or `VITE_API_URL`) variable at build time. Confirm it
is exactly the URL you open in a browser — `https://`, the real host, no trailing slash:

1. GitHub → **Settings → Secrets and variables → Actions → Variables**
2. Check `PULSE_APP_URL`. It must match the deployed site, for example
   `https://your-service.onrender.com`.
3. Re-run **Build Android APK**. The build prints one of two lines:
   - `[capacitor] Live mode: the app will open https://…` — the address was accepted.
   - `[capacitor] Ignoring "…": the app needs an https:// address` — it was rejected (plain `http`,
     a typo, or a bare host that could not be parsed) and the app was built in bundled mode.
   - `No PULSE_APP_URL/VITE_API_URL — building the bundled app` — the variable is not visible to the
     workflow at all. A variable set under a *different* name, or under an environment, does nothing.

## Check the server is awake and healthy

Open `https://your-site/api/health` in a phone browser. It should answer with JSON containing
`"status":"ok"`. If it does not answer at all, the app is right: the server is down, sleeping,
suspended (a free Render instance that ran out of hours stays down until the next month), or
blocked on that network.

## Reinstall cleanly if the app still will not start

An APK install keeps the WebView's stored data. If a previous build left a cached page behind,
clearing it is the fastest reset:

1. Android **Settings → Apps → Pulse → Storage → Clear storage** (this also removes downloads).
2. Install the newest APK from
   <https://github.com/kaiedits99/pulse-music/releases/latest>.

## Known causes, fixed in 1.0.5

- The recovery page loaded its own script from `localhost`, which does not exist on the phone, so
  the buttons did nothing. It is now one self-contained page whose controls are plain links.
- The service worker could answer a script request with an HTML page, which blanks the app.
- Requests could hang forever instead of failing.

If the screen still appears on 1.0.5, report: the version from **Settings → About Pulse**, the
exact address you expect, and what `api/health` says on the same phone.
