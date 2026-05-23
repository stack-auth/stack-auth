# Gist Upload

Host PR screenshots/GIFs in a public GitHub gist using only a PAT (no browser cookies). Gist raw URLs render inline as images and GIFs in PR bodies.

## Why gist instead of `user-attachments`

GitHub's `user-attachments` endpoint (what happens when you drag an image into a PR editor) requires a browser session cookie. Tools like `gh-image` scrape Chrome's cookie jar to impersonate the browser. That cookie has broader scope than a PAT and isn't something to use without the user's explicit OK.

Gist hosting is the PAT-only equivalent:
- `gh gist create` needs only the `gist` scope
- `git push` to the gist needs only the PAT
- `gist.githubusercontent.com/<user>/<id>/raw/<file>` URLs render inline in PR bodies

Trade-off: gist-hosted `.webm` doesn't get GitHub's native video player (that's a `user-attachments`-only feature). Convert scroll clips to `.gif` so they play inline.

## Full recipe

```bash
# 1. Create a public gist with a placeholder README.
GIST_URL=$(gh gist create --public --desc "PR #<N> screenshots + scroll clips" \
  -f README.md - <<< "PR #<N> assets" | tail -1)
GIST_ID=$(basename "$GIST_URL")
echo "$GIST_ID" > /tmp/pr-<N>-visuals/gist-id.txt

# 2. Clone locally (HTTPS, no creds needed for read).
cd /tmp
rm -rf "gist-$GIST_ID"
git clone "https://gist.github.com/$GIST_ID.git" "gist-$GIST_ID"

# 3. Stage every asset.
cd "gist-$GIST_ID"
cp /tmp/pr-<N>-visuals/shots/*.png /tmp/pr-<N>-visuals/clips/*.gif ./
git add -A
git -c user.email=noreply@github.com -c user.name=<your-username> \
  commit -m "Add PR <N> visuals"

# 4. Push with PAT via credential helper. `gh auth token` prints the PAT.
TOKEN=$(gh auth token)
git -c credential.helper= \
    -c credential.helper="!f() { echo username=<your-username>; echo password=$TOKEN; }; f" \
    push
```

The `credential.helper= <blank>` clears any existing helper, then the custom helper feeds the PAT. This avoids stamping the token into `~/.gitconfig` or a credential store.

## Building the URL table

After push, enumerate raw URLs:

```bash
USER=<your-username>
for f in /tmp/pr-<N>-visuals/shots/*.png /tmp/pr-<N>-visuals/clips/*.gif; do
  base=$(basename "$f")
  echo "$base  https://gist.githubusercontent.com/$USER/$GIST_ID/raw/$base"
done > /tmp/pr-<N>-visuals/urls.txt
```

Use raw URLs **without** a commit SHA — the bare `/raw/<file>` path always resolves to the latest, which means you can re-push updated versions of a screenshot without changing the PR body.

## Verifying a URL before embedding

```bash
curl -sI -L "https://gist.githubusercontent.com/$USER/$GIST_ID/raw/users-light.png" | head -3
# Expect: HTTP/2 200  and  content-type: image/png (or image/gif)
```

A quick spot-check on one asset per type is enough.

## File-size watch-outs

- Gist has a 10 MB per-file limit and ~10 MB total is reasonable. If you've got a massive set of widescreen captures, drop the quality or scope down the matrix.
- GIFs balloon fast. Target 100-400 KB per clip by keeping `fps=8, scale=960` and clip length under 5 seconds.

## Updating the gist later

If you need to add more screenshots or fix one:

```bash
cd /tmp/gist-$(cat /tmp/pr-<N>-visuals/gist-id.txt)
cp new-file.png ./
git add -A
git -c user.email=... -c user.name=... commit -m "Update"
git -c credential.helper="!f() { echo username=...; echo password=$(gh auth token); }; f" push
```

Existing `/raw/<file>` URLs keep working; new files get new URLs.

## Cleanup

The gist stays until deleted. If the user wants it gone after the PR lands:

```bash
gh gist delete $GIST_ID
```

Warn them: deleting the gist breaks every image link in the PR body. Usually you leave it.
