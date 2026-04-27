#!/bin/bash

set -e

# ============= ROTATED SECRETS OVERLAY =============
# On emulator snapshot resume, the host injects freshly-generated secrets into
# /run/stack-auth/rotated-secrets.env before supervisorctl restarts us. Sourcing
# here lets a fast-restart pick up new values without a full container restart.
if [ -f /run/stack-auth/rotated-secrets.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /run/stack-auth/rotated-secrets.env
  set +a
fi

# ============= FORWARD MOCK OAUTH SERVER =============

# Start socat to forward port 32202 for mock-oauth-server if enabled
if [ "$STACK_FORWARD_MOCK_OAUTH_SERVER" = "true" ]; then
  socat TCP-LISTEN:32202,fork,reuseaddr TCP:host.docker.internal:32202 &
fi

# ============= ENV VARS =============

if [ "$NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR" = "true" ]; then
  for v in STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY; do
    if [ -z "${!v:-}" ]; then
      echo "$v must be set in local-emulator mode (injected by the QEMU VM)." >&2
      exit 1
    fi
  done
  export STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY
else
  export STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY=${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY:-$(openssl rand -base64 32)}
  export STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY=${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY:-$(openssl rand -base64 32)}
  export STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY=${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY:-$(openssl rand -base64 32)}
fi

export NEXT_PUBLIC_STACK_PROJECT_ID=internal
export NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY}
if [ -n "${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY:-}" ]; then
  export STACK_SECRET_SERVER_KEY=${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY}
fi
if [ -n "${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY:-}" ]; then
  export STACK_SUPER_SECRET_ADMIN_KEY=${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY}
fi

export NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL=${NEXT_PUBLIC_STACK_DASHBOARD_URL}
export NEXT_PUBLIC_STACK_PORT_PREFIX=${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}
PORT_PREFIX=${NEXT_PUBLIC_STACK_PORT_PREFIX}
export NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL="http://localhost:${PORT_PREFIX}01"
export NEXT_PUBLIC_BROWSER_STACK_API_URL=${NEXT_PUBLIC_STACK_API_URL}
export NEXT_PUBLIC_SERVER_STACK_API_URL="http://localhost:${PORT_PREFIX}02"
export BACKEND_PORT=${BACKEND_PORT:-${PORT_PREFIX}02}
export DASHBOARD_PORT=${DASHBOARD_PORT:-${PORT_PREFIX}01}

export USE_INLINE_ENV_VARS=true

if [ -z "${NEXT_PUBLIC_STACK_SVIX_SERVER_URL}" ]; then
  export NEXT_PUBLIC_STACK_SVIX_SERVER_URL=${STACK_SVIX_SERVER_URL}
fi

# ============= MIGRATIONS =============

should_run_migrations=true
if [ "$STACK_SKIP_MIGRATIONS" = "true" ] || [ "$STACK_RUN_MIGRATIONS" = "false" ]; then
  should_run_migrations=false
fi

if [ "$should_run_migrations" = "false" ]; then
  echo "Skipping migrations."
else
  echo "Running migrations..."
  cd apps/backend
  node dist/db-migrations.mjs migrate
  cd ../..
fi

should_run_seed_script=true
if [ "$STACK_SKIP_SEED_SCRIPT" = "true" ] || [ "$STACK_RUN_SEED_SCRIPT" = "false" ]; then
  should_run_seed_script=false
fi

if [ "$should_run_seed_script" = "false" ]; then
  echo "Skipping seed script."
else
  echo "Running seed script..."
  cd apps/backend
  node dist/db-migrations.mjs seed
  cd ../..
fi

# ============= LOCAL EMULATOR: BOOTSTRAP INTERNAL API KEY SET =============
# The build-time seed ran without any keys (the VM generates random ones on
# first boot). The slim image strips apps/backend/dist so we can't re-run the
# full seed here. Instead, targeted-upsert the internal api key set with the
# VM-supplied keys:
#   - pck: used by stack-cli to auth against /api/v1/internal/local-emulator/project
#   - ssk/sak: required by the emulator's own dashboard (StackServerApp ctor
#     throws without ssk). User-app flows don't use these — per-project
#     credentials come from the /local-emulator/project route.
if [ "$NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR" = "true" ] && [ -n "${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY:-}" ] && [ -n "${STACK_DATABASE_CONNECTION_STRING:-}" ]; then
  # Validate the keys are hex-only to defuse any SQL-injection risk (the VM
  # generates them via `openssl rand -hex 32`, so this is an assert, not a filter).
  for varname in STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY; do
    val="${!varname:-}"
    if [ -z "$val" ]; then
      echo "ERROR: $varname is not set; refusing to bootstrap internal api key set." >&2
      exit 1
    fi
    if ! printf '%s' "$val" | grep -Eq '^[0-9a-fA-F]+$'; then
      echo "ERROR: $varname is not hex-only; refusing to bootstrap internal api key set." >&2
      exit 1
    fi
  done
  echo "Bootstrapping internal API key set (emulator runtime)..."
  psql "$STACK_DATABASE_CONNECTION_STRING" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO "ApiKeySet" ("projectId", id, description, "expiresAt", "createdAt", "updatedAt", "publishableClientKey", "secretServerKey", "superSecretAdminKey")
