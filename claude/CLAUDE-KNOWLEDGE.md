Q: What conversation schema shape matches the latest support ERD?
A: Keep assignment/SLA/metadata fields directly on `Conversation` (drop `ConversationMetadata`), model channel ingress rows in `ConversationEntryPoint` (renamed from `ConversationChannel`), and keep `ConversationMessage.channelId` referencing entry points by `(tenancyId, id)`. Backend raw SQL in `apps/backend/src/lib/conversations.tsx` must read/write those metadata fields from `Conversation` itself.

# CLAUDE Knowledge Base

Q: How are the development ports derived now that NEXT_PUBLIC_STACK_PORT_PREFIX exists?
A: Host ports use `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}29`, POP3 `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}30`, and OTLP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}31` by default).

Q: How do you expand the internal metrics endpoint to include cross-product aggregates?
A: Extend the existing `/api/v1/internal/metrics` route (in `apps/backend/src/app/api/latest/internal/metrics/route.tsx`) by adding new parallel async queries for each product domain. Add `auth_overview`, `payments_overview`, `email_overview`, and `analytics_overview` to the response schema and the handler, loaded via dedicated helper functions that use Prisma (for payments/emails/teams/users) and ClickHouse (for page views, clicks). New response fields must also be added to the shared yup schemas in `packages/stack-shared/src/interface/admin-metrics.ts` so the dashboard `useMetrics` hook (typed via `yup.InferType<typeof MetricsResponseBodySchema>`) automatically picks up the new shape with full type safety. Never widen `useMetrics` (or `getMetrics`) to `any` — the schemas are the single source of truth and dashboard call sites should never need `as ...` casts.

Q: How can duplicate Recharts keys like `rectangle-25-10-0` appear on overview pages with multiple charts?
A: Recharts can generate colliding internal SVG IDs/keys across chart instances when they share default ID generation paths. Set explicit unique IDs (or instance-unique IDs) on chart roots and avoid duplicated chart-def namespaces to prevent repeated internal keys and console errors.

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

Q: How can overview Recharts on the dashboard dim non-hovered data while keeping the active day emphasized?
A: In `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/(overview)/line-chart.tsx`, track `hoveredIndex` from Recharts' `activeTooltipIndex` via chart `onMouseMove`/`onMouseLeave`, then use that index to lower non-hovered `Cell` opacity for bar charts and reduce line/area `strokeOpacity`/`fillOpacity` while relying on `activeDot` plus a stronger tooltip cursor to keep the hovered point visually focused.

Q: How do you add a hover-to-swap chart interaction to the analytics chart widget with fade transitions?
A: In `metrics-page.tsx`, maintain `chartMode` (the hover intent) and `displayMode` (the chart currently rendered) as separate states. On pill mouse-enter, set chartMode immediately, then use a 120ms timer to set displayMode and clear a `fadingOut` flag. Fade is achieved via CSS opacity transitions on the chart container. The pill component uses `onMouseEnter`/`onMouseLeave` rather than `onClick` so hovering is enough to swap. Clear the timer ref when a new mode is requested to avoid flicker during rapid transitions.

Q: How do you add a MAU (monthly active users) metric sourced from ClickHouse to the backend metrics endpoint?
A: Add a `loadMonthlyActiveUsers` function in `route.tsx` that runs `uniqExact(user_id)` over `$token-refresh` events in the last 30 days on `analytics_internal.events`. Wrap the ClickHouse call in try/catch and return 0 on error. Add the result to `loadAuthOverview`'s return as `mau`, and in the dev fallback block set `mau: totalUsers * 0.3` when `mau === 0` to ensure the dashboard is usable in development.

Q: How should overview dashboard charts support both preset ranges and calendar-picked custom ranges?
A: In `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/(overview)/line-chart.tsx`, expand `TimeRange` to include presets (`7d`, `14d`, `30d`, `90d`, `all`) plus `custom`, add a `CustomDateRange` type, and route all date-series filtering through shared helpers (`filterDatapointsByTimeRange` and `filterStackedDatapointsByTimeRange`) that accept the optional custom range. Then pass `customDateRange` through `TimeRangeToggle`, `TabbedMetricsCard`, and metrics-page data derivations so charts and range-dependent totals stay synchronized when the user changes either preset pills or the calendar range.

Q: How should the overview custom date picker behave to avoid runtime errors when `custom` is selected?
A: Keep custom-range interaction inside the `Custom` pill flow in `TimeRangeToggle` (no separate "Pick date range" action button), seed a default range when none exists before switching to `custom`, and make range filters tolerate a temporarily missing custom range by returning unfiltered data instead of throwing.

Q: How can a custom date-range panel anchored to a pill toggle stay visually consistent with dashboard design standards?
A: Use shadcn primitives (`Popover`, `PopoverAnchor`, `PopoverContent`, `Calendar`) and style the content as a glassmorphic control surface (`rounded-2xl`, subtle border/ring, backdrop blur, compact spacing rhythm, muted header text), with customized `Calendar` classNames for range states so selection/readability stay balanced in dark mode.

Q: How should overview charts parse `YYYY-MM-DD` analytics dates without shifting a day in some timezones?
A: In `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/(overview)/line-chart.tsx`, do not use `new Date("YYYY-MM-DD")` for chart labels/tooltips because browsers interpret date-only strings as UTC. Parse those keys into local dates with `new Date(year, month - 1, day)` via a shared helper (for example `parseChartDate`) before formatting or weekend checks.

Q: How should the overview custom date picker prevent invalid future selections?
A: Normalize picker dates to local midnight and pass `disabled={{ after: latestSelectableDate }}` to the dashboard `Calendar` so users cannot select dates after today, while keeping the default seeded custom range capped at today as well.

Q: How should overview dashboard rows handle fixed chart heights across breakpoints?
A: In `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/(overview)/metrics-page.tsx`, only apply fixed row heights like `h-[340px]` at the desktop layout breakpoint (`lg:`). When a two-column chart row collapses to one column, wrap each card in a `min-h-[340px]` container so stacked charts keep a usable height instead of being squeezed into the old shared row height.

Q: How do we add Daily Active Users into the analytics chart modes while keeping the lower card focused on sign-ups?
A: In `metrics-page.tsx`, keep DAU split data as `StackedDataPoint[]`, pass a time-filtered version to `AnalyticsChartWidget` as the first in-card mode, and aggregate DAU totals into the shared `composedData` points as a `dau` field so `ComposedAnalyticsChart` can render a third line. Then remove `stackedChartData` from the lower `TabbedMetricsCard` so that card displays plain Daily Sign-Ups behavior while DAU remains in the analytics chart widget.

Q: Why can tuple corner radii on Recharts `Cell` fail TypeScript checks even though they work at runtime?
A: In dashboard charts, `Cell` props are typed broadly from SVG attributes (`radius` as `string | number`), but Recharts bar rectangles accept tuple radii like `[4, 4, 0, 0]`. For stacked bars that need per-cell top-corner rounding, keep tuple `radius` on `Cell` and document it with `@ts-expect-error` at the specific line.

Q: How can overview "recent" tabs support infinite lazy loading without adding new endpoints?
A: Return a larger bounded page from `/api/v1/internal/metrics` (for example 100 recent sign-ups/emails), then implement client-side incremental rendering in the tab list views using an `IntersectionObserver` sentinel inside the scroll container (batching e.g. 12 items at a time). This gives infinite-scroll UX while keeping backend changes minimal.

Q: How can the Top Referrers card on overview support infinite lazy loading?
A: In `metrics-page.tsx`, make the referrers list container scrollable (`min-h-0 overflow-y-auto`) and append rows incrementally via an `IntersectionObserver` sentinel (e.g. 12 rows per batch). In `internal/metrics/route.tsx`, raise the ClickHouse referrer query limit (e.g. `TOP_REFERRERS_PAGE_SIZE = 100`) so the UI has enough rows to lazy-load.

Q: Where does the shared glassmorphic chart-card shell live after the design-component refactor?
A: In `apps/dashboard/src/components/design-components/analytics-card.tsx`. It exports `DesignAnalyticsCard` (the glass card with Recharts tooltip escape), `DesignAnalyticsCardHeader` (compact header row with divider), `DesignChartLegend` (dot+label legend strip), `useInfiniteListWindow` (IntersectionObserver-based incremental list hook), and `DesignInfiniteScrollList` (a scroll container that drives `useInfiniteListWindow`). The page-local `ChartCard` wrapper in `line-chart.tsx` and all `GlassCard` clones in emails/email-drafts/email-themes pages were replaced with `DesignAnalyticsCard`.

Q: How do you fix "RefObject<HTMLDivElement | null> is not assignable to LegacyRef<HTMLDivElement>" TS errors when using useRef with JSX in React 19?
A: In React 19 with TypeScript 5.x, `useRef<T>(null)` returns `RefObject<T | null>`, but JSX `ref` props still expect `RefObject<T>`. Cast the result: `const ref = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>`. Then inside effects, cast `.current` back to `T | null` when doing null checks to avoid triggering `@typescript-eslint/no-unnecessary-condition`.

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

Q: How does the Stack Auth docs MCP relate to the ask-chat API and doc tools?
A: The public MCP (`/api/internal/mcp` on the docs site) exposes only `ask_stack_auth`, which POSTs to `/api/latest/ai/query/generate` with `tools: ["docs"]` and `systemPrompt: "docs-ask-ai"`. The backend no longer loads doc tools via MCP; `createDocsTools()` calls the docs app `POST /api/internal/docs-tools` with typed actions (same behavior as before). Optional `STACK_INTERNAL_DOCS_TOOLS_SECRET` gates the internal route; `STACK_DOCS_INTERNAL_BASE_URL` overrides the docs origin for the backend.
Q: What caused the March 19, 2026 QEMU local emulator deps startup regression?
A: The QEMU runtime path regressed when it switched from mounting `docker/local-emulator/base.env` into the runtime ISO to mounting the generated hidden file `docker/local-emulator/.env.development` instead. In testing, the `.env.development` QEMU path left cold boot stuck with only PostgreSQL healthy, while restoring the runtime ISO back to `base.env` brought deps startup back to about 12-13 seconds. The env payloads were effectively the same, so the likely issue was the QEMU runtime bundle/path handling for `.env.development`, not the actual env values.
Q: Where is the private sign-up risk engine generated entrypoint in backend now?
A: The generator script writes `apps/backend/src/private/implementation.generated.ts` (not `src/generated/private-sign-up-risk-engine.ts`), and backend runtime imports should target `@/private/implementation.generated`.

Q: Why did EventTracker throw `Reflect.get called on non-object` in JS cookie tests?
A: Partial browser mocks can expose `window` without a real `history` object. Calling `Reflect.get(historyObject, "pushState")` throws before type checks. Use normal guarded access (`Object.getOwnPropertyDescriptor(window, "history")?.value`) plus type guards for `pushState`/`replaceState`, and patch/restore methods directly without `Reflect`.

Q: How are custom handler URL target versions validated?
A: In `packages/template/src/lib/stack-app/url-targets.ts`, custom targets are only allowed for handler names listed in `customPagePrompts` (not for `handler`). For allowed pages, `version: 0` is always accepted and non-zero versions must exist in `customPagePrompts[handlerName].versions`; otherwise an error is thrown.

Q: How should `StackHandlerClient.redirectIfNotHandler` avoid SSR `window` crashes?
A: In `packages/template/src/components-page/stack-handler-client.tsx`, parse handler URLs with a placeholder origin (`http://example.com`) and avoid reading `window` on the server path. For SSR, compare only handler path shape; for browser, keep origin+path checks using `window.location.origin`.

