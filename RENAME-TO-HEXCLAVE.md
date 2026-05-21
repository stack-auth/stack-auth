# Stack Auth → Hexclave Rename Plan (v6)

Rebrand rollout with backwards compatibility. Organized by wire-compatibility risk: what breaks existing users vs. what's purely cosmetic.

**Rollout strategy:** one large additive PR that introduces Hexclave naming everywhere without breaking anything, then a much-later cleanup PR that removes only the safely-removable fallbacks (cookies, customer SDK env vars, MCP legacy tool, non-essential DNS).

## Locked-in decisions

- GitHub canonical repo: **`hexclave/hexclave`** (was `hexclave/stack-auth`)
- Read-only legacy identifiers — kept indefinitely (no Hexclave writer needed because nothing emits them in new code):
  - `x-stack-auth` (legacy JSON-encoded auth header)
- **Symmetric dual-support** (old kept indefinitely, new is preferred / emitted by new code):
  - All `x-stack-*` request headers ↔ `x-hexclave-*` equivalents (dual-accept)
  - All `x-stack-*` response headers ↔ `x-hexclave-*` equivalents (dual-emit)
  - `Bearer stackauth_*` ↔ `Bearer hexclave_*`
  - All `stack-*` cookies (auth, OAuth state, low-risk UI) ↔ `hexclave-*` equivalents (dual-write)
  - All three `stack-auth.com` JWT issuer variants ↔ `hexclave.com` (validator accepts both)
  - `stack.config.ts` ↔ `hexclave.config.ts` (discovery prefers new, falls back to old)
  - `stack-auth-mobile-oauth-url://` ↔ `hexclave-mobile-oauth-url://` (backend accepts both schemes; new Swift SDK registers the new one)
  - `Symbol.for("StackAuth--app-internals")` ↔ `Symbol.for("Hexclave--app-internals")` (attach under both, look up both)
  - JS `Stack*` exports stay canonical; `Hexclave*` added as aliases — both kept indefinitely
- **Swift SDK: separate package**, not typealiases. `StackAuth` Swift package frozen at existing git URL — old users keep `import StackAuth`. New `Hexclave` Swift package (new git URL) is the canonical going-forward SDK with real `Hexclave*` symbols. Breaking changes allowed between versions; old package remains installable but unmaintained.
- New docs teach **Hexclave-only** names; old names appear only in explicitly-marked compatibility notes
- Self-host operator env vars (Category C) are **out of scope** — stay as `STACK_*`, no aliasing
- `@hexclave/*` packages dual-published via rewrite step in `.github/workflows/npm-publish.yaml` (see Tier 2)
- **Sentry / PostHog / observability DSNs** — out of scope. Existing DSNs continue unchanged. No project renames in either tool.
- **`skill.stack-auth.com`** — DNS redirects to `skill.hexclave.com`; both URLs serve identical content indefinitely. Customers with cached MCP configs pointing at old domain keep working.
- **`StackAssertionError`** — class gets `HexclaveAssertionError` alias (per Tier 1 pattern); error message string updates from "This is likely an error in Stack." → "This is likely an error in Hexclave." in PR 1.
- **CHANGELOG title** — becomes "Hexclave Changelog" in PR 1. History continuity preserved through commit log, not title.
- **Test assertion updates** — every test that asserts on header names, cookie names, error message prefixes, etc. updates in lockstep with implementation in PR 1.
- **Deprecation warning text** — exact wording is an implementation-time decision; SDK init logs `console.warn` once per process.
- **Docker registry path / image naming** — not part of this rebrand; existing image tags continue.
- Telemetry is deferred; not blocking PR 1

## Scale at a glance

| Surface | Count |
|---|---|
| HTTP headers (`x-stack-*`) | 21 |
| Cookies | ~12 |
| Customer-facing env vars | ~20+ |
| NPM packages | 11 |
| Public SDK classes/components/hooks (JS) | ~12 |
| Swift module + symbols | 1 module, ~10 symbols |
| Domain references | 625+ |
| Total brand string references | ~1,000+ |

---

## Tier 0 — Wire identifiers (dual-accept indefinitely)

These travel between SDK and backend, or get baked into third-party systems. **Alias, never replace.**

### Read-only legacy identifiers (no Hexclave writer needed)

These have no Hexclave equivalent because nothing in new code emits them. Backend keeps parsing them indefinitely as a compatibility path.

| Identifier | What | Why no Hexclave equivalent |
|---|---|---|
| `x-stack-auth: { accessToken, refreshToken }` | Legacy JSON-encoded auth header | Newer SDKs use split `x-stack-access-token` + `x-stack-refresh-token` (which DO get `x-hexclave-*` aliases). This older header has no current writer to add a new format to. |

### Symmetric dual-support (old kept, new is canonical)

These follow the same pattern as request headers: old form continues to work indefinitely; new form is preferred and emitted by new code.

| Concept | Old (read indefinitely) | New (canonical, written by new code) |
|---|---|---|
| Bearer auth prefix | `Authorization: Bearer stackauth_<base64>` | `Authorization: Bearer hexclave_<base64>` |
| Response/protocol headers | `x-stack-actual-status`, `x-stack-known-error`, `x-stack-request-id` | `x-hexclave-actual-status`, `x-hexclave-known-error`, `x-hexclave-request-id` (dual-emitted) |
| Config filename | `stack.config.ts` | `hexclave.config.ts` |
| Mobile OAuth URL scheme | `stack-auth-mobile-oauth-url://` | `hexclave-mobile-oauth-url://` |

**Bearer prefix details.** Backend's Authorization parser checks both `stackauth_` and `hexclave_` prefixes (one extra string-prefix check). New SDKs construct tokens with the `hexclave_` prefix; old SDKs keep working unchanged. Anyone debugging a request sees the brand-consistent prefix on new traffic.

**Response header details.** Backend emits both `x-stack-*` AND `x-hexclave-*` versions of `actual-status`, `known-error`, `request-id` on every response (~60 extra bytes total — negligible). New SDKs read `x-hexclave-*` first, fall back to `x-stack-*`. Old SDKs continue to read `x-stack-*` only.

**Config filename details.**
- **Discovery order:** CLI/dashboard look for `hexclave.config.ts` first; fall back to `stack.config.ts`.
- **`hexclave init`** generates `hexclave.config.ts` for new projects.
- **Existing projects** with `stack.config.ts` keep working without migration — the DB row pointing at that filename still resolves.
- **GitHub config push** writes back to whichever filename already exists in the customer's repo; defaults to `hexclave.config.ts` for new repos.
- **Tests** updated to expect new default; old-filename tests retained as compat coverage.

**Mobile OAuth URL scheme details.**
- **Backend acceptance check** at [apps/backend/src/lib/redirect-urls.tsx:78](apps/backend/src/lib/redirect-urls.tsx:78) currently reads `url.protocol === 'stack-auth-mobile-oauth-url:'`. Update to accept either protocol: `url.protocol === 'stack-auth-mobile-oauth-url:' || url.protocol === 'hexclave-mobile-oauth-url:'`.
- **Frozen `StackAuth` Swift SDK** keeps registering `stack-auth-mobile-oauth-url` in `Info.plist` and using `stack-auth-mobile-oauth-url://success` / `…://error` as callback URLs. Existing App-Store-shipped customer apps keep working unchanged.
- **New `Hexclave` Swift SDK** registers `hexclave-mobile-oauth-url` in `Info.plist`, uses `hexclave-mobile-oauth-url://success` / `…://error` callbacks.
- **Spec update:** `sdks/spec/src/apps/client-app.spec.md` documents both schemes; canonical for new code is the Hexclave scheme.
- **Tests:** add `isAcceptedNativeAppUrl('hexclave-mobile-oauth-url://success')` etc. alongside the existing assertions in `apps/backend/src/lib/redirect-urls.test.tsx`.

### HTTP request headers (dual-accept)

