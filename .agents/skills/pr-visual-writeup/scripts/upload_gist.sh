#!/usr/bin/env bash
# Create a public gist, push every file under one or more dirs into it, print raw URLs.
# Usage: upload_gist.sh <desc> <dir> [<dir> ...]
#
# Example:
#   upload_gist.sh "PR #1338 visuals" /tmp/pr-1338-visuals/shots /tmp/pr-1338-visuals/clips
#
# Prints a line per uploaded file:
#   <basename>\t<raw-url>
# …and stashes the gist id in ./gist-id.txt for later re-pushes.

set -euo pipefail

DESC="${1:?usage: $0 <desc> <dir> [<dir> ...]}"
shift

if [ $# -eq 0 ]; then
  echo "need at least one source directory" >&2
  exit 1
fi

for d in "$@"; do
  if [ ! -d "$d" ]; then
    echo "not a directory: $d" >&2
    exit 1
  fi
done

USER=$(gh api user --jq .login)
TOKEN=$(gh auth token)

# 1. Create the gist.
GIST_URL=$(gh gist create --public --desc "$DESC" -f README.md - <<< "$DESC assets" | tail -1)
GIST_ID=$(basename "$GIST_URL")
echo "gist: $GIST_URL" >&2

# 2. Clone into a tmp working dir.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git clone --quiet "https://gist.github.com/$GIST_ID.git" "$WORK/gist"

# 3. Stage every file from every input dir. Don't recurse — gists are flat.
count=0
for d in "$@"; do
  for f in "$d"/*; do
    [ -f "$f" ] || continue
    cp "$f" "$WORK/gist/"
    count=$((count+1))
  done
done

if [ $count -eq 0 ]; then
  echo "no files found in input directories" >&2
  exit 1
fi
echo "staged $count files" >&2

# 4. Commit + push with PAT.
cd "$WORK/gist"
git add -A
git -c user.email="noreply@github.com" -c user.name="$USER" \
    commit --quiet -m "Add $count assets"

git -c credential.helper= \
    -c credential.helper="!f() { echo username=$USER; echo password=$TOKEN; }; f" \
    push --quiet

# 5. Echo URLs.
echo "$GIST_ID" > "$OLDPWD/gist-id.txt"
for f in *; do
  [ "$f" = "README.md" ] && continue
  echo -e "$f\thttps://gist.githubusercontent.com/$USER/$GIST_ID/raw/$f"
done
