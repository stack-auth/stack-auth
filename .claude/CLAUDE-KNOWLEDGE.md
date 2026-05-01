# CLAUDE-KNOWLEDGE.md

This file contains knowledge learned while working on the codebase in Q&A format.

## Q: How should Dashboard V2 keep detail-sheet navigation on the current page?
A: Project entity detail sheets are rendered by the shared `/projects/$projectId` layout, not by individual pages. User/team links should set `userId` or `teamId` on the current route's search params (for example via `ProjectUserDrawerLink`) instead of linking to `/users` or `/teams`; the layout reads those params and swaps the drawer content while the underlying page stays put. Entity sheet components should use callbacks such as `onViewTeam`/`onViewMember` instead of hard-coding routes.

## Q: How should Dashboard V2 render the email theme editor preview?
A: Pass `previewTemplateSource` from `@stackframe/stack-shared/dist/helpers/emails` as `templateTsxSource` when calling `useEmailPreviewQuery` for a theme. The backend `/emails/render-email` endpoint requires either `template_id` or `template_tsx_source`; calling it with only `themeId` fails schema validation and leaves the iframe blank unless the page surfaces the query error.

## Q: How does the legacy dashboard count users on the users page?
A: `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/users/page-client.tsx` uses `useMetricsUserCountsOrThrow`, which calls the admin app internals `useMetricsUserCounts()` hook backed by `/internal/metrics/user-counts`. The displayed signed-up count is `metrics.total_users - metrics.anonymous_users`; anonymous users are shown separately only when present. The legacy users table searches server-side through `stackAdminApp.listUsers({ query, includeRestricted: true, includeAnonymous: false })` by default.

## Q: How should Dashboard V2 create user checkout and impersonation actions?
A: `ServerUser` from `@stackframe/tanstack-start` includes customer methods, so V2 can call `user.createCheckoutUrl({ productId })` directly after filtering `adminApp.useProject().useConfig().payments.products` to `customerType === "user"`. For impersonation, call `user.createSession({ expiresInMillis, isImpersonation: true })`, require a non-null refresh token, and show a console snippet that sets `stack-refresh-${adminApp.projectId}` before reloading.

## Q: What reusable component should Dashboard V2 use for dense virtualized data grids?
A: Use `apps/dashboardV2/src/components/ui/virtual-data-grid.tsx`. `VirtualDataGrid` owns the sticky search/header, shared column grid template, skeleton rows, window virtualization, infinite-load trigger, row selection, and `j/k` keyboard navigation. Pages should pass typed columns (`VirtualDataGridColumn<TItem, TSortId>[]`), sorted items, search state, sort state, and row-specific renderers/actions.

## Q: How should Dashboard V2 virtualized grids size their scroll area when the server knows the total row count?
A: Pass `totalCount` to `VirtualDataGrid`. When present, the grid uses `max(totalCount, loaded rows + loader)` as the virtualizer count so the document scrollbar reflects the full dataset before every row is loaded. Leave `totalCount` undefined for searches or filters that do not have a server-provided filtered total.

## Q: How should Dashboard V2 page and component logic be organized?
A: Keep Dashboard V2 components mostly render-focused by extracting state, derived data, effects, and submit/toggle handlers into `src/hooks/<feature>/use-*.ts` hook modules. Use feature folders such as `hooks/console`, `hooks/projects`, and `hooks/onboarding` instead of defining non-trivial hooks inline in route/component files.

## Q: How is the Dashboard V2 fixed icon rail organized?
A: `apps/dashboardV2/src/components/console/app-sidebar.tsx` owns the fixed left icon rail. Keep primary app navigation near the top, centered resource/help actions in the middle, and persistent controls such as theme/account at the bottom. Use a shared icon-link helper when adding multiple external rail buttons so Docs/Support-style links do not get duplicated across rail sections.

## Q: How should Dashboard V2 avoid SSR hydration mismatches from generated element IDs?
A: Do not let visible SSR markup depend on generated IDs from `React.useId()` or Base UI trigger defaults when the surrounding tree can differ between server and client. Pass stable semantic IDs to Base UI triggers and to shared wrappers such as `ChartContainer`; make IDs required in shared components when missing IDs would otherwise fall back to generated DOM attributes or injected CSS selectors.

