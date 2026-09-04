#!/bin/bash
#
# Railway entrypoint for the Hexclave self-host image.
#
# Wraps the image's own /app/entrypoint.sh rather than replacing it: everything
# upstream does (migrations, seeding, sentinel substitution, starting the backend
# and dashboard) still happens, unmodified. This script only adds the parts
# Railway needs around it:
#
#   1. Derives configuration Railway already knows (database URL, public domain,
#      proxy trust) so operators do not hand-set variables the platform provides.
#   2. Starts the single-port proxy so one Railway domain serves both the API and
#      the dashboard, replacing a separate Caddy service.
#   3. Starts the in-container cron runner, replacing a separate cron service.
#   4. Supervises all three, so the container exits when any of them does.
#
# Keeping this additive means `git merge upstream` never touches it.

set -euo pipefail

# Overridable purely so the test suite can point these at fixtures; production
# deployments use the defaults baked into the overlay image.
UPSTREAM_ENTRYPOINT=${HEXCLAVE_RAILWAY_UPSTREAM_ENTRYPOINT:-/app/entrypoint.sh}
RAILWAY_DIR=${HEXCLAVE_RAILWAY_DIR:-/railway}
APP_DIR=${HEXCLAVE_RAILWAY_APP_DIR:-/app}

if [ ! -x "$UPSTREAM_ENTRYPOINT" ]; then
  echo "ERROR: expected the base image's entrypoint at $UPSTREAM_ENTRYPOINT. Is BASE_IMAGE a Hexclave server image?" >&2
  exit 1
fi

# ============= ENV DERIVATION =============

# The application dual-reads HEXCLAVE_* and STACK_* names and refuses to start if
# the two spellings disagree, so a value counts as configured if EITHER is set.
# Deriving over an operator's explicit STACK_*-named value would trip that check.
hexclave_env_is_set() {
  local canonical=$1
  local twin=${canonical/HEXCLAVE_/STACK_}
  [ -n "${!canonical:-}" ] || [ -n "${!twin:-}" ]
}

derive_env() {
  local name=$1
  local value=$2
  local reason=$3
  if [ -z "$value" ]; then
    return 0
  fi
  if hexclave_env_is_set "$name"; then
    return 0
  fi
  export "$name=$value"
  echo "railway/entrypoint: derived $name from $reason"
}

if [ -n "${RAILWAY_ENVIRONMENT_ID:-}${RAILWAY_SERVICE_ID:-}" ]; then
  echo "railway/entrypoint: Railway environment detected (service ${RAILWAY_SERVICE_NAME:-unknown})"
fi

# Railway's Postgres publishes DATABASE_URL. Mapping it here means the service
# needs no HEXCLAVE_DATABASE_CONNECTION_STRING variable at all when it is wired to
# a Railway Postgres; an operator using an external database still sets it and
# that explicit value wins.
derive_env HEXCLAVE_DATABASE_CONNECTION_STRING "${DATABASE_URL:-}" "DATABASE_URL"

# RAILWAY_PUBLIC_DOMAIN is the domain Railway routes to this service. Both URLs
# resolve to the same origin because the proxy below serves the API and the
# dashboard from one port. Custom domains should still be set explicitly — this
# is a sensible default for a freshly deployed template, not a replacement for
# real configuration.
if [ "${HEXCLAVE_RAILWAY_DISABLE_PROXY:-false}" != "true" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  derive_env NEXT_PUBLIC_HEXCLAVE_API_URL "https://${RAILWAY_PUBLIC_DOMAIN}" "RAILWAY_PUBLIC_DOMAIN"
  derive_env NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL "https://${RAILWAY_PUBLIC_DOMAIN}" "RAILWAY_PUBLIC_DOMAIN"
fi

# Every request arrives through Railway's edge proxy, and the backend refuses to
# start with an HTTPS public URL unless it is told a proxy is in front of it.
# "generic" is the correct setting for an edge that terminates TLS and blocks
# direct origin access, which is exactly Railway's model.
derive_env HEXCLAVE_TRUSTED_PROXY "generic" "the Railway edge proxy"

# ============= PROCESS SUPERVISION =============

declare -a child_pids=()
declare -a child_names=()

start_child() {
  local name=$1
  shift
  "$@" &
  local pid=$!
  child_pids+=("$pid")
  child_names+=("$name")
  echo "railway/entrypoint: started $name (pid $pid)"
}

if [ "${HEXCLAVE_RAILWAY_DISABLE_PROXY:-false}" = "true" ]; then
  # Opt-out for operators who would rather expose BACKEND_PORT and DASHBOARD_PORT
  # as two Railway domains with explicit target ports.
  echo "railway/entrypoint: proxy disabled by HEXCLAVE_RAILWAY_DISABLE_PROXY"
else
  start_child proxy node "$RAILWAY_DIR/proxy.mjs"
fi

if [ "${HEXCLAVE_RAILWAY_DISABLE_CRON:-false}" = "true" ]; then
  echo "railway/entrypoint: cron disabled by HEXCLAVE_RAILWAY_DISABLE_CRON"
elif [ -z "${CRON_SECRET:-}" ]; then
  # Not fatal: a deployment that does not need scheduled work is legitimate. Say so
  # loudly, though, because silently skipping the email queue and sync workers is a
  # very confusing thing to debug later.
  echo "railway/entrypoint: WARNING: CRON_SECRET is unset, so scheduled jobs (email queue, external DB sync, workflow engine, growth watchdog) will NOT run. Set CRON_SECRET to enable them, or HEXCLAVE_RAILWAY_DISABLE_CRON=true to silence this." >&2
else
  start_child cron node "$RAILWAY_DIR/cron.mjs"
fi

# The upstream entrypoint expects to run from the app root: it cd's into
# apps/backend by relative path for migrations and seeding.
cd "$APP_DIR"
start_child app "$UPSTREAM_ENTRYPOINT"

terminating=false
forward_signal() {
  if [ "$terminating" = true ]; then
    # A second signal means the operator (or Railway's SIGKILL timer) is out of
    # patience; stop being graceful.
    kill -KILL "${child_pids[@]}" 2>/dev/null || true
    return
  fi
  terminating=true
  echo "railway/entrypoint: shutting down"
  kill -TERM "${child_pids[@]}" 2>/dev/null || true
}
trap forward_signal SIGTERM SIGINT

# Exit as soon as any child does. Without this a crashed backend would sit behind
# a still-listening proxy, and Railway would keep the deployment marked healthy
# because the container's main process never exited.
set +e
wait -n "${child_pids[@]}"
exit_code=$?
set -e

if [ "$terminating" = false ]; then
  echo "railway/entrypoint: a child process exited with code $exit_code; stopping the rest" >&2
  terminating=true
  kill -TERM "${child_pids[@]}" 2>/dev/null || true
fi

for pid in "${child_pids[@]}"; do
  wait "$pid" 2>/dev/null || true
done

exit "$exit_code"
