#!/bin/bash
set -e

# In deps-only mode (used during QEMU image build), skip app startup entirely.
# The build only needs the infrastructure services to initialize; the app
# requires runtime env vars that are not available at build time.
if [ "${STACK_DEPS_ONLY:-false}" = "true" ]; then
  echo "Deps-only mode: app startup skipped."
  while true; do sleep 3600; done
fi

# Wait for all infrastructure services to be ready before running migrations
# and starting the backend/dashboard.
INIT_SERVICES_DONE_FILE=/var/run/stack-local-init-services.done
INIT_SERVICES_FAILED_FILE=/var/run/stack-local-init-services.failed

until pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1; do sleep 2; done
until curl -sf http://127.0.0.1:8123/ping >/dev/null 2>&1; do sleep 2; done
until curl -sf http://127.0.0.1:8071/api/v1/health/ >/dev/null 2>&1; do sleep 2; done
until curl -sf http://127.0.0.1:9090/minio/health/live >/dev/null 2>&1; do sleep 2; done
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/ 2>/dev/null || true)" = "401" ]; do sleep 2; done

until [ -f "$INIT_SERVICES_DONE_FILE" ]; do
  if [ -f "$INIT_SERVICES_FAILED_FILE" ]; then
    echo "init-services.sh failed; refusing to start the app." >&2
    exit 1
  fi
  sleep 1
done

exec /app-entrypoint.sh
