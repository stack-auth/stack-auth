# CLAUDE-KNOWLEDGE.md

This file documents key learnings from implementing wildcard domain support in Stack Auth, organized in Q&A format.

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