Server reads both `x-stack-*` and `x-hexclave-*` via a single helper. New SDKs emit `x-hexclave-*`; existing SDKs keep working unchanged.

**Read paths:** `apps/backend/src/route-handlers/smart-request.tsx`, `apps/backend/src/proxy.tsx`

| Old (accepted indefinitely) | New (preferred) |
|---|---|
| `x-stack-access-token` | `x-hexclave-access-token` |
| `x-stack-refresh-token` | `x-hexclave-refresh-token` |
| `x-stack-project-id` | `x-hexclave-project-id` |
| `x-stack-access-type` | `x-hexclave-access-type` |
| `x-stack-api-key` | `x-hexclave-api-key` |
| `x-stack-request-type` | `x-hexclave-request-type` |
| `x-stack-publishable-client-key` | `x-hexclave-publishable-client-key` |
| `x-stack-secret-server-key` | `x-hexclave-secret-server-key` |
| `x-stack-super-secret-admin-key` | `x-hexclave-super-secret-admin-key` |
| `x-stack-admin-access-token` | `x-hexclave-admin-access-token` |
| `x-stack-branch-id` | `x-hexclave-branch-id` |
| `x-stack-allow-anonymous-user` | `x-hexclave-allow-anonymous-user` |
| `x-stack-allow-restricted-user` | `x-hexclave-allow-restricted-user` |
| `x-stack-client-version` | `x-hexclave-client-version` |
| `x-stack-development-override-key` | `x-hexclave-development-override-key` |
| `x-stack-override-error-status` | `x-hexclave-override-error-status` |
| `x-stack-disable-artificial-development-delay` | `x-hexclave-disable-artificial-development-delay` |
| `x-stack-development-disable-extended-logging` | `x-hexclave-development-disable-extended-logging` |
| `x-stack-random-nonce` | `x-hexclave-random-nonce` |
| `x-stack-bulldozer-studio-token` | `x-hexclave-bulldozer-studio-token` |

**Implementation pattern:** `readDualHeader(req, "x-hexclave-foo", "x-stack-foo")` at the parse layer. Zero per-route changes.

**CORS sync requirement.** `apps/backend/src/proxy.tsx` maintains explicit allowlists for request headers (lines 16-54) and response headers (lines 50-54) used by CORS preflight. Every old + new header pair must appear in both allowlists or preflight will fail. Easy to miss.

### HTTP response/protocol headers (dual-emit)

These flow backend → client. Covered in the symmetric dual-support table above. Backend emits both `x-stack-*` and `x-hexclave-*` versions of `actual-status`, `known-error`, `request-id` on every response. New SDKs read `x-hexclave-*` first, fall back to `x-stack-*`.

> **Note on `x-stack-override-error-status`:** this is a **request** header (client tells backend to override response status before backend emits `x-stack-actual-status`). It's in the request-header table above, dual-accepted as `x-hexclave-override-error-status`.

### Authorization Bearer formats

Covered in the symmetric dual-support table above. Backend accepts both `Bearer stackauth_*` and `Bearer hexclave_*`. New SDKs emit `Bearer hexclave_*`.

### Cookies (dual-write, dual-read across the board)

Every cookie containing "stack" gets a `hexclave-*` equivalent dual-written. Reads prefer new, fall back to old. Old cookies expire naturally as users re-authenticate or as their TTL passes.

**Main auth cookies** (`packages/template/src/lib/cookie.ts`, dashboard manual setters):

| Old (read for compat) | New (canonical, written by PR 1+) |
|---|---|
| `stack-access` | `hexclave-access` |
| `stack-refresh-{projectId}--default` | `hexclave-refresh-{projectId}--default` |
| `stack-refresh-{projectId}--custom-{encoded}` | `hexclave-refresh-{projectId}--custom-{encoded}` |
| `__Host-stack-refresh-internal--*` | `__Host-hexclave-refresh-internal--*` |
| `stack-refresh` (legacy, pre-projectId scheme) | continue reading + deleting on sign-out, do not write |

**OAuth state cookies** (`apps/backend/.../oauth/authorize/[provider_id]/route.tsx`, `packages/template/src/lib/cookie.ts`):

| Old (read for compat) | New (canonical, written by PR 1+) |
|---|---|
| `stack-oauth-inner-{state}` (backend-set, deleted on callback) | `hexclave-oauth-inner-{state}` |
| `stack-oauth-outer-{state}` (SDK-set PKCE verifier, 60min TTL) | `hexclave-oauth-outer-{state}` |

**Low-risk cookies** (low TTL or UI-only — same dual-write pattern for consistency):

| Old | New |
|---|---|
| `stack-is-https` | `hexclave-is-https` |
| `stack-last-seen-changelog-version` | `hexclave-last-seen-changelog-version` |
| `stack-cli-auth-confirmed` | `hexclave-cli-auth-confirmed` |

**CHIPS test cookies — keep as `stack-*` indefinitely** (internal, never user-visible, no functional reason to rename):

- `__Host-stack-temporary-chips-test-*`

Additional surfaces that set/read cookies and need updating in PR 1:

- Dashboard remote development environment auth route (deletes internal project cookies)
- Dashboard user impersonation/debug flows (manually set refresh cookies)
- Backend OAuth callback routes (set + delete OAuth state cookies)

### Customer-facing env vars — see "Env var taxonomy" section below

The env var question is large enough to warrant its own section.

### OAuth callback paths

`/handler/oauth-callback` and `/handler/*` are registered with Google, GitHub, Discord, Apple, etc. as fixed strings.

**Decision: do NOT rename.** Keep these paths stable indefinitely. New docs teach the existing URLs; do not invent `/hexclave-handler/*`.

Note: Apple sign-in setup docs require `api.stack-auth.com` as the configured domain for Apple's relay service. This is one more reason `api.stack-auth.com` cannot be deprecated.

### JWT issuer / audience

Encoded into already-issued tokens. Validator must accept old + new indefinitely. Three issuer variants:

| Old | New |
|---|---|
| `iss: https://api.stack-auth.com/api/v1/projects/{projectId}` | `iss: https://api.hexclave.com/api/v1/projects/{projectId}` |
| `iss: https://api.stack-auth.com/api/v1/projects-anonymous-users/{projectId}` | `iss: https://api.hexclave.com/api/v1/projects-anonymous-users/{projectId}` |
| `iss: https://api.stack-auth.com/api/v1/projects-restricted-users/{projectId}` | `iss: https://api.hexclave.com/api/v1/projects-restricted-users/{projectId}` |
| `aud: https://idp-jwk-audience.stack-auth.com/{idpId}` | `aud: https://idp-jwk-audience.hexclave.com/{idpId}` |

**Files:** `packages/template/src/integrations/convex.ts`, `apps/backend/src/app/api/latest/integrations/idp.ts:167`

**Strategy:**
- Validator accepts both domains for all three issuer types
- JWKS docs teach Hexclave issuer URLs as canonical
- Convex provider config exposes new issuer URLs by default; old tokens remain valid
- New tokens sign with new domain when the API is served from the new domain (driven by configured base URL, not a separate flag)

### Dashboard "Create-a-Dashboard" sandbox · iframe protocol + window globals

The dashboard's AI-generated mini-dashboards run in an iframe sandbox host that exposes SDK globals and a postMessage protocol with `stack-*` identifiers. Generated dashboards saved by customers reference these names — renaming naively breaks every saved dashboard.

**Window globals** (`apps/dashboard/src/components/commands/create-dashboard/dashboard-sandbox-host.tsx:84-93, 171-173`):

| Old (kept) | New (set alongside) |
|---|---|
| `window.StackAdminApp` | `window.HexclaveAdminApp` |
| `window.StackServerApp` | `window.HexclaveServerApp` |
| `window.StackSDK` | `window.HexclaveSDK` |

Sandbox sets both globals; saved dashboards using either reference resolve.

**iframe postMessage types** (`apps/dashboard/.../dashboard-sandbox-host.tsx:405, 419, 778`):

