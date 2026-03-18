#!/usr/bin/env bash
set -euo pipefail

OUTPUT_PATH="${1:-}"
shift || true

if [ -z "$OUTPUT_PATH" ] || [ "$#" -eq 0 ]; then
  echo "Usage: $0 <output-tar.gz> <docker-image> [docker-image...]" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to package emulator images" >&2
  exit 1
fi

for IMAGE_NAME in "$@"; do
  if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    cat >&2 <<EOF
Missing Docker image: $IMAGE_NAME

Build the local emulator images first, then rerun the QEMU image build.
Expected images:
  - stack-local-emulator-deps
  - stack-local-emulator-app
EOF
    exit 1
  fi
done

mkdir -p "$(dirname "$OUTPUT_PATH")"
tmp_output="${OUTPUT_PATH}.tmp"
rm -f "$tmp_output"

docker save "$@" | gzip -c > "$tmp_output"
mv "$tmp_output" "$OUTPUT_PATH"
