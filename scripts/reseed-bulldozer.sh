#!/usr/bin/env bash
# Re-seed the bulldozer-js payments store from Postgres as part of restart-deps.
#
# Why this exists: bulldozer-js keeps its state in an on-disk LMDB store that
# lives OUTSIDE Docker, so stop-deps/start-deps (which only reset the Docker
# containers) leave a stale bulldozer store behind. After a fresh Postgres seed
# that store is inconsistent, which is why we previously had to manually wipe
# apps/bulldozer-js/.data and re-run db:backfill-bulldozer-from-prisma every
# time. This script does that automatically: wipe the store, boot a temporary
# bulldozer-js, run the one-way Postgres->bulldozer backfill against it, then
# shut it back down again.
set -euo pipefail

PORT_PREFIX="${NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX:-81}"
BULLDOZER_PORT="${PORT_PREFIX}46"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BULLDOZER_DIR="$REPO_ROOT/apps/bulldozer-js"
DATA_DIR="$BULLDOZER_DIR/.data"
TEMP_DATA_DIR=""
BACKUP_DATA_DIR="$BULLDOZER_DIR/.data-backup.untracked.$$"
BULLDOZER_PID=""

port_is_open() {
  node - "$BULLDOZER_PORT" <<'NODE'
const net = require("node:net");
const port = Number(process.argv[2]);
const socket = net.createConnection({ host: "127.0.0.1", port });
socket.setTimeout(250);
socket.once("connect", () => {
  socket.destroy();
  process.exit(0);
});
socket.once("error", () => process.exit(1));
socket.once("timeout", () => {
  socket.destroy();
  process.exit(1);
});
NODE
}

stop_bulldozer() {
  if [[ -z "$BULLDOZER_PID" ]]; then
    return
  fi
  echo "Shutting down temporary bulldozer-js (pid $BULLDOZER_PID) ..."
  kill "$BULLDOZER_PID" 2>/dev/null || true
  wait "$BULLDOZER_PID" 2>/dev/null || true
  BULLDOZER_PID=""
}

cleanup() {
  stop_bulldozer
  if [[ -n "$TEMP_DATA_DIR" && -d "$TEMP_DATA_DIR" ]]; then
    rm -rf "$TEMP_DATA_DIR"
  fi
  if [[ -e "$BACKUP_DATA_DIR" ]]; then
    if [[ ! -e "$DATA_DIR" ]]; then
      mv "$BACKUP_DATA_DIR" "$DATA_DIR"
    else
      rm -rf "$BACKUP_DATA_DIR"
    fi
  fi
}
trap cleanup EXIT

if port_is_open; then
  echo "Cannot re-seed bulldozer-js: port $BULLDOZER_PORT is already in use." >&2
  echo "Stop the existing bulldozer-js process and run restart-deps again." >&2
  exit 1
fi

# Build the replacement store separately. The existing store remains untouched
# unless startup and the full Postgres backfill both succeed.
TEMP_DATA_DIR="$(mktemp -d "$BULLDOZER_DIR/.data-reseed.untracked.XXXXXX")"
TEMP_LMDB_PATH="$TEMP_DATA_DIR/bulldozer-js-lmdb"

echo "Starting temporary bulldozer-js on port $BULLDOZER_PORT ..."
(
  cd "$BULLDOZER_DIR" && \
    NODE_ENV=development \
    HEXCLAVE_BULLDOZER_JS_LMDB_PATH="$TEMP_LMDB_PATH" \
    exec node --import tsx --expose-gc src/index.ts
) &
BULLDOZER_PID=$!

echo "Waiting for temporary bulldozer-js to accept connections on port $BULLDOZER_PORT ..."
ready=0
for ((attempt = 0; attempt < 120; attempt++)); do
  if ! kill -0 "$BULLDOZER_PID" 2>/dev/null; then
    process_status=0
    wait "$BULLDOZER_PID" || process_status=$?
    BULLDOZER_PID=""
    echo "Temporary bulldozer-js exited before becoming ready (status $process_status)." >&2
    exit 1
  fi
  if port_is_open; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" -ne 1 ]]; then
  echo "Temporary bulldozer-js did not become ready within 60 seconds." >&2
  exit 1
fi

echo "Running Postgres->bulldozer backfill ..."
pnpm run db:backfill-bulldozer-from-prisma

stop_bulldozer

echo "Replacing bulldozer-js LMDB store at $DATA_DIR ..."
if [[ -e "$DATA_DIR" ]]; then
  mv "$DATA_DIR" "$BACKUP_DATA_DIR"
fi
mv "$TEMP_DATA_DIR" "$DATA_DIR"
TEMP_DATA_DIR=""
rm -rf "$BACKUP_DATA_DIR"

echo "Bulldozer re-seed complete."