Q: What is the current `app.urls` contract after deprecating runtime URL mutation?
A: `app.urls` is now static (`getUrls(...)` only) and no longer injects runtime `after_auth_return_to` / `stack_cross_domain_*` params from `window.location`. For navigation flows, examples and consumers should use `redirectToXyz()` methods instead (for example `redirectToSignIn()` / `redirectToSignOut()`), while tests for hosted flows should assert dynamic params on actual redirect methods, not on `app.urls`.

Q: How should the dashboard onboarding pages get a calmer "Linear-like" transition without changing flow logic?
A: In `apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/new-project/page-client.tsx`, use a shared animated stage wrapper keyed by onboarding status plus a centered hero/surface pattern for each step. The current transition is a 500ms fade-and-drop animation (`opacity` + small negative `translateY`), which keeps step changes feeling deliberate without changing the flow logic.

Q: How can onboarding CTA buttons stay visible without leaving bottom-of-page actions on every step?
A: In the current onboarding implementation, step actions are rendered by the shared `OnboardingPage` layout rather than a dedicated `OnboardingStickyTop` component in `apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/new-project/page-client.tsx`. Keep the page body focused on step content and rely on that shared layout for visible `Continue` / `Do This Later` actions instead of adding duplicated footer CTAs.
Q: How should user signup time be exposed in JWT claims before production rollout?
A: Use `signed_up_at` (OIDC-style naming) in access tokens and encode it as Unix seconds in `apps/backend/src/lib/tokens.tsx` (`Math.floor(user.signed_up_at_millis / 1000)`). Since this is pre-prod, the payload schema can require `signed_up_at` directly without a backward-compat optional shim.

