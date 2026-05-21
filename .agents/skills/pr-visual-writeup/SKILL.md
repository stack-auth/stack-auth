---
name: pr-visual-writeup
description: Generate a rich GitHub PR description with dashboard/web-UI screenshots and scrolling animations captured from a running dev server, hosted as a GitHub gist, and pushed to the PR via `gh pr edit`. Use this skill whenever the user asks to "make a PR description with screenshots", "write up a PR with visuals", "add screenshots to my PR", "PR description with GIFs / demo / scroll animations", or anything involving turning a code PR into a visual-heavy writeup. Also triggers on phrases like "ship a PR writeup", "PR body with light and dark mode screenshots", "visual PR review", "generate PR body from dev server". The core value is the parallel capture pipeline — multiple browser sessions running concurrently to produce theme/viewport matrix screenshots in roughly the wall-clock time of a single pass.
---

# pr-visual-writeup

Turn a PR into a visual writeup: inspect the diff, capture screenshots + scroll animations from a local dev server across themes and viewports **in parallel**, host everything in a GitHub gist (PAT-only, no browser cookies), compose a rich markdown body, and set it as the PR description.

## When this triggers

- "make me a pr description with screenshots / gifs / videos"
- "pr writeup with visuals"
- "generate pr body from the running dev server"
- "screenshot all the pages this PR changes and put them in the description"

If the user only wants a text-only PR description, don't use this skill — it's for visual-heavy writeups.

## The shape of the work

Six phases. Phases 2 and 3 are the parallel-heavy ones — lean on subagents there. Phase 6 is the cleanup that puts the user's working tree back.

1. **Scope** — figure out which PR, which routes, which dev server, which auth, **which selectors are new UI**
2. **Capture** — "after" pass first (parallel: page × theme × viewport, red borders on new UI), then stash + checkout base + capture "before" pass against the same dev server.
3. **Process (parallel)** — convert scroll videos → GIFs (inline-playable), prep gist
4. **Upload** — one gist, one commit, all files; get raw URLs
5. **Compose + set** — markdown body with before/after tables, then `gh pr edit --body-file`
6. **Restore** — `git checkout <orig-branch>` + `git stash pop` so the user's working tree is exactly where they left it

## Phase 1 — Scope

Before you capture anything, know:

- **PR number + repo** — `gh pr view <N> --json baseRefName,headRefName,title,url`
- **Changed UI routes** — `gh pr diff <N> --name-only` and filter for page/route files. For Next.js look for `**/page*.tsx` / `**/*page-client.tsx`. Map route files to URL paths based on the app router convention. Ignore changes purely in backend / shared components unless they have an obvious UI surface.
- **Dev server port** — `lsof -iTCP -sTCP:LISTEN -P -n | grep node` and `curl -s http://localhost:<port>/ | grep -oE '<title>[^<]+</title>'` to identify which port is the dashboard vs. API vs. docs vs. mock-OAuth.
- **Auth flow** — if the app requires login, inspect the sign-in page for the OAuth provider to use, and ask the user (or infer from context) which dev account to sign in as. Mock OAuth servers typically accept any email.
- **New-UI selectors** — for each changed route, derive a list of CSS selectors that point to the UI elements added or visibly modified in this PR. Read the diff for that route's component file(s), pick stable selectors (`data-testid`, semantic role, unique class, or a `:has()` text match) for each new/changed block. These selectors drive the red-border highlight pass on "after" captures. If a route has no visually changed elements (only behavior/copy refactor), record `[]` and skip highlighting for that route.
- **Base ref for "before"** — `gh pr view <N> --json baseRefName` gives you the base branch (usually `dev` or `main`). The "before" pass swaps the working tree to that ref under the same dev server — see Phase 2. Skip the before pass entirely if the user says "after only" or if every route is greenfield.
- **Working-tree state** — `git status --porcelain`. If there are uncommitted changes, they need to be stashed before the base checkout. Record whether a stash will be needed and the current branch name so you can restore exactly.

Record all of these in `/tmp/pr-<N>-visuals/scope.md` — the Phase 2 subagents need them.

## Phase 2 — Capture

Two ordered passes against a **single** dev server. The "after" pass runs first while the head branch is checked out; then we swap the working tree to the base ref (same server, same port, HMR rebuilds) and run the "before" pass.

### Pass 1 — "after" (parallel)

The head branch is already checked out and the dev server is already running, so this is just the parallel matrix you started with.

