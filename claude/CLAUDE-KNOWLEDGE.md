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