## Q: How do anonymous users work in Stack Auth?
A: Anonymous users are a special type of user that can be created without any authentication. They have `isAnonymous: true` in the database and use different JWT signing keys with a `role: 'anon'` claim. Anonymous JWTs use a prefixed secret ("anon-" + audience) for signing and verification.

## Q: How are anonymous user JWTs different from regular user JWTs?
A: Anonymous JWTs have:
1. Different kid (key ID) - prefixed with "anon-" in the generation
2. Different signing secret - uses `getPerAudienceSecret` with `isAnonymous: true`
3. Contains `role: 'anon'` in the payload
4. Must pass `isAnonymous` flag to both `getPrivateJwk` and `getPublicJwkSet` functions for proper verification

## Q: What is the X-Stack-Allow-Anonymous-User header?
A: This header controls whether anonymous users are allowed to access an endpoint. When set to "true" (which is the default for client SDK calls), anonymous JWTs are accepted. When false or missing, anonymous users get an `AnonymousAuthenticationNotAllowed` error.

## Q: How do you upgrade an anonymous user to a regular user?
A: When an anonymous user (identified by `is_anonymous: true`) signs up or signs in through any auth method (password, OTP, OAuth), instead of creating a new user, the system upgrades the existing anonymous user by:
1. Setting `is_anonymous: false`
2. Adding the authentication method (email, password, OAuth provider, etc.)
3. Keeping the same user ID so old JWTs remain valid

## Q: How do you access the current user in smart route handlers?
A: In smart route handlers, the user is accessed through `fullReq.auth?.user` not through the destructured `auth` parameter. The auth parameter only guarantees `tenancy`, while `user` is optional and needs to be accessed from the full request.

## Q: How do user CRUD handlers work with parameters?
A: The `adminUpdate` and similar methods take parameters directly, not wrapped in a `params` object:
- Correct: `adminUpdate({ tenancy, user_id: "...", data: {...} })`
- Wrong: `adminUpdate({ tenancy, params: { user_id: "..." }, data: {...} })`

## Q: What query parameter filters anonymous users in user endpoints?
A: The `include_anonymous` query parameter controls whether anonymous users are included in results:
- Without parameter or `include_anonymous=false`: Anonymous users are filtered out
- With `include_anonymous=true`: Anonymous users are included in results
This applies to user list, get by ID, search, and team member endpoints.

## Q: How does the JWKS endpoint handle anonymous keys?
A: The JWKS (JSON Web Key Set) endpoint at `/.well-known/jwks.json`:
- By default: Returns only regular user signing keys
- With `?include_anonymous=true`: Returns both regular and anonymous user signing keys
This allows systems that need to verify anonymous JWTs to fetch the appropriate public keys.

## Q: What is the typical test command flow for Stack Auth?
A: 
1. `pnpm typecheck` - Check TypeScript compilation
2. `pnpm lint --fix` - Fix linting issues
3. `pnpm test run <path>` - Run specific tests (the `run` is important to avoid watch mode)
4. Use `-t "test name"` to run specific tests by name

## Q: How do E2E tests handle authentication in Stack Auth?
A: E2E tests use `niceBackendFetch` which automatically:
- Sets `x-stack-allow-anonymous-user: "true"` for client access type
- Includes project keys and tokens from `backendContext.value`
- Handles auth tokens through the context rather than manual header setting

## Q: What is the signature of a verification code handler?
A: The handler function in `createVerificationCodeHandler` receives 5 parameters:
```typescript
async handler(tenancy, validatedMethod, validatedData, requestBody, currentUser)
```
Where:
- `tenancy` - The tenancy object
- `validatedMethod` - The validated method data (e.g., `{ email: "..." }`)
- `validatedData` - The validated data object
- `requestBody` - The raw request body
- `currentUser` - The current authenticated user (if any)

## Q: How does JWT key derivation work for anonymous users?
A: The JWT signing/verification uses a multi-step key derivation process:
1. **Secret Derivation**: `getPerAudienceSecret()` creates a derived secret from:
   - Base secret (STACK_SERVER_SECRET)
   - Audience (usually project ID)
   - Optional "anon-" prefix for anonymous users
