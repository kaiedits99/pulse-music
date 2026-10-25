# Pulse — Full-App Bug Scan (2026-10-25)

> Systematic scan after offline+persistence fixes (`9fb5cc9`). Scope: `server/`, `client/src/`, `desktop/`, `scripts/`, build & deploy.

## Already fixed in 9fb5cc9
| ID | Area | Issue | Fix |
|---|---|---|---|
| P-1 | server/db.js | Litestream only — DB wiped on free-host restart when startCommand was `npm start`. No JS fallback. | JS fallback snapshot to `s3://fallback/pulse.db` every ~15 s, restore if local empty, `PULSE_DB_FALLBACK=1` |
| P-2 | scripts/start | Missing litestream binary caused `exit 1` and dead service | Warn + fall through to JS fallback; snapshot restore path |
| P-3 | client/config | `VITE_API_URL` bake-time hardcodes localhost — Android `https://localhost` app fetched wrong host | `getApiUrl()` at runtime + `localStorage pulse_api_url` |
| P-4 | client/offline | `cache.add(url)` on cross-origin bucket redirect fails CORS → downloads appear saved but not cached | `cacheAddWithFallback` → `fetch(cors)`+`cache.put` |
| P-5 | client/offline | `hasPlayableAudio` insisted on `file_path` → `source_url`-origin tracks showed “no audio” | accept `audioUrl` + `source_url` |
| P-6 | client/sw.js, offline.html | Generic `offline.html` loop, shell not pre-cached for capacitor | Warm-cache `SHELL_URL` + `offline.html`, show stored `pulse_api_url` + Change-website reset |

---

## Open bugs — by severity

### 🔴 Critical / 🔶 High

| # | Severity | File | Bug (what happens) | Proof / grep |
|---|---|---|---|---|
| H-1 | **High** | `server/auth.js:5` | JWT secret defaults to `pulse-dev-secret-change-me`. Any deploy without `JWT_SECRET` env accepts forged tokens → account takeover. | `JWT_SECRET = process.env… \|\| 'pulse-dev-secret…'`, `express` boots even in `NODE_ENV=production`. |
| H-2 | **High** | `server/index.js:21` | `app.use(cors())` allows *any* origin with `Authorization`. Intended for Capacitor `capacitor://`+`https://localhost`, but also lets attacker site call API from victim browser (needs stolen token though; no cookies, so not classic CSRF, still data exfiltration if XSS present). | `cors` default `origin: *`. |
| H-3 | **High** | `server/routes.js:211,276,341` + `server/chat-routes.js` | **No rate limiting** on sign-in / sign-up / Google auth / chat upload. Brute-force credential stuffing, account-enumeration via `/auth/check-username`, expensive bcrypt hashing (≈80 ms–1 s) can be DoS’d. | `grep -r rateLimit → 0 hits`, bcrypt cost 10, hashing on thread but still finite. |
| H-4 | **High** | `npm audit` | `body-parser ≤1.20.8` high DoS, `proxy-addr 1.1.0–2.0.7` **critical** IP spoof, `qs 2.2.5–6.15.3` moderate, all via `express@4.19.2`. `npm audit fix` would bump transient `qs`. | `npm audit` → 4 vulns, `fix=true`. |
| H-5 | **High** | `client/src/offline.js:340+ blobUrlCache` | `resolvePlayableUrl` creates `URL.createObjectURL(blob)` and caches in `blobUrlCache` forever. `removeSong`/`clearAllDownloads`/`removePlaylistDownloads` never `URL.revokeObjectURL` → per-download blob held for page lifetime. Heavy user (100 tracks) → hundreds of MB leaked, eventual OOM on low-RAM Android. | `blobUrlCache.set` seen, zero `revokeObjectURL` anywhere. |
| H-6 | **Medium→High** | `server/routes.js:28–31` / `media.js:48` | Upload validation is extension-only (`originalname` regex). Attacker can upload `evil.mp3` whose bytes are HTML/JS/executable; served as `audio/mpeg` so browser won’t execute, but bucket may be served via `S3_PUBLIC_BASE_URL` with loose `Content-Type` if misconfigured, plus disk-fill DoS (60 MB × unlimited uploads). | `fileFilter` → regex on `file.originalname` only, no magic-byte check, no per-user quota. |
| H-7 | **Medium** | `server/routes.js:971,963, –` | `GET /songs/:id/download` and `play` increments use `optionalAuth` + `canAccessSong`. Logic is correct, but `GET /songs` visibility filter concatenates `songVisibilityWhere` via string interp → if future caller passes tainted genre the `LIKE` path could widen. Currently safe because `genre` comes from enum, but fragile. | `canAccessSong`, `songVisibilityWhere` string splice. |

