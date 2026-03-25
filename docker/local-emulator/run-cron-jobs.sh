#!/bin/bash
# Polls backend cron endpoints in parallel background loops, matching vercel.json cron config.
# Replaces the tsx scripts used in dev mode since tsx is not in the final image.

set -e

BACKEND_URL="http://127.0.0.1:${BACKEND_PORT:-8102}"
CRON_SECRET="${CRON_SECRET:-mock_cron_secret}"

# Wait for the backend to be ready
until curl -fsS "${BACKEND_URL}/health" >/dev/null 2>&1; do sleep 2; done

echo "Cron jobs started."

run_loop() {
  local endpoint="$1"
  while true; do
    curl -sf -o /dev/null --max-time 120 "${BACKEND_URL}${endpoint}" \
      -H "Authorization: Bearer ${CRON_SECRET}" || true
    sleep 60
  done
}

run_loop "/api/latest/internal/email-queue-step" &
run_loop "/api/latest/internal/external-db-sync/sequencer" &
run_loop "/api/latest/internal/external-db-sync/poller" &

wait
