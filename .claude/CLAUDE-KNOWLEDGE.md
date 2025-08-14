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