# Pulse on Render — the complete guide

Everything needed to run Pulse on Render so that **accounts, songs and messages survive every update**,
plus what to check when they don't. Follow it top to bottom once; after that, deploying is automatic.

> If your friends/family have had to sign up again after an update, the cause is in
> [Part C](#part-c--prove-it-is-fixed). It is a hosting setting, not a bug in Pulse.

---

## Contents

1. [What you are deploying](#1-what-you-are-deploying)
2. [Part A — Create the storage bucket (5 min, free)](#part-a--create-the-storage-bucket-5-minutes-free)
3. [Part B — Deploy on Render](#part-b--deploy-on-render-10-minutes)
4. [Part C — Prove it is fixed](#part-c--prove-it-is-fixed) ← **do not skip**
5. [Part D — Point the apps at the site](#part-d--point-the-apps-at-the-site)
6. [Part E — Keep it awake](#part-e--keep-it-awake)
7. [Everyday operations](#everyday-operations)
8. [Troubleshooting table](#troubleshooting)
9. [What cannot be recovered](#what-cannot-be-recovered)

---

## 1. What you are deploying

One Render web service runs everything: the React website, the API, the database and the media.

```
                 ┌─────────────────────── Render web service ───────────────────────┐
 phone app ──────┤  React build (site)  +  Express API  +  SQLite database           │
 windows app ────┤  start command: npm run start:render                               │
 browser ────────┤      └── Litestream: copies chat.db + pulse.db to the bucket      │
                 └───────────────┬──────────────────────────────┬───────────────────┘
                                 │ uploads (audio, covers)      │ database copies
                                 ▼                              ▼
                          ┌──────────── Cloudflare R2 bucket ────────────┐
                          │  uploads/…            litestream/pulse, chat│
                          └─────────────────────────────────────────────┘
```

The single most important detail: **the bucket is not enough on its own.** Uploaded audio is copied to
it on upload, but the *database* only survives because Litestream — started by the start command
`npm run start:render` — copies it there too. A service whose start command is `npm start` gets a
healthy-looking bucket and a database that is wiped on every deploy. That is the exact failure Pulse
now reports out loud.

| Kept thing | How it survives a deploy |
|------------|--------------------------|
| Uploaded audio, covers, avatars | copied to the R2 bucket as each file arrives |
| Accounts, songs, playlists, messages | Litestream copies `pulse.db` and `chat.db` to the bucket every 5 s and restores them at boot |
| The service itself | Render pings `/api/health` every 5 minutes during waking hours |

**Cost:** Render free web service + Cloudflare R2 free tier (10 GB storage, 1M writes/month) = $0.
Pulse pushes a database checkpoint at most every 5 seconds and only while something is changing.

---

## Part A — Create the storage bucket (5 minutes, free)

### A1. Create the bucket

1. Sign in at <https://dash.cloudflare.com> → **R2** in the left sidebar.
2. **Create bucket** → name it `pulse-music` → leave the location as *Automatic* → **Create bucket**.
3. Copy your **Account ID** from the R2 overview page (or from the dashboard URL,
   `dash.cloudflare.com/<ACCOUNT_ID>`). Your endpoint is:

   ```
   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

### A2. Create an access key

1. On the R2 page: **Manage R2 API Tokens** → **Create API token**.
2. Name it `pulse-server`, permission **Object Read & Write**.
3. Under *Specify bucket(s)*, restrict it to `pulse-music` (safer than all buckets).
4. **Create API token**, then copy the two values — they are shown **once**:

   | Cloudflare shows | Paste into Render as |
   |------------------|----------------------|
   | Access Key ID | `S3_ACCESS_KEY_ID` |
   | Secret Access Key | `S3_SECRET_ACCESS_KEY` |
   | (your endpoint URL above) | `S3_ENDPOINT` |
   | bucket name | `S3_BUCKET` |

5. Leave `S3_REGION` unset — Pulse defaults to `auto`, which is what R2 wants.

> **Do not paste only some of the four.** Pulse refuses to start with a partial set on purpose: a
> half-configured bucket is how data loss happens silently. All four, or none.

---

## Part B — Deploy on Render (10 minutes)

### B1. Create the service

**If you have no Render service yet (Blueprint — recommended):**

1. <https://dashboard.render.com> → **New +** → **Blueprint**.
2. Connect GitHub and pick `kaiedits99/pulse-music`.
3. Render reads `render.yaml` and asks for the values marked *sync: false*: paste the four `S3_*`
   values from Part A. `GOOGLE_CLIENT_ID` can be left empty.
4. **Apply**. The service is created and the first build starts (5–8 minutes: two `npm ci` runs plus
   the Vite build).

**If the service already exists:**

Go to **your service → Environment** and add the four `S3_*` variables from Part A
(**Add Environment Variable** each time), then **Save** — Render redeploys with them.

### B2. Check the three settings that matter

Open **your service → Settings**:

| Setting | Must be |
|---------|---------|
| **Build Command** | `npm ci && cd client && npm ci && npm run build` |
| **Start Command** | `npm run start:render` ← **the one that protects the database** |
| **Health Check Path** | `/api/health` |

If **Start Command** says `npm start`, change it now. Everything else can look perfect and accounts
will still disappear on every deploy, because `npm start` never starts Litestream.

### B3. Watch the first boot

**Logs** tab. On a correct deployment you will see, in this order:

```
[pulse] Restoring the database from the bucket, if a saved copy exists...
[pulse] Restoring messages from the bucket, if a saved copy exists...
[pulse] Uploads are kept on bucket "pulse-music" at <account>.r2.cloudflarestorage.com.
[pulse] Uploads:  Uploaded audio and artwork are in object storage and survive every deploy and restart.
[pulse] Database: Accounts, songs, playlists and messages are copied to the bucket by Litestream and
                  restored when the server starts.
[pulse] Starting Pulse under Litestream; database changes are copied to bucket "pulse-music".
[pulse] Data is safe across restarts (bucket).
```

Any line starting with `[pulse] WARNING:` means something is still wrong — jump to
[Troubleshooting](#troubleshooting).

---

## Part C — Prove it is fixed

Do this once, right after the first deploy. It takes five minutes and it is the only way to know.

1. Open your site, **sign up**, and upload one short track.
2. In Render: **your service → Manual Deploy → Deploy latest commit**. Wait for *Live*.
3. Reload the site and log in with the same account.

| Result | Meaning |
|--------|---------|
| Account works, track still there | **Fixed.** Deploys no longer erase anything. |
| Track's audio still in the bucket, but the account and song list are gone | The database is *still* not being copied — re-check **Start Command** is `npm run start:render`. |
| Everything gone, bucket empty too | The `S3_*` values are not reaching the app — re-check Part A/B1, then the logs. |

You can also ask the server directly:

```
https://pulse-music.onrender.com/api/health
```

```json
{
  "status": "ok",
  "storage": "bucket",
  "data": {
    "persistent": true,
    "keeps": "bucket",
    "uploads":  { "durable": true, "where": "bucket" },
    "database": { "durable": true, "where": "bucket", "replicated": true },
    "issues": []
  }
}
```

`"storage": "bucket"` alone only says uploads are safe. **`"persistent": true`** is the one that means
accounts and songs survive. If you see `"database": {"durable": false}` with `"uploads": {"durable":
true}`, you are in the half-state described above.

The admin account also sees a red banner inside the app whenever either half is unsafe, and it names
which one. It disappears on its own when the deployment is fixed.

---

## Part D — Point the apps at the site

The phone and desktop builds need the site's address baked in at build time. Set it **once** in GitHub.

1. Copy your site address from Render (top of the service page), e.g.
   `https://pulse-music.onrender.com`. `https://`, no trailing slash, no `/api`.
2. In GitHub: **repo → Settings → Secrets and variables → Actions → Variables → New repository
   variable**.
3. Add **both** (same value is correct — the website and the API are one service):

   | Variable | Value |
   |----------|-------|
   | `PULSE_APP_URL` | `https://pulse-music.onrender.com` |
   | `VITE_API_URL` | `https://pulse-music.onrender.com` |

4. Rebuild the apps: **Actions → Build Android APK → Run workflow** and **Actions → Build Windows app**.
5. Install the new APK / `.exe`.

With `PULSE_APP_URL` set, the Android app opens your **live site** — so every future website change
reaches installed phones on the next deploy, with no new APK.

Verify the address works first: `https://pulse-music.onrender.com/api/health` must answer `ok`. A
sleeping free instance takes ~50 seconds to wake; that is the first thing to suspect if an app seems
stuck on launch.

---

## Part E — Keep it awake

Free instances sleep after ~15 minutes without visitors. Pulse keeps itself awake **during chosen
hours** (in `render.yaml`): `KEEP_AWAKE=true`, `KEEP_AWAKE_HOURS=6-24`, `PULSE_TIMEZONE=Africa/Lagos`.
Change them in **Environment** if your hours differ.

Why not 24 hours: the free plan gives ~750 instance hours per workspace per month, and a month is ~730
hours. Around-the-clock pinging spends the whole allowance and Render suspends the service until the
1st of the next month. `6-24` uses roughly 550.

Anyone visiting during the sleep window waits a few seconds for the wake-up. If it was *suspended* for
exceeding hours, nobody can wake it — that is the difference.

---

## Everyday operations

**Deploying a change:** push to `main`. Render redeploys automatically (`autoDeploy: true`). The site
and both apps pick the change up on next load (the apps load the live site).

**Releasing an APK / Windows build:** push a tag `v1.0.x`. Both workflows build and attach the files to
a GitHub Release.

**Rolling back:** **Deploys** tab → pick the previous deploy → **Redeploy**. With a working bucket this
is safe for data, because the database lives outside the instance.

**Checking configuration without guessing:** in a Render shell (**Shell** tab) run

```bash
npm run doctor
```

It prints one line per check — Node version, bucket, Litestream, uploads, database — and exits
non-zero when data is at risk.

**Restarting:** **Manual Deploy → Restart service**. Safe with a bucket; on a bucket-less free instance
it empties the site.

**Backups:** the bucket *is* the backup — `litestream/` holds the database history. To take a copy out,
use the R2 dashboard, or in a Render shell:

```bash
npx @flydotio/litestream restore -config litestream.yml /tmp/pulse-copy.db
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Everyone has to sign up again after a deploy; some audio still in the bucket | **Start command is `npm start`** — Litestream never runs | **Settings → Start Command** = `npm run start:render`, then redeploy |
| Everything gone, and uploads gone too | No bucket configured, or partial `S3_*` | Part A, then redeploy |
| `/api/health` shows `"persistent": false` | Read `data.issues` — it names the broken half | Follow the issue message |
| Server will not boot: `Object storage is only partly configured` | Some but not all `S3_*` set | Add the missing ones, or remove them all |
| Boot fails: `could not restore the database from the bucket` | Bad keys / wrong endpoint / bucket deleted | Check the four values; reissue the R2 token |
| Boot fails: `Litestream program was not found` | `npm ci` did not install it | **Manual Deploy → Clear build cache & deploy** |
| Build fails on `better-sqlite3` | Node version drifted from 24 | Keep `NODE_VERSION=24`; `.node-version`, `engines` must agree (a test enforces it) |
| Site shows "Application loading" for ~1 minute | Free instance asleep — normal | Wait; check `KEEP_AWAKE_HOURS` |
| Site is gone until the 1st of next month | Monthly instance hours exhausted (24 h pinging) | Set `KEEP_AWAKE_HOURS=6-24`; contact Render support |
| App says "Can't reach Pulse" | Wrong address baked in, or instance asleep | Check `/api/health`, then rebuild with the correct `PULSE_APP_URL` |
| Songs play on the site, an error in the app | App built without an address | Set `PULSE_APP_URL` and rebuild; the player's **why?** button shows the URL it tried |
| Episodes/users missing but music fine | Messages expire after 24 h **by design**; that is not data loss | — |

---

## What cannot be recovered

If the database was wiped before a bucket was in place, the old accounts and songs are gone from
Render's side; there is nothing to restore. Everyone can sign up again with the same name and email,
and uploads can be re-added. What the fix guarantees is that it cannot happen again — the app now
reports both halves of the answer at `/api/health`, in the startup logs, and in an in-app banner to the
admin, and `npm run doctor` states it plainly before you deploy.

---

## Quick reference

```
Build command   npm ci && cd client && npm ci && npm run build
Start command   npm run start:render          ← Litestream wraps the server
Health path     /api/health
Node version    24                             (NODE_VERSION + .node-version + engines)

Required env    JWT_SECRET                    (generated by render.yaml)
                S3_ENDPOINT                   https://<account>.r2.cloudflarestorage.com
                S3_BUCKET                     pulse-music
                S3_ACCESS_KEY_ID              from the R2 API token
                S3_SECRET_ACCESS_KEY          from the R2 API token

Optional env    S3_REGION                     auto (default)
                S3_PUBLIC_BASE_URL            only if you front the bucket with a domain
                S3_SIGNED_URL_TTL_SECONDS     how long playback links last
                PULSE_PERSISTENT_DISK=true    only with a paid Render Disk
                KEEP_AWAKE / KEEP_AWAKE_HOURS / PULSE_TIMEZONE
                GOOGLE_CLIENT_ID              enables "Sign in with Google"
                PULSE_DB_SYNC_SECONDS         database checkpoint interval (default 5)

GitHub vars     PULSE_APP_URL   = your Render URL   (app opens the live site)
                VITE_API_URL    = your Render URL   (API base baked into builds)
```
