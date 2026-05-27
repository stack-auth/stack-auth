# Stack Auth → Hexclave Rename Plan (v7)

Rebrand rollout with backwards compatibility. Organized by wire-compatibility risk: what breaks existing users vs. what's purely cosmetic.

**Rollout strategy:** three PRs. **PR 1** is invisible — wire-level dual-accept/dual-write, SDK export aliases, and internal renames, all shipped inside the existing `@stackframe/*` packages and existing deploys; nothing breaks and no Hexclave branding is yet visible to any user. **PR 2** makes the brand public — new `@hexclave/*` and Swift packages, `@deprecated` markers on old names, and every user-facing string, domain, title, and doc. **PR 3** (12+ months later) removes only the safely-removable fallbacks once telemetry confirms they're unused. See [Rollout](#rollout--3-prs).

## Locked-in decisions

- GitHub canonical repo: **`hexclave/hexclave`** (was `hexclave/stack-auth`)
- SDK-internal legacy identifiers — kept readable indefinitely, no Hexclave variant added:
  - `x-stack-auth` (legacy JSON-encoded auth header) — produced by the deprecated `getAuthHeaders()` / `useAuthHeaders()` SDK methods, read by the SDK's `tokenStore: { headers }` parser. Never travels to the Stack backend. Frozen because its producers are `@deprecated` in favor of `getAuthorizationHeader()` (the Bearer path).
- **Symmetric dual-support** (old kept indefinitely, new is preferred / emitted by new code):
  - All `x-stack-*` request headers ↔ `x-hexclave-*` equivalents (dual-accept)
  - All `x-stack-*` response headers ↔ `x-hexclave-*` equivalents (dual-emit)
  - `Bearer stackauth_*` ↔ `Bearer hexclave_*`
  - All `stack-*` cookies (auth, OAuth state, low-risk UI) ↔ `hexclave-*` equivalents (dual-write)
  - All three `stack-auth.com` JWT issuer variants ↔ `hexclave.com` (validator accepts both)
  - `stack.config.ts` ↔ `hexclave.config.ts` (discovery prefers new, falls back to old)
  - `stack-auth-mobile-oauth-url://` ↔ `hexclave-mobile-oauth-url://` (backend accepts both schemes; new Swift SDK registers the new one)
  - `Symbol.for("StackAuth--app-internals")` ↔ `Symbol.for("Hexclave--app-internals")` (attach under both, look up both)
  - JS public `Stack*` exports stay canonical; `Hexclave*` added as aliases — both kept indefinitely. `Stack*` names get `@deprecated` JSDoc in PR 2. **Internal-only** symbols (the three SDK interfaces, `StackAssertionError`) are renamed outright with no alias — see Tier 1
- **Swift SDK: separate package**, not typealiases. `StackAuth` Swift package frozen at existing git URL — old users keep `import StackAuth`. New `Hexclave` Swift package (new git URL) is the canonical going-forward SDK with real `Hexclave*` symbols. Breaking changes allowed between versions; old package remains installable but unmaintained.
- New docs teach **Hexclave-only** names; old names appear only in explicitly-marked compatibility notes
- All env vars are **dual-read** (`HEXCLAVE_*` accepted alongside `STACK_*`, new name preferred) across every category — including self-host/operator (Category C) and build/dev/test (Category E) vars. Sole exception: `NEXT_PUBLIC_STACK_PORT_PREFIX`, renamed outright (dev-only, no dual-accept)
- `@hexclave/*` packages dual-published via rewrite step in `.github/workflows/npm-publish.yaml` (see Tier 2)
- **Sentry / PostHog / observability DSNs** — out of scope. Existing DSNs continue unchanged. No project renames in either tool.
- **`skill.stack-auth.com`** — DNS redirects to `skill.hexclave.com`; both URLs serve identical content indefinitely. Customers with cached MCP configs pointing at old domain keep working.
- **`StackAssertionError`** — internal-only (not exported from any customer SDK entrypoint), so it is renamed to `HexclaveAssertionError` with **no alias** (see Tier 1). Its error message string updates from "This is likely an error in Stack." → "This is likely an error in Hexclave." as part of the Tier 4 brand-string sweep (PR 2).
- **CHANGELOG title** — becomes "Hexclave Changelog" in PR 2 (Tier 4 brand string). History continuity preserved through commit log, not title.
- **Test assertion updates** — every test that asserts on header names, cookie names, error message prefixes, etc. updates in lockstep with the implementation, in whichever PR changes that identifier (wire identifiers in PR 1, brand strings in PR 2).
- **`@hexclave/*` package versions** start at `1.0.0` and bump in lockstep with `@stackframe/*` releases — one `@hexclave` publish per `@stackframe` publish; absolute version numbers stay offset (`@stackframe/*` is currently `2.8.92`).
- **Old-package deprecation (PR 2)** — `@stackframe/*` packages are marked deprecated on npm via `npm deprecate`; the SDK additionally logs a `console.warn` once per process recommending the `@hexclave/*` equivalent. All `Stack*`-named public exports get `@deprecated` JSDoc. Exact warning wording is an implementation-time decision.
- **CHIPS partitioned-cookie test** — the feature is no longer used and will be removed in a separate change; this rebrand ignores it entirely (no rename, no dual-write).
- **Docker registry path / image naming** — not part of this rebrand; existing image tags continue.
- Telemetry is deferred; not blocking PR 1

## Scale at a glance

| Surface | Count |
|---|---|
| HTTP headers (`x-stack-*`) | 21 |
| Cookies | ~12 |
| Customer-facing env vars | ~20+ |
| `@hexclave/*` mirror packages | 9 |
| Public SDK classes/components/hooks (JS) | ~12 |
| Swift module + symbols | 1 module, ~10 symbols |
| Domain references | 625+ |
| Total brand string references | ~1,000+ |

---

## Tier 0 — Wire identifiers (dual-accept indefinitely)

These travel between SDK and backend, or get baked into third-party systems. **Alias, never replace.**

### SDK-internal legacy identifiers (no Hexclave variant)

*Discovery correction:* `x-stack-auth` is **not** a backend wire identifier — `apps/backend` and `packages/stack-shared` contain zero references to it. Like the `Bearer stackauth_` prefix, it lives entirely in the SDK (`packages/template`).

| Identifier | What | Treatment |
|---|---|---|
| `x-stack-auth: { accessToken, refreshToken }` | Legacy JSON-encoded auth header | **Produced** by the SDK's `getAuthHeaders()` / `useAuthHeaders()` methods (`client-app-impl.ts:1640,3471` — both `@deprecated` in favor of `getAuthorizationHeader()`). **Consumed** by the SDK's `tokenStore: { headers }` parser at `client-app-impl.ts:1098-1113`. The flow is client SDK → the developer's own server → a server-side Stack SDK; the Stack backend is never in the path. Frozen: the producing methods are deprecated, so no `x-hexclave-auth` variant is added — the parser keeps reading `x-stack-auth` indefinitely. New code uses `getAuthorizationHeader()` (the `hexclave_` Bearer path). |

### Symmetric dual-support (old kept, new is canonical)

These follow the same pattern as request headers: old form continues to work indefinitely; new form is preferred and emitted by new code.