Q: Where should new globally searchable Cmd+K destinations be added in the dashboard?
A: For the new Support app work, model support as generic conversations rather than support-specific threads: use `Conversation` for identity/status/source, `ConversationChannel` for adapter/entry-point expansion (`chat`, `email`, `api`, `manual`), `ConversationMessage` for message history (`message`, `internal-note`, `status-change`), and `ConversationMetadata` for assignment/tags/SLA timestamps. Keep the dashboard UI under `/projects/[projectId]/conversations` (legacy `/projects/[projectId]/support` redirects there), but point both internal admin routes and user-facing API routes at the generic `/api/latest/.../conversations` surface.
A: Support-thread contracts added during dashboard feature work are easiest to keep buildable by colocating them in the consuming app (`apps/dashboard/src/lib/*` and `apps/backend/src/lib/*`) unless the package build is already running and up to date. New files under `packages/stack-shared/src` are not automatically visible to app-local typechecks that import `@stackframe/stack-shared/dist/*` until the package dist has been regenerated.
A: Add project-level shortcuts to `PROJECT_SHORTCUTS` in `apps/dashboard/src/components/cmdk-commands.tsx` (optionally gated with `requiredApps`), and for app subpages rely on the flattened `appFrontend.navigationItems` command generation in the same file so pages are directly searchable without nested preview navigation.

