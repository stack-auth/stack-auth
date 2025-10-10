#!/bin/bash

echo "🐳 Checking Docker status..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo ""
    echo "❌ Docker is not running!"
    echo ""
    echo "Please start Docker Desktop:"
    echo "  1. Open Docker Desktop application from Applications folder"
    echo "  2. Wait for Docker icon in menu bar to stop animating"
    echo "  3. Run this script again to verify"
    echo ""
    echo "Or start it from command line:"
    echo "  open -a Docker"
    echo ""
    exit 1
fi

echo "✅ Docker is running!"
echo ""
echo "Docker version:"
docker --version
echo ""
echo "Running containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "You can now run: pnpm run start-deps:minimal"

