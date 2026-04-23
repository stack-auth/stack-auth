#!/bin/bash
# Polls backend cron endpoints in parallel background loops, matching vercel.json cron config.
# Replaces the tsx scripts used in dev mode since tsx is not in the final image.

set -e

# Pick up rotated secrets from the emulator snapshot resume path if present.
if [ -f /run/stack-auth/rotated-secrets.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /run/stack-auth/rotated-secrets.env
  set +a
fi

BACKEND_URL="http://127.0.0.1:${BACKEND_PORT:-8102}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set; refusing to start cron loops." >&2
  exit 1
fi

# Wait for the backend to be ready
until curl -fsS "${BACKEND_URL}/health" >/dev/null 2>&1; do sleep 2; done

echo "Cron jobs started."

run_loop() {
  local endpoint="$1"
  while true; do
    curl -sf -o /dev/null --max-time 120 "${BACKEND_URL}${endpoint}" \
      -H "Authorization: Bearer ${CRON_SECRET}" || true
    sleep 1
  done
}

run_loop "/api/latest/internal/email-queue-step" &
run_loop "/api/latest/internal/external-db-sync/sequencer" &
run_loop "/api/latest/internal/external-db-sync/poller" &

wait