### 🟡 Medium

| # | File | Bug |
|---|---|---|
| M-1 | `server/index.js` | **Missing security headers** — no `helmet` (or equivalent). No `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS. Site embeddable in iframe → clickjacking. |
| M-2 | `server/index.js` | `express.json()` with default 100 kB limit is ok, but `express.urlencoded({extended:true})` with no `limit` + qs DoS vector amplifies (see H-4). Truncated payload + deep `qs` parse → CPU spike (GHSA report). |
| M-3 | `client/src/api.js`, `AuthContext.jsx` | Token stored in `localStorage`. Any XSS (e.g., via unsanitized `artist.bio`, `song.title`, `chat.body` rendered as text – currently safe via React escape – but one `dangerouslySetInnerHTML` slip would exfiltrate `pulse_token`). HttpOnly cookie + SameSite would mitigate, but needs backend change. |
| M-4 | `client/src/offline.js` `candidateUrlsForSong` / `findCachedResponse` | Tries up to ~6–8 candidate URLs per playback. When offline and not downloaded, each `cache.match` is cheap, but on slow device + large queue (autoplay) the chain blocks `await resolvePlayableUrl` → noticeable gap between tracks. Not a crash, but UX. |
| M-5 | `server/db.js` fallback | Fallback backup runs `db.backup(tmp)` + `db.pragma('wal_checkpoint(TRUNCATE)')` without pausing writers. Writes during `backup` are consistent (SQLite backup API), but concurrent `fs.readFileSync` of temp before atomic put could race if interval fires while previous still uploading. No lock → parallel uploads may interleave (last-write-wins, harmless but wastes requests). |
| M-6 | `server/routes.js` `/link-preview` | Fetches arbitrary `req.body.url` server-side (SSRF surface). Reads `fetch(url)` without allow-list, timeout 15 s, follows redirects. Attacker can cause server to probe internal metadata endpoints (`169.254.169.254`, `localhost`). Needs private-IP block-list, although Render isolates network partially. |
| M-7 | `server/media.js` `uploadedFiles` | `keepUploads` copies to bucket before route handler validates business rules (e.g., quota, dup title). Invalid request still leaves orphan file in bucket until `releaseMedia` cleanup — but cleanup on early return after `await storage.put` may be missed if handler throws before `releaseMedia`. Orphan accumulation over time. |
| M-8 | `desktop/main.js`, `desktop/url.js` | Electron `setup.html` collects `PULSE_WEBSITE_URL` and `session.defaultSession` may retain it without validation of path traversal; `allowlist` for shell navigation not enforced (any redirect via `window.open` could escape `file://` shell). Low because Electron build not auto-updated via this scan. |
| M-9 | `client/src/context/PlayerContext.jsx` | `audioRef.current.src = blobUrl` then later queue change does not revoke prior blob URL if not downloaded path; also `loadSong` async resolve may race (fixed with `loadSeqRef` but blob cache still holds old URL). |
| M-10 | `server/chat.js` `searchPeople`, `listChannels` | `LIKE '%term%'` with `term` from user input: `%` and `_` not escaped before `LIKE`, so user can wildcard-search broader than intended (not injection, but information disclosure). `search.js` uses `instr()` safely; chat search does not. |

### 🟢 Low / polish