| Old (kept) | New (accepted alongside) |
|---|---|
| `stack-access-token-request` | `hexclave-access-token-request` |
| `stack-access-token-response` | `hexclave-access-token-response` |

Sandbox listens for both message types and responds with both. AI prompts for new dashboards generate Hexclave-named messages; saved dashboards continue using the old names.

### `@stackframe/emails` virtual module · customer email templates

Customer-authored email templates import from a virtual `@stackframe/emails` module. This is a public API surface that the plan previously missed.

**Renderer:** `apps/backend/src/lib/email-rendering.tsx:89` maps the virtual import — currently only `@stackframe/emails`. Update to map both `@stackframe/emails` and `@hexclave/emails` to the same backing module.

**AI tools:** `apps/backend/src/lib/ai/tools/create-email-template.ts:22,33` and `create-email-draft.ts:23` instruct the model to import from `@stackframe/emails`. Update prompts to teach `@hexclave/emails`; accept either in validation.

**Monaco editor typings:** `apps/dashboard/src/components/vibe-coding/code-editor.tsx:95` declares the module to the editor. Declare both.

**Error messages:** `apps/backend/.../email-templates/[templateId]/route.tsx:61` tells users to import from the old name in error text. Update to suggest `@hexclave/emails`.

**Default templates / E2E fixtures:** find any seeded customer templates that import the old name; new defaults use new name; existing seeded data left alone (works via dual-mapping).

### MCP tool name

AI clients (Claude, Cursor, etc.) have `ask_stack_auth` baked into their MCP configs.

**File:** `apps/mcp/src/mcp-handler.ts:107`

**Strategy:** register `ask_hexclave` as a new tool; keep `ask_stack_auth` indefinitely as a thin proxy. Setup pages generated by `apps/mcp/src/setup-page.ts` teach the new tool name.

### Storage keys

`sessionStorage` / `localStorage` keys. Dual-write old + new names; reads prefer new.

| Old (read for compat) | New (canonical) |
|---|---|
| `stack-docs-selected-platform` (sessionStorage) | `hexclave-docs-selected-platform` |
| `stack-docs-selected-frameworks` (sessionStorage) | `hexclave-docs-selected-frameworks` |
| `stack_mfa_attempt_code` (sessionStorage, underscore-delimited) | `hexclave_mfa_attempt_code` |

Note the third key uses underscores instead of hyphens — preserve the existing convention for the new name to keep the access pattern identical.

---

## Tier 1 — Public SDK API (alias via re-exports)

### JS / React / Next.js / TanStack SDKs

Codegen makes this clean. `scripts/generate-sdks.ts` copies `packages/template` → `packages/{js,stack,react,tanstack-start}`. Add re-exports once in template; all generated packages get both names.

Dual-export every public Stack* symbol:

| Old (kept) | New (alias added) |
|---|---|
| `StackClientApp` | `HexclaveClientApp` |
| `StackServerApp` | `HexclaveServerApp` |
| `StackAdminApp` | `HexclaveAdminApp` |
| `StackProvider` | `HexclaveProvider` |
| `StackHandler` | `HexclaveHandler` |
| `StackTheme` | `HexclaveTheme` |
| `useStackApp()` | `useHexclaveApp()` |
| `StackClientInterface` | `HexclaveClientInterface` |
| `StackServerInterface` | `HexclaveServerInterface` |
| `StackAdminInterface` | `HexclaveAdminInterface` |
| `StackAssertionError` | `HexclaveAssertionError` (plus: error message text updates from "This is likely an error in Stack." → "This is likely an error in Hexclave." in `packages/stack-shared/src/utils/errors.tsx`) |
| `StackConfig` | `HexclaveConfig` |
| `defineStackConfig()` | `defineHexclaveConfig()` |
| `Stack*ConstructorOptions` | `Hexclave*ConstructorOptions` |
| `Stack{Client,Server,Admin}AppConstructor` | `Hexclave{Client,Server,Admin}AppConstructor` |
| `StackClientAppJson` | `HexclaveClientAppJson` |

**Pattern:** `export { StackClientApp as HexclaveClientApp }`. Same class, both names. Users can mix freely.

**Canonicality:** `Stack*` is the internal/canonical class name; `Hexclave*` is the alias. This means PR 2 cannot "remove Stack* aliases" — they're the originals. Both names stay indefinitely. If a future effort wants to flip canonicality so `Hexclave*` is the real class and `Stack*` is the alias, that's a separate, optional follow-up — not part of this rebrand.

`stack.config.ts` filename stays (locked decision). `showOnboardingStackConfigValue` stays internal — no alias needed.

Page components (`SignIn`, `SignUp`, `AuthPage`, `AccountSettings`, `UserButton`, `TeamSwitcher`, `OAuthButton`, `PasswordReset`, `EmailVerification`, `ForgotPassword`, `MessageCard`, `CliAuthConfirmation`) don't carry the brand — leave alone.

**Internal `Symbol.for(...)` keying** — dual-symbol pattern. Three distinct `Symbol.for()` strings with "stack" in them across the codebase. All get the dual-attach treatment for consistency.

| Old (kept for cross-version coexistence) | New (canonical) | Location |
|---|---|---|
| `Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals")` | `Symbol.for("Hexclave--app-internals")` | `packages/template/src/lib/stack-app/common.ts:213` |
| `Symbol.for("__stack-globals")` | `Symbol.for("__hexclave-globals")` | `packages/stack-shared/src/utils/globals.tsx` |
| `Symbol.for("__stack_email_queue_first_run_completed")` | `Symbol.for("__hexclave_email_queue_first_run_completed")` | `apps/backend/src/lib/email-queue-step.tsx` |

On attach: write internals under BOTH symbols. On lookup: try new first, fall back to old. Mixed-version setups (a customer with two SDK majors loaded in one page) keep working.

### Swift SDK — separate package, not typealiases

The Swift SDK is niche enough that breaking changes between versions are acceptable as long as old SDK versions remain installable. So the cleanest split is **two separate Swift packages**:

| Package | Status | Module | Symbols |
|---|---|---|---|
| `StackAuth` (existing git URL) | **Frozen**. Bug fixes only; no new features. Existing SPM consumers keep working with no change. | `import StackAuth` | `StackClientApp`, `StackServerApp`, `StackAuthError`, ... |
| `Hexclave` (new git URL / new repo) | **Canonical going forward**. All new development happens here. | `import Hexclave` | `HexclaveClientApp`, `HexclaveServerApp`, `HexclaveError`, ... — these are *real types*, not typealiases |

Notes:
- Old code (`import StackAuth; let app = StackClientApp(...)`) keeps working indefinitely from the existing SPM URL — but doesn't get new features
- New code uses `import Hexclave; let app = HexclaveClientApp(...)` — Hexclave-only, no Stack visible anywhere
- Default base URL in the new `Hexclave` package is `https://api.hexclave.com`
- No typealiases, no dual-export inside one module — the two packages are independent

**`sdks/spec`** describes Hexclave naming as canonical; the spec for the legacy `StackAuth` package is preserved at the existing path but flagged as frozen.

**Files in scope:**
- Existing `sdks/implementations/swift/` — frozen as-is, keeps publishing `StackAuth` package from existing URL
- New Hexclave Swift package — new directory (e.g. `sdks/implementations/swift-hexclave/`) or new repo, TBD by Swift maintainer
- `sdks/spec/` updated to describe Hexclave canonical Swift API

**Files in scope:**
- `sdks/implementations/swift/Package.swift`
- `sdks/implementations/swift/Sources/StackAuth/`
- `sdks/implementations/swift/Tests/StackAuthTests/`
- `sdks/implementations/swift/Examples/StackAuthiOS/`
- `sdks/implementations/swift/Examples/StackAuthMacOS/`
- `sdks/spec/src/`
- `sdks/spec/README.md`

Per AGENTS.md, SDK implementation changes must update `sdks/spec` — bake this into the PR 1 checklist.

