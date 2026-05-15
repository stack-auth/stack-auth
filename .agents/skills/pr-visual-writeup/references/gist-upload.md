# Gist upload (PAT-only)

The bundled `scripts/upload_gist.sh` handles this end-to-end. This doc explains the mechanism so you can diagnose failures or deviate when you need to.

## Why gists and not `user-attachments`

GitHub renders inline images and GIFs in PR bodies from any `https://` URL. Two common hosts:

| Host | Auth | GIF inline? | WebM inline? |
| --- | --- | --- | --- |
| `user-attachments.githubusercontent.com` | Browser session cookie | yes | **yes** |
| `gist.githubusercontent.com/.../raw/...` | PAT (via git push) | yes | no (download link) |

`user-attachments` is nicer (WebM plays inline, smaller files) but requires the browser session cookie, which has broader scope than a PAT and shouldn't be exfiltrated by a CLI tool without explicit user consent. Stick with gists unless the user says otherwise.

## The push trick

`gh gist create` creates the gist and can seed it with one file via stdin. After that, use git to add more files:

```bash
git clone https://gist.github.com/<gist-id>.git
cp *.png *.gif <clone>/
cd <clone>
git add -A
git commit -m "Add assets"
git push
```

The catch: `git push` to a gist over HTTPS needs credentials. The local git credential helper may be configured to answer with a browser session cookie or nothing useful. Override it inline with a one-shot helper that feeds your PAT:

```bash
USER=$(gh api user --jq .login)
TOKEN=$(gh auth token)

git -c credential.helper= \
    -c credential.helper="!f() { echo username=$USER; echo password=$TOKEN; }; f" \
    push
```

The `credential.helper=` (empty) clears any inherited helpers; the second `-c` installs a single-use function-based helper that answers with the PAT. This does NOT persist — no config is written.

## Flat namespace

Gists don't support subdirectories. If your local layout is `shots/foo.png` and `clips/bar.gif`, everything gets flattened in the gist. Make sure filenames are unique across your input dirs before pushing (`upload_gist.sh` doesn't dedupe — it just cps, so a later cp wins).

## Raw URL shape

```
https://gist.githubusercontent.com/<user>/<gist-id>/raw/<filename>
```

Note: `raw/` without a revision SHA points to HEAD. If you push new commits to the gist later, old raw URLs serve the newest version of that filename, which is usually what you want for iterative PR body updates.

## Re-pushing to an existing gist

If you saved `gist-id.txt` from a prior run, you can re-push to the same gist instead of creating a new one. This keeps the URL stable across iterations (useful if the PR body has already been approved/reviewed). Swap the "create" step for a clone of the existing gist by ID.
