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

Q: How should user signup time be exposed in JWT claims before production rollout?
A: Use `signed_up_at` (OIDC-style naming) in access tokens and encode it as Unix seconds in `apps/backend/src/lib/tokens.tsx` (`Math.floor(user.signed_up_at_millis / 1000)`). Since this is pre-prod, the payload schema can require `signed_up_at` directly without a backward-compat optional shim.

Q: Where should new globally searchable Cmd+K destinations be added in the dashboard?
A: Add project-level shortcuts to `PROJECT_SHORTCUTS` in `apps/dashboard/src/components/cmdk-commands.tsx` (optionally gated with `requiredApps`), and for app subpages rely on the flattened `appFrontend.navigationItems` command generation in the same file so pages are directly searchable without nested preview navigation.