---

## Tier 2 — NPM packages (dual-publish)

Keep `@stackframe/*` published indefinitely. Add `@hexclave/*` mirrors.

### Publishing mechanics

**Decision: rewrite-then-republish in `.github/workflows/npm-publish.yaml`.** Workspace stays `@stackframe/*`-keyed; no duplicate source dirs.

Concrete change to the existing workflow:

```yaml
# Existing steps:
- name: Build packages
  run: pnpm build:packages
- name: Publish @stackframe/* packages
  run: pnpm publish -r --no-git-checks --access public
  env:
    NPM_CONFIG_PROVENANCE: true

# New steps appended:
- name: Rewrite package names to @hexclave/*
  run: pnpm tsx scripts/rewrite-packages-to-hexclave.ts
- name: Publish @hexclave/* packages
  run: pnpm publish -r --no-git-checks --access public
  env:
    NPM_CONFIG_PROVENANCE: true
```

`scripts/rewrite-packages-to-hexclave.ts` does, for each publishable package per the mapping table below:
- Read `package.json`
- Rewrite `name`: `@stackframe/foo` → `@hexclave/foo`
- Rewrite all `dependencies` / `peerDependencies` entries from `@stackframe/X` → `@hexclave/X` with the version of the just-published artifact
- Update `bin` entries where relevant (e.g. `@hexclave/cli` registers `hexclave` binary alongside the existing `stack`)
- Leave built `dist/` artifacts untouched (no rebuild needed)

`pnpm publish` skips versions already on npm, so reruns are safe. The workflow runs on a clean checkout each time, so no revert is needed.

Notes:
- Workspace remains `@stackframe/*`-keyed; `pnpm-workspace.yaml`, Turbo filters, and lockfile are unchanged
- Source maps, type declarations, `exports`, `typesVersions` resolve under both names because they're the same built artifacts
- The rewrite step only runs in CI; local development keeps using `@stackframe/*` names

### 10 mirrored packages

| Old (kept) | New (mirrored) |
|---|---|
| `@stackframe/react` | `@hexclave/react` |
| `@stackframe/stack` | `@hexclave/stack` |
| `@stackframe/js` | `@hexclave/js` |
| `@stackframe/stack-shared` | `@hexclave/shared` |
| `@stackframe/stack-ui` | `@hexclave/ui` |
| `@stackframe/stack-sc` | `@hexclave/sc` |
| `@stackframe/init-stack` | `@hexclave/init` |
| `@stackframe/stack-cli` | `@hexclave/cli` |
| `@stackframe/tanstack-start` | `@hexclave/tanstack-start` |
| `@stackframe/dashboard-ui-components` | `@hexclave/dashboard-ui-components` |

**`@stackframe/dashboard-ui-components` is publishable.** Earlier plan versions marked it "internal only" — that was wrong. It's loaded at runtime via esm.sh by the dashboard's create-dashboard sandbox host ([apps/dashboard/.../dashboard-sandbox-host.tsx](apps/dashboard/src/components/commands/create-dashboard/dashboard-sandbox-host.tsx)) plus served locally as an IIFE bundle (`dashboard-ui-components.iife.js`). Mirror it like the other public packages. The IIFE bundle filename also gets dual-served — both `dashboard-ui-components.iife.js` and a future Hexclave-branded path (TBD) until generated dashboards stored with the old filename can be updated.

**Not mirrored — internal:** `@stackframe/template` (codegen source).

**Not publishable, stay `@stackframe/*`:** `@stackframe/monorepo`, backend, dashboard, docs, mcp, hosted-components, skills, mock-oauth-server, e2e, internal-tool, dev-launchpad.

### CLI / init wizard

| Old (kept) | New |
|---|---|
| `npx @stackframe/init-stack` | `npx @hexclave/init` |
| `stack` binary | `hexclave` binary alias |
| `~/.config/stack-auth/credentials.json` | `~/.config/hexclave/credentials.json` |
| `stack.config.ts` (fallback) | `hexclave.config.ts` (preferred default) |

CLI reads both config paths; writes new path. Old path silently migrates on next run. For project config: `init` generates `hexclave.config.ts` in new projects; discovery prefers `hexclave.config.ts` and falls back to `stack.config.ts` for existing projects (see Tier 0 details).

---

## Env var taxonomy

Replaces the flat env var table from v1. Different categories warrant different treatment.

### Table shape

For each *concept* (e.g. "Project ID"), the repo may already have multiple env var aliases (Vite vs. Next, BROWSER prefix vs. suffix, etc.). The plan picks **one canonical Hexclave name per concept**; all currently-recognized old names continue to be read as compat aliases. A grep-based pass over Category A and B old-name aliases should be done before implementation to confirm the list below matches what's actually in the repo.

### A. Customer SDK env vars (dual-read, prefer Hexclave)

Customer-set in their own projects. SDK init reads any old alias for compat; warns if no canonical Hexclave name is set; new canonical is the only name documented.

| Concept | Old accepted (compat) | New canonical |
|---|---|---|
| Project ID (Next.js client) | `NEXT_PUBLIC_STACK_PROJECT_ID` | `NEXT_PUBLIC_HEXCLAVE_PROJECT_ID` |
| Publishable client key (Next.js client) | `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY` | `NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY` |
| API URL (Next.js client) | `NEXT_PUBLIC_STACK_API_URL` | `NEXT_PUBLIC_HEXCLAVE_API_URL` |
| Dashboard URL (Next.js client) | `NEXT_PUBLIC_STACK_DASHBOARD_URL` | `NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL` |
| Stack base URL (Next.js client) | `NEXT_PUBLIC_STACK_URL` | `NEXT_PUBLIC_HEXCLAVE_URL` |
| Hosted handler domain suffix | `NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX` | `NEXT_PUBLIC_HEXCLAVE_HOSTED_HANDLER_DOMAIN_SUFFIX` |
| Hosted handler URL template | `NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE` | `NEXT_PUBLIC_HEXCLAVE_HOSTED_HANDLER_URL_TEMPLATE` |
| Extra request headers (client) | `NEXT_PUBLIC_STACK_EXTRA_REQUEST_HEADERS` | `NEXT_PUBLIC_HEXCLAVE_EXTRA_REQUEST_HEADERS` |
| Project ID (server) | `STACK_PROJECT_ID` | `HEXCLAVE_PROJECT_ID` |
| Publishable client key (server) | `STACK_PUBLISHABLE_CLIENT_KEY` | `HEXCLAVE_PUBLISHABLE_CLIENT_KEY` |
| Secret server key | `STACK_SECRET_SERVER_KEY` | `HEXCLAVE_SECRET_SERVER_KEY` |
| Super secret admin key | `STACK_SUPER_SECRET_ADMIN_KEY` | `HEXCLAVE_SUPER_SECRET_ADMIN_KEY` |
| API URL (server, generic) | `STACK_API_URL` | `HEXCLAVE_API_URL` |
| API URL (server, browser-context override) | `STACK_API_URL_BROWSER` | `HEXCLAVE_API_URL_BROWSER` |
| API URL (server, server-context override) | `STACK_API_URL_SERVER` | `HEXCLAVE_API_URL_SERVER` |
| Dashboard URL (server) | `STACK_DASHBOARD_URL` | `HEXCLAVE_DASHBOARD_URL` |
| Dashboard base URL (server) | `STACK_DASHBOARD_BASE_URL` | `HEXCLAVE_DASHBOARD_BASE_URL` |
| Extra request headers (server) | `STACK_EXTRA_REQUEST_HEADERS` | `HEXCLAVE_EXTRA_REQUEST_HEADERS` |
| Project ID (Vite client) | `VITE_STACK_PROJECT_ID` | `VITE_HEXCLAVE_PROJECT_ID` |
| Publishable client key (Vite client) | `VITE_STACK_PUBLISHABLE_CLIENT_KEY` | `VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY` |
| API URL (Vite client) | `VITE_STACK_API_URL` | `VITE_HEXCLAVE_API_URL` |

