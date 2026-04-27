#!/bin/bash
# Rotate baked-in placeholder secrets with fresh host-generated values.
#
# Called inside the stack container by the emulator snapshot-resume path.
# Host writes fresh secrets to /host/stack-runtime/fresh-secrets.env before
# invoking this script (via `docker exec stack /usr/local/bin/rotate-secrets`).
#
# Flow:
#   1. Read fresh secrets from host-supplied env file.
#   2. Validate they are 64-char hex (the build placeholders are too).
#   3. Write rotated-secrets.env that app-entrypoint and run-cron-jobs source
#      on restart.
#   4. Targeted sed across built files: swap the placeholder PCK for the fresh
#      one (this is the only secret baked into JS via sentinel replacement at
#      build time — SSK/SAK/CRON_SECRET flow through process.env only).
#   5. UPDATE the internal ApiKeySet row in Postgres.
#   6. supervisorctl restart stack-app + cron-jobs so the new values take
#      effect in the running Node processes.

set -euo pipefail

OUTPUT=/run/stack-auth/rotated-secrets.env
WORK_DIR="${STACK_RUNTIME_WORK_DIR:-/app}"

PLACEHOLDER_PCK="00000000000000000000000000000000ffffffffffffffffffffffffffffffff"

log() { printf '[rotate-secrets] %s\n' "$*"; }

# Fresh secrets arrive via env vars (passed by trigger-fast-rotate using
# `docker exec -e`). For backward compatibility, fall back to a file path if
# STACK_ROTATE_INPUT is set.
if [ -n "${STACK_ROTATE_INPUT:-}" ] && [ -f "$STACK_ROTATE_INPUT" ]; then
  log "reading fresh secrets from $STACK_ROTATE_INPUT"
  set -a
  # shellcheck disable=SC1090
  source "$STACK_ROTATE_INPUT"
  set +a
fi

for var in STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY \
           STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY \
           STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY \
           CRON_SECRET; do
  val="${!var:-}"
  if [ -z "$val" ]; then
    log "ERROR: $var is missing from environment"
    exit 1
  fi
  if ! printf '%s' "$val" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    log "ERROR: $var is not a 64-char hex string"
    exit 1
  fi
done

mkdir -p "$(dirname "$OUTPUT")"
umask 077
{
  printf 'STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY=%s\n' "$STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY"
  printf 'STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY=%s\n' "$STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY"
  printf 'STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY=%s\n' "$STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"
  printf 'CRON_SECRET=%s\n' "$CRON_SECRET"
  # Mirror these so process.env lookups in Node match env after restart.
  printf 'NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=%s\n' "$STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY"
  printf 'STACK_SECRET_SERVER_KEY=%s\n' "$STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY"
  printf 'STACK_SUPER_SECRET_ADMIN_KEY=%s\n' "$STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"
} > "$OUTPUT"
chmod 0600 "$OUTPUT"
log "wrote $OUTPUT"

# The PCK is baked into built JS via STACK_ENV_VAR_SENTINEL replacement at
# container start (see /app-entrypoint.sh). Swap the placeholder hex for the
# fresh value across the built tree. Only *.js files need patching; this
# runs in ~1s on the standalone Next.js bundles.
if [ "$STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY" != "$PLACEHOLDER_PCK" ]; then
  log "rewriting PCK placeholder in $WORK_DIR"
  # grep -rl narrows the find to only files that contain the placeholder, so
  # the follow-up sed doesn't walk the whole tree.
  mapfile -t files < <(grep -rl --include='*.js' "$PLACEHOLDER_PCK" "$WORK_DIR/apps" 2>/dev/null || true)
  if [ "${#files[@]}" -gt 0 ]; then
    sed -i "s|${PLACEHOLDER_PCK}|${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY}|g" "${files[@]}"
    log "patched ${#files[@]} file(s)"
  else
    log "no files contained the placeholder (already rotated?)"
  fi
fi

# Update the internal ApiKeySet row so existing dashboard sessions keep
# working with the new keys. Values are already validated as hex above, so
# inlining is safe.
if [ -n "${STACK_DATABASE_CONNECTION_STRING:-}" ]; then
  log "updating internal ApiKeySet"
  psql "$STACK_DATABASE_CONNECTION_STRING" -v ON_ERROR_STOP=1 <<SQL
UPDATE "ApiKeySet" SET
  "publishableClientKey" = '${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY}',
  "secretServerKey"      = '${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY}',
  "superSecretAdminKey"  = '${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY}',
  "updatedAt"            = NOW()
WHERE "projectId" = 'internal' AND id = '3142e763-b230-44b5-8636-aa62f7489c26';
SQL
fi

log "restarting stack-app and cron-jobs"
supervisorctl restart stack-app cron-jobs
log "done"
