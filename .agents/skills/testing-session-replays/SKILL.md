---
name: testing-session-replays
description: Test the dashboard session replay player end-to-end (seeding replays, playback, timeline, mini tabs, performance). Use when verifying session replay UI, playback, or performance changes.
---

# Testing Session Replays

## Environment setup
1. Run the minimal dev stack: `pnpm dev:basic` (dashboard :8101, backend :8102, assuming `NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX=81`).
2. If the dashboard/backend return 500s, generated artifacts might be missing after a restart — `pnpm build:packages` usually fixes it (ask the user first per AGENTS.md; as an autonomous agent you may run it yourself).
3. If `pnpm db:init` fails with a missing `migration-files` module, run `pnpm run generate-migration-imports` in `apps/backend` first.
4. Sign in via mock GitHub OAuth as `admin@example.com`.

## Getting a replay to test with
- The seed script's Demo Project may already contain many seeded replays — check there first.
- To create a **multi-tab** replay (needed for mini-tab behavior), record real pages with rrweb via Playwright (attach to the CDP endpoint), shift the event timestamps so the tabs overlap, and upload via `POST /api/v1/session-replays/batch`.
- Watch out for two upload blockers:
  - Access tokens expire quickly — regenerate via the admin key flow and handle 401s by refreshing.
  - The project may have 0 `session_replays` quota (`ItemQuantityInsufficientAmount`) — bump it via `POST /api/v1/payments/items/team/{teamId}/session_replays/update-quantity` with a positive delta.

## What to test on the player
Replay page: `/projects/<projectId>/session-replays`.
- **Smooth playback**: run a CDP long-task probe (`PerformanceObserver('longtask')` via a separate Playwright connection to the same Chrome) during ~30s of playback; regressions show up as continuous multi-hundred-ms tasks.
- **Timeline**: time label + progress fill are updated imperatively (refs + rAF), not via React state — verify they advance every second while playing.
- **Mini tabs**: non-active tab thumbnails sync on a throttled cadence (`MINI_TAB_SYNC_INTERVAL_MS`, 2s) — verify they step every ~2s and jump immediately after a SEEK (throttle resets on seek).
- **Page responsiveness**: interact with chrome (Filters dropdown, sidebar) during playback; it should respond instantly.
- **Unit tests**: `pnpm vitest run session-replay-machine` in `apps/dashboard`.

## Known pitfalls
- rrweb v1 `Replayer.pause(offset)` is a full synchronous seek — any code path that calls it frequently (e.g. per 200ms TICK) can freeze the page. Keep this in mind when probing performance.
- CI on this repo: `docker` and `E2E Fallback Tests` might be flaky/failing on the base (`dev`/`main`) branch — verify with `gh run list --branch dev/main` before assuming a PR caused them. Only the `all-good` workflow is required.

## Devin Secrets Needed
- None beyond repo defaults; the local backend uses the dev super-secret admin key from `.env.development`.