### B. Framework / internal URL env vars (dual-read at app runtime)

Used by dashboard/backend/local-dev tooling. Some concepts have multiple historical aliases; pick one canonical Hexclave name, accept all old aliases.

| Concept | Old accepted (compat) | New canonical |
|---|---|---|
| Browser API URL (framework runtime) | `NEXT_PUBLIC_BROWSER_STACK_API_URL`, `NEXT_PUBLIC_STACK_API_URL_BROWSER` | `NEXT_PUBLIC_HEXCLAVE_API_URL_BROWSER` |
| Server API URL (framework runtime) | `NEXT_PUBLIC_SERVER_STACK_API_URL`, `NEXT_PUBLIC_STACK_API_URL_SERVER` | `NEXT_PUBLIC_HEXCLAVE_API_URL_SERVER` |
| Browser Dashboard URL | `NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL`, `NEXT_PUBLIC_STACK_DASHBOARD_URL_BROWSER` | `NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL_BROWSER` |
| Server Dashboard URL | `NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL`, `NEXT_PUBLIC_STACK_DASHBOARD_URL_SERVER` | `NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL_SERVER` |
| Is local emulator | `NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR` | `NEXT_PUBLIC_HEXCLAVE_IS_LOCAL_EMULATOR` |
| Is remote dev env | `NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT` | `NEXT_PUBLIC_HEXCLAVE_IS_REMOTE_DEVELOPMENT_ENVIRONMENT` |
| Is preview | `NEXT_PUBLIC_STACK_IS_PREVIEW` | `NEXT_PUBLIC_HEXCLAVE_IS_PREVIEW` |

> The exact list of "Old accepted" aliases above is best-effort and **must be validated** against a repo-wide grep before implementation. The reviewer flagged that prior versions of this plan listed aspirational names (`NEXT_PUBLIC_STACK_BROWSER_API_URL`) that don't actually exist in the repo.

**Exception — keep indefinitely:** `NEXT_PUBLIC_STACK_PORT_PREFIX`. Baked into every dev's local Docker/`.env`; renaming has zero user-facing value and breaks local setups.

### C. Self-host / operator env vars — out of scope

These remain as `STACK_*` indefinitely. Not part of the rebrand.

- `STACK_DATABASE_CONNECTION_STRING`, `STACK_SERVER_SECRET`, `STACK_EMAIL_*`, `STACK_S3_*`, `STACK_SVIX_*`, `STACK_QSTASH_*`, `STACK_STRIPE_*`, `STACK_FREESTYLE_*`, `STACK_OPENROUTER_API_KEY`, `STACK_MCP_LOG_TOKEN`, `STACK_CLICKHOUSE_*`, `STACK_RUN_MIGRATIONS`, `STACK_RUN_SEED_SCRIPT`, `STACK_SEED_INTERNAL_PROJECT_*`, local emulator + QEMU vars

Self-hosters keep their existing `.env` files unchanged. No deprecation warnings, no docs migration, no `.env.example` rewrite. Operators are not affected by the rebrand at the env-var layer.

### D. GitHub onboarding workflow

Two different things to keep straight, conflated in prior plan versions:

**GitHub Actions secret names** in the customer's repo (`secrets.STACK_AUTH_*`):

| Old (kept supported) | New (emitted by new workflows) |
|---|---|
| `secrets.STACK_AUTH_PROJECT_ID` | `secrets.HEXCLAVE_PROJECT_ID` |
| `secrets.STACK_AUTH_SECRET_SERVER_KEY` | `secrets.HEXCLAVE_SECRET_SERVER_KEY` |
| `secrets.STACK_AUTH_CONFIG_PATH` | `secrets.HEXCLAVE_CONFIG_PATH` |
| `secrets.STACK_AUTH_SOURCE_REPO` | `secrets.HEXCLAVE_SOURCE_REPO` |
| `secrets.STACK_AUTH_SOURCE_WORKFLOW_PATH` | `secrets.HEXCLAVE_SOURCE_WORKFLOW_PATH` |

**Process env vars** exported from those secrets and consumed by the CLI inside the workflow runner (`apps/dashboard/src/lib/onboarding/link-existing-onboarding-workflow.ts:51-53` exports them; `packages/stack-cli/src/lib/auth.ts:55,93` reads them):

| Old (kept supported) | New (emitted by new workflows) |
|---|---|
| `STACK_PROJECT_ID` | `HEXCLAVE_PROJECT_ID` |
| `STACK_SECRET_SERVER_KEY` | `HEXCLAVE_SECRET_SERVER_KEY` |

These are the **same env vars** customers set in their own apps (Category A) — the workflow just reads the same names. CLI dual-read in Category A automatically covers the workflow runner case. The dashboard's workflow generator must emit both old + new export lines until the CLI dual-read ships.

New generated workflows emit `HEXCLAVE_*`. Existing customer workflows with `STACK_AUTH_*` secrets / `STACK_*` process env vars keep working. Generated-workflow tests cover both shapes.

### E. Build / dev / test env vars (keep as `STACK_*`)

Classified as internal. Not part of the brand rebrand.

- `STACK_SKIP_TEMPLATE_GENERATION`
- `STACK_DISABLE_REACT_ASYNC_DEBUG_INFO`
- `STACK_ENABLE_HARDCODED_PASSKEY_CHALLENGE_FOR_TESTING`
- `STACK_RUN_SETUP_WIZARD_TESTS`
- `STACK_TEST_SDK_FALLBACK`

Add to `turbo.json` `globalEnv`: `HEXCLAVE_*` alongside existing `STACK_*`.

---

## Tier 3 — Persistent data (idempotent migrations in PR 1)

### Internal project display name

**File:** `apps/backend/prisma/seed.ts`

```
Project { id: 'internal', displayName: 'Stack Dashboard' }
  → displayName: 'Hexclave Dashboard'
```

**Migration shape:**
- Idempotent forward migration: `UPDATE Project SET displayName='Hexclave Dashboard' WHERE id='internal' AND displayName='Stack Dashboard'`
- Custom user-modified display names (where someone renamed the internal project) are **not overwritten**
- Missing row no-ops safely
- Migration tests cover all three cases

Project ID `'internal'` stays — code constant, not brand string.

### IdP audience URL (stored OAuth configs)

**File:** `apps/backend/src/app/api/latest/integrations/idp.ts:167`

Validator accepts both `stack-auth.com` and `hexclave.com` domains. Leave existing DB rows untouched; new configs use the new domain.

### Email config name

**Files:** `apps/backend/src/lib/emails.tsx`, `apps/backend/prisma/seed.ts`

Update `getSharedEmailConfig("Stack Auth")` → `getSharedEmailConfig("Hexclave")`. Bundled with the seed migration; same idempotency rules.

### Things NOT migrated (locked)

- Clickhouse `analytics_internal` database name — never user-visible
- Postgres DB name `stackframe` — would orphan every dev's local volume
- Prisma schema tables/columns — no "stack" in them, nothing to rename
- Historical migration filenames — already applied

---

## Tier 4 — Brand strings (mechanical sweep, no compat needed)

### GitHub repo slug

Canonical repo becomes **`hexclave/hexclave`** (was `hexclave/stack-auth`). GitHub will redirect old URLs for browser/git usage, but all newly-generated content uses the canonical URL.

Surfaces to update:
- `repository` fields in all `package.json` files (root + every package + every example)
- `homepage` fields where present
- README, CONTRIBUTING, SECURITY links
- Docs links to GitHub source files
- Mintlify navbar GitHub link in `docs-mintlify/docs.json`
- Generated setup prompts
- Example projects
- GitHub issue/PR templates
- Workflow file repo references
- Raw GitHub asset URLs in CHANGELOG (`raw.githubusercontent.com/stack-auth/stack-auth/`)
- `.github/workflows/swift-sdk-publish.yaml` — currently references `stack-auth/swift-sdk-prerelease`; decide its new home (likely `hexclave/swift-sdk-prerelease` or fold into main repo)