Q: How should handler URL/shared interface renames be rolled out when template/backend import `@stackframe/stack-shared/dist/*`?
A: Add the new source entrypoint in `packages/stack-shared/src/interface` and update imports to the new `dist` path, but validate with package typechecks after the stack-shared dist artifacts are refreshed (for example via existing dev watchers), because consumers resolve through `dist/*` entrypoints rather than `src/*`.

Q: How are custom page prompts organized in `page-component-versions.ts` now?
A: `signIn` and `signUp` share a single `createAuthPagePrompt(type)` helper, and all remaining pages (`signOut`, `emailVerification`, `passwordReset`, `forgotPassword`, `oauthCallback`, `magicLinkCallback`, `accountSettings`, `teamInvitation`, `mfa`, `error`, `onboarding`) now use `createCustomPagePrompt(...)` with concise logical `structure` plus a React `reactExample`.

Q: What makes custom page prompt examples actionable for coding agents?
A: Avoid abstract placeholders for core flows (for example undefined section components or form primitives). In `page-component-versions.ts`, examples are most useful when they inline the section/form components and state transitions they rely on, while keeping `structure` focused on logical behavior rather than visual layout.

Q: How detailed should the Account Settings custom-page prompt be?
A: The `accountSettings` prompt should enumerate each top-level page and each subsection's exact responsibilities and API calls (emails, password, passkey, OTP, MFA, notifications, sessions, API keys, payments, settings, team pages, team creation). The example should inline section components and actions rather than referencing undefined placeholders.

Q: What should we do if dashboard typecheck fails with syntax errors in `apps/dashboard/.next/dev/types/routes.d.ts`?
A: Regenerate Next route types with `pnpm --filter @stackframe/dashboard exec next typegen` (and if needed, delete the corrupted `apps/dashboard/.next/dev/types/routes.d.ts` first). This fixes transient generated-file corruption without changing source code.

Q: What is the current `getCustomPagePrompts` API shape?
A: `getCustomPagePrompts` now takes no arguments and returns all prompts directly; call it as `getCustomPagePrompts()` instead of passing an SDK package name.
Q: Which port suffixes are assigned to the two local docs sites?
A: `docs` (old docs app) uses suffix `26`, and `docs-mintlify` uses suffix `04`. Keep these in sync across `docs/package.json`, `docs-mintlify/package.json`, `apps/dev-launchpad/public/index.html`, and `apps/dashboard/.env.development` (`NEXT_PUBLIC_STACK_DOCS_BASE_URL` points to old docs on `26`).

Q: Do analytics `$page-view` / `$click` rows in ClickHouse carry `is_anonymous` today?
A: Not by default. The client event tracker in `packages/template/src/lib/stack-app/apps/implementations/event-tracker.ts` sends page-view and click payloads without `is_anonymous`, and `apps/backend/src/app/api/latest/analytics/events/batch/route.tsx` currently inserts `event.data` unchanged into `analytics_internal.events`. Any metrics code that wants anonymous filtering for page-view/click events must either enrich those rows at ingestion time or do a time-correct join against another source.

Q: What does the current overview revenue logic count?
A: The overview metrics queries in `apps/backend/src/app/api/latest/internal/metrics/route.tsx` currently derive `daily_revenue`, `payments_overview.revenue_cents`, `payments_overview.mrr_cents`, and `analytics_overview.total_revenue_cents` from `SubscriptionInvoice.amountTotal` only. `OneTimePurchase` rows do not have an `amountTotal` column in the Prisma schema, so one-time-purchase-only projects will show zero revenue unless that amount is derived from the stored product/price snapshot and added separately.

Q: Why did the dashboard Vercel integration throw "Expected publishableClientKey" during key generation?
A: In `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/vercel/page-client.tsx`, the code always asserted `newKey.publishableClientKey` even when `project.requirePublishableClientKey` was false. Fix by only asserting/passing `publishableClientKey` when that project config flag is true.

