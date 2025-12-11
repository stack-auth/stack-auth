#!/bin/bash
# Cursor hook: afterFileEdit
# Runs lint --fix on JS/TS files after they are edited by the agent

# Read JSON input from stdin
input=$(cat)

# Extract file_path from the input
file_path=$(echo "$input" | jq -r '.file_path')

# If file is a JS/TS file, run lint --fix on it
if [[ "$file_path" =~ \.(js|jsx|ts|tsx)$ ]]; then
  pnpm run lint --fix "$file_path" || true
fi

exit 0


