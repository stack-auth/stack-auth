#!/bin/bash

set -e  # Exit on any error

echo "🔄 Restarting Stack Auth dev:basic environment"
echo "=============================================="
echo ""

# Step 1: Kill existing dev servers
echo "📋 Step 1: Stopping existing dev servers..."
bash "$(dirname "$0")/kill-dev-servers.sh" | tail -n 5
echo ""

# Step 2: Check if Docker dependencies are running
echo "📋 Step 2: Checking Docker dependencies..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running!"
    echo "   Please start Docker and run: pnpm run start-deps:minimal"
    exit 1
fi

# Check if minimal stack-dependencies containers are running (need at least 7)
RUNNING_CONTAINERS=$(docker ps --filter "name=stack-dependencies" --format '{{.Names}}' | wc -l)

if [ "$RUNNING_CONTAINERS" -lt 7 ]; then
    echo "❌ Only $RUNNING_CONTAINERS stack-dependencies containers running (need at least 7)"
    echo ""
    echo "Please start dependencies first:"
    echo "   pnpm run start-deps:minimal"
    echo ""
    exit 1
fi

echo "✅ All Docker dependencies are running ($RUNNING_CONTAINERS containers)"

# Test database connection (optional check, non-blocking)
echo "   Testing database connection..."
if timeout 2 bash -c "cat < /dev/null > /dev/tcp/localhost/5432" 2>/dev/null; then
    echo "   ✅ PostgreSQL is reachable"
else
    echo "   ⚠️  PostgreSQL port test failed, but continuing anyway"
    echo "      (Container might be starting, Prisma will auto-reconnect)"
fi

echo ""

# Step 3: Start dev:basic
echo "📋 Step 3: Starting dev:basic..."
echo "   (Prisma will automatically connect to the database)"
echo ""
cd "$(dirname "$0")/.."
pnpm run dev:basic

