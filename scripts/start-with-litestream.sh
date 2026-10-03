#!/usr/bin/env bash
# Starts Pulse so its database survives restarts on a host with a temporary disk (Render's free plan):
#   1. restores the database from the bucket if this machine does not have one,
#   2. runs the server under Litestream, which copies every change back to the bucket and makes a last
#      copy when the server is asked to stop.
#
# With no bucket configured it simply starts the server, as `npm start` does.
# Set LITESTREAM_DISABLED=true to skip Litestream on purpose (uploads still use the bucket).
set -euo pipefail

cd "$(dirname "$0")/.."

say() { echo "[pulse] $*"; }
is_set() { [ -n "${!1:-}" ]; }
run_plain() { exec node server/index.js; }

# The same data folder the server uses (see server/db.js): PULSE_DATA_DIR, or ./data.
export PULSE_DATA_DIR="${PULSE_DATA_DIR:-$PWD/data}"
mkdir -p "$PULSE_DATA_DIR"
PULSE_DATA_DIR="$(cd "$PULSE_DATA_DIR" && pwd)"
export PULSE_DB_PATH="$PULSE_DATA_DIR/pulse.db"
# Messages live in their own file (see server/chat-db.js) so the catalogue is never touched by
# their much shorter lifecycle. Same folder, so both survive together on a host with a disk.
export PULSE_CHAT_DB_PATH="${PULSE_CHAT_DB_PATH:-$PULSE_DATA_DIR/chat.db}"

if [ "${LITESTREAM_DISABLED:-}" = "true" ]; then
  say "Litestream is turned off (LITESTREAM_DISABLED=true): the database is NOT being copied anywhere."
  run_plain
fi

have_bucket=1
for setting in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  is_set "$setting" || have_bucket=0
done
if [ "$have_bucket" != 1 ]; then
  # Nothing is set, or only part of it is. The server checks that itself and refuses a partial set.
  say "No bucket is configured, so the database is not being copied anywhere (see DEPLOY.md)."
  run_plain
fi

LITESTREAM_BIN="${LITESTREAM_BIN:-$(node scripts/litestream-path.mjs || true)}"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-$PWD/litestream.yml}"
if [ -z "$LITESTREAM_BIN" ] || [ ! -x "$LITESTREAM_BIN" ]; then
  say "ERROR: a bucket is configured but the Litestream program was not found. Run 'npm ci' on a supported"
  say "platform (Linux or macOS), or set LITESTREAM_DISABLED=true to run without database copies."
  exit 1
fi
if [ ! -f "$LITESTREAM_CONFIG" ]; then
  say "ERROR: Litestream settings file not found: $LITESTREAM_CONFIG"
  exit 1
fi

# litestream.yml reads its settings from these.
export S3_REGION="${S3_REGION:-auto}"

# How often Litestream copies changes to the bucket, in seconds. Litestream copies on this timer only, so
# when the server is asked to stop it stays up a little longer than one interval (see server/shutdown.js)
# to let the last changes go out first.
SYNC_SECONDS="${PULSE_DB_SYNC_SECONDS:-5}"
case "$SYNC_SECONDS" in ''|*[!0-9]*) SYNC_SECONDS=5 ;; esac
if [ "$SYNC_SECONDS" -lt 1 ]; then SYNC_SECONDS=1; fi
if [ "$SYNC_SECONDS" -gt 20 ]; then SYNC_SECONDS=20; fi
export PULSE_DB_SYNC_INTERVAL="${SYNC_SECONDS}s"
export PULSE_SHUTDOWN_DELAY_SECONDS="$((SYNC_SECONDS + 2))"

say "Restoring the database from the bucket, if a saved copy exists..."
if ! "$LITESTREAM_BIN" restore -config "$LITESTREAM_CONFIG" -if-db-not-exists -if-replica-exists "$PULSE_DB_PATH"; then
  # Carrying on would start an empty database and copy it over the saved one, losing everything.
  say "ERROR: could not restore the database from the bucket, so Pulse is NOT starting."
  say "Check the S3_* settings and that the bucket is reachable, then restart or redeploy."
  exit 1
fi

# Messages are restored too, but a failure here is not fatal: every conversation in that file is
# deleted within a day of being read anyway, so starting empty is survivable where losing the
# catalogue would not be.
say "Restoring messages from the bucket, if a saved copy exists..."
"$LITESTREAM_BIN" restore -config "$LITESTREAM_CONFIG" -if-db-not-exists -if-replica-exists "$PULSE_CHAT_DB_PATH" \
  || say "WARNING: messages could not be restored; starting with an empty message store."

say "Starting Pulse under Litestream; database changes are copied to bucket \"$S3_BUCKET\"."
exec "$LITESTREAM_BIN" replicate -config "$LITESTREAM_CONFIG" -exec "node server/index.js"
