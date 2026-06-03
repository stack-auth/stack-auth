# Hexclave Rename — PR 5 Plan (internal symbol & path cleanup)

Branch: `cl/hexclave-rename-pr5`

PR 5 finishes the **internal, non-wire** half of the Stack→Hexclave rename. PRs 1–3 + follow-ups already shipped the compatibility layer (wire dual-accept, env dual-read, `@hexclave/*` packages, public `Hexclave*` aliases, dual cookies, dual domains). PR 5 renames things that are **safe because nobody outside the repo depends on the exact name**: internal symbols, directory/file names, internal variables, and residual brand strings. It must NOT touch wire/compat identifiers or external-facing names.

Generated SDK packages (`packages/js`, `packages/react`, `packages/stack`, `packages/tanstack-start`) are **copied from `packages/template`** by `scripts/generate-sdks.ts` — only edit `packages/template`, then run `pnpm -w run generate-sdks`.

---

## Scope decisions (maps the 12-section review feedback)

| # | Area | Decision |
|---|---|---|
| 1 | Package **directory** names (`packages/stack*`) | **Rename all** dirs → `hexclave`-based names |
| 2 | `@stackframe/template`, `@stackframe/init-stack` | Rename `@stackframe/template` → **`@hexclave/template`**; **delete `packages/init-stack/` entirely** (deprecated) |
| 3 | Source dirs (`lib/stack-app`, `stack-companion`, `apps/.../stack/`); `skills/stack-auth` | **Rename all**; `skills/stack-auth` → **`skills/hexclave`** directly |
| 4 | Source **files** with `stack` basename; logo assets | **Rename all** code files. **KEEP `stack-auth-logo*.svg`** (verified: used intentionally by the rebrand modal as the old logo) |
| 5 | Public SDK `Stack*` aliases | **No action** (kept as deprecated aliases) |
| 6 | Internal-only `Stack*` symbols + camelCase/infix internal vars | **Rename all** (incl. newly-discovered `stackGlobalsSymbol`-class identifiers) |
| 7 | `x-stack-*` HTTP headers | **No action** (dual-accept forever) |
| 8 | Cookies / storage / DOM / postMessage | **Rename what's safe-to-reset** (UI-only local state); **keep compat** for anything persisted/cross-version |
| 9 | `STACK_PORT_PREFIX` | Env var already renamed (0 refs left). **Rename the internal `stackPortPrefix` / `expandStackPortPrefix` / `replaceStackPortPrefix` vars/fns** |
| 10 | `doctor.ts`, `init` prompt | **Update** stale `stack.config.ts`-only references to prefer `hexclave.config.ts` |
| 11 | `*.stack-auth.com` domains | **No action** (compat) |
| 12 | Brand strings | **Update** `"Stack Auth"`/`"Stack dashboard"` prose in code (incl. newly-found `known-errors.tsx`, backend messages) |

---

## A. Directories to rename (§1, §3)

| Current | New |
|---|---|
| `packages/stack` (npm `@hexclave/next`) | `packages/next` |
| `packages/stack-shared` (`@hexclave/shared`) | `packages/shared` |
| `packages/stack-ui` (`@hexclave/ui`) | `packages/ui` |
| `packages/stack-sc` (`@hexclave/sc`) | `packages/sc` |
| `packages/stack-cli` (`@hexclave/cli`) | `packages/cli` |
| `packages/template` (→ `@hexclave/template`) | `packages/template` (dir name fine; npm name changes) |
| `**/src/lib/stack-app/` (template + generated) | `**/src/lib/hexclave-app/` |
| `apps/dashboard/src/stack/` | `apps/dashboard/src/hexclave/` |
| `apps/dashboard/src/components/stack-companion/` (+ `stack-companion.tsx`) | `…/hexclave-companion/` |
| `skills/stack-auth/` | `skills/hexclave/` |
| `app/handler/[...stack]/` (dashboard, internal-tool, all `examples/*`) | `app/handler/[...hexclave]/` — **DECIDED: rename** |

