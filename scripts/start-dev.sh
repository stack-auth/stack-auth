#!/bin/bash

set -e  # Exit on any error

echo "🚀 Stack Auth Development Environment Startup"
echo "=============================================="
echo ""

# Step 1: Check Docker
echo "📋 Step 1: Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running!"
    echo "   Starting Docker Desktop..."
    open -a Docker
    echo "   Waiting for Docker to start..."
    sleep 15
    
    if ! docker info > /dev/null 2>&1; then
        echo "❌ Docker failed to start. Please start it manually and try again."
        exit 1
    fi
fi
echo "✅ Docker is running"
echo ""

# Step 2: Check for port conflicts
echo "📋 Step 2: Checking for port conflicts..."
CONFLICTING_CONTAINERS=$(docker ps --format '{{.Names}}' | grep -v "^stack-dependencies" || true)
if [ ! -z "$CONFLICTING_CONTAINERS" ]; then
    echo "⚠️  Found non-Stack containers that might conflict:"
    echo "$CONFLICTING_CONTAINERS"
    echo ""
    read -p "Do you want to stop these containers? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "$CONFLICTING_CONTAINERS" | xargs docker stop 2>/dev/null || true
        echo "✅ Stopped conflicting containers"
    else
        echo "⚠️  Continuing with existing containers (may cause port conflicts)"
    fi
fi
echo ""

# Step 3: Kill any running dev servers
echo "📋 Step 3: Cleaning up old dev servers..."
bash "$(dirname "$0")/kill-dev-servers.sh" | tail -n 5
echo ""

# Step 4: Start minimal dependencies
echo "📋 Step 4: Starting Docker dependencies..."
cd "$(dirname "$0")/.."
pnpm run restart-deps:minimal:no-delay
echo ""

# Step 5: Start dev servers
echo "📋 Step 5: Starting development servers..."
echo "   This will run in the background. Check logs with:"
echo "   tail -f dev-server.log.untracked.txt"
echo ""

pnpm run dev:basic > dev-server.log.untracked.txt 2>&1 &
DEV_PID=$!

# Wait for servers to start
echo "   Waiting for servers to start..."
sleep 20

# Check if process is still running
if ! kill -0 $DEV_PID 2>/dev/null; then
    echo "❌ Dev server failed to start. Check dev-server.log.untracked.txt for errors."
    exit 1
fi

# Test endpoints
echo ""
echo "📋 Step 6: Testing endpoints..."
BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8102/health || echo "000")
DASHBOARD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8101/projects || echo "000")

echo "   Backend (8102/health): $BACKEND_STATUS"
echo "   Dashboard (8101/projects): $DASHBOARD_STATUS"
echo ""

if [ "$BACKEND_STATUS" = "200" ]; then
    echo "✅ Backend is ready!"
else
    echo "⚠️  Backend not ready yet (may need more time)"
fi

if [ "$DASHBOARD_STATUS" = "200" ] || [ "$DASHBOARD_STATUS" = "307" ]; then
    echo "✅ Dashboard is ready!"
else
    echo "⚠️  Dashboard not ready yet (may need more time)"
fi

echo ""
echo "=============================================="
echo "🎉 Development environment started!"
echo ""
echo "📍 Access points:"
echo "   Dashboard: http://localhost:8101"
echo "   Backend:   http://localhost:8102"
echo ""
echo "📝 Logs:"
echo "   tail -f dev-server.log.untracked.txt"
echo ""
echo "🛑 To stop:"
echo "   pnpm run kill-servers"
echo "   pnpm run stop-deps:minimal"
echo "=============================================="

