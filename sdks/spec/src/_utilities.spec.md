# Utilities

Common patterns referenced by bracketed notation in other spec files.


## [authenticated] - Authenticated Request

Include header:
  x-stack-access-token: <access_token from token storage>

On 401 with code="access_token_expired": do [token-refresh], retry once.
On 401 after retry: treat as unauthenticated.


## [token-refresh] - Token Refresh

POST /auth/sessions/current/refresh
Headers: x-stack-refresh-token: <refresh_token>
Route: apps/backend/src/app/api/latest/auth/sessions/current/refresh/route.ts

On 200: { access_token, refresh_token } - store both
On error: clear tokens, user is signed out


## [server-only] - Server Key Required

Include header: x-stack-secret-server-key: <secretServerKey>
Only available in StackServerApp and StackAdminApp.


## [admin-only] - Admin Key Required  

Include header: x-stack-super-secret-admin-key: <superSecretAdminKey>
Only available in StackAdminApp.


## Base Request Headers

Always include on every request:
  x-stack-project-id: <projectId>
  x-stack-publishable-client-key: <publishableClientKey>
  x-stack-client-version: "<language>@<version>" (e.g. "python@1.0.0")
  content-type: application/json


## Error Response Format

4xx/5xx responses have body: { code: string, message: string, details?: object }

Map `code` to error type. Unknown codes create generic ApiError.


## Token Storage

Store access_token and refresh_token. Strategy from constructor:

"cookie": 
  Browser cookies: "stack-refresh-{projectId}", "stack-access"
  Options: Secure=true in production, SameSite=Lax

"memory":
  Runtime variable, lost on restart

RequestLike object:
  Read x-stack-auth header (JSON: { accessToken, refreshToken })
  For server-side request handling


## Naming Conventions

SDK uses language-appropriate naming:
  - JS/TS: camelCase (displayName, getUser)
  - Python: snake_case (display_name, get_user)
  - Go: PascalCase exports (DisplayName, GetUser)

API always uses snake_case in JSON.
