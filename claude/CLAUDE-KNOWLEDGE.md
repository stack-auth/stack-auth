# CLAUDE Knowledge Base

Q: How are the development ports derived now that NEXT_PUBLIC_STACK_PORT_PREFIX exists?
A: Host ports use `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}29`, POP3 `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}30`, and OTLP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}31` by default).

Q: How can I show helper text beneath metadata text areas in the dashboard?
A: Use the shared `TextAreaField` component's `helperText` prop in `apps/dashboard/src/components/form-fields.tsx`; it now renders the helper content in a secondary Typography line under the textarea.

Q: Why did `pnpm typecheck` fail after deleting a Next.js route?
A: The generated `.next/types/validator.ts` can keep stale imports for removed routes. Deleting that file (or regenerating Next build output) clears the outdated references so `pnpm typecheck` succeeds again.

Q: Why can external DB sync tests time out in dev-focused GitHub workflows?
A: The first calls to `/api/latest/internal/external-db-sync/sequencer` and `/poller` can be slow in dev mode and hit Undici's headers timeout; prewarming those endpoints with the cron secret, retrying header-timeout failures in the test helper, or running tests single-worker are viable mitigations.

Q: How can we serialize only the external DB sync Vitest files while keeping the rest parallel?
A: Use `poolMatchGlobs` to route the external DB sync test globs to the `forks` pool and set `poolOptions.forks.{minForks,maxForks}=1` in `apps/e2e/vitest.config.ts`; keep the default threads pool for all other tests.

Q: How can CI keep most tests parallel while isolating external DB sync tests?
A: Split workflow test runs into two steps: run the full suite with `--exclude "**/external-db-sync*.test.ts"`, then run only external DB sync tests with `--min-workers=1 --max-workers=1`.

Q: How do I call a custom internal admin endpoint from the dashboard without adding SDK methods?
A: Grab the Stack internals symbol (`Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals")`) and call `adminApp[stackAppInternalsSymbol].sendRequest(path, options, "admin")` to issue an authenticated admin request.

Q: How do I read project and branch IDs from admin auth in backend route handlers?
A: Use `auth.tenancy.project.id` and `auth.tenancy.branchId` when `adminAuthTypeSchema` is in use; `auth.project` and `auth.branchId` do not exist there.

Q: How do I avoid BigInt literal errors in dashboard typecheck?
A: Avoid `0n` in client code and use `BigInt(0)` instead, since BigInt literals require an ES2020 target.

Q: How can I get external DB sync status across all tenancies?
A: Call `/api/latest/internal/external-db-sync/status?scope=all` with admin auth; the response includes a `global` aggregate alongside the current tenancy details.

Q: How can I throttle external DB sync in dev without pausing it?
A: Use `STACK_EXTERNAL_DB_SYNC_POLL_CLAIM_LIMIT` to cap poller throughput, `STACK_EXTERNAL_DB_SYNC_SEQUENCER_BATCH_SIZE` to reduce backfill batch size, and `STACK_EXTERNAL_DB_SYNC_MAX_BATCHES_PER_MAPPING` to limit sync-engine work per request (it re-enqueues when throttled).

Q: How can the external DB sync dashboard show global stats only?
A: When `/api/latest/internal/external-db-sync/status?scope=all` is used, the route can return global aggregates for the main stats and an empty `external_databases` array; the dashboard should avoid tenancy-specific fields and external DB cards in that mode.

Q: How can I make the mega-user load in `mock-external-db-sync-projects.sql` show progress and avoid huge single-statement inserts?
A: Create a temp table for the three mega projects, then use a `DO $$` loop to insert users in batches (e.g., 10k per project) with a `RAISE NOTICE` after each batch; this keeps memory pressure lower and gives progress feedback.

Q: Why is the mega-user load still slow even with batching?
A: `ProjectUser` inserts fire the `project_user_insert_trigger` (from `apps/backend/prisma/migrations/20250304200822_add_project_user_count/migration.sql`) which updates `Project.userCount` on every insert; with 1M users per project, that means 1M updates to the same project row, causing huge write amplification. ContactChannel inserts also trigger `mark_project_user_on_contact_channel_*` updates. For fast bulk loads, disable those triggers during the load and recompute `Project.userCount` afterward.
