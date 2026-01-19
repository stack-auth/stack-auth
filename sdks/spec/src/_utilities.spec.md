# Utilities

Common patterns referenced by bracketed notation in other spec files.


## Sending Requests

All API requests follow this pattern. This section describes the complete request lifecycle.

### Base URL

Construct API URL: `{baseUrl}/api/v1{path}`
  - baseUrl defaults to "https://api.stack-auth.com"
  - Remove trailing slash from final URL
  - Example: `https://api.stack-auth.com/api/v1/users/me`


### Required Headers (every request)

x-stack-project-id: <projectId>
x-stack-publishable-client-key: <publishableClientKey>
x-stack-client-version: "<sdk-name>@<version>" (e.g., "python@1.0.0", "go@0.1.0")
x-stack-access-type: "client" | "server" | "admin"
  - "client" for StackClientApp
  - "server" for StackServerApp (also include server key header)
x-stack-override-error-status: "true"
  - Tells server to return errors as 200 with x-stack-actual-status header
  - This works around some platforms that intercept non-200 responses
x-stack-random-nonce: <random-string>
  - Cache buster to prevent framework caching (e.g., Next.js)
  - Generate a new random string for each request
content-type: application/json (for requests with body)


### Authentication Headers [authenticated]

Include when session tokens are available:

x-stack-access-token: <access_token>
x-stack-refresh-token: <refresh_token> (if available)

On 401 response with code="invalid_access_token":
1. Mark access token as expired
2. Fetch new access token using refresh token (see Token Refresh below)
3. Retry the request with the new token
4. If still 401 after retry: treat as unauthenticated


### Token Refresh

Use OAuth2 refresh_token grant to get new access token.