**Decided (review):** directory names **drop the `stack-` prefix** to match the npm names — `packages/{next,shared,ui,sc,cli}`.

**`[...stack]` → `[...hexclave]`** is internal/cosmetic: it changes the Next.js catch-all **param key** (`params.stack` → `params.hexclave`), NOT the public `/handler/*` URL. Update the param read site in the handler (`packages/template/src/components-page/*handler*.tsx`) and every `examples/*/.../handler/[...stack]/page.tsx` in lockstep. Public URLs are unchanged, so no wire/compat risk.

**Do NOT rename**: `sdks/implementations/swift/Sources/StackAuth/` (frozen Swift package).

Each dir rename ripples into: `tsconfig.json` path aliases, `pnpm-workspace.yaml`, `turbo.json`, import specifiers (mostly already `@hexclave/*` so unaffected), `scripts/generate-sdks.ts` source/dest paths, and any relative imports. Use `git mv`; then sweep references.

---

## B. Package renames / deletions (§2)

1. **`@stackframe/template` → `@hexclave/template`**: update `packages/template/package.json` `name`; update the ~3 dependents that reference `@stackframe/template` (find: `rg '@stackframe/template'`), `scripts/generate-sdks.ts`, any tsconfig path. It's never published, so no npm impact.
2. **Delete `packages/init-stack/`**: remove the directory and de-wire all references —
   - `pnpm-workspace.yaml`, root `package.json` scripts (`init-stack:local` etc.), `turbo.json`
   - any CI workflow referencing it
   - dashboard onboarding / docs that point at `npx @stackframe/init-stack` (onboarding already moved to `@hexclave/cli init`)
   - The already-published `@stackframe/init-stack` npm package stays on npm (can't/shouldn't unpublish) — that's fine; we just stop building it.
   - **Migrate-or-confirm**: a few helper names live here (`getStackPackageName`, `StackAppFile*` types, `MCP_SERVER_NAME`, `EVENT_PREFIX="stack-init-"`). Confirm nothing still-shipping imports from init-stack before deletion (`rg 'init-stack'`).

---

## C. Files to rename (§4)

Edit in `packages/template` (regenerated to SDKs):
- `components-page/stack-handler.tsx` → `hexclave-handler.tsx`; `stack-handler-client.tsx` → `hexclave-handler-client.tsx`
- `providers/stack-context.tsx` → `hexclave-context.tsx`; `stack-provider.tsx` → `hexclave-provider.tsx`; `stack-provider-client.tsx` → `hexclave-provider-client.tsx`

Apps:
- `apps/backend/src/stack.tsx` → `hexclave.tsx`
- `apps/internal-tool/src/stack.ts` → `hexclave.ts`
- `apps/dashboard/src/lib/stack-app-internals.ts` → `hexclave-app-internals.ts`
- `apps/dashboard/src/components/stack-companion.tsx` → `hexclave-companion.tsx` (with dir rename in §A)

**KEEP (do not rename/delete):**
- `apps/dashboard/public/stack-auth-logo.svg`, `stack-auth-logo-bright.svg` — **old logo shown on purpose** in `hexclave-rebrand-modal.tsx`.
- `.github/assets/stack-webhooks.png` — only if it still depicts current product; low priority, leave unless re-capturing.

---

## D. Internal symbols & variables to rename (§6, §9)

All internal-only (not exported from any customer entrypoint). `Stack* → Hexclave*`, `stack* → hexclave*`.

