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

Five phases. Phases 2 and 3 are the parallel-heavy ones — lean on subagents there.

1. **Scope** — figure out which PR, which routes, which dev server, which auth
2. **Capture (parallel)** — matrix of {page × theme × viewport}, plus scroll animations
3. **Process (parallel)** — convert scroll videos → GIFs (inline-playable), prep gist
4. **Upload** — one gist, one commit, all files; get raw URLs
5. **Compose + set** — markdown body with tables, then `gh pr edit --body-file`

## Phase 1 — Scope

Before you capture anything, know:

- **PR number + repo** — `gh pr view <N> --json baseRefName,headRefName,title,url`
- **Changed UI routes** — `gh pr diff <N> --name-only` and filter for page/route files. For Next.js look for `**/page*.tsx` / `**/*page-client.tsx`. Map route files to URL paths based on the app router convention. Ignore changes purely in backend / shared components unless they have an obvious UI surface.
- **Dev server port** — `lsof -iTCP -sTCP:LISTEN -P -n | grep node` and `curl -s http://localhost:<port>/ | grep -oE '<title>[^<]+</title>'` to identify which port is the dashboard vs. API vs. docs vs. mock-OAuth.
- **Auth flow** — if the app requires login, inspect the sign-in page for the OAuth provider to use, and ask the user (or infer from context) which dev account to sign in as. Mock OAuth servers typically accept any email.

Record these facts somewhere (a scratchpad file under `/tmp/<skill-workspace>/scope.md` is fine) — the parallel subagents in Phase 2 need them.

## Phase 2 — Parallel capture

This is the skill's core trick. You have N pages × M themes × K viewports of screenshots to take. If you do this in one browser, you navigate sequentially — 9 × 2 × 2 = 36 navigations at ~5s each = 3 minutes. If you fan out, you do it in ~45s.

### Fan-out plan

Spawn one subagent per **(theme, viewport)** combination. Each subagent owns a named `agent-browser` session, authenticates once, captures every page in its assigned theme/viewport, and returns the output directory. Typical combinations:

- `light-standard` (1920×1200, theme=light)
- `dark-standard` (1920×1200, theme=dark)
- `light-wide` (2560×1440, theme=light, a subset of pages)
- `dark-wide` (2560×1440, theme=dark, a subset of pages)

Widescreen captures are usually only worth taking for the "flagship" pages (the 3-5 most important ones). Full matrix on every page is overkill.

**Important:** issue all Agent tool calls for capture subagents **in a single assistant message** so they run concurrently. If you spawn them one at a time across turns, you've lost the parallelism.

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
- **Screenshots** section with one subsection per "flagship" page, each using a 2-col light/dark table, then a widescreen table
- **Other migrated surfaces** compact table for the long tail
- **Scroll behaviour** section with a light/dark GIF table
- Everything after the visual section is the usual PR body: What's new, Notes for reviewers, Test plan

Set it with:
```bash
gh pr edit <N> --body-file <path-to-md>
```

Confirm with the user before pushing if the PR is on a public repo — this is a shared-state action. On a personal fork or draft PR, go ahead.

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
└── urls.txt                  # raw URL per file, for copy-paste
```