Concurrency: Token refresh must be serialized. Only one refresh request should be in-flight at a time.
If a refresh is already in progress, wait for it to complete rather than starting another.
Use a mutex/lock to ensure this (or, if preferred in that framework, some kind of asynchronous mechanism that doesn't block the main thread).

POST /api/v1/auth/oauth/token
Content-Type: application/x-www-form-urlencoded

Body (form-encoded):
  grant_type: refresh_token
  refresh_token: <refresh_token>
  client_id: <projectId>
  client_secret: <publishableClientKey>

Response on success:
  { access_token: string, refresh_token?: string, ... }

On success: store new access_token. If refresh_token is returned, store it too.
On error (e.g., refresh_token_error): clear all tokens, user is signed out.

Use an OAuth library (e.g., oauth4webapi) for proper OAuth2 handling.


### [server-only] - Server Key Required

Include header: x-stack-secret-server-key: <secretServerKey>
Only available in StackServerApp.


### Retry Logic

For network errors (TypeError from fetch) on idempotent requests (GET, HEAD, OPTIONS, PUT, DELETE):
1. Retry up to 5 times
2. Use exponential backoff: delay = 1000ms * 2^attempt
3. If all retries fail: throw network error with diagnostics

For rate limiting (429 response):
1. Check Retry-After header for delay (in seconds)
2. Wait that duration, then retry
3. If no Retry-After header: retry immediately with backoff


### Request Body

POST, PATCH, and PUT requests MUST include a JSON body, even if empty.
If no body data is needed, send an empty object: {}

Set Content-Type: application/json for all requests with a body.


### Response Processing

1. Check x-stack-actual-status header for real status code
   (Server may return 200 with actual status in this header)

2. Check x-stack-known-error header for error code
   If present: body is { code, message, details? }
   Parse into appropriate error type

3. On success (2xx): parse JSON body and return


### Credentials

Set credentials: "omit" on fetch to avoid sending cookies cross-origin.
(Skip this on platforms that don't support it, e.g., Cloudflare Workers)


### Cache Control

Set cache: "no-store" to prevent caching.
(Skip this on platforms that don't support it)


## Error Response Format

If the response has x-stack-known-error header, the body has shape:
  { code: string, message: string, details?: object }

The code matches the x-stack-known-error header value.
See packages/stack-shared/src/known-errors.ts for all error types.


## StackAuthApiError

The base error type for all Stack Auth API errors.

Properties:
  code: string - error code from API, UPPERCASE_WITH_UNDERSCORES (e.g., "USER_NOT_FOUND")
  message: string - human-readable error message
  details: object? - optional additional details

Error codes are always UPPERCASE_WITH_UNDERSCORES format.
Examples: EMAIL_PASSWORD_MISMATCH, USER_NOT_FOUND, PASSWORD_REQUIREMENTS_NOT_MET, PASSWORD_TOO_SHORT

Note: PASSWORD_TOO_SHORT is returned when a password doesn't meet minimum length requirements.
PASSWORD_REQUIREMENTS_NOT_MET is a more general error for other password policy violations.

All function-specific errors (like PasswordResetCodeInvalid, EmailPasswordMismatch, etc.) 
should extend or be instances of StackAuthApiError.

For unrecognized error codes, create a StackAuthApiError with the code and message from the response.


## Token Storage

Store access_token and refresh_token. The tokenStore constructor option determines storage strategy.

Many functions also accept a tokenStore parameter to override storage for that call.

### TokenStoreInit Type

TokenStoreInit is a union type representing the different ways to provide token storage:

```
TokenStoreInit = 
  | "cookie"                              // [JS-ONLY] Browser cookies
  | "memory"                              // In-memory storage
  | { accessToken: string, refreshToken: string }  // Explicit tokens
  | RequestLike                           // Extract from request headers
  | null                                  // No storage
```

### Token Store Types

"cookie": [JS-ONLY]
  Store tokens in browser cookies. Requires browser environment.
  Due to cookie complexity (Secure flags, SameSite, Partitioned/CHIPS, HTTPS detection),
  this is only implemented in the JS SDK. Other SDKs should use "memory" or explicit tokens.
  
"memory":
  Store tokens in runtime memory. Lost on page refresh or process restart.
  Useful for short-lived sessions, CLI tools, or server-side scripts.

{ accessToken, refreshToken } object:
  Use explicit token values directly.
  For custom token management scenarios.

RequestLike object:
  An object that conforms to whatever the requests look like in common backend frameworks. For example, in JavaScript, these often have the shape `{ headers: { get(name: string): string | null } }`, but in other languages this may drastically differ (and may not even be an interface and instead rather just be an abstract class, or not exist at all).

  This exists as a simplified way to support common backend frameworks in a more accessible way than the `{ accessToken: string, refreshToken: string }` one.
  
  Extract tokens from the x-stack-auth header:
  1. Get header value: headers.get("x-stack-auth")
  2. Parse as JSON: { accessToken: string, refreshToken: string }
  3. Use those tokens for authentication

null:
  No token storage. SDK methods requiring authentication will fail.
  Most useful for backends, as you can still specify the token store per-request.


### x-stack-auth Header Format

For cross-origin requests or server-side handling, use this header:
  x-stack-auth: { "accessToken": "<token>", "refreshToken": "<token>" }

JSON-encoded object with both tokens.
Use getAuthHeaders() to generate this header value.

## MFA Handling Pattern

Several sign-in methods may return MultiFactorAuthenticationRequired error when MFA is enabled.

Error format:
  code: "multi_factor_authentication_required"
  message: "Multi-factor authentication is required."
  details: { attempt_code: string }

When this error is received:
1. Store the attempt_code (e.g., in sessionStorage)
2. Redirect user to the MFA page (urls.mfa)
3. User enters their 6-digit TOTP code
4. Call signInWithMfa(otp, attemptCode) to complete sign-in

Methods that can return this error:
- signInWithCredential
- signInWithMagicLink
- signInWithPasskey
- callOAuthCallback

The attempt_code is short-lived (a few minutes) and single-use.


## JWT Access Token Claims

The access token is a JWT with these claims:

| Claim | Maps to | Type |
|-------|---------|------|
| sub | id | string |
| name | displayName | string or null |
| email | primaryEmail | string or null |
| email_verified | primaryEmailVerified | boolean |
| is_anonymous | isAnonymous | boolean |
| is_restricted | isRestricted | boolean |
| restricted_reason | restrictedReason | object or null |
| exp | expiresAt | number (Unix timestamp) |
| iat | issuedAt | number (Unix timestamp) |

To decode: split by ".", base64url-decode the second segment, parse as JSON.


## Unknown Errors

If an API returns an error code not listed in the spec:
1. Create a generic StackAuthApiError with the code and message
2. Log the unknown error for debugging
3. Treat it as a general API error

This ensures forward compatibility when new error codes are added.