Spawn one subagent per **(theme, viewport)** combination. Each owns a named `agent-browser` session, authenticates once, captures every page in its slice with **red borders injected on new-UI selectors**, and returns the output directory.

- `after-light-standard` (1920×1200, theme=light, red borders on)
- `after-dark-standard`  (1920×1200, theme=dark,  red borders on)
- `after-light-wide` / `after-dark-wide` (2560×1440, flagship pages only)

Issue all Agent calls in **one assistant message** so they run concurrently. Unique `--session-name` per agent.

**Red borders.** The "after" subagents inject a stylesheet that outlines the new-UI selectors recorded in Phase 1 — see the `pr-visual-highlight` block in `references/capture-patterns.md`. Inject after navigation + settle, before the screenshot. Use `outline` (not `border` — `border` shifts layout). Skip the inject for routes whose selector list is empty.

**Wait for the page to be ready before every shot.** Next.js dev compiles routes on demand and the dashboard renders skeletons during data fetch. Networkidle alone is not enough — see the `wait-for-ready` recipe in `references/capture-patterns.md`. Each subagent should also do a one-time *warm-up pass* over its assigned routes before the real capture loop, so the on-demand compile cost is paid against a throwaway hit rather than the screenshot.

### Pass 1.5 — swap working tree to base

After Pass 1 finishes, **before** spawning Pass 2:

```bash
# 1. Record state so Phase 6 can restore it
ORIG_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "$ORIG_BRANCH" > /tmp/pr-<N>-visuals/orig-branch.txt

# 2. Stash anything dirty (including untracked) — even if scope said clean, do this defensively
git stash push --include-untracked -m "pr-visual-writeup pr-<N> after-pass" || true
git rev-parse stash@{0} 2>/dev/null > /tmp/pr-<N>-visuals/stash-ref.txt || rm -f /tmp/pr-<N>-visuals/stash-ref.txt

# 3. Move to the base ref
git checkout <base-ref>     # usually `dev` or `main`, from Phase 1 scope
git pull --ff-only

# 4. Give the dev server time to HMR-rebuild against the new tree
sleep 5 && curl -fs http://localhost:<port>/ >/dev/null
```

Stash the changes **even if `git status` reported clean.** Defensive: the user might have edited a file mid-skill, and a failed checkout halfway through is much worse than a no-op `git stash pop` at the end.

If the dev server doesn't recover from HMR after the checkout (some Next configs choke on large simultaneous file changes), the fallback is to restart it manually — flag this to the user rather than papering over it.

### Pass 2 — "before" (parallel)

Same fan-out as Pass 1, but:
- Filename suffix is `-before-<theme>` instead of `-after-<theme>`
- **No red-border injection.** "Before" is the unmodified baseline.
- Skip routes that didn't exist on the base ref (greenfield) — the subagent will hit a 404; have it log and move on instead of failing the whole pass.
- Long-tail pages are usually not worth capturing in "before" — restrict Pass 2 to the flagship set unless the user asks otherwise.

Filename convention so Phase 5 can pair shots up:

- `/shots/<route>-before-<theme>[-wide].png`
- `/shots/<route>-after-<theme>[-wide].png`

The exact subagent prompt pattern lives in `references/capture-patterns.md` — read it before spawning.

### Scroll animations

Tables, long lists, and sticky-header surfaces benefit from a short down-and-back-up scroll clip. Don't do this for every page — pick the 2-3 most representative. Record via **frame-by-frame screenshot then ffmpeg stitch**, not `agent-browser record`, because `record` creates a fresh browser context that loses dev-mode auth state. The recipe is in `references/capture-patterns.md`.

### When fan-out is NOT worth it

- Only 1-2 pages total → just run sequentially in the main conversation
- The dev server can't handle parallel logins (rare, but some mock-OAuth servers serialize)
- The user explicitly asks for a quick single-theme capture

## Phase 3 — Process (parallel)

After capture, you have a pile of PNGs and 2-4 WebM scroll clips. The WebMs need to become GIFs because GitHub only inline-plays `.webm` when it's hosted on `user-attachments/...` (a browser-session-only upload path we're avoiding). Gist-hosted `.webm` becomes a plain download link; gist-hosted `.gif` plays inline.

Run all ffmpeg conversions in parallel using shell `&`:

```bash
for f in *.webm; do
  (ffmpeg -y -i "$f" -vf "fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${f%.webm}.gif" >/dev/null 2>&1) &
done
wait
```

