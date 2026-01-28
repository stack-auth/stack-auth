#!/bin/bash
# Cursor hook: stop
# Runs typecheck and lint when the agent loop ends

# Read JSON input from stdin (contains status and loop_count)
input=$(cat)

# Check if this is a repeated stop hook call (loop_count > 0)
# to prevent infinite loops
loop_count=$(echo "$input" | jq -r '.loop_count // 0')
if [[ "$loop_count" -gt 0 ]]; then
  exit 0
fi

# Run typecheck and lint
pnpm run typecheck 1>&2 || exit 2
pnpm run lint --fix 1>&2 || exit 2

exit 0