### Domain inventory

Complete old→new table. All old domains keep resolving/redirecting indefinitely.

| Old | New | Notes |
|---|---|---|
| `api.stack-auth.com` | `api.hexclave.com` | Apple sign-in setup requires old domain — keep working indefinitely |
| `app.stack-auth.com` | `app.hexclave.com` | |
| `stack-auth.com` | `hexclave.com` | Marketing root |
| `docs.stack-auth.com` | `docs.hexclave.com` | |
| `discord.stack-auth.com` | `discord.hexclave.com` | |
| `demo.stack-auth.com` | `demo.hexclave.com` | |
| `mcp.stack-auth.com` | `mcp.hexclave.com` | MCP server endpoint |
| `skill.stack-auth.com` | `skill.hexclave.com` | Skill resource server |
| `built-with-stack-auth.com` | `built-with-hexclave.com` | Hosted-component subdomain pattern |
| `r.stack-auth.com` | `r.hexclave.com` | Analytics/replay endpoint |
| `feedback.stack-auth.com` | `feedback.hexclave.com` | |
| `test.stack-auth.com` | `test.hexclave.com` | |
| `preview.stack-auth.com` | `preview.hexclave.com` | |
| `api2.stack-auth.com` | `api2.hexclave.com` | |
| `api.staging.stack-auth.com` | `api.staging.hexclave.com` | |
| `idp-jwk-audience.stack-auth.com` | `idp-jwk-audience.hexclave.com` | See JWT section |

**OAuth callback URLs in provider setup docs:** teach new Hexclave callbacks; include a compatibility note that old callback URLs registered with providers continue to work.

### Emails

| Old | New |
|---|---|
| `noreply@stackframe.co` | `noreply@hexclave.com` |
| `security@stack-auth.com` | `security@hexclave.com` |
| `team@stack-auth.com` | `team@hexclave.com` |

Set up new mailboxes; forward old → new during transition.

### Page titles and metadata

| Old | New | Where |
|---|---|---|
| "Stack Auth Dashboard" | "Hexclave Dashboard" | `apps/dashboard/src/app/layout.tsx` |
| "Stack Auth API" | "Hexclave API" | `apps/backend/src/app/layout.tsx` |
| "Stack REST API" | "Hexclave REST API" | `docs-mintlify/openapi/{server,admin,client}.json` |
| "Stack Webhooks API" | "Hexclave Webhooks API" | `docs-mintlify/openapi/webhooks.json` |
| "Stack Auth Documentation" | "Hexclave Documentation" | `docs-mintlify/docs.json` |

### Generated content / AI / MCP / skills

These are AI-generated or template-generated; **update the generator first, then regenerate outputs**. Verify no generated file reintroduces "Stack Auth" branding unintentionally.

Source generators to update:
- `docs-mintlify/snippets/home-prompt-island.jsx`
- Setup prompt generation scripts (`scripts/generate-setup-prompt-docs.ts` or similar)
- `packages/stack-shared/src/ai/prompts.ts`
- `packages/stack-shared/src/helpers/init-prompt.ts`
- `apps/backend/src/lib/ai/prompts.ts`
- `apps/mcp/src/setup-page.ts`
- `apps/skills/src/app/route.ts`
- `skills/stack-auth/SKILL.md` (consider renaming dir to `skills/hexclave/`)

Generated artifacts to regenerate after generator updates:
- Docs MDX under `docs-mintlify/`
- OpenAPI `servers`, `x-full-url`, titles
- Setup prompts
- Hosted skill outputs
- MCP browser references

### OpenAPI schema header documentation

**Decision: Hexclave-only canonical, with a compatibility note.**
- OpenAPI documents `X-Hexclave-*` request headers as canonical
- A single compatibility note in the OpenAPI description explains that `X-Stack-*` aliases are accepted on every endpoint
- Backend schema routes that explicitly enumerate `X-Stack-*` get dual schema entries (both names accepted, only new name documented as primary)
- Response headers documented under `X-Hexclave-*` as canonical; compat note explains that `X-Stack-*` equivalents are emitted in parallel and read by older clients

### Visual / branding assets

Asset filenames can stay or be renamed; the contents are what matter. Update:
- `.github/assets/logo.png` (+ other logo/screenshot assets)
- Docs logos: `docs-mintlify/images/logo-{dark,light}.svg`, OG images
- Favicons across apps
- Dashboard logo/wordmark components
- README screenshots/GIFs (rerun capture)
- Package README badges
- App icons under `docs-mintlify/images/app-icons/`
- Social cards (Twitter/OpenGraph)

### Known-error message templates (user-visible)

`packages/stack-shared/src/known-errors.tsx` has user-facing error message templates that reference specific header names and docs URLs. Lines 246, 256, 269, 286, 299, 710 reference `x-stack-access-type`, `x-stack-project-id`, `x-stack-publishable-client-key`, etc. Lines 271, 288 link `docs.stack-auth.com`. Update messages to lead with the canonical `x-hexclave-*` header name and the new docs domain; keep mentions of `x-stack-*` only as a compat alias note. Test assertions on these message strings must update in lockstep.

### Email strings (subjects + body content)

Not just subjects — body strings too. Hardcoded in source, not in DB templates. Search exhaustively for "Stack Auth" inside email-related files.

- "Test Email from Stack Auth" — `apps/backend/src/app/api/latest/internal/send-test-email/route.tsx`
- "Thank you for using Stack Auth!" — `apps/backend/src/app/api/latest/internal/failed-emails-digest/route.ts`
- "Stack Auth User" default passkey display name
- Any other hardcoded subject/body containing "Stack Auth" — grep before PR 1

### CHANGELOG title flip

`CHANGELOG.md` title becomes "Hexclave Changelog" in PR 1. Existing entries' commit-by-commit context preserves continuity; no need to dual-name the title.

### Contributor / agent guidance

- `AGENTS.md` currently says: *"Any environment variables you create should be prefixed with `STACK_`"*. Flip to prefer `HEXCLAVE_*` for Category A/B; document that Category C/E vars stay `STACK_*`.
- Update any other contributor guidance referencing brand strings.

### Other Tier 4 sweeps (same PR)

- README.md, CONTRIBUTING.md, CHANGELOG.md (title flip per above), AGENTS.md (env var guidance per above)
- 49 docs files referencing `Stack*` class names in code examples (Hexclave-only after the rewrite; one compat note per page where relevant)
- 72 docs files referencing `@stackframe/*` package names in install snippets
- 11 example projects (`examples/`) — including hardcoded `https://app.stack-auth.com` links in their UIs and `.env` comments
- `.github/SECURITY.md`, PR template, workflow file refs
- `skills/stack-auth/SKILL.md` (consider directory rename to `skills/hexclave/`; old directory can stay as a pointer if needed)
- Dashboard setup-page snippets (`apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/(overview)/setup-page.tsx`) — copy-pasteable code blocks shown to customers
- Init wizard prompts (`packages/init-stack/`) — user-facing CLI messaging

---

## Do not rename — `stack-*` literals kept indefinitely

Items that contain "stack" in their literal name and intentionally stay that way. No Hexclave equivalent will exist.

| What | Why |
|---|---|
| `x-stack-auth` legacy JSON-encoded header | No current writer; pure read-only compat path |
| `__Host-stack-temporary-chips-test-*` cookies | Internal, never user-visible, no functional reason to rename |
| `NEXT_PUBLIC_STACK_PORT_PREFIX` | Baked into every dev's local Docker setup |
| `POSTGRES_DB: stackframe` | Would orphan every dev's local volume |
| Self-host `STACK_*` env vars (Category C) | Out of scope; self-hosters unaffected |
| Build/dev/test env vars (`STACK_SKIP_TEMPLATE_GENERATION`, `STACK_TEST_SDK_FALLBACK`, etc.) | Internal-only, not user-facing |
| Swift legacy `StackAuth` package | Frozen but installable; new SDK lives in separate `Hexclave` package |