`fps=8,scale=960` keeps file sizes reasonable (100-400KB) while still looking smooth.

## Phase 4 — Upload via gist (no browser cookies)

Gist-hosting via `git push` with a PAT is the PAT-only equivalent of `user-attachments`. GitHub's `user-attachments` endpoint requires a browser session cookie (not a PAT) — **don't** use tools like `gh-image` unless the user has explicitly opted in. Gist URLs look like `https://gist.githubusercontent.com/<user>/<gist-id>/raw/<filename>` and render inline as images/GIFs in PR bodies.

Full recipe is in `references/gist-upload.md`. Summary: create a public gist via `gh gist create`, clone it, copy all PNGs + GIFs in, commit, `git push` with a credential-helper trick that feeds the PAT. One push, all files.

## Phase 5 — Compose the body, then `gh pr edit`

Markdown structure template is in `references/pr-body-template.md`. The load-bearing patterns:

- **Summary** paragraph + `Base: → Head:` + scope line (files, +lines)
- **Screenshots** section with one subsection per "flagship" page, each using a 2×2 before/after × light/dark table, then a widescreen table
- **Other migrated surfaces** compact table for the long tail (after-only)
- **Scroll behaviour** section with a light/dark GIF table
- A short legend noting that the red outlines on "after" shots mark the new/changed UI
- Everything after the visual section is the usual PR body: What's new, Notes for reviewers, Test plan

Set it with:
```bash
gh pr edit <N> --body-file <path-to-md>
```

Confirm with the user before pushing if the PR is on a public repo — this is a shared-state action. On a personal fork or draft PR, go ahead.

## Phase 6 — Restore the working tree

The "before" pass left the repo on the base ref with the user's original changes stashed. Put it back:

```bash
ORIG=$(cat /tmp/pr-<N>-visuals/orig-branch.txt)
git checkout "$ORIG"
if [ -f /tmp/pr-<N>-visuals/stash-ref.txt ]; then
  git stash pop "$(cat /tmp/pr-<N>-visuals/stash-ref.txt)" || {
    echo "stash pop hit conflicts — leaving stash in place"
    git stash list | head -5
  }
fi
```

Do this **even if Phase 5 failed**, or the user is stuck on the wrong branch with their work hidden in a stash. If `git stash pop` conflicts, leave the stash alone and surface the conflict to the user explicitly — never auto-resolve.

After restore: `git status` and `git rev-parse --abbrev-ref HEAD` for sanity, paste the output back to the user so they can verify before continuing other work.

## A note on trust boundaries

Three distinct credentials touch this workflow. Keep them straight:

- **PAT** (`gh auth token`) — for gist push, `gh pr edit`, `gh pr diff`. Fine to use freely.
- **Dev-server session cookie** — for logging into the local dashboard. Local to the machine, fine.
- **github.com browser session cookie** — what `gh-image` and similar tools extract. **Don't** use this unless the user opts in. It has broader scope than a PAT.

The workflow above deliberately stays in PAT territory.

## Bundled scripts

Use these — don't reinvent them inline. They live at `scripts/` relative to this SKILL.md.

- **`detect_dev_server.sh [min-port] [max-port]`** — lists running node dev servers with their HTML `<title>` so you can pick the right port at a glance.
- **`convert_clips.sh <dir>`** — converts every `.webm` in a directory to `.gif` in parallel (fps=8, 960px wide, ~400KB per clip).
- **`upload_gist.sh <desc> <dir> [<dir> ...]`** — creates a public gist, pushes every file from the input dirs into it in one commit, prints one line per file as `<basename>\t<raw-url>`. Stashes the gist id in `./gist-id.txt`.

## What you bundle in the workspace

Create a `/tmp/pr-<N>-visuals/` workspace to hold everything. After the PR body is set, the PNGs/GIFs live permanently in the gist; the local copies are safe to delete but useful to keep around if the user wants to iterate.

```
/tmp/pr-<N>-visuals/
├── scope.md                  # phase 1 output
├── shots/                    # captured PNGs
├── clips/                    # webm + gif scroll animations
├── body.md                   # composed PR description
├── gist-id.txt               # for re-pushing if you add more shots later
├── urls.txt                  # raw URL per file, for copy-paste
├── orig-branch.txt           # phase 1.5: branch to return to in phase 6
└── stash-ref.txt             # phase 1.5: stash ref to pop in phase 6 (absent if nothing was stashed)
```
