#!/bin/bash

set -e

# ============= FORWARD MOCK OAUTH SERVER =============

# Start socat to forward port 32202 for mock-oauth-server if enabled
if [ "$STACK_FORWARD_MOCK_OAUTH_SERVER" = "true" ]; then
  socat TCP-LISTEN:32202,fork,reuseaddr TCP:host.docker.internal:32202 &
fi

# ============= ENV VARS =============

export STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY=$(openssl rand -base64 32)
export STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY=$(openssl rand -base64 32)
export STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY=$(openssl rand -base64 32)

export NEXT_PUBLIC_STACK_PROJECT_ID=internal
export NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=${STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY}
export STACK_SECRET_SERVER_KEY=${STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY}
export STACK_SUPER_SECRET_ADMIN_KEY=${STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY}

export NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL=${NEXT_PUBLIC_STACK_DASHBOARD_URL}
export NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL="http://localhost:8101"
export NEXT_PUBLIC_BROWSER_STACK_API_URL=${NEXT_PUBLIC_STACK_API_URL}
export NEXT_PUBLIC_SERVER_STACK_API_URL="http://localhost:8102"

export USE_INLINE_ENV_VARS=true

if [ -z "${NEXT_PUBLIC_STACK_SVIX_SERVER_URL}" ]; then
  export NEXT_PUBLIC_STACK_SVIX_SERVER_URL=${STACK_SVIX_SERVER_URL}
fi

# ============= MIGRATIONS =============

if [ "$STACK_SKIP_MIGRATIONS" = "true" ]; then
  echo "Skipping migrations."
else
  echo "Running migrations..."
  prisma migrate deploy --schema=./apps/backend/prisma/schema.prisma
fi

if [ "$STACK_SKIP_SEED_SCRIPT" = "true" ]; then
  echo "Skipping seed script."
else
  echo "Running seed script..."
  cd apps/backend
  node seed.js
  cd ../..
fi

# ============= ENV VARS =============

# Create a working directory for our processed files
# This is necessary because we need to replace the env vars in all files and we might want to run the seed script multiple times with different env vars.
WORK_DIR="/tmp/processed"
mkdir -p "$WORK_DIR"

echo "Copying files to working directory..."
cp -r /app/. "$WORK_DIR"/.

# Find all files in the working directory that contain a STACK_ENV_VAR_SENTINEL and extract the unique sentinel strings.
unhandled_sentinels=$(find "$WORK_DIR/apps" -type f -exec grep -l "STACK_ENV_VAR_SENTINEL" {} + | \
  xargs grep -h "STACK_ENV_VAR_SENTINEL" | \
  grep -o "STACK_ENV_VAR_SENTINEL[A-Z_]*" | \
  sort -u | grep -v "^STACK_ENV_VAR_SENTINEL$")

# Choose an uncommon delimiter – here, we use the ASCII Unit Separator (0x1F)
delimiter=$(printf '\037')

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

echo "Starting backend on port $BACKEND_PORT..."
cd "$WORK_DIR"
PORT=$BACKEND_PORT HOSTNAME=0.0.0.0 node apps/backend/server.js &

echo "Starting dashboard on port $DASHBOARD_PORT..."
PORT=$DASHBOARD_PORT HOSTNAME=0.0.0.0 node apps/dashboard/server.js &

# Wait for both to finish
wait -n
