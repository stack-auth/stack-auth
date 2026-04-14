# CLAUDE Knowledge Base

Q: How are the development ports derived now that NEXT_PUBLIC_STACK_PORT_PREFIX exists?
A: Host ports use `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}29`, POP3 `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}30`, and OTLP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}31` by default).

Q: How can I show helper text beneath metadata text areas in the dashboard?
A: Use the shared `TextAreaField` component's `helperText` prop in `apps/dashboard/src/components/form-fields.tsx`; it now renders the helper content in a secondary Typography line under the textarea.

Q: How is the Email Template Editor structured?
A: It uses a hero-preview layout in `VibeCodeLayout` where the preview area dominates the screen. The code editor is hidden by default and accessible via a modal, while the AI assistant chat resides in a resizable right panel. Device viewport switching (Desktop/Tablet/Mobile) is integrated into the top toolbar.

Q: How can I improve AI design generations for emails?
A: Update the system prompts in the backend's chat adapters (e.g., `apps/backend/src/lib/ai-chat/email-template-adapter.ts`). Providing explicit design principles, Tailwind CSS best practices, and structured technical rules helps the AI generate more polished and consistent designs.

Q: What endpoint does the local Freestyle mock expose for script execution?
A: The mock server responds on `/execute/v1/script` and `/execute/v2/script` when built from `docker/dependencies/freestyle-mock/Dockerfile`; if the running image is older and only supports v1, backend dev can post to `/execute/v1/script` for email rendering.

Q: How can I add a small Vitest check inside a client-only file?
A: Use `import.meta.vitest?.test(...)` at the bottom of the file for lightweight, in-file tests without adding a separate test file.
Q: Why did `pnpm typecheck` fail after deleting a Next.js route?
A: The generated `.next/types/validator.ts` can keep stale imports for removed routes. Deleting that file (or regenerating Next build output) clears the outdated references so `pnpm typecheck` succeeds again.

Q: Why can auto-migrations time out and how should I mitigate it?
A: Auto-migrations run each migration inside a Prisma interactive transaction with an 80s timeout. Long-running statements (even if marked RUN_OUTSIDE_TRANSACTION_SENTINEL) still consume that time, so keep each iteration small using CONDITIONALLY_REPEAT_MIGRATION_SENTINEL and reduce batch sizes (e.g., lower LIMIT) so each transaction finishes under 80s.

Q: How should `restricted_by_admin` updates handle reason fields?
A: When setting `restricted_by_admin` to false, explicitly clear `restricted_by_admin_reason` and `restricted_by_admin_private_details` to null (even if omitted in the PATCH) to satisfy the database constraint.

Q: Where should `stackAppInternalsSymbol` be imported from in the dashboard?
A: Use the shared `apps/dashboard/src/lib/stack-app-internals.ts` export to avoid duplicating the Symbol.for definition across files.

Q: How do we control whether a project requires publishable client keys?
A: Use the project-level config override field `project.requirePublishableClientKey` via `/api/v1/internal/config/override/project` or `AdminProject.update({ requirePublishableClientKey: ... })`. It defaults to false for new projects and is set true for existing projects via DB migration.

Q: When adding new config fields, what else should be updated?
A: Update the config schema fuzzer configs in `packages/stack-shared/src/config/schema-fuzzer.test.ts` (for example, add the new field under `projectSchemaFuzzerConfig`/`branchSchemaFuzzerConfig`).

Q: Why can't `canNoLongerBeOverridden` accept dotted paths?
A: It uses `schema.getNested`, which only allows keys with alphanumerics, `_`, `$`, `:`, or `-`. Dots are rejected, so mark the parent object key (e.g., `project`) as non-overridable instead.

Q: Where is the editable-grid preview spacing controlled in the dashboard playground?
A: In `apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/playground/page-client.tsx`, the `selected === "editable-grid"` branch controls the card width/padding and the main preview container now uses `isExpandedPreview` to reduce outer gray padding only for editable-grid.

Q: Why do editable-grid dropdown/boolean values sometimes not fill the full value column width?
A: In `apps/dashboard/src/components/design-components/editable-grid.tsx`, the value wrappers must be explicitly full-width (`w-full`) for boolean and dropdown fields, and the grid value cell container should also include `w-full`; otherwise controls shrink to content width.

Q: How should dashboard inline editable text fields match the new design-components style?
A: Use `DesignInput` and `DesignButton` in `apps/dashboard/src/components/editable-input.tsx` (instead of legacy `Input`/`Button`) and style accept/reject actions as subtle glassy icon buttons with muted ring/border plus semantic hover tints.

Q: What should dashboard email/project pages prefer for UI primitives?
A: Prefer `apps/dashboard/src/components/design-components/*` components (`DesignCard`, `DesignAlert`, `DesignBadge`, `DesignButton`, `DesignPillToggle`, `DesignCategoryTabs`, etc.) over page-local wrappers or repeated inline class patterns; current email surfaces still contain local patterns like custom GlassCard/SectionHeader/ViewportSelector that should be standardized.

Q: What sections are expected in the dashboard design guide beyond component mapping?
A: Include explicit best-practices plus dedicated guidance for animation, typography, light/dark color system, micro-interactions, and spacing/layout rules so the guide is actionable for both humans and AI agents.

Q: How should the project emails page cards align with the design system?
A: In `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/emails/page-client.tsx`, wrap the major sections with `DesignCard` from `@/components/design-components` (for example `gradient="default"`/`"purple"` with `glassmorphic`) instead of maintaining a local page-specific glass card wrapper.

Q: Where is the default inner spacing for shared design cards controlled?
A: `apps/dashboard/src/components/design-components/card.tsx` sets the default content padding via `bodyPaddingClass` (currently `p-5`), and compact cards use `p-5` header plus `px-5 py-4` body spacing.

Q: Why can two `DesignCard` surfaces look like they have different padding?
A: Pages can add extra local wrappers inside `DesignCard` (for example `p-5`, `px-5`, `pb-5`) which stack on top of `DesignCard` defaults; in the emails page, removing those local wrappers (`p-0`, `px-0`, `pb-0`) makes spacing match playground behavior.

Q: How can a split section inside body-only `DesignCard` match header/content card borders?
A: Inside body-only cards (which already apply `p-5`), use a second section with `-mx-5 px-5` and `border-t border-black/[0.12] dark:border-white/[0.06]` so the divider spans full card width while content alignment matches `DesignCard` header/content layout.

Q: How should cards handle header action buttons when using `title` + `subtitle`?
A: `DesignCard` now supports an `actions` prop when title/icon are provided; use `title`, `subtitle`, `icon`, and `actions` in pages like emails so header spacing and subtitle-bottom spacing exactly match playground/header variant styles without custom section-header workarounds.

Q: What should we do after changing props in a core dashboard design component?
A: Update the playground implementation (`apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/playground/page-client.tsx`) in the same change so the component controls/examples reflect the new or changed props immediately.

Q: How is the new `DesignCard` `actions` prop represented in playground?
A: The card playground now includes a `Header Actions` toggle that injects a sample `actions` slot (`DesignButton` with `Sliders` icon and "Configure") into `DesignCard` preview and generated code, only when `title` is present.

Q: What is the reliable way to lint a single dashboard file in this monorepo?
A: Run lint from `apps/dashboard` directly (for example `pnpm lint -- "src/app/(main)/(protected)/projects/[projectId]/(overview)/line-chart.tsx"`), because running root `pnpm lint -- <file>` fans out through Turbo packages where that path does not exist.
Q: How should unsubscribe-link e2e tests avoid breakage from email theme/layout changes?
A: In `apps/e2e/tests/backend/endpoints/api/v1/unsubscribe-link.test.ts`, avoid snapshotting the entire rendered HTML for transactional emails; assert stable behavior instead (email content present and `/api/v1/emails/unsubscribe-link` absent) so cosmetic wrapper/style changes do not fail the test.

Q: Why is the JIT disabled for Bulldozer DB mutations with only a few rows?
A: PostgreSQL JIT can dominate runtime for Bulldozer's giant single-statement CTE transactions. In a `group -> map -> map -> group` mutation with only 31 SQL statements and ~8 source rows, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, VERBOSE)` showed ~1.4ms planning, ~1598.9ms execution, and ~1597.5ms of JIT time (`Optimization` ~836ms, `Emission` ~740ms) while the actual plan nodes were sub-millisecond. Disabling JIT locally for Bulldozer transactions with `SET LOCAL jit = off;` in `toExecutableSqlTransaction()` dropped the same query to ~0.63ms execution and brought the stacked fuzz case from ~41s to ~0.34s.

Q: How do cross-domain auth handoffs avoid creating extra refresh-token sessions?
A: The cross-domain authorize route must carry the current `refreshTokenId` through authorization-code exchange and OAuth token issuance must reuse that ID. Keep `afterCallbackRedirectUrl` URL-only and persist refresh-token linkage in `ProjectUserAuthorizationCode.grantedRefreshTokenId`; then return that as `user.refreshTokenId` in `getAuthorizationCode` so token issuance can reuse the same refresh-token row with ownership checks.

Q: Is there a manual demo page for cross-domain auth handoff verification?
A: Yes — `examples/demo/src/app/cross-domain-handoff/page.tsx` provides one-click triggers for client sign-in/sign-up redirects, server protected-page redirects, and OAuth provider sign-in, plus runtime URL visibility for manual verification.

Q: Why did the demo still use `*.built-with-stack-auth.com` in local dev?
A: The demo app needs `NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX` in `examples/demo/.env.development`; set it to `.localhost:${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}09` so hosted handler URLs resolve to the local hosted-components instance.

Q: How should SDK code read environment variables to work across bundlers?
A: Read from `packages/template/src/lib/env.ts` via `envVars` only. That file uses explicit `typeof process !== "undefined" ? process.env.KEY : undefined` getters so bundlers like Next.js can inline `process.env.KEY` at build time while still being safe if `process` is unavailable at runtime. Direct `process.env` usage is banned in `packages/template/.eslintrc.cjs` everywhere except `src/lib/env.ts`.

Q: What if hosted auth rewrites `after_auth_return_to` into a same-origin relative callback URL?
A: Cross-domain handoff should still run when handoff params indicate a different final callback origin. In that case, reconstruct the cross-domain redirect URI on the `afterCallbackRedirectUrl` origin while preserving callback path/query/hash, then continue through `/auth/oauth/cross-domain/authorize`.

Q: How should `app.urls.signIn`/`signOut` behave for hosted cross-domain flows?
A: In browser contexts, `app.urls` should return redirect-ready handler URLs for `signIn`, `signUp`, `onboarding`, and `signOut`: include `after_auth_return_to`, preserve existing cross-domain handoff params, and for hosted sign-in/up/onboarding populate cross-domain callback targets (`/handler/oauth-callback` with `stack_cross_domain_auth=1`) so plain `router.push(app.urls.signIn)` / `<Link href={app.urls.signOut}>` keeps return-to-domain behavior.

Q: What should happen if hosted `after_auth_return_to` requires cross-domain handoff but URL params are missing?
A: In `planRedirectToHandler` (`redirect-page-urls.ts`), do not throw immediately. Generate missing PKCE handoff `state`/`codeChallenge` via `getCrossDomainHandoffParams(currentUrl)` and default `afterCallbackRedirectUrl` to `currentUrl.toString()`, then continue with cross-domain authorize planning.

Q: What is the cleanest split for `_redirectToHandler`?
A: Put branching/policy into a pure planner (`planRedirectToHandler`) in `redirect-page-urls.ts` that returns either a direct redirect URL or a cross-domain authorize payload; keep `client-app-impl` as the executor for side effects (calling authorize endpoint and navigating).

Q: Should query parsing like `_getCrossDomainHandoffParamsForUrlsGetter` live in client-app-impl?
A: Prefer moving pure query parsing into `redirect-page-urls.ts` (for example `getCrossDomainHandoffParamsFromCurrentUrl`) and keep `client-app-impl` focused on fallback/prefetch/stateful concerns only.

Q: How should we carry cross-domain refresh-token reuse data without corrupting URL semantics?
A: Keep `afterCallbackRedirectUrl` as a URL-only field and persist refresh-token linkage in a dedicated DB column (`ProjectUserAuthorizationCode.grantedRefreshTokenId`). Then return that column as `user.refreshTokenId` in `getAuthorizationCode` so token issuance can safely reuse and ownership-check it.

Q: How can cross-domain handoff require proof of refresh-token possession without adding extra body fields?
A: Reuse the existing `X-Stack-Refresh-Token` header already sent by the client interface. In `/auth/oauth/cross-domain/authorize`, require this header, resolve the refresh-token row by token string, and verify it matches auth context (`auth.refreshTokenId`, `auth.user.id`, `auth.tenancy.id`) and validity before issuing the handoff code.

Q: Why can cross-domain e2e tests fail after adding a new file under template implementations?
A: E2E JS tests import `@stackframe/js` from built `dist`, so new helper files copied to `packages/js/src` still fail at runtime until package dist is rebuilt and includes the new module path.

Q: How should dashboard pages update project config values?
A: Do not call `project.updateConfig(...)` directly from dashboard pages; lint enforces using `useUpdateConfig()` from `apps/dashboard/src/lib/config-update.tsx` so pushable-config confirmation flows are handled consistently.

Q: How should EventTracker behave in test environments with partial DOM mocks?
A: In `packages/template/src/lib/stack-app/apps/implementations/event-tracker.ts`, gate `start()` behind runtime capability checks (DOM listener APIs and screen dimensions), and patch `window.history` instead of global `history`. This prevents crashes like `Cannot read properties of undefined (reading 'width')` in non-browser test stubs while keeping browser behavior unchanged.

Q: How can the dashboard find resumable onboarding state without SDK type changes?
A: Query `/internal/projects` via `stackAppInternalsSymbol` and read each project's `onboarding_status`; this avoids relying on `AdminOwnedProject` fields that may lag until generated package copies are rebuilt.

Q: How should the new-project onboarding page avoid React's "Cannot update a component while rendering a different component" router error?
A: In `apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/new-project/page-client.tsx`, never call `router.replace(...)` during render when an onboarding project is already completed; move that redirect into a `useEffect` and render a plain spinner while the redirect is in progress.

Q: What is the expected lightweight loading state when reopening an in-progress onboarding project?
A: On `apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/new-project/page-client.tsx`, the "loading onboarding" state should be just a centered `Spinner` with no card chrome or explanatory copy.

Q: How should dashboard project onboarding status responses be handled to avoid silently bypassing onboarding?
A: Import `ProjectOnboardingStatus`/`projectOnboardingStatusValues` from `@stackframe/stack-shared/dist/schema-fields`, validate every `onboarding_status` from `/internal/projects`, and throw on invalid/missing values instead of defaulting to `"completed"`.

Q: What E2E updates are required after adding `onboarding_status` to project API responses?
A: Update affected inline snapshots in `apps/e2e/tests/backend/endpoints/api/v1/**` to include `"onboarding_status": "completed"` in project payloads (for example projects, permissions, and integration provisioning/current endpoints), otherwise CI setup/restart E2E jobs fail with snapshot mismatches.

Q: How should `createOrUpdateProjectWithLegacyConfig` handle `onboardingStatus` for forward-compat checks?
A: Only write `onboardingStatus` when the `Project.onboardingStatus` column exists (for example by checking `information_schema.columns` in-transaction) so current code can still run against older schemas where that column is absent.

Q: Where is the private sign-up risk engine generated entrypoint in backend now?
A: The generator script writes `apps/backend/src/private/implementation.generated.ts` (not `src/generated/private-sign-up-risk-engine.ts`), and backend runtime imports should target `@/private/implementation.generated`.

Q: When do Bulldozer transactions need sequential temp-table execution instead of the default giant CTE executor?
A: Most Bulldozer operators should keep using the original giant-CTE executor because it is faster and matches existing semantics. `declareSortTable` is the exception for its bulk-init path: it needs real temp tables so a transaction-local PL/pgSQL helper can read intermediate sorted rows by table name. The safe split is to keep the CTE executor by default and switch to sequential execution only when a statement uses `pg_temp.bulldozer_sort_bulk_init_from_table`. Also, plain side-effecting `SELECT pg_temp.helper(...)` CTEs are not reliable unless they are wrapped in a data-modifying statement such as `INSERT INTO pg_temp.bulldozer_side_effects ...`.

Q: Why can initializing a Bulldozer operator with an internal child table fail with `BulldozerStorageEngine_keyPathParent_fkey`?
A: Internal child table paths add an extra `"table"` segment (for example `.../table/external:parent/table/internal:child`). The parent operator must insert the intermediate `.../table` keyPath before running the child table `init()`. Without that node, inserting the child root path violates the storage engine parent foreign key.

Q: Why can a multi-input operator like `declareLeftJoinTable` read stale upstream rows inside trigger execution?
A: Bulldozer executes most statement batches as one giant CTE transaction for speed. Within that single statement snapshot, downstream reads of `BulldozerStorageEngine` may not see upstream writes from earlier CTEs unless data is passed explicitly. For left-join trigger correctness (especially when one input depends on the other), force sequential execution for those statements (for example with a sentinel checked in `toExecutableSqlStatements`) or derive new input state directly from change tables instead of re-reading storage.

Q: How can `declareLeftJoinTable` avoid accidental scans over unrelated `BulldozerStorageEngine` rows?
A: Avoid all-groups `listRowsInGroup` scans in `init()`. First list left-table groups, then fetch left/right rows per group via `CROSS JOIN LATERAL listRowsInGroup({ groupKey })`. For all-groups read paths, traverse from table-local group nodes using `keyPathParent = <groupsPath>` equality joins (`groupPath -> groupRowsPath -> rows`) instead of prefix-slice predicates like `keyPathParent[1:cardinality(...)] = ...`.

Q: What query shape should Bulldozer use to list all rows without scaling with entire `BulldozerStorageEngine` size?
A: For table-scoped all-groups reads, use equality-join traversal rooted at that table's groups path: `groupPath (keyPathParent = groupsPath) -> groupRowsPath (keyPathParent = groupPath.keyPath and leaf = 'rows') -> rows (keyPathParent = groupRowsPath.keyPath)`. Avoid prefix slicing on `keyPathParent` (`[1:cardinality(...)] = ...`), which can force broad scans over unrelated tables.

Q: Why did EventTracker throw `Reflect.get called on non-object` in JS cookie tests?
A: Partial browser mocks can expose `window` without a real `history` object. Calling `Reflect.get(historyObject, "pushState")` throws before type checks. Use normal guarded access (`Object.getOwnPropertyDescriptor(window, "history")?.value`) plus type guards for `pushState`/`replaceState`, and patch/restore methods directly without `Reflect`.

Q: How are custom handler URL target versions validated?
A: In `packages/template/src/lib/stack-app/url-targets.ts`, custom targets are only allowed for handler names listed in `customPagePrompts` (not for `handler`). For allowed pages, `version: 0` is always accepted and non-zero versions must exist in `customPagePrompts[handlerName].versions`; otherwise an error is thrown.

Q: How should `StackHandlerClient.redirectIfNotHandler` avoid SSR `window` crashes?
A: In `packages/template/src/components-page/stack-handler-client.tsx`, parse handler URLs with a placeholder origin (`http://example.com`) and avoid reading `window` on the server path. For SSR, compare only handler path shape; for browser, keep origin+path checks using `window.location.origin`.

Q: What is the current `app.urls` contract after deprecating runtime URL mutation?
A: `app.urls` is now static (`getUrls(...)` only) and no longer injects runtime `after_auth_return_to` / `stack_cross_domain_*` params from `window.location`. For navigation flows, examples and consumers should use `redirectToXyz()` methods instead (for example `redirectToSignIn()` / `redirectToSignOut()`), while tests for hosted flows should assert dynamic params on actual redirect methods, not on `app.urls`.

Q: What is the fastest safe way to delete a Bulldozer table subtree from `BulldozerStorageEngine`?
A: Delete only the table root `keyPath` and rely on the existing `keyPathParent -> keyPath ON DELETE CASCADE` FK to remove descendants. This avoids recursive CTE path enumeration and significantly speeds up large deletes while preserving semantics.

Q: How should `declareLimitTable.listRowsInGroup` implement the all-groups read path for performance?
A: Read directly from the materialized limit table subtree (`groups -> rows` via `keyPathParent` equality joins) and apply range predicates on stored `rowSortKey`, instead of scanning upstream source rows and semi-joining with `EXISTS` on each row. This keeps behavior but removes an avoidable full-source scan.

Q: How should user signup time be exposed in JWT claims before production rollout?
A: Use `signed_up_at` (OIDC-style naming) in access tokens and encode it as Unix seconds in `apps/backend/src/lib/tokens.tsx` (`Math.floor(user.signed_up_at_millis / 1000)`). Since this is pre-prod, the payload schema can require `signed_up_at` directly without a backward-compat optional shim.

Q: Why did adding `signed_up_at` to the access token payload break backend typecheck?
A: `AccessTokenPayload` currently does not include `signed_up_at`. In `apps/backend/src/lib/tokens.tsx`, `payload` is typed as `Omit<AccessTokenPayload, "iss" | "aud" | "iat">`, so extra fields fail with `TS2353`. Until the schema/type is updated consistently, keep `signed_up_at` out of the payload object.

Q: How should Bulldozer Studio mutation endpoints be hardened?
A: In `apps/backend/scripts/run-bulldozer-studio.ts`, enforce loopback-only requests, require a per-instance mutation token header (for all POST routes), bound request body size before buffering/JSON parse, and ensure raw writes use the same advisory transaction lock as other table mutations. For raw upsert correctness, insert missing parent key paths before upserting the leaf node.

Q: What is the new `declareLeftJoinTable` API contract and why was it changed?
A: `declareLeftJoinTable` now takes `leftJoinKey` and `rightJoinKey` SQL mappers (each producing a `joinKey`) instead of an arbitrary `on` predicate. Join rows are matched when `leftJoinKey IS NOT DISTINCT FROM rightJoinKey` within the same group. This removes custom non-equality predicates, enables planner-friendly equality joins, and keeps null-key matching explicit (`IS NOT DISTINCT FROM`).

Q: What does `listRowsInGroup` return regarding `groupKey` and what pitfall was fixed?
A: In Bulldozer, all-groups row queries can include `groupKey`, while specific-group queries may omit it. A bug in `declareStoredTable.listRowsInGroup` ignored the provided `groupKey` and did not expose `groupKey` for all-groups reads. It now returns `'null'::jsonb AS groupKey` for all-groups reads and correctly filters specific-group reads to only the null group (`groupKey IS NOT DISTINCT FROM 'null'::jsonb`).

Q: How should Bulldozer materialized operators manage upstream trigger registrations across init/delete?
A: Register upstream row-change triggers lazily in `init()` (via an idempotent `ensure...Registration` helper), store deregistration handles, and call those `deregister()` functions in `delete()`. This avoids leaked/no-op trigger callbacks after table teardown while still allowing re-initialization to re-register subscriptions.

Q: How can we test trigger registration lifecycle behavior without depending on database row changes?
A: In `apps/backend/src/lib/bulldozer/db/index.test.ts`, wrap input tables with an instrumentation helper that intercepts `registerRowChangeTrigger`, counts `register`/`deregister` calls, and tracks active registrations. Then assert `init()` registers exactly once per input, repeated `init()` is idempotent, `delete()` deregisters, and re-`init()` re-registers.

Q: Why can `declareConcatTable` ignore input sort comparator differences?
A: `declareConcatTable` always emits `rowSortKey = null` and uses `compareSortKeys: () => 0` itself, so input sort-order semantics are not part of concat output behavior. It should only enforce group-key comparator compatibility, not sort comparator compatibility.

Q: How should flaky subset-iteration perf assertions be stabilized?
A: In `apps/backend/src/lib/bulldozer/db/index.perf.test.ts`, keep a warmup query, then measure multiple timed runs (for example 5) and assert on average latency instead of a single run. Log average, standard deviation, variance, min, and max so regressions still show up while reducing one-off outlier failures.

Q: What if multi-run average still flakes because of one or two large outliers?
A: Use robust stats for thresholds: keep logging full `avg/stddev/variance/min/max`, but assert subset-iteration performance on `trimmedAverage` (drop one min/max sample when there are 5 runs). This preserves sensitivity to sustained regressions while tolerating transient host contention spikes during concurrent test-file execution.

Q: How should `declareTimeFoldTable` row identifiers and SQL aliases behave?
A: `declareTimeFoldTable` emits expanded output identifiers with a flat-row suffix (for example `sourceRowId:1` even when one row is emitted), matching other fold-style operators. For query outputs, use unquoted aliases (`AS groupKey`, `AS rowIdentifier`, etc.) if later clauses reference them (`ORDER BY groupKey, rowIdentifier`) to avoid case-sensitive alias lookup errors in Postgres.

Q: Why can Bulldozer Studio show initialized derived tables that do not react to new stored-table mutations?
A: Trigger registrations are in-memory and are established in table `init()`. If the DB already has initialized derived tables from a previous Studio process, a fresh Studio process can report `initialized: true` from storage while lacking active trigger subscriptions. In `run-bulldozer-studio.ts`, rebind initialized derived tables at startup by deleting and re-initializing them in dependency order so subscriptions are re-registered.

Q: How can I inspect the `declareTimeFoldTable` scheduler state in Bulldozer Studio?
A: Use the new `⏱️ Timefold` mode in `apps/backend/scripts/run-bulldozer-studio.ts`. It calls `/api/timefold/debug`, which reports whether `BulldozerTimeFoldQueue` and `BulldozerTimeFoldMetadata` exist, the metadata `lastProcessedAt` value, and up to 500 queued rows (including `scheduledAt`, `stateAfter`, `rowData`, and `reducerSql`) ordered by scheduled execution time.

Q: Why can timefold queue rows remain overdue even though the reducer function exists?
A: The migration creates the queue processor function regardless of `pg_cron`, but `pg_cron` setup is best-effort and can be skipped (for example if `cron.job` is unavailable). In that state, `BulldozerTimeFoldQueue` grows while `lastProcessedAt` stops moving until `public.bulldozer_timefold_process_queue()` is called manually or `pg_cron` is installed/configured correctly.

Q: How do we ensure `pg_cron` is actually available in local dev Postgres?
A: In `docker/dev-postgres-with-extensions/Dockerfile`, install `postgresql-15-cron`, add `pg_cron` to `shared_preload_libraries`, set `cron.database_name='stackframe'`, and create the extension during init (`CREATE EXTENSION pg_cron;`). After `pnpm run restart-deps`, `to_regclass('cron.job')` should be non-null and `cron.job_run_details` should show the `bulldozer-timefold-worker` running every second.

Q: How does Bulldozer Studio "init all" work?
A: `apps/backend/scripts/run-bulldozer-studio.ts` now exposes `POST /api/tables/init-all`, which initializes only non-initialized tables in topological dependency order derived from table snapshots. The toolbar has a `🚀 init all` button that calls this endpoint and refreshes schema/details afterward.

Q: What are safe reducer practices for `declareTimeFoldTable`, and how do timed reruns affect outputs?
A: Timefold reducers should avoid non-deterministic values (`now()`, random) for output-driving logic; prefer stable row timestamps and prior reducer timestamps so replay/re-init stays deterministic. Timed reruns now append newly emitted rows on top of existing emitted rows for a source row (instead of replacing prior timed outputs), while source updates/deletes still recompute/reset that source row’s materialized outputs.

Q: How does the Bulldozer payments dual-write work?
A: `apps/backend/src/lib/payments/bulldozer-dual-write.ts` exports `bulldozerWrite*` functions (one per payment model: Subscription, OneTimePurchase, SubscriptionInvoice, ItemQuantityChange). Each takes a full Prisma row, converts it to the Bulldozer stored table format via `*ToStoredRow`, then calls `schema.<table>.setRow()` + `toExecutableSqlTransaction` + `prisma.$executeRaw`. Every Prisma create/update/upsert on these models has a `// dual write - prisma and bulldozer` comment and a call to the corresponding function. For `update` calls (which don't return full rows), a `findUniqueOrThrow` re-reads the row before passing to the bulldozer write. The conversion functions are also reused by the ingress script (`bulldozer-payments-init.ts`).

Q: Does `ManualItemQuantityChangeRow` have a `paymentProvider` field?
A: No. It was removed because item quantity changes have nothing to do with payment providers. The `manualItemQuantityChangeTxns` mapper in `transactions.ts` emits `'null'::jsonb AS "paymentProvider"`, and `TransactionRow.paymentProvider` is typed as `PaymentProvider | null` to accommodate this.

Q: Are Bulldozer table `init()` calls idempotent?
A: No. They use plain `INSERT INTO "BulldozerStorageEngine"` without `ON CONFLICT DO NOTHING`, so calling `init()` twice crashes with a unique constraint violation. The ingress script (`bulldozer-payments-init.ts`) checks `table.isInitialized()` per-table before calling `init()` to handle this safely.

Q: How does the Bulldozer `verifyDataIntegrity()` method work?
A: Each `Table` has a `verifyDataIntegrity()` method returning a `SqlQuery` that produces error rows (empty = healthy). For derived tables (flat-map, sort, group-by, left-join, compact), it re-derives expected rows from input tables and does a FULL OUTER JOIN with actual materialized rows. For stored/concat tables (leaf/virtual), it returns empty. For reduce/l-fold/time-fold, it does structural group-correspondence checks. All derived-table queries are gated on `isInitialized` so uninitialized tables are silently skipped. The helper `verifyAllTablesIntegrity(tables)` UNION ALLs all tables' queries with a `tableid` column. Filter and map tables delegate to their internal nested flat-map table's verifyDataIntegrity via the `pick()` spread.

Q: How are Bulldozer table implementations structured when they need self-referencing methods?
A: When a table method (like `verifyDataIntegrity`) needs to call another method on the same table (like `listRowsInGroup`), the `declare*Table` function assigns the result object to a `const table` variable first, then returns it: `const table: ReturnType<typeof declare*Table<...>> = { ... }; return table;`. This lets closures reference `table` by the time they execute.
