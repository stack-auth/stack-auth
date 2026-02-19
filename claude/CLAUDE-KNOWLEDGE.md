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