2. **Kid Generation**: `getKid()` creates a key ID from:
   - Base secret (STACK_SERVER_SECRET) 
   - "kid" string with optional "anon-" prefix
   - Takes only first 12 characters of hash
3. **Key Generation**: Private/public keys are generated from the derived secret

## Q: What is the JWT signing and verification flow?
A: 
**Signing (signJWT)**:
1. Derive secret: `getPerAudienceSecret(audience, STACK_SERVER_SECRET, isAnonymous)`
2. Generate kid: `getKid(STACK_SERVER_SECRET, isAnonymous)`
3. Create private key from derived secret
4. Sign JWT with kid in header and role in payload

**Verification (verifyJWT)**:
1. Decode JWT without verification to read the role
2. Check if role === 'anon' to determine if it's anonymous
3. Derive secret with same parameters as signing
4. Generate kid with same parameters as signing
5. Create public key set and verify JWT

## Q: What makes anonymous JWTs different from regular JWTs?
A: Anonymous JWTs have:
1. **Different derived secret**: Uses "anon-" prefix in secret derivation
2. **Different kid**: Uses "anon-" prefix resulting in different key ID
3. **Role field**: Contains `role: 'anon'` in the payload
4. **Verification requirements**: Requires `allowAnonymous: true` flag to be verified

## Q: How do you debug JWT verification issues?
A: Common debugging steps:
1. Check that the `X-Stack-Allow-Anonymous-User` header is set to "true"
2. Verify the JWT has `role: 'anon'` in its payload
3. Ensure the same secret derivation parameters are used for signing and verification
4. Check that the kid in the JWT header matches the expected kid
5. Verify that `allowAnonymous` flag is passed through the entire call chain

## Q: What is the difference between getPrivateJwk and getPrivateJwkFromDerivedSecret?
A: 
- `getPrivateJwk(secret, isAnonymous)`: Takes a base secret, may derive it internally, generates kid
- `getPrivateJwkFromDerivedSecret(derivedSecret, kid)`: Takes an already-derived secret and pre-calculated kid
The second is used internally for the actual JWT signing flow, while the first is for backward compatibility and special cases like IDP.

## Q: How does the JWT verification process work with jose?
A: The `jose.jwtVerify` function:
1. Extracts the kid from the JWT header
2. Looks for a key with matching kid in the provided JWK set
3. Uses that key to verify the JWT signature
4. If no matching kid is found, verification fails with an error

## Q: What causes UNPARSABLE_ACCESS_TOKEN errors?
A: This error occurs when JWT verification fails in `decodeAccessToken`. Common causes:
1. Kid mismatch - the kid in the JWT header doesn't match any key in the JWK set
2. Wrong secret derivation - using different parameters for signing vs verification
3. JOSEError thrown during `jose.jwtVerify` due to invalid signature or key mismatch

## OAuth Flow and Validation

### Q: Where does OAuth redirect URL validation happen in the flow?
A: The validation happens in the callback endpoint (`/api/v1/auth/oauth/callback/[provider_id]/route.tsx`), not in the authorize endpoint. The authorize endpoint just stores the redirect URL and redirects to the OAuth provider. The actual validation occurs when the OAuth provider calls back, and the oauth2-server library validates the redirect URL.

### Q: How do you test OAuth flows that should fail?
A: Use `Auth.OAuth.getMaybeFailingAuthorizationCode()` instead of `Auth.OAuth.getAuthorizationCode()`. The latter expects success (status 303), while the former allows you to test failure cases. The failure happens at the callback stage with a 400 status and specific error message.

### Q: What error is thrown for invalid redirect URLs in OAuth?
A: The callback endpoint returns a 400 status with the message: "Invalid redirect URI. The URL you are trying to redirect to is not trusted. If it should be, add it to the list of trusted domains in the Stack Auth dashboard."

## Wildcard Pattern Implementation

### Q: How do you handle ** vs * precedence in regex patterns?
A: Use a placeholder approach to prevent ** from being corrupted when replacing *:
```typescript
const doubleWildcardPlaceholder = '\x00DOUBLE_WILDCARD\x00';
regexPattern = regexPattern.replace(/\*\*/g, doubleWildcardPlaceholder);
regexPattern = regexPattern.replace(/\*/g, '[^.]*');
regexPattern = regexPattern.replace(new RegExp(doubleWildcardPlaceholder, 'g'), '.*');
```

