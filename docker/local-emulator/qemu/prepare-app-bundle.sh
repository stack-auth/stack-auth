#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/prepare-image-bundle.sh" "${1:-}" stack-local-emulator-app
