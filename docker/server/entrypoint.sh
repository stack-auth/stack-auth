#!/bin/bash

set -e

# ============= FORWARD MOCK OAUTH SERVER =============

# Start socat to forward port 32202 for mock-oauth-server if enabled
if [ "$STACK_FORWARD_MOCK_OAUTH_SERVER" = "true" ]; then
  socat TCP-LISTEN:32202,fork,reuseaddr TCP:host.docker.internal:32202 &
fi

# ============= ENV VARS =============

if [ "$NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR" = "true" ]; then
  export STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY=${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY:-local-emulator-publishable-client-key}
  export STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY=${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY:-local-emulator-secret-server-key}
  export STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY=${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY:-local-emulator-super-secret-admin-key}
else
  export STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY=${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY:-$(openssl rand -base64 32)}
  export STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY=${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY:-$(openssl rand -base64 32)}
  export STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY=${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY:-$(openssl rand -base64 32)}
fi

export NEXT_PUBLIC_STACK_PROJECT_ID=internal
export NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY}
export STACK_SECRET_SERVER_KEY=${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY}
export STACK_SUPER_SECRET_ADMIN_KEY=${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY}

export NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL=${NEXT_PUBLIC_STACK_DASHBOARD_URL}
if [ "$NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR" = "true" ]; then
  export NEXT_PUBLIC_STACK_PORT_PREFIX=${NEXT_PUBLIC_STACK_PORT_PREFIX:-167}
else
  export NEXT_PUBLIC_STACK_PORT_PREFIX=${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}
fi
PORT_PREFIX=${NEXT_PUBLIC_STACK_PORT_PREFIX}
export BACKEND_PORT=${BACKEND_PORT:-${PORT_PREFIX}02}
export DASHBOARD_PORT=${DASHBOARD_PORT:-${PORT_PREFIX}01}
export NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL="http://localhost:${DASHBOARD_PORT}"
export NEXT_PUBLIC_BROWSER_STACK_API_URL=${NEXT_PUBLIC_STACK_API_URL}
export NEXT_PUBLIC_SERVER_STACK_API_URL="http://localhost:${BACKEND_PORT}"

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

# Create a working directory for our processed files.
# Keep this off /tmp so local-emulator config sharing can bind-mount /tmp
# without pushing the whole runtime copy step onto the host filesystem.
WORK_DIR="${STACK_RUNTIME_WORK_DIR:-/var/tmp/stack-runtime}"
mkdir -p "$WORK_DIR"

if [ "$WORK_DIR" != "/app" ]; then
  echo "Copying files to working directory..."
  cp -r /app/. "$WORK_DIR"/.
fi

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

# ============= START BACKEND AND DASHBOARD =============

# When running inside the QEMU emulator with a 9p host mount, the guest kernel
# checks file permissions using guest UIDs. Files on the host are owned by the
# host user (e.g. UID 501) so the app processes must run as that UID to be able
# to read/write config files on the host filesystem (including in sticky-bit
# directories like /tmp).
HOST_MOUNT_ROOT="${STACK_LOCAL_EMULATOR_HOST_MOUNT_ROOT:-}"
RUN_AS=""
if [ -n "$HOST_MOUNT_ROOT" ] && [ -d "$HOST_MOUNT_ROOT" ]; then
  HOST_UID=$(stat -c %u "$HOST_MOUNT_ROOT/etc" 2>/dev/null || echo "")
  if [ -n "$HOST_UID" ] && [ "$HOST_UID" != "0" ]; then
    useradd -u "$HOST_UID" -M -s /bin/false -d "$WORK_DIR" hostuser 2>/dev/null || true
    RUN_AS="gosu $HOST_UID"
  fi
fi

echo "Starting backend on port $BACKEND_PORT..."
cd "$WORK_DIR"
$RUN_AS env PORT=$BACKEND_PORT HOSTNAME=0.0.0.0 node apps/backend/server.js &

echo "Starting dashboard on port $DASHBOARD_PORT..."
$RUN_AS env PORT=$DASHBOARD_PORT HOSTNAME=0.0.0.0 node apps/dashboard/server.js &

# Wait for both to finish
wait -n