Q: Why can restricted users appear logged out on auth handler pages even with a valid session?
A: `useUser()` filters out restricted users by default. In `packages/template/src/components-page/auth-page.tsx`, use `useUser({ includeRestricted: true })` and explicitly redirect restricted users to onboarding when `automaticRedirect` is enabled.

Q: Why can external-db-sync sequencer throw `operator does not exist: text = uuid` on team updates?
A: In `apps/backend/src/app/api/latest/internal/external-db-sync/sequencer/route.ts`, the TEAM_INVITATION cascade compares JSON text (`"VerificationCode"."data"->>'team_id'`) against `"Team"."teamId"` (`uuid`). Cast the UUID side to text (`changed_teams."teamId"::text`) in the WHERE clause so Postgres type resolution succeeds and team-invitation re-sync marking works.

Q: Why shouldn't OAuth callback retries wrap the whole `getCallback` flow?
A: The authorization code exchange (`oauthClient.callback` / `oauthCallback`) is effectively one-shot, so retrying the full callback can convert a transient downstream failure into `invalid_grant` on the next attempt. Retries should wrap only post-exchange user-info fetches (`postProcessUserInfo`) and only for transient network/timeout errors.

Q: How should OAuth callback behave when userinfo retries still fail?
A: After exhausting transient-network retries in `OAuthBaseProvider.getCallback`, capture internal diagnostics (`oauth-userinfo-retry-exhausted`) but throw `KnownErrors.OAuthProviderTemporarilyUnavailable` so clients get a user-recoverable error/redirect flow instead of an internal assertion.

Q: How should OAuth callback errors be surfaced to handler-based clients?
A: In `apps/backend/src/app/api/latest/auth/oauth/callback/[provider_id]/route.tsx`, prefer redirecting known errors to the original OAuth callback URL (`redirectUri`) with `error`, `error_description`, `errorCode`, `message`, and `details` query params (fallback to `errorRedirectUrl` if needed). In template client handling (`packages/template/src/lib/auth.ts` + `components-page/oauth-callback.tsx`), detect those params, reconstruct a `KnownError`, and route to the handler error page so users get actionable UI instead of silent sign-in redirects.

Q: How should OAuth E2E tests assert callback failures after handler-based error redirects?
A: In OAuth callback/merge strategy E2E tests, assert `307` plus parsed `location` query params (`error`, `errorCode`, `error_description`, `message`, and optionally `details`) instead of snapshotting old `4xx` JSON error responses. This matches current callback semantics and avoids brittle encoded-URL snapshots.

Q: How should auth sign-up-rules OAuth rejection tests assert failures now?
A: In `apps/e2e/tests/backend/endpoints/api/v1/auth/sign-up-rules.test.ts`, OAuth rejection cases should assert the callback redirect (`307`) and validate `location` query params (`error=server_error`, `errorCode=SIGN_UP_REJECTED`, `message`/`error_description`, and JSON `details`) rather than expecting direct `403` response bodies.

Q: Where is the docs-mintlify homepage hero/island content defined?
A: The top homepage island on docs-mintlify is authored directly in `docs-mintlify/index.mdx` as the first `not-prose` block, so copy/design/CTA updates should be made there.

Q: Why can a docs-mintlify snippet fail validation when importing React?
A: `mint validate` rejects non-local imports in `/snippets/*.jsx` (for example `import { useState } from "react"`), so snippets must avoid package imports and rely on zero-import component code.

Q: Where was the docs homepage Quick Start block defined?
A: The Quick Start section on the docs-mintlify homepage lived directly in `docs-mintlify/index.mdx` right after `<HomePromptIsland />`, so removing that full `<div className="mx-auto mt-16 ...">` block removes the entire Quick Start UI.

Q: How is the docs homepage "Explore Apps" step now rendered?
A: It is embedded inside the "Navigate Through Our Docs" timeline as a single step via `DocsAppsHomeGrid` from `docs-mintlify/snippets/docs-apps-home-grid.jsx`, using app icon SVGs in a dashboard-style quick-access grid.

Q: Why did docs-mintlify throw `ReferenceError: agentSetupPromptPlaceholder is not defined` on the homepage?
A: In snippet components (`/snippets/*.jsx`), top-level constants can fail to resolve in the runtime-compiled output; moving constants like `agentSetupPromptPlaceholder` and `appLinks` inside the exported component function avoids the reference error.