VALUES ('internal', '3142e763-b230-44b5-8636-aa62f7489c26', 'Internal API key set', '2099-12-31T23:59:59Z', NOW(), NOW(),
        '${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY}',
        '${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY}',
        '${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY}')
ON CONFLICT ("projectId", id) DO UPDATE SET
  "publishableClientKey" = EXCLUDED."publishableClientKey",
  "secretServerKey" = EXCLUDED."secretServerKey",
  "superSecretAdminKey" = EXCLUDED."superSecretAdminKey",
  "updatedAt" = NOW();
SQL
fi

# ============= ENV VARS =============

# Create a working directory for our processed files.
# Keep this off /tmp so local-emulator config sharing can bind-mount /tmp
# without pushing the whole runtime copy step onto the host filesystem.
WORK_DIR="${STACK_RUNTIME_WORK_DIR:-/var/tmp/stack-runtime}"
mkdir -p "$WORK_DIR"

if [ "$WORK_DIR" != "/app" ]; then
  echo "Copying files to working directory..."
  cp -r /app/. "$WORK_DIR"/.
fi

# The full-tree sentinel scan is expensive (several seconds over the whole built
# app tree). On a fast-restart — triggered by the emulator snapshot rotation
# path — the placeholders have already been sed-replaced by rotate-secrets,
# and no new sentinels need substitution. Skip the scan in that case. Marker
# lives in WORK_DIR because the docker/server image runs as the unprivileged
# `node` user and cannot write to /var/run.
SENTINEL_MARKER="$WORK_DIR/.stack-sentinels-replaced"
if [ -f "$SENTINEL_MARKER" ]; then
  echo "Sentinels already replaced on a previous start; skipping scan."
else
  # Find all files in the apps directory that contain a STACK_ENV_VAR_SENTINEL and extract the unique sentinel strings.
  echo "Finding unhandled sentinels..."
  unhandled_sentinels=$(find "$WORK_DIR/apps" -type f -exec grep -l "STACK_ENV_VAR_SENTINEL" {} + | \
    xargs grep -h "STACK_ENV_VAR_SENTINEL" | \
    grep -o "STACK_ENV_VAR_SENTINEL[A-Z_]*" | \
    sort -u | grep -v "^STACK_ENV_VAR_SENTINEL$")

  # Choose an uncommon delimiter – here, we use the ASCII Unit Separator (0x1F)
  delimiter=$(printf '\037')

  echo "Replacing sentinels..."
  for sentinel in $unhandled_sentinels; do
    # The sentinel is like "STACK_ENV_VAR_SENTINEL_MY_VAR", so extract the env var name.
    env_var=${sentinel#STACK_ENV_VAR_SENTINEL_}

    # Get the corresponding environment variable value.
    value="${!env_var}"

    # If the env var is not set, skip replacement.
    if [ -z "$value" ]; then
      continue
    fi

    # Although the sentinel only contains [A-Z_] we still escape it for any regex meta-characters.
    escaped_sentinel=$(printf '%s\n' "$sentinel" | sed -e 's/\\/\\\\/g' -e 's/[][\/.^$*]/\\&/g')

    # For the replacement value, first escape backslashes, then escape any occurrence of
    # the chosen delimiter and the '&' (which has special meaning in sed replacements).
    escaped_value=$(printf '%s\n' "$value" | sed -e 's/\\/\\\\/g' -e "s/[${delimiter}&]/\\\\&/g")

    # Now replace the sentinel with the (properly escaped) value in all files in the working directory.
    find $WORK_DIR/apps -type f -exec sed -i "s${delimiter}${escaped_sentinel}${delimiter}${escaped_value}${delimiter}g" {} +
  done
  touch "$SENTINEL_MARKER"
fi

# ============= START BACKEND AND DASHBOARD =============

echo "Starting backend on port $BACKEND_PORT..."
cd "$WORK_DIR"
PORT=$BACKEND_PORT HOSTNAME=0.0.0.0 node apps/backend/server.js &

echo "Starting dashboard on port $DASHBOARD_PORT..."
PORT=$DASHBOARD_PORT HOSTNAME=0.0.0.0 node apps/dashboard/server.js &

# Wait for both to finish
wait -n
