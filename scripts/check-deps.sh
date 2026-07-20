#!/usr/bin/env bash

set -euo pipefail

expected_services="$(pnpm run --silent deps-compose config --services)"
running_services="$(pnpm run --silent deps-compose ps --status running --services)"

if [[ -z "$expected_services" ]]; then
  echo "Error: The dependency Docker Compose configuration contains no services." >&2
  exit 1
fi

missing_services="$(
  comm -23 \
    <(printf '%s\n' "$expected_services" | LC_ALL=C sort) \
    <(printf '%s\n' "$running_services" | LC_ALL=C sort)
)"

if [[ -n "$missing_services" ]]; then
  echo "Error: The following development dependency containers are not running:" >&2
  while IFS= read -r service; do
    printf '  - %s\n' "$service" >&2
  done <<< "$missing_services"
  echo "Run 'pnpm restart-deps' and try again." >&2
  exit 1
fi