Q: How was the docs homepage prompt island restyled for stronger contrast?
A: `docs-mintlify/snippets/home-prompt-island.jsx` now uses an inverted minimal palette (`bg-[#0b0b0d]` in light mode and `dark:bg-zinc-50` in dark mode) with simplified borders, reduced visual effects, and custom button styles for cleaner contrast.

Q: Why did `DocsAppsHomeGrid` throw `ReferenceError` for helper functions despite passing lint?
A: In docs-mintlify snippets, top-level helper function references can disappear in the runtime-compiled output even when `mint validate` passes; keep helper functions/constants inside the exported component body to avoid runtime `ReferenceError`s.

Q: How to ensure the manual-installation CTA remains visible on the inverted dark-mode hero?
A: In `docs-mintlify/snippets/home-prompt-island.jsx`, force explicit dark-mode button contrast with strong dark variant classes (for example `dark:bg-zinc-100` and `dark:!text-zinc-900`) so Mintlify base link styles cannot wash out label text.

Q: How can the docs homepage prompt feel compact while still implying multi-line content?
A: In `docs-mintlify/snippets/home-prompt-island.jsx`, use a low-height read-only textarea (`h-28`) with `overflow-hidden`, place the copy button as an absolute suffix inside the field, and add a bottom gradient overlay to hint hidden lines.

Q: Where is the docs homepage recommended-order timeline controlled?
A: The ordered step blocks are authored directly in `docs-mintlify/index.mdx` inside the "Navigate Through Our Docs" section, so adding steps like `SDK Reference` and `REST API` is done by inserting new timeline `<div className="relative ...">` blocks there.

Q: Why can the docs copy button throw `Cannot set properties of null (setting 'textContent')`?
A: In `docs-mintlify/snippets/home-prompt-island.jsx`, reading `event.currentTarget` after `await navigator.clipboard.writeText(...)` can produce null in runtime event wrappers. Capture `const button = event.currentTarget` before awaiting.

Q: How should the docs Explore Apps grid support both light and dark themes?
A: In `docs-mintlify/snippets/docs-apps-home-grid.jsx`, use light-first container/tile styles with explicit `dark:*` overrides (including `dark:invert` for icons) so light mode remains readable while dark mode keeps the neon tile look.

Q: How can docs-mintlify add an Apps sidebar filter without React hooks?
A: In `docs-mintlify/snippets/docs-apps-home-grid.jsx`, inject a compact `<input>` under the sidebar "Apps" header via DOM (`#navigation-items` + `.sidebar-group-header` text match), filter that group's `<ul>` rows on `input`, and observe `document.documentElement.classList` with `MutationObserver` to swap light/dark inline styles when `html` toggles between `light` and `dark`.

Q: Why did Explore Apps look light in dark mode even with `dark:bg` set on the container?
A: `bg-gradient-to-b` applies a background image, and `dark:bg-[#...]` only changes background color, so the light gradient image stays visible. Use `dark:from[...] dark:to[...]` (or a full dark gradient/image override) so dark mode replaces the gradient itself.

Q: What should we do when changing docs sidebar search injection from block to inline?
A: Remove legacy `div[data-apps-sidebar-search='true']` nodes before adding the new inline header input; otherwise old and new filters can coexist after hot reload and render duplicate search boxes.

Q: What caused the Explore Apps hover layout shift?
A: The app link wrapper in `docs-mintlify/snippets/docs-apps-home-grid.jsx` used `hover:-translate-y-0.5`, which makes tiles physically move on hover and looks like layout jank. Removing the translate/transform from the wrapper keeps hover effects without perceived shifting.

Q: How should the sidebar Apps filter behave when there are no matches?
A: In `docs-mintlify/snippets/docs-apps-home-grid.jsx`, track visible rows while filtering and show a small inline empty state (`No more results. Clear filter`) when query is non-empty and visible count is zero; wire `Clear filter` to reset the input, rerun filtering, and refocus the input.

Q: Why did internal feedback E2E tests expect 1 Inbucket message but get 2?
A: Inbucket persists mail across runs. `Mailbox.waitForMessagesWithSubject` waits until at least one match then returns **all** messages whose subject includes the string. Fixed subjects like `[Support] devtool-user@example.com` accumulate, so assertions should use a unique subject per run (e.g. `randomUUID()` in the sender email) or a baseline count before/after.

Q: Why does `@typescript-eslint/no-unnecessary-condition` fire on `props.reset` in Next.js `ErrorBoundary` `errorComponent`?
A: Next’s typings treat `reset` as always present on the error component props, so `props.reset &&` is redundant; render the reload control unconditionally and call `props.reset()` directly.

