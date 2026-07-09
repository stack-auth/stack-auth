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

echo "Wiping bulldozer-js LMDB store at $BULLDOZER_DIR/.data ..."
rm -rf "$BULLDOZER_DIR/.data"

echo "Starting temporary bulldozer-js on port $BULLDOZER_PORT ..."
# Run the server directly (single node process, so we can reliably kill it) via
# tsx's node loader — the same entrypoint the package's `start` script uses.
(
  cd "$BULLDOZER_DIR" && exec node --import tsx --expose-gc src/index.ts
) &
BULLDOZER_PID=$!

cleanup() {
  echo "Shutting down temporary bulldozer-js (pid $BULLDOZER_PID) ..."
  kill "$BULLDOZER_PID" 2>/dev/null || true
  wait "$BULLDOZER_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for bulldozer-js to accept connections on port $BULLDOZER_PORT ..."
pnpm exec wait-on -t 60000 "tcp:localhost:$BULLDOZER_PORT"

echo "Running Postgres->bulldozer backfill ..."
pnpm run db:backfill-bulldozer-from-prisma

echo "Bulldozer re-seed complete."