**`packages/stack-shared` (→ `packages/shared`):**
- `stackGlobalsSymbol` (`utils/globals.tsx`) — the `Symbol.for("__stack-globals")` **string is already `__hexclave-globals`**; rename just the JS const.
- `stackCapturedErrors` (`utils/errors.tsx`), `stackFs` (`utils/fs.tsx`), `stackPortPrefix` (`utils/redirect-urls.tsx`), `stackDevEnvStatePath` (`utils/dev-env-state-path.ts`)
- `stackAuthHost` (loop var) + `stackAuth` (return-object key) in `utils/cloud-hosts.tsx` — internal shape, paired with a `hexclave` key; safe.
- `stackAuthUser` / `stackAuthUserId` (`utils/featurebase.tsx`), `StackAuthUser` type
- yup `.meta()` keys: `stackSchemaInfo`, `stackConfigCanNoLongerBeOverridden`, `stackAllowUserIdMe`, `StackAdaptSentinel` (`schema-fields.ts`, `config/schema.ts`) — internal metadata, renameable in lockstep
- `stackApp` / `stackServerApp` local vars in `interface/page-component-versions.ts`
- ⚠️ **`showOnboardingStackConfigValue`** — rename the **identifier**, but VERIFY its string *value* isn't persisted in DB config rows before changing the value (rename name only if value is persisted).

**`packages/template` (regenerate after):**
- `stackAppInternalsSymbol` const (`lib/stack-app/common.ts`) — rename the const; **keep the dual `Symbol.for("StackAuth--…")` + `Symbol.for("Hexclave--app-internals")` strings** (customer-visible, dual-attach).
- `_StackClientAppImplIncomplete`, `_StackServerAppImplIncomplete`, `_StackAdminAppImplIncomplete`, `_StackClientAppImpl`/`Server`/`Admin`, `LazyStackAdminAppImpl` (impl classes/index)
- `StackContext` (`providers/stack-context.tsx`), `StackContextValue`, `StackProviderClient`, `StackHandlerClient`, `StackHandlerProps`, `StackSDK`, `StackAppInternals`, `StackAppTokenInternals`, `StackAppRequestInternals`, `StackDevTool`, `StackSimple`, `StackRouter`, `StackConfigValue`/`StackConfigObject`/`StackConfigFileContent`, `StackOAuthCallback`, `StackIcon`, `StackAuthHeaders`, `StackAppImport`
- `replaceStackPortPrefix` (`lib/stack-app/apps/implementations/common.ts`)
- `.stack-devtool` CSS class (dev-tool-styles.ts + core) — rename className + selectors **atomically**. (Dev-tool storage/DOM keys `STORAGE_KEY`/`ROOT_ID`/etc. are already `__hexclave-dev-tool-*`.)

**`apps/backend`:**
- `getStackStripe` (`lib/stripe.tsx`), `stackPortPrefix`, `expandStackPortPrefix` (`polyfills.tsx`), `stackAuthBaseUrl` (`oauth/index.tsx`), `stackAuthHost` (loop var)
- `getStackAuthApiBaseUrl` (imported from shared — rename at source)
- in-process global cache keys `__stack_actual_global_connection_string`, `__stack_actual_replica_connection_string`, `__stack_prisma_sigterm_registered` (`prisma-client.tsx`) — process-local, safe
- ⚠️ `__stackComponent` (`email-rendering.tsx`) — VERIFY it's a runtime-only marker, not serialized into stored/rendered templates, before renaming.

**`apps/dashboard`:**
- `stackAppInternalsSymbol` (`lib/stack-app-internals.ts` + `external-db-sync/page-client.tsx`) — const rename, dual Symbol strings kept
- `stackServerApp`/`stackAdminApp` local vars, `StackAdminAppContext`, `expandStackPortPrefix` (`polyfills.tsx`), `isStackAppTokenInternals`/`getStackAppTokenInternals`
- `data-stack-handler-page` DOM attribute (internal)
- ⚠️ `stack-scope` CSS class (47×) — VERIFY it isn't referenced by the published `@hexclave/dashboard-ui-components` / saved create-dashboard outputs. If purely dashboard-internal, rename className + globals.css selector atomically; else keep.

**Other apps:** `createStackMcpHandler` (`apps/mcp`), and e2e helper names (`expandStackPortPrefix`, `stackTestTenancyId`, `localRedirectUrl` test consts) — rename freely (internal test harness).

---

## E. Safe-to-reset cookies/storage/DOM (§8)

