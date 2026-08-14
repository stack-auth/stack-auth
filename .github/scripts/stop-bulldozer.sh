#!/usr/bin/env bash

set -euo pipefail

port="${NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX:-81}46"
mapfile -t listener_pids < <(lsof -n -P -t -iTCP:"$port" -sTCP:LISTEN)

if [[ "${#listener_pids[@]}" -eq 0 ]]; then
  echo "No Bulldozer listener found on TCP port $port." >&2
  exit 1
fi

echo "Stopping Bulldozer listener(s) on TCP port $port: ${listener_pids[*]}"
kill -TERM "${listener_pids[@]}"

deadline=$((SECONDS + 30))
while lsof -n -P -t -iTCP:"$port" -sTCP:LISTEN >/dev/null; do
  if (( SECONDS >= deadline )); then
    echo "Bulldozer did not stop within 30 seconds." >&2
    exit 1
  fi
  sleep 0.5
done

echo "Bulldozer stopped."
