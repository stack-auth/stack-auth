# CLAUDE Knowledge Base

Q: How are the development ports derived now that NEXT_PUBLIC_STACK_PORT_PREFIX exists?
A: Host ports use `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}29`, POP3 `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}30`, and OTLP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}31` by default).

Q: How can I show helper text beneath metadata text areas in the dashboard?
A: Use the shared `TextAreaField` component's `helperText` prop in `apps/dashboard/src/components/form-fields.tsx`; it now renders the helper content in a secondary Typography line under the textarea.

Q: Why did `pnpm typecheck` fail after deleting a Next.js route?
A: The generated `.next/types/validator.ts` can keep stale imports for removed routes. Deleting that file (or regenerating Next build output) clears the outdated references so `pnpm typecheck` succeeds again.

Q: How can I attach changelog bullet metadata to rendered Markdown without mutating render-time state?
A: Generate a remark plugin for the entry that walks the Markdown AST once before rendering, annotates each `listItem` node with the corresponding metadata object, and then read that metadata from the custom `li` renderer in ReactMarkdown. This keeps React renders pure and still pairs tags with their bullets deterministically.

Q: What happened to the standalone changelog app?
A: We removed `apps/changelog` entirely and now rely solely on the root-level `CHANGELOG.md`, which future work will fetch from GitHub via a server component with hourly revalidation. All other `CHANGELOG.md` copies across the repo were deleted so the root file is the single source of truth.