| Concept | Old (read indefinitely) | New (canonical, written by new code) |
|---|---|---|
| Bearer auth prefix | `Authorization: Bearer stackauth_<base64>` | `Authorization: Bearer hexclave_<base64>` |
| Response/protocol headers | `x-stack-actual-status`, `x-stack-known-error`, `x-stack-request-id` | `x-hexclave-actual-status`, `x-hexclave-known-error`, `x-hexclave-request-id` (dual-emitted) |
| Config filename | `stack.config.ts` | `hexclave.config.ts` |
| Mobile OAuth URL scheme | `stack-auth-mobile-oauth-url://` | `hexclave-mobile-oauth-url://` |

**Bearer prefix details.** *Discovery correction:* the `Bearer stackauth_<base64>` token is **not** a backend wire identifier — the Stack backend never parses it. It is an SDK-internal serialization of `{ accessToken, refreshToken }` for the `tokenStore: { headers }` init path; the SDK decodes it itself and then sends `x-stack-access-token` / `x-stack-refresh-token` to the backend. Dual-support lives entirely in `packages/template` (`client-app-impl.ts`): accept either prefix on parse, emit `hexclave_`. No backend change. See the [PR 1 implementation guide](#pr-1-implementation-guide-resolved-from-codebase-discovery).

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

**Implementation pattern:** normalize `x-hexclave-*` → `x-stack-*` at the existing (currently-empty) request-header hook in `apps/backend/src/proxy.tsx:114`, before routing and yup validation — so `smart-request.tsx` and every route schema keep working unchanged. No `readDualHeader` helper, no per-route edits. Details and the exact reader sites are in the [PR 1 implementation guide](#pr-1-implementation-guide-resolved-from-codebase-discovery).

**CORS sync requirement.** `apps/backend/src/proxy.tsx` maintains explicit allowlists — `corsAllowedRequestHeaders` (lines 16-48) and `corsAllowedResponseHeaders` (lines 50-54). `apps/dashboard/src/proxy.tsx` has a near-duplicate pair (lines 13-34). Every old + new header name must appear in all of them or CORS preflight fails. Easy to miss.

### HTTP response/protocol headers (dual-emit)

These flow backend → client. Covered in the symmetric dual-support table above. Backend emits both `x-stack-*` and `x-hexclave-*` versions of `actual-status`, `known-error`, `request-id` on every response. New SDKs read `x-hexclave-*` first, fall back to `x-stack-*`.

> **Note on `x-stack-override-error-status`:** this is a **request** header (client tells backend to override response status before backend emits `x-stack-actual-status`). It's in the request-header table above, dual-accepted as `x-hexclave-override-error-status`.

### Authorization Bearer formats

**SDK-internal — not a backend identifier.** The `Bearer stackauth_*` token is parsed and emitted entirely within the SDK (`packages/template`); the Stack backend never sees it. The SDK's token parser accepts both `stackauth_` and `hexclave_` prefixes; new SDK code emits `hexclave_`. Exact functions and line numbers in the [PR 1 implementation guide](#pr-1-implementation-guide-resolved-from-codebase-discovery).

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

**CHIPS test cookies — out of scope.** The `__Host-stack-temporary-chips-test-*` probe cookies belong to the partitioned-cookie support test (`_internalShouldSetPartitionedClient` in `packages/template/src/lib/cookie.ts`). These are ephemeral — set and deleted within the same synchronous call, never persisted. The feature is no longer used and is slated for removal in a separate change, so this rebrand does not touch it: no rename, no dual-write.

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
| `_STACK_AUTH.lastUsed` (localStorage, dot-delimited — `packages/template/src/components/oauth-button.tsx`) | `_HEXCLAVE.lastUsed` |
| `stack:session-replay:v1:{projectId}` (localStorage, colon-delimited versioned prefix — `packages/template/src/lib/stack-app/apps/implementations/session-replay.ts`) | `hexclave:session-replay:v1:{projectId}` |
| `__stack-dev-tool-state` (localStorage — `packages/template/src/dev-tool/dev-tool-core.ts`) | `__hexclave-dev-tool-state` |
| `stack-devtool-trigger-position` (localStorage — `packages/template/src/dev-tool/dev-tool-core.ts`) | `hexclave-devtool-trigger-position` |

Delimiter conventions are inconsistent across these keys (hyphen, underscore, dot, colon) — preserve each key's existing convention for its new name so the access pattern stays identical.

**Per-key risk.** The docs `sessionStorage` keys and `stack_mfa_attempt_code` follow the dual-write / prefer-new pattern. The dev-tool keys (`__stack-dev-tool-state`, `stack-devtool-trigger-position`) and the OAuth `_STACK_AUTH.lastUsed` last-provider hint are UI-only local preferences — a one-time reset on rename is harmless, so a straight rename is acceptable. `stack:session-replay:v1:*` holds an in-progress recording session ID; dual-read the old key so a recording session active across the SDK upgrade is not orphaned.

### Query parameters (dual-accept)

`stack_*` / `stack-*` URL query parameters travel between SDK and backend, or across domains during auth handoffs — the same wire-compatibility risk class as headers. Earlier plan versions had no query-parameter category. **Alias, never replace:** the reader accepts both names; new code emits the new name.

| Old (accepted indefinitely) | New (preferred) | Flow |
|---|---|---|
| `stack_response_mode` | `hexclave_response_mode` | SDK → backend (OAuth authorize) — **the only query param the backend reads** |
| `stack_cross_domain_auth` (marker, value `"1"`) | `hexclave_cross_domain_auth` | cross-domain handoff (SDK ↔ SDK), SDK-internal |
| `stack_cross_domain_state` | `hexclave_cross_domain_state` | cross-domain handoff, SDK-internal |
| `stack_cross_domain_code_challenge` | `hexclave_cross_domain_code_challenge` | cross-domain handoff, SDK-internal |
| `stack_cross_domain_after_callback_redirect_url` | `hexclave_cross_domain_after_callback_redirect_url` | cross-domain handoff, SDK-internal |
| `stack_nested_cross_domain_auth_refresh_token_id` | `hexclave_nested_cross_domain_auth_refresh_token_id` | nested cross-domain handoff, SDK-internal |
| `stack_nested_cross_domain_auth_callback_url` | `hexclave_nested_cross_domain_auth_callback_url` | nested cross-domain handoff, SDK-internal |
| `stack-init-id` | `hexclave-init-id` | init CLI → dashboard wizard-congrats page |

**`stack_response_mode`** — emitted by `packages/stack-shared/src/interface/client-interface.ts:1419`, read by the yup query schema at `apps/backend/src/app/api/latest/auth/oauth/authorize/[provider_id]/route.tsx:42` (used at :160,:166). The backend schema must accept both keys (prefer new). This needs genuine dual-accept, not a rename: if the param is dropped silently the backend falls back to `responseMode: "redirect"` and the SDK can no longer intercept bot challenges before navigating. **This is the only `stack_*` query param the backend itself parses** — all the others below are SDK↔SDK only.

**`stack_cross_domain_*`** — the four param names are the `crossDomainAuthQueryParams` const at `packages/template/src/lib/stack-app/apps/implementations/redirect-page-urls.ts:5-10`; the `stack_cross_domain_auth === "1"` marker is read at `packages/template/src/components-page/stack-handler-client.tsx:267`. The two `stack_nested_cross_domain_auth_*` params are the `nestedCrossDomainAuthQueryParams` object at `client-app-impl.ts:89-97` (written :847,:849; read :860,:863). Writer and reader are both in the SDK, so a handoff between two SDK majors (one per domain) must still resolve: dual-emit both param sets into the redirect URL, and accept either on read. (The non-prefixed OAuth params in `nestedCrossDomainAuthQueryParams` — `redirect_uri`, `state`, `code_challenge`, etc. — are standard OAuth and are **not** rebranded.)

**`stack-init-id`** — emitted by `packages/init-stack/src/index.ts:452`, read by `apps/dashboard/src/app/(main)/wizard-congrats/posthog.tsx:12`. Dashboard reads either key; new `init` CLI emits the new one. Low-stakes (PostHog distinct-id correlation only) but follows the same pattern. Note the hyphen delimiter — the cross-domain and response-mode params use underscores; preserve each.

### Custom DOM events

The docs site syncs platform/framework selection across components via `window`-dispatched `CustomEvent`s with `stack-`-prefixed names. They pair with the `stack-docs-selected-*` sessionStorage keys above.

| Old | New |
|---|---|
| `stack-platform-change` | `hexclave-platform-change` |
| `stack-framework-change` | `hexclave-framework-change` |

**Files:** `docs/src/components/layouts/platform-indicator.tsx` and `docs/src/components/mdx/platform-codeblock.tsx` (both dispatch and listen). These events are dispatched and consumed entirely within a single docs-site page load — no cross-version or persistence concern. Straight rename; update dispatch and listener sites in lockstep.

### Dev tool (`packages/template/src/dev-tool/dev-tool-core.ts`)

The in-app dev tool ships inside the SDK (`packages/template`, propagated to every generated SDK) and is its own brand surface, missed by earlier plan versions. It spans tiers:

- **localStorage keys** — `__stack-dev-tool-state`, `stack-devtool-trigger-position` (in the Storage keys table above).
- **Header-emit site** — the AI tab builds a `fetch` to the AI endpoint with hand-written `X-Stack-Access-Type`, `X-Stack-Project-Id`, `X-Stack-Publishable-Client-Key` headers, bypassing the normal client interface. The request-header table covers the backend *accept* side; SDK header *emit* sites like this one must be switched to `x-hexclave-*` and enumerated during PR 1.
- **DOM identifiers** — element id `__stack-dev-tool-root`, global key `__stack-dev-tool-instance`, attribute `data-stack-devtool-trigger`. Internal, no compat needed — straight rename.
- **Brand strings / domains** — many "Stack Auth" UI strings and `docs.stack-auth.com` / `app.stack-auth.com` / `test.stack-auth.com` references; covered by the Tier 4 sweep + domain inventory, but the file must be on the sweep list.

---

## Tier 1 — Public SDK API (aliases for user-facing symbols, outright rename for internal ones)

### JS / React / Next.js / TanStack SDKs

Codegen makes this clean. `scripts/generate-sdks.ts` copies `packages/template` → `packages/{js,stack,react,tanstack-start}`. Add re-exports once in template; all generated packages get both names.

**Classification rule:** a symbol gets a `Hexclave*` alias only if it is **user-facing** — reachable from a customer SDK entrypoint (`@stackframe/stack` / `@stackframe/js` / `@stackframe/react`). Symbols that are internal-only — not in any customer SDK entrypoint — are renamed outright with no alias (next subsection).

Dual-export every user-facing `Stack*` symbol:

| Old (kept, `@deprecated` in PR 2) | New (alias added) |
|---|---|
| `StackClientApp` | `HexclaveClientApp` |
| `StackServerApp` | `HexclaveServerApp` |
| `StackAdminApp` | `HexclaveAdminApp` |
| `StackProvider` | `HexclaveProvider` |
| `StackHandler` | `HexclaveHandler` |
| `StackTheme` | `HexclaveTheme` |
| `useStackApp()` | `useHexclaveApp()` |
| `StackConfig` | `HexclaveConfig` |
| `defineStackConfig()` | `defineHexclaveConfig()` |
| `Stack*ConstructorOptions` | `Hexclave*ConstructorOptions` |
| `Stack{Client,Server,Admin}AppConstructor` | `Hexclave{Client,Server,Admin}AppConstructor` |
| `StackClientAppJson` | `HexclaveClientAppJson` |

The type cluster (`Stack*ConstructorOptions`, `Stack{Client,Server,Admin}AppConstructor`, `StackClientAppJson`) is obscure but *is* exported from the customer SDK index ([`packages/template/src/lib/stack-app/index.ts`](packages/template/src/lib/stack-app/index.ts)). Aliasing is free (`export type { X as Y }`) and a wrong rename would be breaking, so these keep aliases.

**Pattern:** `export { StackClientApp as HexclaveClientApp }`. Same class, both names. Users can mix freely. Adding the aliases is non-breaking and ships in **PR 1**; the `@deprecated` JSDoc on the `Stack*` names is IDE-visible (strikethrough) and ships in **PR 2**.

### Internal-only symbols — renamed outright, no alias

These are **not exported from any customer SDK entrypoint** (`@stackframe/stack` / `js` / `react`). The three interfaces are exported only from the low-level `@stackframe/stack-shared` package's index — an implementation-detail package, not a customer-facing API; `StackAssertionError` is not exported from any public index at all. Per the "internal-only → rename, no alias" rule they are renamed in place — every reference updates in lockstep, no `Stack*` name survives. Non-user-facing, so this lands in **PR 1**.

| Old (removed, no alias) | New |
|---|---|
| `StackClientInterface` | `HexclaveClientInterface` |
| `StackServerInterface` | `HexclaveServerInterface` |
| `StackAdminInterface` | `HexclaveAdminInterface` |
| `StackAssertionError` | `HexclaveAssertionError` (the class rename is PR 1; its user-visible message text "This is likely an error in Stack." → "Hexclave" is a Tier 4 brand string, PR 2) |

> If a pre-implementation grep finds any of these re-exported from a customer SDK entrypoint after all, that symbol moves back to the alias table — the rule is "internal *and* not directly reachable by users."

**Canonicality.** For the user-facing classes, `Stack*` remains the underlying class name and `Hexclave*` is the alias; both stay indefinitely (**PR 3 does not remove the `Stack*` names** — they're the originals). `Stack*` is marked `@deprecated` to steer new code toward `Hexclave*`, but "deprecated" here means "discouraged," not "scheduled for removal." A future effort could flip canonicality so `Hexclave*` is the real class — separate, optional, out of scope here.

`stack.config.ts` filename stays (locked decision). `showOnboardingStackConfigValue` stays internal — no alias needed.

Page components (`SignIn`, `SignUp`, `AuthPage`, `AccountSettings`, `UserButton`, `TeamSwitcher`, `OAuthButton`, `PasswordReset`, `EmailVerification`, `ForgotPassword`, `MessageCard`, `CliAuthConfirmation`) don't carry the brand — leave alone.

**Internal `Symbol.for(...)` keying.** Discovery found **four** distinct `Symbol.for()` strings containing "stack" (earlier plan versions listed three). Only the first is customer-visible — part of `StackClientApp`'s type surface, accessed by dashboard + example code — and needs dual-attach; the other three are file-private with no cross-version concern and are renamed outright.

| Old | New | Scope / treatment |
|---|---|---|
| `Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals")` | `Symbol.for("Hexclave--app-internals")` | Customer-visible. **3 definition sites:** `packages/template/src/lib/stack-app/common.ts:213`, `apps/dashboard/src/lib/stack-app-internals.ts:8`, `apps/dashboard/.../external-db-sync/page-client.tsx:24`. **Dual-attach.** |
| `Symbol.for("__stack-globals")` | `Symbol.for("__hexclave-globals")` | SDK-internal, file-private to `packages/stack-shared/src/utils/globals.tsx`. Straight rename. |
| `Symbol.for("stack-smartRouteHandler")` | `Symbol.for("hexclave-smartRouteHandler")` | Backend-only, file-private to `apps/backend/src/route-handlers/smart-route-handler.tsx`. Straight rename. |
| `Symbol.for("__stack_email_queue_first_run_completed")` | `Symbol.for("__hexclave_email_queue_first_run_completed")` | Backend-only, file-private to `apps/backend/src/lib/email-queue-step.tsx`. Straight rename. |

For the customer-visible symbol: on attach, write internals under BOTH symbols; on lookup, try new then old — so a page with two SDK majors keeps working. The other three are read and written within a single file, so a plain rename of the string is sufficient.

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

Per AGENTS.md, SDK implementation changes must update `sdks/spec` — bake this into the PR 2 checklist (the new Swift package is part of PR 2).

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
- Set `version`: `@hexclave/*` packages carry their **own** version line, starting at `1.0.0` and bumped once per `@stackframe/*` release (lockstep cadence — absolute numbers stay offset from `@stackframe/*`, currently `2.8.92`). The script reads the target `@hexclave` version from a single source (a `HEXCLAVE_VERSION` file or workflow input); all mirror packages share one version.
- Rewrite all `dependencies` / `peerDependencies` entries `@stackframe/X` → `@hexclave/X`, pinned to the **`@hexclave` version being published** (not the `@stackframe` version) — since all mirror packages share one version this is a single substitution
- Update `bin` entries where relevant (e.g. `@hexclave/cli` registers `hexclave` binary alongside the existing `stack`)
- Leave built `dist/` artifacts untouched (no rebuild needed)

`pnpm publish` skips versions already on npm, so reruns are safe. The workflow runs on a clean checkout each time, so no revert is needed.

Notes:
- Workspace remains `@stackframe/*`-keyed; `pnpm-workspace.yaml`, Turbo filters, and lockfile are unchanged
- Source maps, type declarations, `exports`, `typesVersions` resolve under both names because they're the same built artifacts
- The rewrite step only runs in CI; local development keeps using `@stackframe/*` names

### 9 mirrored packages

| Old (kept) | New (mirrored) |
|---|---|
| `@stackframe/react` | `@hexclave/react` |
| `@stackframe/stack` | `@hexclave/next` |
| `@stackframe/js` | `@hexclave/js` |
| `@stackframe/stack-shared` | `@hexclave/shared` |
| `@stackframe/stack-ui` | `@hexclave/ui` |
| `@stackframe/stack-sc` | `@hexclave/sc` |
| `@stackframe/stack-cli` | `@hexclave/cli` |
| `@stackframe/tanstack-start` | `@hexclave/tanstack-start` |
| `@stackframe/dashboard-ui-components` | `@hexclave/dashboard-ui-components` |

**`@stackframe/dashboard-ui-components` is publishable.** Earlier plan versions marked it "internal only" — that was wrong. It's loaded at runtime via esm.sh by the dashboard's create-dashboard sandbox host ([apps/dashboard/.../dashboard-sandbox-host.tsx](apps/dashboard/src/components/commands/create-dashboard/dashboard-sandbox-host.tsx)) plus served locally as an IIFE bundle (`dashboard-ui-components.iife.js`). Mirror it like the other public packages. The IIFE bundle filename also gets dual-served — both `dashboard-ui-components.iife.js` and a future Hexclave-branded path (TBD) until generated dashboards stored with the old filename can be updated.

**Not mirrored:**
- `@stackframe/template` — codegen source, internal.
- `@stackframe/init-stack` — the standalone init wizard. Stays published under its existing name (existing `npx @stackframe/init-stack` users keep working), but gets **no `@hexclave` mirror**: new-user onboarding moves to the CLI's `init` subcommand (`npx @hexclave/cli@latest init`). See CLI section.

**Not publishable, stay `@stackframe/*`:** `@stackframe/monorepo`, backend, dashboard, docs, mcp, hosted-components, skills, mock-oauth-server, e2e, internal-tool, dev-launchpad.

### Deprecating the `@stackframe/*` packages (PR 2)

`@stackframe/*` packages stay published and fully functional indefinitely — but once the `@hexclave/*` mirrors exist, new installs should be steered to them. Two layers, both in PR 2:

- **npm-level:** run `npm deprecate "@stackframe/<pkg>@*" "Renamed to @hexclave/<pkg> — see <docs URL>"` for each mirrored package. npm surfaces this on every `npm install`.
- **Runtime:** the SDK logs a `console.warn` once per process on init when it was loaded from a `@stackframe/*` package, recommending the `@hexclave/*` equivalent. (How the SDK knows which name it shipped under is an implementation detail — e.g. a build-time constant stamped by the rewrite script.)

Separately, every `Stack*`-named public export gets `@deprecated` JSDoc (see Tier 1). Because `@stackframe/*` and `@hexclave/*` are generated from the same `packages/template` source, the `@deprecated` tag lands in **both** packages — that is intended: `Stack*` is the old brand regardless of which package ships it, and `Hexclave*` is the name to prefer everywhere. The npm-level `npm deprecate` is the only piece scoped to `@stackframe/*` specifically.

### CLI / init wizard

| Old (kept) | New |
|---|---|
| `npx @stackframe/init-stack` | `npx @hexclave/cli@latest init` — onboarding moves to the CLI's `init` subcommand |
| `stack` binary | `hexclave` binary alias |
| `~/.config/stack-auth/credentials.json` | `~/.config/hexclave/credentials.json` |
| `stack.config.ts` (fallback) | `hexclave.config.ts` (preferred default) |

CLI reads both config paths; writes new path. Old path silently migrates on next run. For project config: `init` generates `hexclave.config.ts` in new projects; discovery prefers `hexclave.config.ts` and falls back to `stack.config.ts` for existing projects (see Tier 0 details).

The canonical onboarding command everywhere — docs, dashboard setup snippets, generated prompts — becomes `npx @hexclave/cli@latest init`. `npx @stackframe/stack-cli@latest init` is the byte-identical command under the old package name and keeps working. The standalone `@stackframe/init-stack` package is no longer the taught entrypoint and is not mirrored as `@hexclave/*`.

---

## Env var taxonomy

Replaces the flat env var table from v1. **Every category is dual-read** — `HEXCLAVE_*` accepted alongside `STACK_*`, new name preferred and documented. Categories differ only in audience and which docs change. Sole exception: the dev-only port-prefix var, renamed outright (see Category B).

### Table shape

For each *concept* (e.g. "Project ID"), the repo may already have multiple env var aliases (Vite vs. Next, BROWSER prefix vs. suffix, etc.). The plan picks **one canonical Hexclave name per concept**; all currently-recognized old names continue to be read as compat aliases. A grep-based pass over Category A, B, and C old-name aliases should be done before implementation to confirm the list below matches what's actually in the repo.

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

**Exception — renamed outright, no dual-accept:** `NEXT_PUBLIC_STACK_PORT_PREFIX` → `NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX`. A dev-only var baked into local Docker/`.env` setups; unlike every other env var it is *not* dual-read — it's a straight rename. Each developer updates their local `.env` once (internal-only churn, no customer impact).

### C. Self-host / operator env vars (dual-read, prefer Hexclave)

Used by operators running their own instance. Previously scoped out; **now dual-read** like every other category — the runtime accepts `HEXCLAVE_*` alongside the existing `STACK_*` name, prefers `HEXCLAVE_*`, and docs / `.env.example` teach the new name.

- `STACK_DATABASE_CONNECTION_STRING`, `STACK_SERVER_SECRET`, `STACK_EMAIL_*`, `STACK_S3_*`, `STACK_SVIX_*`, `STACK_QSTASH_*`, `STACK_STRIPE_*`, `STACK_FREESTYLE_*`, `STACK_OPENROUTER_API_KEY`, `STACK_MCP_LOG_TOKEN`, `STACK_CLICKHOUSE_*`, `STACK_RUN_MIGRATIONS`, `STACK_RUN_SEED_SCRIPT`, `STACK_SEED_INTERNAL_PROJECT_*`, local emulator + QEMU vars — each gets a `HEXCLAVE_*` equivalent.

Existing operator `.env` files keep working unchanged (old names still read). This makes the exhaustive operator-var inventory (see Open questions) **in-scope, required work** — not a deferred prerequisite — since every operator var now needs a dual-read site, a docs update, and an `.env.example` entry.

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

### E. Build / dev / test env vars (dual-read, prefer Hexclave)

Internal tooling vars. **Dual-read** like every other category.

- `STACK_SKIP_TEMPLATE_GENERATION`
- `STACK_DISABLE_REACT_ASYNC_DEBUG_INFO`
- `STACK_ENABLE_HARDCODED_PASSKEY_CHALLENGE_FOR_TESTING`
- `STACK_RUN_SETUP_WIZARD_TESTS`
- `STACK_TEST_SDK_FALLBACK`

Each gets a `HEXCLAVE_*` equivalent, dual-read at its use site. Add the `HEXCLAVE_*` form of every env var (Categories A–E) to `turbo.json` `globalEnv` alongside the existing `STACK_*` form.

---

## Tier 3 — Persistent data (idempotent migrations)

The display-name and email-config migrations change user-visible data → **PR 2**. The IdP-audience validator change is compatibility-only → **PR 1**.

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

| Old | New | Notes |
|---|---|---|
| `noreply@stackframe.co` | `noreply@sent-with-hexclave.com` | Transactional/bulk sender on a **separate domain** — see below |
| `security@stack-auth.com` | `security@hexclave.com` | Inbound mailbox |
| `team@stack-auth.com` | `team@hexclave.com` | Inbound mailbox |

**Transactional sender uses a dedicated domain.** The bulk/transactional sender (`noreply@`) moves to a separate registrable domain — `sent-with-hexclave.com` or similar (exact name TBD) — *not* `noreply@hexclave.com`. This is a deliberate split: it isolates bulk-email deliverability problems from the primary `hexclave.com` domain's reputation. That domain must be registered and configured with SPF/DKIM/DMARC. It is **not** in the domain inventory above — it has no `stack-auth.com` predecessor (the old sender was on `stackframe.co`). The inbound human mailboxes (`security@`, `team@`) carry no reputation risk and move to `hexclave.com` as normal. Set up new mailboxes; forward old → new during transition.

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
- Any other hardcoded subject/body containing "Stack Auth" — grep before PR 2

### CHANGELOG title flip

`CHANGELOG.md` title becomes "Hexclave Changelog" in PR 2. Existing entries' commit-by-commit context preserves continuity; no need to dual-name the title.

### Contributor / agent guidance

- `AGENTS.md` currently says: *"Any environment variables you create should be prefixed with `STACK_`"*. Flip to prefer `HEXCLAVE_*` for Category A/B; document that Category C/E vars stay `STACK_*`.
- Update any other contributor guidance referencing brand strings.

### Other Tier 4 sweeps (PR 2)

- README.md, CONTRIBUTING.md, CHANGELOG.md (title flip per above), AGENTS.md (env var guidance per above)
- 49 docs files referencing `Stack*` class names in code examples (Hexclave-only after the rewrite; one compat note per page where relevant)
- 72 docs files referencing `@stackframe/*` package names in install snippets
- 11 example projects (`examples/`) — including hardcoded `https://app.stack-auth.com` links in their UIs and `.env` comments
- `.github/SECURITY.md`, PR template, workflow file refs
- `skills/stack-auth/SKILL.md` (consider directory rename to `skills/hexclave/`; old directory can stay as a pointer if needed)
- Dashboard setup-page snippets (`apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/(overview)/setup-page.tsx`) — copy-pasteable code blocks shown to customers
- Init wizard prompts — user-facing CLI messaging in `packages/stack-cli/` (the `init` command, the new taught entrypoint) and the still-published `packages/init-stack/`

---

## Do not rename — `stack-*` literals kept indefinitely

Items that contain "stack" in their literal name and intentionally stay that way. No Hexclave equivalent will exist.

| What | Why |
|---|---|
| `x-stack-auth` legacy JSON-encoded header | SDK-internal — produced by deprecated `getAuthHeaders()`, read by the SDK `tokenStore` parser; never a backend identifier, no Hexclave variant |
| `POSTGRES_DB: stackframe` | Would orphan every dev's local volume |
| Swift legacy `StackAuth` package | Frozen but installable; new SDK lives in separate `Hexclave` package |

Two items that earlier plan versions listed here have moved:
- **`NEXT_PUBLIC_STACK_PORT_PREFIX`** is now **renamed outright** to `NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX` (no dual-accept) — see Env var taxonomy.
- **Self-host (Category C) and build/dev/test (Category E) `STACK_*` env vars** are now **dual-read** — `HEXCLAVE_*` accepted alongside `STACK_*` — see Env var taxonomy.
- **`__Host-stack-temporary-chips-test-*` cookies** belong to an unused feature being removed in a separate change; this rebrand ignores them entirely (see Tier 0 cookies).

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

## PR 1 implementation guide (resolved from codebase discovery)

A discovery pass against the codebase resolved the open items from earlier plan versions. Each work-area below gives the chosen approach, the concrete files/lines, and the gotchas — enough to implement PR 1 without further investigation.

### Request headers — normalize at the proxy

There is an **existing, currently-empty hook** at `apps/backend/src/proxy.tsx:114` (`const newRequestHeaders = new Headers(request.headers); // here we could update the request headers (currently we don't)`). Insert the normalization here: for each `x-hexclave-*` request header, copy its value onto the matching `x-stack-*` name. It runs before routing, `createSmartRequest`, and yup validation, so **every downstream reader keeps working unchanged** — `parseAuth`'s ~12 `req.headers.get("x-stack-*")` calls (`smart-request.tsx:162-172,348`), the route handlers that destructure header names from yup schemas (`auth/password/update/route.tsx:27,34`; `auth/sessions/current/refresh/route.tsx:19,29`; `auth/oauth/cross-domain/authorize/route.tsx:110-160`), `smart-response.tsx:144`, `smart-route-handler.tsx:92`, `proxy.tsx:64,81`. No `readDualHeader` helper, no per-route schema edits. Apply the same normalization in `apps/dashboard/src/proxy.tsx` (it has its own header handling).

### Response headers

`apps/backend/src/route-handlers/smart-response.tsx` sets `x-stack-request-id` (:136, always) and `x-stack-actual-status` (:146); `x-stack-known-error` comes from `KnownError.getHeaders()` (`packages/stack-shared/src/known-errors.tsx:49-53`) and is copied on at `smart-response.tsx:150-152`. Dual-emit = set the `x-hexclave-*` copy at each site. The SDK reads `x-stack-actual-status` (`client-interface.ts:794-795`) and `x-stack-known-error` (`:807-810`); `x-stack-request-id` is emit-only, never read. Dual-read = check `x-hexclave-*` first.

### Bearer token prefix — SDK-internal, not a backend identifier

The `Bearer stackauth_<base64>` token is **never parsed by the Stack backend**. It is an SDK-internal serialization of `{ accessToken, refreshToken }` for the `tokenStore: { headers }` init path; the SDK decodes it and then sends `x-stack-access-token` / `x-stack-refresh-token`. All in `packages/template/.../lib/stack-app/apps/implementations/client-app-impl.ts`: constant `STACK_AUTHORIZATION_VALUE_PREFIX = "stackauth_"` (:102), emit `getAuthorizationHeaderValueFromAuthJson()` (:104-111), parse `getAuthJsonFromAuthorizationHeaderValue()` (:113-154; prefix check :120; hardcoded error strings :126,134,138,144,147). Add `HEXCLAVE_AUTHORIZATION_VALUE_PREFIX = "hexclave_"`, accept either on parse, emit `hexclave_`. No backend change.

### JWT issuer / audience

`apps/backend/src/lib/tokens.tsx:58-104` builds allowed issuer URLs from the configured API URL and passes an exact-match array to `verifyJWT()` — no domain-substring check. Build two arrays (one per domain) and concatenate, or have `getIssuer()` return both variants. Also: `packages/template/src/integrations/convex.ts`, `apps/backend/src/app/api/latest/integrations/idp.ts:167`.

### Cookies — central helper + enumerated bypass sites

Auth cookies (`stack-access`, `stack-refresh-*`, `stack-oauth-outer-*`) flow through `packages/template/src/lib/cookie.ts`; their names have a single point of truth in `client-app-impl.ts` getters — `_accessTokenCookieName` (:1083), `_refreshTokenCookieName` / `_legacyRefreshTokenCookieName` (:969-975), `_getRefreshTokenCookieNamePatterns()` (:1091-1098). Dual-write / dual-read by extending those. **Bypass sites to patch individually:**
- `stack-oauth-inner-*` — backend raw `cookies()`: set at `auth/oauth/authorize/[provider_id]/route.tsx:180-188`, read + delete at `auth/oauth/callback/[provider_id]/route.tsx:119-120`.
- `stack-access` / `stack-refresh-*` delete — `apps/dashboard/.../api/remote-development-environment/auth/route.ts:10-21` (update `isInternalProjectRefreshCookieName()` at :10-13 to match new names too).
- `stack-is-https` — three write sites, all inside `cookie.ts` (:198-203, :280, :355).
- `stack-last-seen-changelog-version` — raw `document.cookie`: `stack-companion.tsx:223`, `changelog-widget.tsx:47` (reads :192,:231).
- Impersonation snippet strings — `users/[userId]/page-client.tsx:161`, `user-table.tsx:399` (code shown to users to paste in a console).
- Snapshot serializer — add `"hexclave-oauth-inner-"` to `keyedCookieNamePrefixes` at `apps/e2e/tests/snapshot-serializer.ts:119`.

### Storage keys

Single-constant keys — change the constant: `CLI_AUTH_CONFIRMED_KEY` (`cli-auth-confirm.tsx:31`), `LOCAL_STORAGE_PREFIX` (`session-replay.ts:90`), `STORAGE_KEY` / `TRIGGER_POS_KEY` (`dev-tool-core.ts:51-52`), `OVERRIDE_KEY` (`dev-tool/index.ts:9`). Hardcoded strings to wrap then change: `stack_mfa_attempt_code` (`client-app-impl.ts:3288`, `mfa.tsx:37,70`, `page-component-versions.ts:1510,1519`), `_STACK_AUTH.lastUsed` (`oauth-button.tsx:37,190`), docs keys (`platform-codeblock.tsx`, `platform-indicator.tsx`). Dual-read where the value must survive an SDK upgrade (`session-replay`); straight rename for the UI-only dev-tool / docs keys.

### Env vars — hybrid: one central transform + two client files + a per-site tail

`getEnvVariable` in `packages/stack-shared/src/utils/env.tsx` already has an `ENV_VAR_RENAME` table — the dual-read primitive exists.
- **Server-side (~150 call sites, zero call-site edits):** add a `STACK_*`→`HEXCLAVE_*` (and `NEXT_PUBLIC_STACK_*`→`NEXT_PUBLIC_HEXCLAVE_*`, infix variants, `STACK_AUTH_*`) prefix transform inside `getEnvVariable` / `getEnvBoolean` / `getProcessEnv`: try the `HEXCLAVE_*` name, then `STACK_*`. This automatically covers the dynamically-built OAuth credential names (`STACK_${provider}_CLIENT_ID` at `apps/backend/src/oauth/index.tsx:40-41`).
- **Dashboard client (~70 sites):** `apps/dashboard/src/lib/env.tsx` `getPublicEnvVar` keys into a static `_inlineEnvVars` map of literal `process.env.NEXT_PUBLIC_*` (build-time inlined — cannot be made dynamic). Add a parallel `NEXT_PUBLIC_HEXCLAVE_*` literal as the preferred operand in each entry; add matching `HEXCLAVE` sentinels to `_postBuildEnvVars` and the Docker post-build substitution.
- **Customer SDK:** `packages/template/src/lib/env.ts` — each getter is a literal `process.env.X`; add the `HEXCLAVE` literal as the preferred operand inside each. Run `generate-sdks` after.
- **Per-site tail (unavoidable):** Vite examples (`VITE_STACK_*` via `import.meta.env`), raw `process.env` in `next.config.mjs` / `prisma/seed.ts` / `stack-cli` / `mock-oauth-server`, the `STACK_*` glob in `turbo.json`, and `.env*` / `.env.example`.
- Resolve (don't mechanically prefix-swap) the three alias clusters — API URL, and the browser/server infix-vs-suffix forms; `apps/dashboard/src/lib/env.tsx` already carries TODOs for them. `NEXT_PUBLIC_STACK_PORT_PREFIX` (~25 sites) is the rename-outright exception.

### SDK export aliases — concrete targets

Add to `packages/template/src/index.ts`: `StackConfig`, `defineStackConfig`, `StackHandler`, `StackProvider`, `StackTheme`, `useStackApp`. Add to `packages/template/src/lib/stack-app/index.ts`: `StackClientApp` / `StackServerApp` / `StackAdminApp` (values) and the types `Stack{Client,Server,Admin}AppConstructor`, `Stack{Client,Server,Admin}AppConstructorOptions`, `StackClientAppJson`. `StackHandler` / `StackProvider` are `export { default as ... }` re-exports — alias as `export { StackHandler as HexclaveHandler }` (not another default). Type exports use `export type { X as HexclaveX }`. Run `generate-sdks` after.

### Internal renames

`StackClientInterface` / `StackServerInterface` / `StackAdminInterface` — defined in `packages/stack-shared/src/interface/{client,server,admin}-interface.ts`, exported only from `@stackframe/stack-shared`'s index (no customer SDK). ~34 references across ~14 files. `StackAssertionError` — `packages/stack-shared/src/utils/errors.tsx:69`, not exported from any public index, ~344 references. Both rename outright; mechanical, grep-driven.

### Config discovery — ~15 sites

CLI: `stack-cli/src/commands/config-file.ts:202-205`, `init.ts:195,390`, `dev.ts:495`. Dashboard local-dev: `lib/remote-development-environment/config-file.ts:18,55`, `link-existing-onboarding.tsx:146,445,500`, `projects/page-client.tsx` (~8 UI strings), `development-environment/health/route.ts:47`, `layout-client.tsx:78`. Backend emulator: `internal/local-emulator/project/route.tsx:43,305`. Each: prefer `hexclave.config.ts`, fall back to `stack.config.ts`. CLI credentials path: `stack-cli/src/lib/config.ts:5` (`~/.config/stack-auth/credentials.json`, override `STACK_CLI_CONFIG_PATH`) — dual-read old path, write new.

### MCP

`apps/mcp/src/mcp-handler.ts` — `server.tool("ask_stack_auth", …)` at :107-172. Add `server.tool("ask_hexclave", …)` delegating to the same handler; pass `toolName: "ask_hexclave"` (:149), adjust the hint text (:169) and `instructions` (:179). `apps/e2e/tests/backend/.../mcp.test.ts` inline snapshots (:37-99) grow and must be updated.

### Test sweep (PR 1 — wire identifiers only)

Header-name assertions: `js/auth-like.test.ts:404,419,470,541`, `render-email.test.ts:180,217`, `internal/projects.test.ts:51`, `neon/.../provision.test.ts:224`, `backend-helpers.ts:197-201`. Cookie-name: `backend-helpers.ts:803`, `oauth/{authorize,callback,merge-strategy}.test.ts`, `sign-up-rules.test.ts:36`, `js/cookies.test.ts:200`, `cross-domain-auth.test.ts:190`. Snapshot serializer: `snapshot-serializer.ts:119`. Many `x-stack-known-error` values live in inline snapshots and regenerate automatically. (Error-message-string and docs-URL assertions are PR 2.)

### `x-stack-auth` legacy header — resolved

A repo-wide grep confirms `x-stack-auth` has **zero references in `apps/backend` or `packages/stack-shared`** — the backend never parses it. It is entirely SDK-internal: produced by the `@deprecated` `getAuthHeaders()` / `useAuthHeaders()` methods (`client-app-impl.ts:1640,3471`) and consumed by the `tokenStore: { headers }` parser (`client-app-impl.ts:1098-1113`) — the same parser path that handles the `Bearer stackauth_` prefix. No backend change, and no `x-hexclave-auth` variant: the producing methods are deprecated in favor of `getAuthorizationHeader()`, so the header is frozen and the parser keeps reading `x-stack-auth` indefinitely.

### Retained from earlier review

- **NPM dual-publish needs the copy-to-temp pattern**, not an in-place rewrite — pnpm's shared lockfile means an in-place rename can't resolve `@hexclave/X` workspace refs. The rewrite script copies `dist/` artifacts and each `package.json` into a temp directory, rewrites the temp copies (names + deps + version), and publishes from temp:

   ```yaml
   - name: Rewrite to @hexclave/* in temp dir
     run: pnpm tsx scripts/rewrite-packages-to-hexclave.ts --out /tmp/hexclave-pkgs
   - name: Publish @hexclave/* packages
     run: pnpm publish --no-git-checks --access public --recursive /tmp/hexclave-pkgs
   ```

- **CLI Sentry DSN compile-time bake.** `packages/stack-cli/tsdown.config.ts` embeds `__STACK_CLI_SENTRY_DSN__`. Existing DSN stays (per locked decision); old released CLI versions keep emitting under their old DSN indefinitely — intentional.

---

## Verification matrix

Compatibility-sensitive enough to be part of the implementation plan, not implicit. Each item is verified in whichever PR introduces it — PR 1 for wire/compat behavior, PR 2 for the visible rebrand.

### Auth wire
- [ ] Backend accepts every `x-stack-*` request header (incl. `x-stack-api-key`, `x-stack-request-type`, `x-stack-override-error-status`)
- [ ] Backend accepts every `x-hexclave-*` request header (incl. `x-hexclave-api-key`, `x-hexclave-request-type`, `x-hexclave-override-error-status`)
- [ ] Both header sets mixed in same request work
- [ ] CORS preflight allowlist in `proxy.tsx` includes both old + new names for request AND response headers
- [ ] New SDK emits `x-hexclave-*` by default
- [ ] Old SDK (unchanged) authenticates successfully
- [ ] SDK token parser accepts `Bearer stackauth_*` AND `Bearer hexclave_*` (SDK-internal — the backend is not involved)
- [ ] New SDK constructs `tokenStore: { headers }` tokens with the `hexclave_` prefix
- [ ] `x-stack-auth` legacy header still accepted by the SDK's `tokenStore: { headers }` parser (SDK-internal; no `x-hexclave-auth` variant; producers are deprecated)
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
- [ ] CHIPS test cookies untouched (unused feature, out of scope for this rebrand)
- [ ] Mobile OAuth callback (`stack-auth-mobile-oauth-url://`) unchanged

### Env vars
- [ ] Old env only (every customer-facing var in Category A) → SDK initializes, deprecation warning emitted
- [ ] New env only → SDK initializes, no warning
- [ ] Both envs with different values → new wins, deprecation warning emitted
- [ ] Multi-alias Category B vars: all historical aliases readable, new canonical preferred
- [ ] `NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX` works; `NEXT_PUBLIC_STACK_PORT_PREFIX` renamed everywhere (straight rename, no dual-accept)
- [ ] Generated GitHub workflow with `STACK_AUTH_*` vars continues to authenticate
- [ ] Newly generated workflow emits `HEXCLAVE_*` and authenticates
- [ ] Self-host vars (Category C) dual-read — both `STACK_*` and `HEXCLAVE_*` work; existing operator `.env` files unchanged
- [ ] Build/dev/test vars (Category E) dual-read — both `STACK_*` and `HEXCLAVE_*` work

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
- [ ] `npm install @hexclave/next` → same, both aliases available
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

## Rollout — 3 PRs

The three PRs separate *invisible* changes from *visible* ones. PR 1 can merge fast with low review risk because nothing in it is observable to any user — it breaks nothing and reveals no Hexclave branding. PR 2 is the actual public rebrand. PR 3 is far-future cleanup.

The Tier sections above describe **what** changes; this section assigns **when**. Several surfaces split across PR 1 and PR 2 — the wire/code half lands in PR 1, the visible half in PR 2 (e.g. MCP: register `ask_hexclave` in PR 1, change the setup-page text in PR 2). "No user-facing changes" in PR 1 means **no breaking changes and no rebranded UI/text/docs** — not byte-identical behavior (new SDK code does start emitting `x-hexclave-*` etc., which is visible on the wire but harmless).

**Deploy ordering within PR 1:** the backend dual-accept must be deployed everywhere — including self-hosted instances — *before* SDKs that emit the new identifiers reach users, or a new SDK against an un-updated backend would fail. Sequence the backend changes ahead of the SDK emit switch.

### PR 1: "Hexclave compatibility layer (invisible)" — now

Purely additive, ships entirely inside the existing `@stackframe/*` packages and existing deploys. Nothing is deleted; nothing breaks; no Hexclave branding becomes visible to any user. Safe to merge quickly. The discovery pass resolved every prerequisite — see the [PR 1 implementation guide](#pr-1-implementation-guide-resolved-from-codebase-discovery) for the concrete files, line numbers, and chosen approach per work-area.

Scope:
- **Wire dual-accept / dual-emit:** request headers, response headers, `Bearer` prefix, query parameters, JWT issuer/audience validator — backend accepts old + new; new SDK code emits the new form (Tier 0).
- **Cookies & storage:** dual-write / dual-read all auth, OAuth-state, and low-risk cookies and storage keys (Tier 0).
- **Env vars:** dual-read every category (A–E); rename `NEXT_PUBLIC_STACK_PORT_PREFIX` outright; `turbo.json` `globalEnv` gains the `HEXCLAVE_*` forms.
- **SDK export aliases:** add `Hexclave*` aliases in `packages/template`, propagated by codegen to every JS SDK (Tier 1). No `@deprecated` markers yet.
- **Internal renames:** the three SDK interfaces and `StackAssertionError` renamed outright (no alias); dev-tool DOM identifiers; `Symbol.for(...)` dual-attach (Tier 1).
- **MCP:** register the `ask_hexclave` tool (additive); `ask_stack_auth` keeps working.
- **Config discovery:** CLI / dashboard accept `hexclave.config.ts` and the `~/.config/hexclave/` credentials path alongside the old ones.
- **Tests:** assertions on wire identifiers updated in lockstep; snapshot serializer handles both prefixes.

### PR 2: "Rebrand to Hexclave (visible)" — after PR 1

Where the brand goes public. Everything user-visible.

Scope:
- **New packages:** publish the `@hexclave/*` npm mirrors (starting at `1.0.0`); stand up the new `Hexclave` Swift package with real `Hexclave*` symbols and `api.hexclave.com` base URL; freeze the existing `StackAuth` Swift package; update `sdks/spec`.
- **Deprecation:** `npm deprecate` the `@stackframe/*` packages; `@deprecated` JSDoc on every `Stack*` public export; SDK runtime `console.warn` recommending `@hexclave/*`.
- **Brand strings (Tier 4):** domains (full inventory), GitHub repo slug, page titles, OpenAPI titles, known-error message templates, email subjects/bodies, `StackAssertionError` message text, CHANGELOG title, contributor guidance, README family, visual assets.
- **Generated content:** update generators (AI prompts, setup prompts, MCP setup page, skills), then regenerate outputs.
- **Docs:** rewrite to teach Hexclave-only names; old names only in compat notes; onboarding command becomes `npx @hexclave/cli@latest init`.
- **Data migration:** idempotent seed migration `Stack Dashboard` → `Hexclave Dashboard` and the email config name (user-visible).
- **CLI:** `hexclave` binary alias; `hexclave init` generates `hexclave.config.ts`; dashboard setup snippets teach the new commands.
- **DNS:** stand up all `*.hexclave.com` subdomains and the `sent-with-hexclave.com` sending domain; redirect from `*.stack-auth.com`.
- **Tests:** assertions on brand strings / error message prefixes updated in lockstep.

### PR 3: "Remove non-essential Stack Auth fallbacks" — 12+ months later

(Formerly "PR 2" in earlier plan versions.) Pure deletion, **narrowly scoped**, only after operational evidence / telemetry shows the targeted fallbacks are unused.

Safely removable in PR 3:
- Stop dual-writing main auth cookies under their old `stack-*` names (old cookies have long expired naturally; reads of old names can also be dropped).
- Stop reading `STACK_*` customer SDK env vars (or hard-error with a migration message) — only after operator dashboards confirm low usage.
- Remove the `ask_stack_auth` MCP tool — only after AI-client adoption of `ask_hexclave` is high.
- Tear down non-essential `*.stack-auth.com` subdomains (keep `api.stack-auth.com` indefinitely — Apple sign-in setup depends on it).
- `@stackframe/*` published packages: leave on npm with a "moved to `@hexclave/*`" README; do not unpublish (npm unpublishing breaks the ecosystem).

**Explicitly NOT removed in PR 3:**
- `x-stack-*` request headers (kept dual-accepted indefinitely)
- `x-stack-*` response headers (kept dual-emitted indefinitely)
- `Bearer stackauth_*` prefix (kept dual-accepted indefinitely)
- `x-stack-auth` legacy header (SDK-internal; still parsed by the SDK `tokenStore` parser)
- JWT validator's acceptance of all three `stack-auth.com` issuer variants and the IdP audience
- JS `Stack*` exports — they're the canonical class names, not aliases (deprecated, not removed)
- Legacy `StackAuth` Swift package (frozen but installable from existing SPM URL)
- OAuth state cookies (`stack-oauth-*`), `stack-auth-mobile-oauth-url://`
- `stack.config.ts` filename (still readable as fallback)
- Everything in the "Do not rename" table

---

## Open questions still worth answering before implementation

- **Operator env var inventory:** the central `getEnvVariable` prefix-transform (see PR 1 implementation guide) makes server-side dual-read automatic with no per-var code changes — so an exhaustive inventory is *not* a code prerequisite for PR 1. It is still needed for the per-site tail (raw `process.env`, `import.meta.env`, `turbo.json`, `.env*`) and for the PR 2 docs / `.env.example` rewrite; produce it before PR 2. Discovery found ~140 distinct `STACK`-named vars across categories A–E.
- **SDK request header emission:** new SDKs emit `x-hexclave-*` for every request header (current plan), or skip the most stable ones (e.g. `branch-id`) to reduce churn? Current plan: emit all.
- **DNS infrastructure:** ops team confirmation on indefinite redirect maintenance capacity for 16 subdomains, plus registration + SPF/DKIM/DMARC for the separate `sent-with-hexclave.com` transactional sending domain.
- **Future canonicality flip (post PR 3):** is there any reason to ever make `Hexclave*` the canonical class name in JS or Swift, with `Stack*` as the alias? Current plan: no — coexistence indefinitely, neither is "more canonical".
- `hexclave.config.ts` is the new canonical config filename; `stack.config.ts` read-fallback stays in discovery indefinitely. We'd only drop the fallback after telemetry shows essentially no projects rely on it.
- DNS infrastructure ownership for redirects — operations team needs to confirm capacity for indefinite redirect maintenance.
