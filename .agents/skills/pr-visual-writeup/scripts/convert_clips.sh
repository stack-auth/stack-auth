#!/usr/bin/env bash
# Convert every .webm in a directory to .gif in parallel.
# Usage: convert_clips.sh <dir>
#
# Output: same basename, .gif extension, next to source.
# Config: fps=8, scale=960 — tuned for gist-hosted PR body embeds
# (small enough for <400KB, smooth enough to read).

set -euo pipefail
DIR="${1:?usage: $0 <dir>}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install with: brew install ffmpeg" >&2
  exit 1
fi

shopt -s nullglob
clips=("$DIR"/*.webm)
if [ ${#clips[@]} -eq 0 ]; then
  echo "no .webm files in $DIR" >&2
  exit 0
fi

echo "converting ${#clips[@]} clips in parallel..."
for f in "${clips[@]}"; do
  out="${f%.webm}.gif"
  (
    ffmpeg -y -i "$f" \
      -vf "fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
      "$out" >/dev/null 2>&1 \
      && echo "  ✓ $(basename "$out") ($(du -h "$out" | cut -f1))"
  ) &
done
wait
echo "done."
