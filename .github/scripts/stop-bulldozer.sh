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
while true; do
  listener_still_present=false
  if lsof -n -P -t -iTCP:"$port" -sTCP:LISTEN >/dev/null; then
    listener_still_present=true
  fi

  process_still_present=false
  for pid in "${listener_pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      process_still_present=true
      break
    fi
  done

  if [[ "$listener_still_present" == false && "$process_still_present" == false ]]; then
    break
  fi

  if (( SECONDS >= deadline )); then
    echo "Bulldozer did not fully exit within 30 seconds." >&2
    exit 1
  fi
  sleep 0.5
done

echo "Bulldozer stopped."