Q: Why do E2E payment tests fail when run in parallel but pass individually?
A: The Bulldozer advisory lock (`pg_advisory_xact_lock` in `toExecutableSqlTransaction`) serializes ALL Bulldozer writes globally. Each dual-write triggers an 848KB SQL cascade that holds the lock. When dozens of E2E tests run concurrently, each creating users/products/purchases, the lock contention causes tokens to expire and requests to timeout. Running payment tests independently avoids this.

Q: Why did we remove `type` and `subscription` from the list products API response?
A: Product ownership is independent of how you acquired the product (subscription vs OTP). A customer could own the same product via both. The old response conflated "what do I own" with "how did I get it." The simplified response returns just `{ id, quantity, product, switch_options }`. Subscription management info (cancel, period end) is a separate concern.

Q: How does validatePurchaseSession work now?
A: It reads from Bulldozer-backed functions: `getOwnedProductsForCustomer` (LFold), `getSubscriptionMapForCustomer` (subscription LFold). Steps: 1) ensureCustomerExists, 2) resolve price, 3) stackability check, 4) fetch owned products once, 5) duplicate check via `customerOwnsProduct`, 6) add-on prerequisite check, 7) product-line conflict detection + find cancelable subscriptions. If conflict exists but no subscription to cancel, throws "already has OTP in product line."

Q: When does syncStripeSubscriptions set endedAt?
A: When `subscription.status === "canceled"` and `sanitizedDates.end <= new Date()` (period has already ended). This triggers TimeFold to emit subscription-end events which revoke the product and expire items.

Q: Why can dashboard onboarding clicks trigger `Cannot call this function on a Stack app without a persistent token store` dev toasts?
A: `useOwnedProjects()` creates each `AdminOwnedProject["app"]` with `tokenStore: null`, but `packages/template/src/lib/stack-app/apps/implementations/client-app-impl.ts` used to start browser `EventTracker` unconditionally. Clicking onboarding controls queued tracked events, and the flush later threw when analytics tried to resolve a session. Fix by only starting browser event/replay tracking when the app has a persistent token store.

Q: Why can "Link Existing -> Load Repositories" fail even when a GitHub connected-account row exists?
A: In `link-existing-onboarding.tsx`, GitHub API calls require a usable provider access token from `connectedAccount.getAccessToken()`. If token retrieval fails, the UI intentionally errors with "Could not get a GitHub access token. Reconnect your GitHub account and try again." and repository/branch selectors remain disabled.

Q: What should GitHub `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` use for `workflow_id`?
A: Use the workflow **file name** (e.g. `stack-auth-config-sync.yml`), not a path like `.github/workflows/...`. Paths with slashes are rejected or mis-resolved by the API.

Q: How should the dashboard load `stack.config` path suggestions after picking a GitHub branch without stale React state?
A: Have `loadBranches` return the resolved branch string, then call `loadConfigSuggestions({ repository, branch })` from the Continue handler with those explicit values instead of relying on `setState` having flushed before the tree fetch runs.

Q: How can PR review threads be resolved from the CLI when fixing bot comments?
A: Use GitHub GraphQL via `gh api graphql` with `resolveReviewThread(input:{threadId: ...})`; list unresolved thread IDs first from `pullRequest.reviewThreads` and then resolve only the IDs tied to fixes you actually made.

Q: How does the payments bulldozer pipeline work end-to-end?
A: Stored tables (subscriptions, OTPs, manual item changes, manual transactions, subscription invoices) are written via dual-write (`bulldozerWriteX` functions). Phase 1 derives events via TimeFold (subscription-start, subscription-end, item-grant-repeat) and filters (subscription-cancel, one-time-purchase). Phase 2 compacts transaction entries. Phase 3 produces owned products (LFold) and item quantities. The TimeFold initial run (T=null) is synchronous within the setRow transaction; only future events (item-grant-repeat at next billing cycle) are queued. Reads go through `customer-data.ts` which queries the Phase 3 LFold tables.

Q: What is the difference between canceled and ended for subscriptions?
A: Canceled (`cancelAtPeriodEnd: true`) means the subscription won't renew but still grants products until the period ends. Ended (`endedAt` is set) means the subscription has actually stopped providing access — the TimeFold emits `subscription-end` which generates `product-revocation` entries. For Stripe subs, only `syncStripeSubscriptions` should set `endedAt` (Stripe is the authority). For test-mode (non-Stripe) subs, `endedAt` is set directly in the route. Terminal Stripe statuses that also need `endedAt`: `incomplete_expired`, `unpaid`.

Q: How does the BulldozerStorageEngine keyPathParent column work?
A: Originally a `GENERATED ALWAYS AS` stored column with a self-referential FK. Migration `20260415100000` converted it to a trigger-maintained column (`bulldozer_key_path_parent_trigger`) to resolve Prisma schema drift (Prisma's `Unsupported` type can't represent generated columns). The trigger computes `keyPath[1:cardinality(keyPath)-1]` on INSERT/UPDATE. Test files still use the generated column DDL in their isolated DBs.

