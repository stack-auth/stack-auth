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

Q: How should ledger transaction generation stay extensible while supporting repeat events?
A: A single event-engine file with typed seed events + a deterministic priority queue + per-event handlers keeps logic clean; store active grant slices (`txId`, `entryIndex`, `quantity`) so expiries can always reference exact adjusted entries, including chained repeat renewals.

Q: What's a robust way to split long ledger transaction code into a folder?
A: Separate by concern: `types.ts` (state/event contracts), `queue.ts` (priority queue), `seed-events.ts` (DB-to-seed mapping), `helpers-core.ts` (pure utilities), `processor.ts` (event handlers), `list.ts` (pagination/list API), and `index.ts` (public exports).

Q: How should `getItemQuantityForCustomer` handle `default-product-item-expire` entries when the matching default grant was filtered due to a conflicting paid product?
A: Skip that expiry entry instead of throwing. For default products, grant/expiry events can be generated while the default is inactive; if the corresponding grant was intentionally not applied, its expiry must also be ignored to keep ledger processing consistent.

Q: Why can include-by-default products still appear during paid ownership of the same product line in playground mocks?
A: Some mock/default snapshots may store `productLineId` (camelCase) instead of `product_line_id` (snake_case). Normalize snapshot products at ledger read time and treat paid-line transitions as suppression/restoration points for active default item grants, so defaults are removed while paid line ownership is active and restored when it ends.