### Not in scope — never had "stack" branding to begin with

These are listed once for completeness so reviewers don't worry about them. The rebrand never touches them.

- Webhook event types (`user.created`, `team.updated`, etc.) — already generic
- Clickhouse `analytics_internal` database name
- `'internal'` project ID literal — a code constant, not a brand string
- `/handler/*` OAuth callback routes
- Prisma schema (tables / columns / enums)
- API key prefixes (`pck_`, `ssk_`) — opaque to users
- Historical migration filenames — already applied

---

## Implementation realities (architecture observations from pre-PR-1 review)

These aren't decisions — they're things the implementer should know before starting. Each comes from grepping the actual codebase.

1. **No `readDualHeader` helper exists — AND it's insufficient on its own.** [smart-request.tsx](apps/backend/src/route-handlers/smart-request.tsx) reads auth-level headers via individual `req.headers.get()` calls (~10 sites). But route handlers ALSO destructure header names directly from yup-validated schemas — e.g. [refresh/route.tsx:19,29](apps/backend/src/app/api/latest/auth/sessions/current/refresh/route.tsx:19) declares `"x-stack-refresh-token"` in the schema and destructures it from `headers` in the handler, and [password/update/route.tsx:27,34](apps/backend/src/app/api/latest/auth/password/update/route.tsx:27) does the same. **A helper at the auth-parse layer alone won't cover these.** PR 1 must either (a) add a header-name normalization step *before* yup schema validation that populates both old + new keys into `headers`, or (b) update every route schema that names a `x-stack-*` header to accept both names. (a) is mechanically smaller. CORS allowlist in `apps/backend/src/proxy.tsx` also needs both old + new names.

2. **JWT issuer validation is URL-built, not domain-matched.** [apps/backend/src/lib/tokens.tsx:58-104](apps/backend/src/lib/tokens.tsx:58) constructs allowed issuer URLs from `NEXT_PUBLIC_STACK_API_URL` and passes them as an exact-match array to `verifyJWT()`. There's no domain-substring check. Implementation must build **two arrays** (one per domain) and concatenate, OR refactor `getIssuer()` to return both variants.

3. **Cookie helper isn't fully centralized.** `stack-is-https` is written in at least 4 places that bypass the central helper (cookie.ts:280, 355; TanStack integration:198; backend OAuth setters). Dual-write requires refactoring those to use shared constants, not just editing one helper.

4. **Bearer prefix parser location TBD.** The agent review couldn't pinpoint where `Bearer stackauth_*` is actually parsed — likely JWT validation in `packages/stack-shared/src/utils/jwt.tsx` or in middleware, not in `smart-request.tsx`. Locating is a PR 1 prerequisite.

5. **NPM dual-publish needs the copy-to-temp pattern, not in-place rewrite.** The plan's original "rewrite package.json names, then `pnpm publish -r` again" approach won't work — pnpm uses a shared lockfile, so after rewrite it can't resolve `@hexclave/X` workspace refs. **Concrete fix:** the rewrite script copies `dist/` artifacts and each package.json into a temp directory, rewrites the temp copies (names + deps), and publishes from temp. Workspace lockfile stays untouched.

   ```yaml
   - name: Rewrite to @hexclave/* in temp dir
     run: pnpm tsx scripts/rewrite-packages-to-hexclave.ts --out /tmp/hexclave-pkgs
   - name: Publish @hexclave/* packages
     run: pnpm publish --no-git-checks --access public --recursive /tmp/hexclave-pkgs
   ```

6. **Config discovery is not one function.** `init` (`packages/stack-cli/src/commands/init.ts`) hardcodes `stack.config.ts` output; `dev` requires explicit `--config-file`; dashboard local-dev linking discovers separately. Adding "prefer `hexclave.config.ts`, fall back to `stack.config.ts`" requires updating each discovery site.

7. **Symbol attach-and-lookup sites unknown.** `stackAppInternalsSymbol` is defined in [common.ts:213](packages/template/src/lib/stack-app/common.ts:213). Every site that does `app[stackAppInternalsSymbol] = …` and every `app[stackAppInternalsSymbol]` read needs dual treatment. Estimated 5-20 sites; enumerate during PR 1.

8. **Snapshot serializer hardcodes `"stack-oauth-inner-"`** at [apps/e2e/tests/snapshot-serializer.ts:119](apps/e2e/tests/snapshot-serializer.ts:119). Update to also recognize `"hexclave-oauth-inner-"` or snapshots will go noisy during dual-write.

9. **Test assertion sweep.** Roughly 7+ e2e tests assert on exact `"Stack Auth: …"` error message prefixes and specific header names (`expect(...).toEqual({"x-stack-auth": ...})`, etc.). Update in lockstep with implementation in PR 1.

10. **CLI Sentry DSN compile-time bake.** `packages/stack-cli/tsdown.config.ts` embeds `__STACK_CLI_SENTRY_DSN__`. Existing DSN stays (per locked decision); just be aware that old released CLI versions will keep emitting under their old DSN indefinitely — that's intentional.

---

## PR 1 verification matrix

Compatibility-sensitive enough to be part of the implementation plan, not implicit.

### Auth wire
- [ ] Backend accepts every `x-stack-*` request header (incl. `x-stack-api-key`, `x-stack-request-type`, `x-stack-override-error-status`)
- [ ] Backend accepts every `x-hexclave-*` request header (incl. `x-hexclave-api-key`, `x-hexclave-request-type`, `x-hexclave-override-error-status`)
- [ ] Both header sets mixed in same request work
- [ ] CORS preflight allowlist in `proxy.tsx` includes both old + new names for request AND response headers
- [ ] New SDK emits `x-hexclave-*` by default
- [ ] Old SDK (unchanged) authenticates successfully
- [ ] Backend accepts `Authorization: Bearer stackauth_*`
- [ ] Backend accepts `Authorization: Bearer hexclave_*`
- [ ] New SDK constructs tokens with `Bearer hexclave_*` prefix
- [ ] `x-stack-auth: {...}` legacy header continues to be parsed (no Hexclave equivalent emitted)
- [ ] Backend emits BOTH `x-stack-*` and `x-hexclave-*` response headers (`actual-status`, `known-error`, `request-id`)
- [ ] New SDK reads `x-hexclave-*` response headers, falls back to `x-stack-*`
- [ ] Old SDK still reads `x-stack-*` response headers correctly

### Cookies
- [ ] Sign-in with old `stack-access` / `stack-refresh-*` only → succeeds
- [ ] Sign-in with new `hexclave-access` / `hexclave-refresh-*` only → succeeds
- [ ] Both old + new cookies present → no conflict, new preferred
- [ ] Sign-out clears both old + new names
- [ ] Legacy `stack-refresh` (pre-projectId) still readable and deletable on sign-out
- [ ] OAuth flow dual-writes `stack-oauth-{inner,outer}-*` and `hexclave-oauth-{inner,outer}-*`
- [ ] OAuth callback reads either cookie name and completes flow
- [ ] Low-risk cookies (`stack-is-https`, changelog, cli-auth-confirmed) dual-written under both names
- [ ] CHIPS test cookies still under `__Host-stack-temporary-chips-test-*` (not renamed)
- [ ] Mobile OAuth callback (`stack-auth-mobile-oauth-url://`) unchanged

### Env vars
- [ ] Old env only (every customer-facing var in Category A) → SDK initializes, deprecation warning emitted
- [ ] New env only → SDK initializes, no warning
- [ ] Both envs with different values → new wins, deprecation warning emitted
- [ ] Multi-alias Category B vars: all historical aliases readable, new canonical preferred
- [ ] `NEXT_PUBLIC_STACK_PORT_PREFIX` still works under that exact name (not renamed)
- [ ] Generated GitHub workflow with `STACK_AUTH_*` vars continues to authenticate
- [ ] Newly generated workflow emits `HEXCLAVE_*` and authenticates
- [ ] Self-host vars (Category C) untouched — `.env` files for operators unchanged
- [ ] Build/dev/test vars (Category E) still under `STACK_*` — no rename attempted

