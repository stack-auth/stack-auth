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

# ============= HEXCLAVE_ ↔ STACK_ ENV ALIASING =============
# Hexclave rebrand: HEXCLAVE_*-prefixed env vars are canonical, but self-host
# operators (and older compose files) may still set the legacy STACK_* names.
# Node-side code dual-reads both, but this shell script and the sentinel
# substitution below look up vars by one exact name — so mirror every
# HEXCLAVE_*/STACK_* var to its unset twin. Called again right before the
# sentinel scan to pick up vars exported by the sections in between.
mirror_hexclave_stack_env() {
  local _name _twin
  for _name in $(compgen -e); do
    case "$_name" in
      *HEXCLAVE_*) _twin=${_name/HEXCLAVE_/STACK_} ;;
      *STACK_*) _twin=${_name/STACK_/HEXCLAVE_} ;;
      *) continue ;;
    esac
    if [ -n "${!_name:-}" ] && [ -n "${!_twin:-}" ] && [ "${!_name}" != "${!_twin}" ]; then
      echo "ERROR: $_name and $_twin are both set to different non-empty values. Remove one of them or set them to the same value." >&2
      exit 1
    fi
    if [ -z "${!_twin:-}" ] && [ -n "${!_name:-}" ]; then
      export "$_twin=${!_name}"
    fi
  done
}
mirror_hexclave_stack_env

# ============= FORWARD MOCK OAUTH SERVER =============

# Start socat to forward port 32202 for mock-oauth-server if enabled
if [ "$STACK_FORWARD_MOCK_OAUTH_SERVER" = "true" ]; then
  socat TCP-LISTEN:32202,fork,reuseaddr TCP:host.docker.internal:32202 &
fi

# ============= ENV VARS =============

export STACK_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY=${STACK_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY:-$(openssl rand -base64 32)}
export STACK_INTERNAL_PROJECT_SECRET_SERVER_KEY=${STACK_INTERNAL_PROJECT_SECRET_SERVER_KEY:-$(openssl rand -base64 32)}
export STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY=${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY:-$(openssl rand -base64 32)}

export NEXT_PUBLIC_STACK_PROJECT_ID=internal
export NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=${STACK_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY}
if [ -n "${STACK_INTERNAL_PROJECT_SECRET_SERVER_KEY:-}" ]; then
  export STACK_SECRET_SERVER_KEY=${STACK_INTERNAL_PROJECT_SECRET_SERVER_KEY}
fi
if [ -n "${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY:-}" ]; then
  export STACK_SUPER_SECRET_ADMIN_KEY=${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY}
fi

export NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL=${NEXT_PUBLIC_STACK_DASHBOARD_URL}
# Hexclave rebrand: the port-prefix var was renamed outright to
# NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX. The dashboard bundle's post-build sentinel
# is STACK_ENV_VAR_SENTINEL_NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX, and the sentinel
# substitution loop below derives the env var name from the sentinel — so this
# MUST export NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX or the sentinel never resolves.
# Accept the legacy NEXT_PUBLIC_STACK_PORT_PREFIX as input for back-compat with
# existing self-host configs.
export NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX=${NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX:-${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}}
PORT_PREFIX=${NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX}
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

# ============= ENV VARS =============

# Mirror again: the sections above exported more STACK_/HEXCLAVE_ vars (internal
# project keys, NEXT_PUBLIC_STACK_PROJECT_ID, svix fallback). The dashboard
# bundle inlines BOTH process.env.NEXT_PUBLIC_HEXCLAVE_* and
# process.env.NEXT_PUBLIC_STACK_* references as sentinels (dual-read), and the
# fallback chain treats an unreplaced sentinel as truthy — so both spellings
# must resolve to the same real value before the sentinel replacement below.
mirror_hexclave_stack_env

# Create a working directory for our processed files.
# Keep this off /tmp so config sharing can bind-mount /tmp
# without pushing the whole runtime copy step onto the host filesystem.
WORK_DIR="${STACK_RUNTIME_WORK_DIR:-/var/tmp/stack-runtime}"
mkdir -p "$WORK_DIR"

if [ "$WORK_DIR" != "/app" ]; then
  echo "Copying files to working directory..."
  cp -r /app/. "$WORK_DIR"/.
fi

# The full-tree sentinel scan is expensive (several seconds over the whole built
# app tree). On a fast-restart the placeholders have already been sed-replaced
# by rotate-secrets, and no new sentinels need substitution. Skip the scan in
# that case. Marker lives in WORK_DIR because the docker/server image runs as
# the unprivileged `node` user and cannot write to /var/run.
SENTINEL_MARKER="$WORK_DIR/.stack-sentinels-replaced"
if [ -f "$SENTINEL_MARKER" ]; then
  echo "Sentinels already replaced on a previous start; skipping scan."
else
  # Find all files in the apps directory that contain a STACK_ENV_VAR_SENTINEL and extract the unique sentinel strings.
  # Require at least one character after `STACK_ENV_VAR_SENTINEL_` — a bare
  # `STACK_ENV_VAR_SENTINEL_` (trailing underscore but no suffix) makes env_var
  # empty below, which would crash `${!env_var}` with "invalid variable name"
  # under `set -e`. The dashboard bundle's sentinel-construction code embeds
  # the prefix as a literal string, so this case occurs in practice.
  echo "Finding unhandled sentinels..."
  unhandled_sentinels=$(find "$WORK_DIR/apps" -type f -exec grep -l "STACK_ENV_VAR_SENTINEL" {} + | \
    xargs grep -h "STACK_ENV_VAR_SENTINEL" | \
    grep -oE "STACK_ENV_VAR_SENTINEL_[A-Z_]*[A-Z]+[A-Z_]*" | \
    sort -u)

  # Choose an uncommon delimiter – here, we use the ASCII Unit Separator (0x1F)
  delimiter=$(printf '\037')

  echo "Replacing sentinels..."
  for sentinel in $unhandled_sentinels; do
    # The sentinel is like "STACK_ENV_VAR_SENTINEL_MY_VAR", so extract the env var name.
    env_var=${sentinel#STACK_ENV_VAR_SENTINEL_}

    # Defense in depth: skip if env_var name is empty. The regex above already
    # excludes bare-prefix matches, but `${!env_var}` with an empty name aborts
    # the whole script under `set -e`, so guard it explicitly.
    if [ -z "$env_var" ]; then
      continue
    fi

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

    # Hexclave rebrand: only sed files that actually contain the sentinel. The previous
    # `find … -exec sed -i … {} +` ran sed across the ENTIRE standalone build for every
    # sentinel (22 sentinels × thousands of files), and got unworkable once the dashboard
    # bundle grew to include dual-literal _inlineEnvVars references. Restrict to matching
    # files; also log per-sentinel so a hang at any specific sentinel is visible.
    echo "  - Replacing $sentinel"
    files=$(grep -rl "$sentinel" "$WORK_DIR/apps" 2>/dev/null || true)
    if [ -n "$files" ]; then
      echo "$files" | xargs sed -i "s${delimiter}${escaped_sentinel}${delimiter}${escaped_value}${delimiter}g"
    fi
  done
  echo "Sentinel replacement complete."
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
