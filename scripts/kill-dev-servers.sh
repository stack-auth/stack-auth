#!/bin/bash

echo "🛑 Stopping Stack Auth development servers..."

# Check if Docker containers are running
DOCKER_RUNNING=false
if docker ps --filter "name=stack-dependencies" --format '{{.Names}}' 2>/dev/null | grep -q .; then
    DOCKER_RUNNING=true
    echo "  ℹ️  检测到 Docker 容器正在运行，将跳过容器使用的端口"
fi

# Function to kill process tree
kill_process_tree() {
    local pid=$1
    local sig=${2:-TERM}
    
    # Get child processes
    local children=$(pgrep -P $pid 2>/dev/null)
    
    # Recursively kill children first
    for child in $children; do
        kill_process_tree $child $sig
    done
    
    # Kill the parent
    if kill -0 $pid 2>/dev/null; then
        kill -$sig $pid 2>/dev/null || true
    fi
}

# Kill processes by name (including their children)
echo "  → Stopping Next.js dev servers..."
pids=$(pgrep -f "next dev" 2>/dev/null)
for pid in $pids; do
    kill_process_tree $pid
done

echo "  → Stopping TSX processes..."
pids=$(pgrep -f "tsx" 2>/dev/null)
for pid in $pids; do
    kill_process_tree $pid
done

echo "  → Stopping Turbo processes..."
pids=$(pgrep -f "turbo run dev" 2>/dev/null)
for pid in $pids; do
    kill_process_tree $pid
done

echo "  → Stopping Concurrently processes..."
pids=$(pgrep -f "concurrently" 2>/dev/null)
for pid in $pids; do
    kill_process_tree $pid
done

echo "  → Stopping Prisma Studio..."
pkill -f "prisma studio" 2>/dev/null || true

echo "  → Stopping mock OAuth server..."
pkill -f "mock-oauth-server" 2>/dev/null || true

# Kill processes by port
# Ports used by dev servers (not Docker containers)
DEV_PORTS=(8100 8101 8102 8103 8104 8106)
# Ports that might be used by Docker containers
DOCKER_PORTS=(8105 8113 8116 8117 8118)

echo "  → Clearing development server ports..."
for port in "${DEV_PORTS[@]}"; do
  pids=$(lsof -ti:$port 2>/dev/null)
  if [ ! -z "$pids" ]; then
    echo "    ✓ Killing processes on port $port"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

# Only clean Docker-related ports if Docker is NOT running
if [ "$DOCKER_RUNNING" = false ]; then
  echo "  → Clearing Docker-related ports (Docker not running)..."
  for port in "${DOCKER_PORTS[@]}"; do
    pids=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pids" ]; then
      echo "    ✓ Killing processes on port $port"
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  done
else
  echo "  → Skipping Docker-related ports (8105, 8113, 8116, 8117, 8118)"
fi

# Combine all ports for verification
ALL_PORTS=("${DEV_PORTS[@]}" "${DOCKER_PORTS[@]}")

# Wait a moment for processes to fully terminate
sleep 3

# Force kill any remaining processes on dev ports (but not Docker ports if Docker is running)
echo "  → Force killing remaining processes on dev ports (if any)..."
for port in "${DEV_PORTS[@]}"; do
  pids=$(lsof -ti:$port 2>/dev/null)
  if [ ! -z "$pids" ]; then
    echo "    → Force killing on port $port"
    for pid in $pids; do
      kill_process_tree $pid KILL
    done
  fi
done

# Only force kill Docker ports if Docker is not running
if [ "$DOCKER_RUNNING" = false ]; then
  for port in "${DOCKER_PORTS[@]}"; do
    pids=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pids" ]; then
      echo "    → Force killing on port $port"
      for pid in $pids; do
        kill_process_tree $pid KILL
      done
    fi
  done
fi

sleep 1

# Verify ports are free
echo ""
echo "📊 Port Status:"
occupied=0
for port in "${DEV_PORTS[@]}"; do
  if lsof -ti:$port >/dev/null 2>&1; then
    echo "  ⚠️  Port $port still occupied"
    occupied=$((occupied + 1))
  fi
done

if [ "$DOCKER_RUNNING" = true ]; then
  echo "  ℹ️  Docker 相关端口 (8105, 8113, 8116, 8117, 8118) 已保留"
fi

if [ $occupied -eq 0 ]; then
  echo "  ✅ All ports are free!"
else
  echo "  ⚠️  $occupied port(s) still occupied. You may need to run this script again."
fi

echo ""
echo "✅ Done! You can now run: pnpm run dev:basic"