### JWT
- [ ] Old normal issuer (`api.stack-auth.com/.../projects/{id}`) validates
- [ ] Old anonymous issuer validates
- [ ] Old restricted issuer validates
- [ ] New equivalents (all three) validate
- [ ] Convex provider config exposes new issuer URLs

### MCP
- [ ] `ask_hexclave` tool works
- [ ] `ask_stack_auth` tool still works
- [ ] Setup pages teach new tool name

### CLI
- [ ] `stack` binary still works
- [ ] `hexclave` binary works
- [ ] Old `~/.config/stack-auth/credentials.json` read on first run
- [ ] After first run, `~/.config/hexclave/credentials.json` exists
- [ ] Project config discovery: `hexclave.config.ts` preferred; falls back to `stack.config.ts`
- [ ] `hexclave init` generates `hexclave.config.ts` for new projects
- [ ] Existing project with only `stack.config.ts` works without migration
- [ ] `hexclave dev --config-file ./stack.config.ts` works (explicit override)
- [ ] GitHub config push writes to whichever filename already exists in customer repo

### Packages
- [ ] `npm install @stackframe/stack` → imports `StackClientApp` AND `HexclaveClientApp`
- [ ] `npm install @hexclave/stack` → same, both aliases available
- [ ] Generated `.d.ts` exposes both names
- [ ] Source maps resolve
- [ ] Both packages can be installed side-by-side without conflicts
- [ ] `npm-publish.yaml` runs build → publish @stackframe → rewrite → publish @hexclave with no failures
- [ ] Rewrite script correctly updates `dependencies` / `peerDependencies` to `@hexclave/*` versions
- [ ] `@hexclave/cli` package registers `hexclave` binary
- [ ] `Symbol.for("StackAuth--app-internals")` and `Symbol.for("Hexclave--app-internals")` both resolve to the same internals

### Swift
- [ ] Existing `StackAuth` SPM package still installable from its existing git URL
- [ ] Existing `import StackAuth` code continues to work unchanged
- [ ] New `Hexclave` SPM package installable from new URL
- [ ] `import Hexclave; let app = HexclaveClientApp(...)` works
- [ ] New `Hexclave` package default base URL is `api.hexclave.com`

### Docs
- [ ] No unintended "Stack Auth" brand strings in new docs (lint pass)
- [ ] Old names appear only in compatibility sections
- [ ] Link checker passes against new GitHub slug + new domains
- [ ] OpenAPI shows `X-Hexclave-*` as canonical with compat note

### Migrations
- [ ] Default `Stack Dashboard` → `Hexclave Dashboard` updates
- [ ] User-modified display names not overwritten
- [ ] Missing row no-ops safely

### Tests + CI
- [ ] All test assertions on header names updated (search for `"x-stack-"` in `apps/e2e/tests/`)
- [ ] All test assertions on cookie names updated (incl. `expect(...).toMatch(/stack-oauth-inner-/)` patterns)
- [ ] Snapshot serializer (`apps/e2e/tests/snapshot-serializer.ts`) handles both `stack-oauth-inner-*` AND `hexclave-oauth-inner-*` prefixes
- [ ] Existing snapshot files regenerated cleanly (only the 1 known snapshot file)
- [ ] Test error messages updated for "Stack Auth: …" → "Hexclave: …" pattern
- [ ] `HexclaveAssertionError` message reads "This is likely an error in Hexclave."
- [ ] CI workflows pass with both old and new package names installable

---

## Rollout — 2 PRs

### PR 1: "Rebrand to Hexclave (additive)" — now

One large additive PR. Nothing deleted. Existing users continue working untouched. Verification matrix above must pass. **Prerequisite (not in the PR itself): exhaustive operator env var inventory** — see Category C.

Major work items:
- Header / cookie / env var dual-accept (Tier 0)
- Template re-exports propagating to generated SDKs (Tier 1 JS)
- Swift: stand up new `Hexclave` SPM package with real `Hexclave*` symbols + `api.hexclave.com` base URL; freeze existing `StackAuth` package
- `sdks/spec` update
- Publish-time mirror artifacts for `@hexclave/*` packages (Tier 2)
- CLI dual config paths + binary alias
- JWT validator accepts both domains for all 3 issuer types
- MCP dual tool registration
- Idempotent seed/data migration with tests
- Mechanical sweep: domains (full inventory), repo slug, page titles, OpenAPI titles, generated content (after generator updates), examples, README family, assets
- DNS: stand up all `*.hexclave.com` subdomains; redirect from `*.stack-auth.com`
- `turbo.json` `globalEnv` adds `HEXCLAVE_*`

### PR 2: "Remove non-essential Stack Auth fallbacks" — 12+ months later

Only after operational evidence shows the targeted fallbacks are unused (telemetry decision deferred from PR 1).

Pure deletion, but **narrowly scoped**. Wire identifiers (request headers, response headers, JWT issuers, Bearer prefix, OAuth state cookies, mobile URL scheme, SDK class aliases) stay indefinitely and are NOT touched by PR 2. The legacy `StackAuth` Swift package stays installable but unmaintained — also untouched. Same goes for everything in "Do not rename".

Safely removable in PR 2:

- Stop dual-writing main auth cookies under their old `stack-*` names (old cookies have long expired naturally; reads of old names can also be dropped)
- Stop reading `STACK_*` customer SDK env vars (or hard-error with a migration message) — only after operator dashboards confirm low usage
- Remove `ask_stack_auth` MCP tool — only after AI client adoption of `ask_hexclave` is high
- Tear down non-essential `*.stack-auth.com` subdomains (keep `api.stack-auth.com` indefinitely — Apple sign-in setup depends on it)
- `@stackframe/*` published packages: leave on npm with a "moved to `@hexclave/*`" README; do not unpublish (npm unpublishing breaks the ecosystem)

**Explicitly NOT removed in PR 2:**

- `x-stack-*` request headers (kept dual-accepted indefinitely)
- `x-stack-*` response headers (kept dual-emitted indefinitely)
- `Bearer stackauth_*` prefix (kept dual-accepted indefinitely)
- `x-stack-auth` legacy header (still parsed)
- JWT validator's acceptance of all three `stack-auth.com` issuer variants and the IdP audience
- JS `Stack*` exports — they're the canonical class names, not aliases
- Legacy `StackAuth` Swift package (frozen but installable from existing SPM URL)
- OAuth state cookies (`stack-oauth-*`), CHIPS test cookies, `stack-auth-mobile-oauth-url://`
- `stack.config.ts` filename (still readable as fallback)
- Everything in the "Do not rename" table

---

## Open questions still worth answering before implementation

- **Operator env var inventory:** must be produced before PR 1 implementation begins. Once produced, decide whether category C scope fits in PR 1 or needs to be deferred to a follow-up. Current plan: include in PR 1 if scope is manageable.
- **SDK request header emission:** new SDKs emit `x-hexclave-*` for every request header (current plan), or skip the most stable ones (e.g. `branch-id`) to reduce churn? Current plan: emit all.
- **DNS infrastructure:** ops team confirmation on indefinite redirect maintenance capacity for 16 subdomains.
- **Future canonicality flip (post PR 2):** is there any reason to ever make `Hexclave*` the canonical class name in JS or Swift, with `Stack*` as the alias? Current plan: no — coexistence indefinitely, neither is "more canonical".
- `hexclave.config.ts` is the new canonical config filename; `stack.config.ts` read-fallback stays in discovery indefinitely. We'd only drop the fallback after telemetry shows essentially no projects rely on it.
- DNS infrastructure ownership for redirects — operations team needs to confirm capacity for indefinite redirect maintenance.