### Q: Why can't you use `new URL()` with wildcard domains?
A: Wildcard characters (* and **) are not valid in URLs and will cause parsing errors. For wildcard domains, you need to manually parse the URL components instead of using the URL constructor.

### Q: How do you validate URLs with wildcards?
A: Extract the hostname pattern manually and use `matchHostnamePattern()`:
```typescript
const protocolEnd = domain.baseUrl.indexOf('://');
const protocol = domain.baseUrl.substring(0, protocolEnd + 3);
const afterProtocol = domain.baseUrl.substring(protocolEnd + 3);
const pathStart = afterProtocol.indexOf('/');
const hostnamePattern = pathStart === -1 ? afterProtocol : afterProtocol.substring(0, pathStart);
```

## Testing Best Practices

### Q: How should you run multiple independent test commands?
A: Use parallel execution by batching tool calls together:
```typescript
// Good - runs in parallel
const [result1, result2] = await Promise.all([
  niceBackendFetch("/endpoint1"),
  niceBackendFetch("/endpoint2")
]);

// In E2E tests, the framework handles this automatically when you
// batch multiple tool calls in a single response
```

### Q: What's the correct way to update project configuration in E2E tests?
A: Use the `/api/v1/internal/config/override/environment` endpoint with PATCH method and admin access token:
```typescript
await niceBackendFetch("/api/v1/internal/config/override/environment", {
  method: "PATCH",
  accessType: "admin",
  headers: {
    'x-stack-admin-access-token': adminAccessToken,
  },
  body: {
    config_override_string: JSON.stringify({
      'domains.trustedDomains.name': { baseUrl: '...', handlerPath: '...' }
    }),
  },
});
```

## Code Organization

### Q: Where does domain validation logic belong?
A: Core validation functions (`isValidHostnameWithWildcards`, `matchHostnamePattern`) belong in the shared utils package (`packages/stack-shared/src/utils/urls.tsx`) so they can be used by both frontend and backend.

### Q: How do you simplify validation logic with wildcards?
A: Replace wildcards with valid placeholders before validation:
```typescript
const normalizedDomain = domain.replace(/\*+/g, 'wildcard-placeholder');
url = new URL(normalizedDomain); // Now this won't throw
```

## Debugging E2E Tests

### Q: What does "ECONNREFUSED" mean in E2E tests?
A: The backend server isn't running. Make sure to start the backend with `pnpm dev` before running E2E tests.

### Q: How do you debug which stage of OAuth flow is failing?
A: Check the error location:
- Authorize endpoint (307 redirect) - Initial request succeeded
- Callback endpoint (400 error) - Validation failed during callback
- Token endpoint (400 error) - Validation failed during token exchange

## Git and Development Workflow

### Q: How should you format git commit messages in this project?
A: Use a HEREDOC to ensure proper formatting:
```bash
git commit -m "$(cat <<'EOF'
Commit message here.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Q: What commands should you run before considering a task complete?
A: Always run:
1. `pnpm test run <relevant-test-files>` - Run tests
2. `pnpm lint` - Check for linting errors
3. `pnpm typecheck` - Check for TypeScript errors

## Common Pitfalls

### Q: Why might imports get removed after running lint --fix?
A: ESLint may remove "unused" imports. Always verify your changes after auto-fixing, especially if you're using imports in a way ESLint doesn't recognize (like in test expectations).

### Q: What's a common linting error in test files?
A: Missing newline at end of file. ESLint requires files to end with a newline character.

### Q: How do you handle TypeScript errors about missing exports?
A: Double-check that you're only importing what's actually exported from a module. The error "Module declares 'X' locally, but it is not exported" means you're trying to import something that isn't exported.

## Project Transfer Implementation

### Q: How do I add a new API endpoint to the internal project?
A: Create a new route file in `/apps/backend/src/app/api/latest/internal/` using the `createSmartRouteHandler` pattern. Internal endpoints should check `auth.project.id === "internal"` and throw `KnownErrors.ExpectedInternalProject()` if not.

### Q: How do team permissions work in Stack Auth?
A: Team permissions are defined in `/apps/backend/src/lib/permissions.tsx`. The permission `team_admin` (not `$team_admin`) is a normal permission that happens to be defined by default on the internal project. Use `ensureUserTeamPermissionExists` to check if a user has a specific permission.

### Q: How do I check team permissions in the backend?
A: Use `ensureUserTeamPermissionExists` from `/apps/backend/src/lib/request-checks.tsx`. Example:
```typescript
await ensureUserTeamPermissionExists(prisma, {
  tenancy: internalTenancy,
  teamId: teamId,
  userId: userId,
  permissionId: "team_admin",
  errorType: "required",
  recursive: true,
});
```

### Q: How do I add new functionality to the admin interface?
A: Don't use server actions. Instead, implement the endpoint functions on the admin-app and admin-interface. Add methods to the AdminProject class in the SDK packages that call the backend API endpoints.

### Q: How do I use TeamSwitcher component in the dashboard?
A: Import `TeamSwitcher` from `@stackframe/stack` and use it like:
```typescript
<TeamSwitcher
  triggerClassName="w-full"
  teamId={selectedTeamId}
  onChange={async (team) => {
    setSelectedTeamId(team.id);
  }}
