# CLAUDE-KNOWLEDGE.md

This file contains knowledge learned while working on the codebase in Q&A format.

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
A: Use the `/api/v1/internal/config/override` endpoint with PATCH method and admin access token:
```typescript
await niceBackendFetch("/api/v1/internal/config/override", {
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

### Q: How do I make authenticated API calls from dashboard server actions?
A: Get the session cookie and include it in the request headers:
```typescript
const cookieStore = await cookies();
const sessionCookie = cookieStore.get("stack-refresh-internal");
const response = await fetch(url, {
  headers: {
    'X-Stack-Access-Type': 'server',
    'X-Stack-Project-Id': 'internal',
    'X-Stack-Secret-Server-Key': getEnvVariable('STACK_SECRET_SERVER_KEY'),
    ...(sessionCookie ? { 'Cookie': `${sessionCookie.name}=${sessionCookie.value}` } : {})
  }
});
```

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