Rename outright (UI-only local state, a one-time reset is harmless):
- `stack-devtool-trigger-position` → already `hexclave-devtool-trigger-position` ✅ (confirm propagated)
- `__stack-dev-tool-state`/`-root`/`-instance` → already `__hexclave-*` ✅
- `_STACK_AUTH.lastUsed` (OAuth last-provider hint) → `_HEXCLAVE.lastUsed`
- dev-tool DOM ids/attrs, `data-stack-handler-page`

**Keep backwards-compatible (persisted / cross-version / saved-state):** main auth + OAuth cookies (`stack-access`, `stack-refresh-*`, `stack-oauth-*` — dual-write already), `stack:session-replay:v1:*` (LEGACY prefix, dual-read), iframe postMessage types + `window.Stack*` globals + `STACK_EDITABLE_*`/`STACK_EXPR_*` email-HTML markers (saved dashboards/templates), `stack-init-id` query param.

---

## F. Brand strings to reword (§12)

Update `"Stack Auth"` / `"Stack dashboard"` / `"Stack"` product prose in **code** (docs handled separately):
- `packages/stack-shared/src/known-errors.tsx` — `"…not a valid OAuth scope for Stack."`, `"…on the Stack dashboard…"` (×2)
- `apps/backend` — `check-version` message, `send-test-webhook` body, `init-script-callback` telegram text, `purchase-session` `"Stack Auth price ID"`, code comments
- `apps/dashboard` — OAuth confirm card alt text, domain-settings label, setup-page snippet labels
- The ~25 `"Stack Auth"` literals across 12 files from the first pass
- Init/CLI prompts: `packages/stack-cli/src/commands/init.ts` user-facing "Set up Stack Auth"/"Stack" strings

**Keep brand strings that are intentional:** the rebrand modal copy ("Stack Auth is now Hexclave"), compat comments documenting `stack_response_mode` / dual-emit, `migration.mdx` prose (the rebrand-explanation page must keep "Stack Auth").