/>
```

### Q: How do I write E2E tests for backend endpoints?
A: Import `it` from helpers (not vitest), and set up the project context inside each test:
```typescript
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch, InternalProjectKeys } from "../../../../../backend-helpers";

it("test name", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // test logic
});
```

### Q: Where is project ownership stored in the database?
A: Projects have an `ownerTeamId` field in the Project model (see `/apps/backend/prisma/schema.prisma`). This links to a team in the internal project.


### Q: What's the difference between ensureTeamMembershipExists and ensureUserTeamPermissionExists?
A: `ensureTeamMembershipExists` only checks if a user is a member of a team. `ensureUserTeamPermissionExists` checks if a user has a specific permission (like `team_admin`) within that team. The latter also calls `ensureTeamMembershipExists` internally.

### Q: How do I handle errors in the backend API?
A: Use `KnownErrors` from `@stackframe/stack-shared` for standard errors (e.g., `KnownErrors.ProjectNotFound()`). For custom errors, use `StatusError` from `@stackframe/stack-shared/dist/utils/errors` with an HTTP status code and message.

### Q: What's the pattern for TypeScript schema validation in API routes?
A: Use yup schemas from `@stackframe/stack-shared/dist/schema-fields`. Don't use regular yup imports. Example:
```typescript
import { yupObject, yupString, yupNumber } from "@stackframe/stack-shared/dist/schema-fields";
```

### Q: How are teams and projects related in Stack Auth?
A: Projects belong to teams via the `ownerTeamId` field. Teams exist within the internal project. Users can be members of multiple teams and have different permissions in each team.

### Q: How do I properly escape quotes in React components to avoid lint errors?
A: Use template literals with backticks instead of quotes in JSX text content:
```typescript
<Typography>{`Text with "quotes" inside`}</Typography>
```

### Q: What auth headers are needed for internal API calls?
A: Internal API calls need:
- `X-Stack-Access-Type: 'server'`
- `X-Stack-Project-Id: 'internal'`
- `X-Stack-Secret-Server-Key: <server key>`
- Either `X-Stack-Auth: Bearer <token>` or a session cookie

### Q: How do I reload the page after a successful action in the dashboard?
A: Use `window.location.reload()` after the action completes. This ensures the UI reflects the latest state from the server.

### Q: What's the file structure for API routes in the backend?
A: Routes follow Next.js App Router conventions in `/apps/backend/src/app/api/latest/`. Each route has a `route.tsx` file that exports HTTP method handlers (GET, POST, etc.).

### Q: How do I get all teams a user is a member of in the dashboard?
A: Use `user.useTeams()` where `user` is from `useUser({ or: 'redirect', projectIdMustMatch: "internal" })`.

### Q: What's the difference between client and server access types?
A: Client access type is for frontend applications and has limited permissions. Server access type is for backend operations and requires a secret key. Admin access type is for dashboard operations with full permissions.

### Q: How to avoid TypeScript "unnecessary conditional" errors when checking auth.user?
A: If the schema defines `auth.user` as `.defined()`, TypeScript knows it can't be null, so checking `if (!auth.user)` causes a lint error. Remove the check or adjust the schema if the field can be undefined.

### Q: What to do when TypeScript can't find module '@stackframe/stack' declarations?
A: This happens when packages haven't been built yet. Run these commands in order:
```bash
pnpm clean && pnpm i && pnpm codegen && pnpm build:packages
```
Then restart the dev server. This rebuilds all packages and generates the necessary TypeScript declarations.

## Q: How is backwards compatibility for the offer→product rename handled in the payments purchase APIs?
A: API v1 requests are routed through the `v2beta1` migration. The migration wraps the latest handlers, accepts legacy `offer_id`/`offer_inline` request fields, translates product-related errors back to the old offer error codes/messages, and augments responses (like `validate-code`) with `offer`/`conflicting_group_offers` aliases alongside the new `product` fields. Newer API versions keep the product-only contract.

## Q: How does `/api/v1/ai/query/generate` reject invalid AI tool names?
A: Invalid `tools` entries are rejected by `requestBodySchema` in `apps/backend/src/lib/ai/schema.ts` via `yupString().oneOf(TOOL_NAMES)`, so the endpoint returns a structured `SCHEMA_ERROR` object mentioning `body.tools[n]` rather than a custom `"Invalid tool names"` string from handler logic.

## Q: Why did the internal metrics E2E snapshots need to change in April 2026?
A: The `/api/v1/internal/metrics` response now intentionally includes `analytics_overview.daily_anonymous_visitors_fallback`, `analytics_overview.anonymous_visitors_fallback`, and `active_users_by_country`. Those additions are reflected in `packages/stack-shared/src/interface/admin-metrics.ts` and the backend route, so the E2E snapshots must include them instead of treating them as regressions.
## Q: How should Dashboard V2 avoid depending on the feature flags branch?
A: Do not reference the `feature-flags` app id, feature flag route, or `FlagIcon` in Dashboard V2 until the feature-flags branch is in the stack. The feature flag implementation lives on `feature-flags-v1`; Dashboard V2 should omit `/projects/$projectId/feature-flags` from `routeTree.gen.ts`, `ProjectSidebarNavTo`, sidebar nav groups, and app icon maps when it is meant to depend only on the TanStack Start integration.

## Q: How should request headers be documented in backend smart-route schemas?
A: Request `headers` fields must use `yupTuple([innerHeaderSchema])`, not `yupArray(...)`. The smart route layer represents header values as string arrays, while the OpenAPI generator expects each header field schema to be a one-item tuple so it can document the header's scalar value.

## Q: What response body types are supported by the backend OpenAPI generator?
A: The Fumadocs OpenAPI generator supports documented `json`, `success`, and `empty` response body types. If a smart route returns JSON data, document it as `bodyType: "json"` and return the plain JSON body; using `bodyType: "binary"` for encoded JSON makes `codegen-docs` fail with `Unsupported body type: binary`.

## Q: How is the external TanStack Start Devtools MCP bridge wired into Dashboard V2 during local development?
A: Dashboard V2 aliases `@barreloflube/tanstack-start-dev-tool-mcp-react` and `@barreloflube/tanstack-start-dev-tool-mcp-shared` to `/Users/barreloflube/Desktop/tanstack-start-dev-tool-mcp` source files in `apps/dashboardV2/vite.config.ts` and `apps/dashboardV2/tsconfig.json`. The Vite `server.fs.allow` list must include both the Stack Auth repo root and the external repo root so Vite can serve the external source. The bridge runs with `pnpm dev:mcp` in the external repo and exposes browser-reported route/query snapshots through MCP tools.

## Q: How should Dashboard V2 avoid cache noise for local virtualized lists?
A: Use `@tanstack/react-virtual` directly when the rows are already local in memory, such as the project switcher. Reserve React Query-backed `useInfiniteVirtualList` for remote, cursor-backed data. Project-scoped remote queries should include the project id in their query keys, and bulky list queries should set an explicit `gcTime` so inactive pages do not sit in the cache for the default duration.

## Q: Where does Dashboard V2 define global SEO/social metadata and favicon links?
A: Dashboard V2 defines app-wide document metadata in `apps/dashboardV2/src/routes/__root.tsx` using the TanStack Router `head` option. Put root-level `og:*`, `twitter:*`, `rel="icon"`, `rel="manifest"`, and stylesheet links there so nested routes inherit them through `HeadContent`.

## Q: How can a Dashboard V2 sheet allow background interaction?
A: The shared `SheetContent` in `apps/dashboardV2/src/components/ui/sheet.tsx` supports `showOverlay={false}`. Combine that with `modal={false}` on `Sheet` for non-blocking detail drawers where outside clicks should close the sheet while still reaching the background target.

## Q: How should Dashboard V2 infinite virtual lists support j/k keyboard navigation?
A: Use the `keyboardNavigation` option in `apps/dashboardV2/src/hooks/use-infinite-virtual-list.ts`. It handles global `j`/`k` shortcuts, skips text-entry targets, scrolls the selected row into view, and remembers pending down-navigation at the loaded-list boundary so the next page is fetched and selected when it arrives.

## Q: How should a TanStack Start SDK package be added without dragging Dashboard V2 logic into the same PR?
A: Keep the integration PR scoped to generated package registration (`packages/tanstack-start/package.json`, `.gitignore`, `scripts/generate-sdks.ts`, `scripts/utils.ts`), template/package dependency metadata, and SDK runtime changes needed by TanStack Start (`cookie.ts`, token-store handling, handler SSR guard). Leave dashboard routes, hooks, app wiring, and admin API types in the dashboard PR.

## Q: How should Dashboard V2 format compact relative dates in admin tables?
A: Put Dashboard V2-specific date display helpers in `apps/dashboardV2/src/lib/dates.ts` and cover them with a real `*.test.ts` file, because this package's Vitest config only discovers test/spec files. The users table uses `formatRecentDashboardDate`, which shows compact relative values like `3 mins ago` and `6 months ago`, then switches to an absolute date once the value is outside the six-month window.

## Q: How can Dashboard V2 combine TanStack Table column resizing with virtualized grid rows?
A: Keep TanStack Table as the sizing source of truth: enable `columnResizeMode: "onChange"`, store `ColumnSizingState`, derive `gridTemplateColumns` from `table.getVisibleLeafColumns().map(column => \`\${column.getSize()}px\`)`, and pass that same template to the sticky header, virtual rows, empty row, and loader row. This prevents header/body drift while still allowing resize handles on each `<th>`.

## Q: How should Dashboard V2 keep project page headers and virtual table sticky offsets consistent?
A: Use `apps/dashboardV2/src/components/console/project-page.tsx` for project-level shells: `ProjectPage`, `ProjectPageHeader`, and `ProjectPageMain`. Page headers are sticky at the viewport top with the shared 52px height. Page-level `VirtualDataGrid` tables should use `PROJECT_PAGE_HEADER_STICKY_TOP_CLASS`; tables under a header with sub-navigation, such as Emails, should use `PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS`.

## Q: What z-index should Dashboard V2 fixed sidebars use relative to sticky page headers?
A: Fixed sidebars from `apps/dashboardV2/src/components/ui/sidebar.tsx` should sit above sticky page chrome. The shared project page header uses `z-30`, so the desktop sidebar container uses `z-40`; otherwise a sticky header can overlay the sidebar hit area and steal clicks from lower nav items.

## Q: How should Dashboard V2 make clickable buttons show the pointer cursor?
A: Put `cursor-pointer` on the shared `buttonVariants` base class in `apps/dashboardV2/src/components/ui/button.tsx` so all `Button` usages inherit the expected affordance. Route-local custom `<button>` elements, such as Teams page cards and member row links, still need `cursor-pointer` on their own class names because they do not use the shared `Button` primitive.

## Q: Is Dashboard V2 users-table sorting and search server-side?
A: Search is server-side: `apps/dashboardV2/src/routes/_app/projects/$projectId/users.tsx` includes the trimmed search text in the React Query key and passes it as `query` to `adminApp.listUsers`, which maps to the backend `/users?query=...` filter. Sorting in V2 is currently client-side over the already loaded infinite-query pages via `sortUsers(items, sort)`; the V2 page does not pass `orderBy` or `desc` to `listUsers`, even though the backend supports `order_by=signed_up_at` and `desc` for server-side signed-up sorting.