Q: How does the migration runner handle multi-statement SQL?
A: Non-single-statement migrations are wrapped in `DO $$ BEGIN ... END $$`. If your migration SQL contains dollar-quoted function bodies, use a different delimiter (e.g., `$func$` instead of `$$`) to avoid conflicts with the outer wrapper.

Q: How can I run a single backend Bulldozer Vitest case when the default threads pool errors with `options.minThreads and options.maxThreads must not conflict`?
A: Run the test from the monorepo root with forks pool, for example: `pnpm test run apps/backend/src/lib/bulldozer/db/index.test.ts -t "setRow/init/delete SQL generation is deterministic on a mixed schema" --pool=forks`.

Q: Why can payments schema tests fail typecheck after switching to explicit `executionContext` arguments in `listRowsInGroup` helpers?
A: Function parameter types are checked contravariantly, so helper signatures like `(ctx: unknown, opts: any)` are too wide and not assignable to table methods that require `BulldozerExecutionContext`. Type helper tables as `listRowsInGroup: (ctx: BulldozerExecutionContext, opts: any) => any` and pass the same `executionContext` variable through all calls.

Q: What breaks when bulldozer tests stop using `bindTableToExecutionContext` wrappers?
A: Any trigger callbacks written as `(changesTable) => ...` can fail against the strict `RowChangeTriggerInput` signature once wrappers are removed. Update those callbacks to explicit two-arg form like `(_ctx, changesTable) => ...`, and make helper types (for example table facades and lifecycle instrumentation helpers) use ctx-first method signatures so all table API calls pass `executionContext` explicitly.

Q: How should `x-stack-override-error-status` behave in backend smart responses?
A: In `apps/backend/src/route-handlers/smart-response.tsx`, only override `4xx` responses to `200` with `x-stack-actual-status`. Do not override `5xx`, so infrastructure/runtime failures still surface as real server errors.

Q: Why can `email-queue-step` heap growth still point at `app-page-turbo.runtime.dev.js` after disabling React async debug info in `react-server-dom-*` bundles?
A: Next.js dev app-page runtimes (`app-page*.runtime.dev.js`) include their own inlined async debug hook (`async_hooks.createHook`) with `pendingOperations` nodes plus stack-frame arrays from `collectStackTracePrivate`. Patching only `react-server-dom-*` is not enough. Gate the app-page runtime hook with `STACK_DISABLE_REACT_ASYNC_DEBUG_INFO` too; once gated, inspector allocation samples stop showing `init`/`collectStackTracePrivate` in `app-page-turbo.runtime.dev.js` and per-burst retained deltas drop from multi-MB to near-baseline noise.

Q: How can we replace the huge `next@16.1.7` patch file with a resilient install-time rewrite?
A: Use a strict root `postinstall` script that rewrites only Next `>=16` app-page dev runtime bundles (`app-page*.runtime.dev.js`) from `doNotLimit=new WeakSet;async_hooks.createHook(` to the guarded `STACK_DISABLE_REACT_ASYNC_DEBUG_INFO` form. Guardrails should fail loud on marker mismatches, mixed guarded/unguarded states, replacement counts not equal to one, or missing runtime fingerprints; the script should also be idempotent (`patched=0, alreadyPatched>0` on second run).

Q: Why can Turbo-pruned Docker builds fail with `Cannot find module /app/scripts/postinstall-patch-next-async-debug-info.mjs` during `pnpm install`?
A: In pruned builder stages, we copy `/app/out/json` and run `pnpm install` before copying `/app/out/full`. The root `package.json` still runs `postinstall: node ./scripts/postinstall-patch-next-async-debug-info.mjs`, but that script is not present yet. Fix by copying `scripts/postinstall-patch-next-async-debug-info.mjs` into the builder stage before `pnpm install` (for all Dockerfiles using the prune pattern).

Q: When does a managed conversation’s `status` move between `open` and `pending` without an explicit status PATCH?
A: `appendConversationMessage` in `apps/backend/src/lib/conversations.tsx` updates `Conversation.status` in the same transaction as the new row: a user-visible **agent** `message` on an `open` thread sets `pending` (waiting on user); a user `message` on a `pending` thread sets `open` (needs support). **Internal notes** do not change status. **`closed` is unchanged** by message appends—reopen/close stays explicit via `updateConversationStatus`. No extra `status-change` message row is written for these automatic transitions (only the `status` column updates) so inbox previews stay tied to the latest real message.
