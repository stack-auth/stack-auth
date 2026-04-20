#!/usr/bin/env bash
# Find running local dev servers and identify each by page title.
# Usage: detect_dev_server.sh [min-port] [max-port]
#
# Output (one per line):  <port>\t<title>\t<url>
# Example:
#   8101    Stack Auth Dashboard    http://localhost:8101
#   8102    Stack Auth API          http://localhost:8102
#
# Use the output to pick the right port for screenshotting. A common convention
# is that the "dashboard" / "app" is the one you want; the API/docs/OAuth servers
# are separate processes on adjacent ports.

set -euo pipefail
MIN="${1:-3000}"
MAX="${2:-9999}"

# Collect every node-listened TCP port in the range.
ports=$(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null \
  | awk '/^node/ {print $9}' \
  | grep -oE ':[0-9]+$' \
  | tr -d ':' \
  | sort -u \
  | awk -v min="$MIN" -v max="$MAX" '$1 >= min && $1 <= max')

if [ -z "$ports" ]; then
  echo "no listening node servers in $MIN-$MAX" >&2
  exit 0
fi

for p in $ports; do
  title=$(curl -sS --max-time 2 "http://localhost:$p/" 2>/dev/null \
    | grep -oE '<title>[^<]+</title>' \
    | sed -E 's|</?title>||g' \
    | head -1)
  [ -z "$title" ] && title="(no title)"
  printf "%s\t%s\thttp://localhost:%s\n" "$p" "$title" "$p"
done