### docs-mintlify (DECIDED: in scope)
- Reword `"Stack Auth"` / `"Stack"` product prose throughout `docs-mintlify/` (keep `migration.mdx`'s intentional mentions + any explicit compat notes).
- Rename `stack`-named doc files: `docs-mintlify/guides/going-further/stack-app.mdx`, `docs-mintlify/sdk/objects/stack-app.mdx`, `docs-mintlify/sdk/hooks/use-stack-app.mdx` → `hexclave-app.mdx` / `use-hexclave-app.mdx`. Update `docs.json` nav entries and every internal cross-link (`rg` the old slugs). Add redirects if Mintlify supports them so old URLs don't 404.
- Leave `tanstack-start` doc dir/files alone (framework name).

---

## G. doctor.ts & init prompt (§10)

- `packages/stack-cli/src/commands/doctor.ts` — config check looks only for `stack.config.{ts,js}`; make it prefer `hexclave.config.ts` and accept `stack.config.ts` as fallback (mirror `config-file.ts` discovery).
- `packages/stack-cli/src/commands/init.ts` prompt text ("Path to your existing stack.config.ts") — mention `hexclave.config.ts` (preferred) + `stack.config.ts` (legacy).

---

## DO NOT TOUCH — verified compat-critical & false positives

**Compat-critical (renaming breaks data/wire/cross-version):**
- Crypto/vault/JWT **domain-separation purpose tags** — `crypto.tsx`, `jwt.tsx`, `helpers/vault/*` carry explicit `do NOT rename` notes (break decryption/verification of existing data).
- **Brand sentinels** `stack-known-error-brand-sentinel`, `stack-status-error-brand-sentinel` (`known-errors.tsx`, `errors.tsx`) — cross-version `isKnownError`/`isStatusError` checks across coexisting SDK copies.
- **OTel telemetry attribute keys** `stack.external-db-sync.*`, `stack.db-replication.*`, `stack.prisma.transaction.*` (observability dashboards; plan scopes observability out).
- **DB table** `_stack_sync_metadata`; **webhook event type** `stack.test`; **IdP ids** `stack-preconfigured-idp:*`.
- **Bearer** `stackauth_` value; `x-stack-*` headers; `stack-*` cookies' legacy names; `stack.config.ts` fallback; `*.stack-auth.com` domains.
- **Infra (plan-locked):** Postgres DB `stackframe`, ClickHouse user `stackframe`, Docker image/container names (`stack-backend`, `stack-local-emulator`, `stackframe-server`), hostnames, `STACK_AUTH_*` GitHub secrets, `stack-auth-config-sync.yml`.
- **Swift** `StackAuth` package + `StackClientApp`/`StackServerApp`/`StackAuthError` symbols (frozen).
- **MCP** `ask_stack_auth` / server name `stack-auth` (kept; `ask_hexclave` already added).
- **`stack-auth-logo*.svg`** (old logo, used by rebrand modal).

**False positives — contain "stack" but are NOT our brand:**
- `stackable` / `Stackable` / `StackableQuantityField` / `handleStackableChange` / `isStackableSelfMatch` / `"Stackable products…"` — payments product feature ("can be purchased multiple times").
- `Stacked*` charts — `StackedTooltip`, `StackedBarChartDisplay`, `StackedDataPoint`, `filterStackedDatapointsByTimeRange`, `emailStackedChartConfig` — "stacked bar chart" charting term.
- **`TanStack` / `TanStackStart*` / `StackStart*`** (the 66 `StackStartServerContext` hits are the tail of `TanStackStartServerContext`), `tanstackStartOnlyTemplateFiles` — TanStack Start framework.
- `OrbStack` (`resolveConnectionStringWithOrbStack`) — third-party Docker tool; `localstack`.
- JS call-stack concepts (`error.stack`, `stackTrace`, stack-trace length) — not brand.

---

## Execution order

1. Branch is ready (`cl/hexclave-rename-pr5`). Work in slices; lint/typecheck between slices.
2. **Symbols/vars first** (§D, §F, §G) inside `packages/template` + `packages/stack-shared` (mechanical, grep-driven), then `apps/*`. Verify the ⚠️ items (`showOnboardingStackConfigValue` value, `__stackComponent`, `stack-scope`) before touching them.
3. `pnpm -w run generate-sdks` to propagate template renames to `js/react/stack/tanstack-start`.
4. **File renames** (§C) via `git mv`, fix imports.
5. **Directory renames** (§A) via `git mv`; update `tsconfig`/`turbo.json`/`pnpm-workspace.yaml`/`generate-sdks.ts`; then a clean install (`rm -rf node_modules && pnpm install --frozen-lockfile`) — large workspace renames leave the `.pnpm` symlink layout half-stitched otherwise.
6. **Package rename + init-stack deletion** (§B); de-wire workspace/CI.
7. `skills/stack-auth` → `skills/hexclave`; `[...stack]` → `[...hexclave]` across dashboard/internal-tool/examples (§A).
8. **docs-mintlify** (§F): reword prose + rename `stack-app.mdx`/`use-stack-app.mdx`, fix `docs.json` nav + cross-links.
9. Force-rebuild (`turbo run build --filter=./packages/* --force`), then `pnpm typecheck` + `pnpm lint`.
10. Targeted tests: SDK build/import, CLI `doctor`/`init`, dashboard boot, e2e auth wire (must still pass with stack-named cookies/headers untouched).

## Resolved decisions (review)
- **Dir naming:** drop the `stack-` prefix → `packages/{next,shared,ui,sc,cli}`.
- **docs-mintlify:** in scope — reword brand prose + rename `stack-*.mdx` files.
- **`[...stack]`:** rename to `[...hexclave]` (internal param key only; URL unchanged).

## Still to verify during implementation (rename only if safe)
- `showOnboardingStackConfigValue` — is the string *value* persisted in DB config rows?
- `__stackComponent` — serialized into stored/rendered email templates?
- `stack-scope` CSS — referenced by published `@hexclave/dashboard-ui-components` or saved create-dashboard outputs?
