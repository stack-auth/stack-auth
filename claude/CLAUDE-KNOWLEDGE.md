# CLAUDE Knowledge Base

Q: How are the development ports derived now that NEXT_PUBLIC_STACK_PORT_PREFIX exists?
A: Host ports use `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}29`, POP3 `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}30`, and OTLP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}31` by default).

Q: How can I show helper text beneath metadata text areas in the dashboard?
A: Use the shared `TextAreaField` component's `helperText` prop in `apps/dashboard/src/components/form-fields.tsx`; it now renders the helper content in a secondary Typography line under the textarea.

Q: Why did `pnpm typecheck` fail after deleting a Next.js route?
A: The generated `.next/types/validator.ts` can keep stale imports for removed routes. Deleting that file (or regenerating Next build output) clears the outdated references so `pnpm typecheck` succeeds again.

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
