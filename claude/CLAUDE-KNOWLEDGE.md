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

Q: What should `getSpoofableEndUserLocation()` return for normal browser/proxy traffic?
A: It should return location fields from `spoofedInfo` when `getEndUserInfo()` reports `maybeSpoofed: true`, and from `exactInfo` otherwise. Returning only exact info drops country data for the normal header-derived browser path and breaks geo-based signup rules.

Q: How should nullable signup-rule context inputs be typed?
A: If a field already uses `null` to represent absence, keep it non-optional and pass explicit `null` at callsites. In practice, `createSignUpRuleContext` and signup-rule option plumbing should use `countryCode: string | null` and `ipAddress: string | null`, not `?: ... | null`, so `undefined` never leaks into the flow.

Q: What shape should `/api/v1/internal/sign-up-rules-test` use for optional-looking inputs?
A: `email`, `country_code`, and `oauth_provider` can be explicit `string | null`, but `risk_scores` should never use nullable score values. For admin tester overrides, either omit `risk_scores` entirely to derive scores server-side or provide both numeric fields as concrete integers.

Q: Where is signup country code stored and exposed for dashboard user details?
A: Persist the best-effort signup country on `ProjectUser.countryCode`, expose it as `country_code` on the server user CRUD read shape, map it to `ServerUser.countryCode` in `packages/template`, and render it as a read-only field in the dashboard user details page.

Q: Is there a deterministic email-based stub for signup country in local/test flows?
A: No. `apps/backend/src/lib/users.tsx` now derives signup country only from request geo (normalized and validated); if geo is missing or invalid, it stores `null` instead of inferring a country from the email address.

Q: How should anonymous-user signup upgrades handle an existing `country_code`?
A: Preserve a non-null `currentUser.country_code` when upgrading an anonymous user in `createOrUpgradeAnonymousUserWithRules`. Only write a newly derived/signup-provided country code when the anonymous user does not already have one.

Q: How should the dashboard signup-rule builder validate `countryCode in_list`?
A: Treat an empty list as invalid in `apps/dashboard/src/components/rule-builder/condition-builder.tsx`; otherwise `countryCode in []` can be saved and silently makes that condition always false.

Q: Who is allowed to set `risk_scores` and `country_code`?
A: Customers/admins can set them through server/admin user create and update surfaces, the server SDK `createUser`/`update`, the dashboard admin create flow, and the internal sign-up-rules tester. End users still cannot set them themselves because `current-user` client update schemas do not expose those fields.

Q: Where should country-code validation and normalization live?
A: Keep the canonical ISO alpha-2 list and normalization helpers in `packages/stack-shared/src/utils/country-codes.ts`, then build `countryCodeSchema` in `packages/stack-shared/src/schema-fields.ts` on top of that. Backend signup derivation, CRUD/internal-route schemas, dashboard forms, the rule builder, CEL serialization, and `getFlagEmoji` should all flow through that shared source instead of ad hoc regexes or `trim().toUpperCase()` copies.

Q: Why can `pnpm dev` fail immediately after adding a new `@stackframe/stack-shared` source entry?
A: The monorepo dev stack reads `packages/stack-shared/dist` immediately. If a new source entry like `src/utils/country-codes.ts` is referenced by existing dist files before `@stackframe/stack-shared` has been rebuilt, backend/dashboard can crash with `ERR_MODULE_NOT_FOUND`. Run `pnpm --filter @stackframe/stack-shared build` so the new dist artifacts exist before relying on the watcher.

Q: How should the dashboard signup-rule builder collect `countryCode` values?
A: In `apps/dashboard/src/components/rule-builder/condition-builder.tsx`, single-value `countryCode` operators (`equals`, `does not equal`) should use a dropdown sourced from `ISO_3166_ALPHA_2_COUNTRY_CODES` re-exported by `schema-fields`, and `is one of` should render repeated country-code dropdowns with add/remove controls while still storing a `string[]`.

Q: What must raw `ProjectUser` SQL fixtures include after sign-up risk scores were added?
A: Any direct `INSERT INTO "ProjectUser"` path that bypasses the CRUD layer must write `"signUpRiskScoreBot"` and `"signUpRiskScoreFreeTrialAbuse"` explicitly, usually as `0, 0`. The migration intentionally removed the temporary DB defaults, so external-db-sync/performance fixtures that omit those columns can fail with `null value in column "signUpRiskScoreBot" violates not-null constraint`.