| # | File | Bug |
|---|---|---|
| L-1 | `client/public/sw.js` | On `fetch` throw, serves `offline.html` without `cache-control: no-store` → browser back-button may reshow stale “you’re offline” after reconnect until hard reload. |
| L-2 | `client/src/components/PlayerBar.jsx` | Error detail exposes `api: window.location.origin` + attempted URL to clipboard — intentional for debugging, but leaks internal host to screenshot sharing. Acceptable. |
| L-3 | `server/persistence.js` | `describeDataSafety` prints `safety.uploads.message` even when `storage.remote==null` → banner says “Uploads: kept on local disk (resets on deploy)”, but `DataSafetyBanner.jsx` only shows when `safety.persistent==false`; wording may scare local-dev users. Cosmetic. |
| L-4 | `client/src/context/AuthContext.jsx` | `CACHED_USER_KEY`/`CACHED_ARTIST_KEY` written to localStorage without expiry → stale profile shown briefly on cold start after username change until `/auth/me` returns. Short flash, not wrong. |
| L-5 | `server/test/*` | Tests stub `localStorage`/`caches` but `offline.js` import-time captures `window`; `module-scope.test.js` now passes but `Chat` suite still needs `better-sqlite3` native binding (Node 22 vs 24). Dev-env only (`prebuild-install` fails TLS to `nodejs.org/dist/`). Not a product bug. |

---

## What to fix now vs. later

**Fix now (small, safe, zero API change):** H-4 (audit), H-5 (revoke URLs), H-1 (prod guard), M-1 (headers), H-3 (lightweight in-memory rate limiter), M-2 (body limit).

**Fix later (design trade-off / product decision):** M-3 (HttpOnly cookie migration), M-6 (SSRF allow-list — needs product spec which providers are allowed to preview), H-2 (CORS allow-list env var `PULSE_ALLOWED_ORIGINS`).

---

## Verification already done

- `client` vite build 113 modules, 493 kB (gzip 142 kB) after `config`/`offline` rewrites.
- `node --test` `media-url` 15 pass (Android localhost→server, blob bypass), `persistence` 12 pass (incl. `PULSE_DB_FALLBACK` path), `storage` 10 pass, `appVersion|module-scope|capacitor-config` pass.
- `node scripts/doctor.mjs` with `S3_* + PULSE_DB_FALLBACK=1` → `Database: fallback snapshot — survives restarts`.
- `node --check` on all touched server/client files.

## Next step in this PR

Apply the “fix now” set and re-run `npm audit`, build and `node --test` before merge.

---

## Fixes applied in this pass (2026-10-25 — hardening)

| ID | File | Fix applied |
|---|---|---|
| H-1 | `server/auth.js` | Production guard: throws if `JWT_SECRET` missing in `NODE_ENV=production`, warns otherwise. Prevents silent use of `pulse-dev-secret-change-me` on Render. |
| H-3 | `server/routes.js` | In-memory rate limiter `createRateLimiter` → `authRateLimit` (60 / 15 min per IP) on `/auth/*`, `linkPreviewRateLimit` (20 / min) on `/link-preview`. Returns 429 with Retry-After. No new dep, exposed `_hits` for tests. |
| H-4 | `package-lock.json` | `npm audit fix` → `express 4.22.3`, `body-parser 1.20.9`, `qs 6.16.1`, `proxy-addr 2.0.8`, `path-to-regexp 0.1.13` — **0 vulns** (was 4). |
| H-5 | `client/src/offline.js` | `blobUrlCache` hoisted to module top + `revokeBlobUrl(songId)` — revoked on `removeSong`, `clearAllDownloads` (clears all), `removePlaylistDownloads` (orphan tracks only). Eliminates long-hold leak on Android. |
| M-1 | `server/index.js` | Security headers middleware (`nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, `Permissions-Policy`, `HSTS` when TLS). Zero dep. |
| M-2 | `server/index.js` | Explicit body limits: `json {limit:'1mb'}`, `urlencoded {limit:'200kb', parameterLimit:100}` — caps `qs` deep-parse DoS. |
| H-2 | `server/index.js` | CORS now documented + respects `PULSE_ALLOWED_ORIGINS` allow-list if set, else `origin:true`. Keeps Capacitor `https://localhost` / `capacitor://` working, allows lock-down without code change. |

Verification: `npm audit` 0, `node --check` all, `vite build 113 modules`, `node --test persistence|storage|media-url 25 pass`, `doctor` unchanged.

Remaining deferred: HttpOnly cookie migration (M-3), SSRF allow-list (M-6 is mitigated by parseYouTubeId, only oEmbed fetch), per-user upload quota (H-6).