Q: Where should disposable-email fraud detection live for this PR?
A: Put it in `apps/backend/src/lib/risk-scores.tsx` as a weighted sign-up heuristic pipeline that outputs `risk_scores`, and keep the sign-up rules engine unchanged. For the current slice, derive bot/free-trial-abuse scores from regex matches against disposable-looking email domains.

Q: Why did `internal-metrics.test.ts` snapshots change after adding signup country and risk scores?
A: The internal metrics response now includes the server user fields `country_code` and `risk_scores` inside `recently_active`/`recently_registered`, so `apps/e2e/tests/backend/endpoints/api/v1/__snapshots__/internal-metrics.test.ts.snap` must be updated whenever those user read-shape fields change.

Q: How should recent-signup abuse heuristics persist signup-only correlation facts?
A: Keep the public `risk_scores` API unchanged and persist private, immutable signup facts directly on `ProjectUser`: a real-signup timestamp (`signUpHeuristicRecordedAt`), normalized signup IP (`signUpIp`), signup IP trust (`signUpIpTrusted`), normalized email identity (`signUpEmailNormalized`), and base email pattern (`signUpEmailBase`). Compute them centrally in `createOrUpgradeAnonymousUserWithRules`, then query them from `apps/backend/src/lib/risk-scores.tsx` so the scoring pipeline can stay deterministic without relying on mutable user fields or session rows.

Q: How should recent-signup heuristic lookups be optimized on `ProjectUser`?
A: In `apps/backend/src/lib/risk-scores.tsx`, do not use open-ended `COUNT(*)` when the logic only needs to know whether recent matches reached a configured threshold. Instead, fetch up to the threshold and compare `rows.length`. Back that with composite indexes on `ProjectUser` ordered as `(tenancyId, signUpIp, signUpHeuristicRecordedAt)` and `(tenancyId, signUpEmailBase, signUpHeuristicRecordedAt)`, added in a separate concurrent migration because `ProjectUser` is large.

Q: How should Emailable be shared between email delivery and signup fraud scoring?
A: Put the vendor call in a shared helper at `apps/backend/src/lib/emailable.tsx` using the existing `STACK_EMAILABLE_API_KEY` and the test fallback domain `emailable-not-deliverable.example.com`. Keep email sending fail-open on Emailable errors in `apps/backend/src/lib/email-queue-step.tsx`, but let `apps/backend/src/lib/risk-scores.tsx` treat Emailable request failures as a max-risk match for the disposable-email heuristic.

Q: How should tests clear auth between repeated signup cases?
A: In long-running backend E2E cases, prefer `backendContext.set({ userAuth: null })` over `Auth.signOut()` when you only need to clear the client session. `Auth.signOut()` asserts a snapshot against a live access token and can fail if the token expired during a slower suite.

Q: What needs to happen before replacing renamed signup-heuristic raw SQL with Prisma ORM calls?
A: Regenerate the backend Prisma client first. After renaming the persisted `ProjectUser` signup heuristic fields to `signUpIp`, `signUpEmailNormalized`, and `signUpEmailBase`, `apps/backend/src/generated/prisma` can still reference the old names until `pnpm --dir apps/backend run codegen-prisma` runs. Only after that will `prisma.projectUser.update(...)` and `findMany(...)` typecheck cleanly in `apps/backend/src/lib/users.tsx` and `apps/backend/src/lib/risk-scores.tsx`.

Q: Should the backend use Emailable's official SDK directly?
A: Yes. The official package is `emailable` (`https://github.com/emailable/emailable-node` / npm `emailable`) and `apps/backend` can use it instead of a hand-rolled HTTP client. But its published TypeScript surface is extremely loose (`Promise<any>` / `options?: {}`), so keep local runtime validation in `apps/backend/src/lib/emailable.tsx` and inject a fake client in unit tests instead of trusting the SDK types.

Q: Where should the sign-up risk-score shape come from?
A: Reuse the shared CRUD schema in `packages/stack-shared/src/interface/crud/users.ts`. Export `riskScoreFieldSchema`, `signUpRiskScoresSchema`, and the inferred `SignUpRiskScoresCrud` type there, then import them into backend code instead of re-declaring the same `bot` / `free_trial_abuse` shape in `apps/backend/src/lib/risk-scores.tsx` or internal route schemas.
