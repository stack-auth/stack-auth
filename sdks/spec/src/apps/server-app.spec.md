# StackServerApp

Extends StackClientApp with server-side capabilities. Requires secretServerKey.


## Constructor

StackServerApp(options)

Extends StackClientApp constructor options with:

Required:
  secretServerKey: string - from Stack Auth dashboard

Optional:
  waitUntil: (promise: Promise<any>) => void
    Callback to extend the lifetime of the serverless function until a promise
    resolves. Ensures analytics flushes complete before the runtime shuts down.
    - Vercel: `import { waitUntil } from '@vercel/functions'`
    - Cloudflare Workers: `(p) => ctx.waitUntil(p)`
    If omitted, auto-detects `globalThis.waitUntil`. Falls back to fire-and-forget.

The secretServerKey enables server-only operations like listing all users,
creating users, and accessing server metadata.


## trackEvent(eventType, data?, optionsOrRequest?)

Send a custom analytics event from the server. Non-blocking — events are buffered
and flushed in the background.

Arguments:
  eventType: string
    Custom event name. MUST NOT start with `$`.
    Allowed characters: letters, numbers, `.`, `_`, `:`, `-`
  data: object?
    JSON-serializable object payload. Default: `{}`

  The third argument can be one of:
  - A request object (Fetch API Request, Express req, or any object with headers)
    to automatically derive user context from auth headers
  - An options object with the following fields:
    options.at: Date | number?
      Event timestamp. If Date, use `.getTime()`. Default: `Date.now()`
    options.browserSessionId: string?
      Explicit browser session ID to associate with the event
    options.sessionReplayId: string?
      Explicit session replay ID to associate with the event
    options.sessionReplaySegmentId: string?
      Explicit session replay segment ID to associate with the event
    options.userId: string?
      Explicit user ID override for the event row
    options.teamId: string?
      Explicit team ID override for the event row
    options.tokenStore: TokenStore?
      Optional request/session context. When present, implementations SHOULD derive
      user context from it if userId/teamId are not explicitly provided.

Behavior:
1. Validate eventType and payload synchronously
2. Validate any provided browserSessionId/sessionReplayId/sessionReplaySegmentId as UUIDs
3. Buffer the event and resolve user context in the background (non-blocking)
4. If userId/teamId are omitted, derive them from the current user/session when possible
5. Events are batched and flushed periodically or when thresholds are reached:
   POST /api/v1/analytics/events/batch [server-only]

Request body:
  {
    batch_id: uuid,
    sent_at_ms: number,
    events: [
      {
        event_type: string,
        event_at_ms: number,
        data: object,
        user_id?: string,
        team_id?: string,
        browser_session_id?: string,
        session_replay_id?: string,
        session_replay_segment_id?: string
      }
    ]
  }

This supports both:
- request-bound events (user/session context present)
- project-scoped events (no user context)


## flushAnalytics()

Flush all buffered server-side analytics events and spans immediately.

Returns: Promise<void> that resolves after all buffered data has been sent.

Use this when you need to ensure events/spans are delivered before the process exits
(e.g., in serverless environments, test teardown, or graceful shutdown handlers).


## startSpan(name, optionsOrRequestOrCallback?, callback?)

Create a traced span for a timed server-side operation.

Overloads:
  startSpan(name, callback)           — callback form, auto-ends
  startSpan(name, options, callback)  — with explicit options
  startSpan(name, request, callback)  — extract trace context from request
  startSpan(name)                     — manual form
  startSpan(name, options)            — manual form with options

Arguments:
  name: string — span type name (no `$` prefix)
  request: RequestLike | { headers } — extracts `x-stack-trace` for distributed tracing
    and `x-stack-replay` for session replay linkage. Also derives user identity.
  options: same as client StartSpanOptions, plus:
    userId: string? — explicit user override
    teamId: string? — explicit team override
    tokenStore: TokenStoreInit? — for auth context extraction
    sessionReplayId: string? — explicit replay linkage
    sessionReplaySegmentId: string? — explicit segment linkage
  callback: (span: Span) => T | Promise<T>

Context propagation:
  - Uses `globalThis.AsyncLocalStorage` (available in Node.js 16+, Deno, Bun,
    Cloudflare Workers, and all serverless runtimes). Nested startSpan() calls
    auto-detect parent span across `await` boundaries.
  - Events tracked inside a span callback auto-get the span in parent_span_ids.
  - trace_id is inherited from incoming x-stack-trace header or parent span.

## captureException(error, optionsOrRequest?, extraData?)

Manually report a caught error as a `$error` analytics event.

Arguments:
  error: unknown — the error to report
  optionsOrRequest: options object or request for user attribution (same as trackEvent)
  extraData: object? — additional key-value data merged into the event

Behavior:
  - Same error metadata extraction as client (error_name, stack_frames, etc.)
  - Derives user context from request headers when provided
  - Auto-linked to active span and session replay
  - Non-blocking: buffered and flushed in background

## getActiveSpan()

Returns the currently active Span, or null.


## getUser(id)

Arguments:
  id: string - user ID to look up

Returns: ServerUser | null

Request:
  GET /api/v1/users/{id} [server-only]

Response:
  ServerUserCrud object or 404 if not found

Construct ServerUser object (types/users/server-user.spec.md).

Does not error.


## getUser(options: { apiKey })

Arguments:
  options.apiKey: string - API key to authenticate with
  options.or: "return-null" | "anonymous"?

Returns: ServerUser | null

Request:
  POST /api/v1/api-keys/check [server-only]
  Body: { api_key: string }

Response:
  { user_id?: string, team_id?: string, ... }

Returns user associated with the API key.

Does not error.


## getUser(options: { from: "convex", ctx })  [JS-ONLY]

Arguments:
  options.from: "convex"
  options.ctx: ConvexQueryContext - Convex query context
  options.or: "return-null" | "anonymous"?

Returns: ServerUser | null

Extract token from Convex context, validate, and return user.
For Convex integration (JS SDK only).

Does not error.


## getPartialUser(options)

Get minimal user info without a full API call.
Same as StackClientApp.getPartialUser but returns server user info.

Arguments:
  options.from: "token" | "convex"
    - "token": Extract user info from the stored access token
    - "convex": Extract user info from Convex auth context [JS-ONLY]
  
  For "convex" [JS-ONLY]:
    options.ctx: ConvexQueryContext - the Convex query context

Returns: TokenPartialUser | null

See StackClientApp.getPartialUser for implementation details.

Does not error.


## listUsers(options?)

Arguments:
  options.cursor: string? - pagination cursor
  options.limit: number? - max results (default 100)
  options.orderBy: "signedUpAt"? - sort field
  options.desc: bool? - descending order
  options.query: string? - search query (searches email, display name)
  options.includeRestricted: bool? - include users who haven't completed onboarding
  options.includeAnonymous: bool? - include anonymous users

Returns: ServerUser[] & { nextCursor: string | null }

Request:
  GET /api/v1/users [server-only]
  Query params: cursor, limit, order_by, desc, query, include_restricted, include_anonymous

Response:
  {
    items: [ServerUserCrud, ...],
    pagination: { next_cursor?: string }
  }

Construct ServerUser for each item.

Does not error.


## createUser(options)

Arguments:
  options.primaryEmail: string?
  options.primaryEmailAuthEnabled: bool?
  options.password: string?
  options.otpAuthEnabled: bool?
  options.displayName: string?
  options.primaryEmailVerified: bool?
  options.clientMetadata: json?
  options.clientReadOnlyMetadata: json?
  options.serverMetadata: json?

Returns: ServerUser

Request:
  POST /api/v1/users [server-only]
  Body: {
    primary_email?: string,
    primary_email_auth_enabled?: bool,
    password?: string,
    otp_auth_enabled?: bool,
    display_name?: string,
    primary_email_verified?: bool,
    client_metadata?: json,
    client_read_only_metadata?: json,
    server_metadata?: json
  }

Response:
  ServerUserCrud object

Does not error.


## getTeam(id)

Arguments:
  id: string - team ID

Returns: ServerTeam | null

Request:
  GET /api/v1/teams/{id} [server-only]

Response:
  ServerTeamCrud object or 404 if not found

Construct ServerTeam object (types/teams/server-team.spec.md).

Does not error.


## getTeam(options: { apiKey })

Arguments:
  options.apiKey: string - team API key

Returns: ServerTeam | null

Request:
  POST /api/v1/api-keys/check [server-only]
  Body: { api_key: string }

Response:
  { team_id?: string, ... }

Returns team associated with the API key.

Does not error.


## listTeams(options?)

Arguments:
  options.userId: string? - filter by user membership

Returns: ServerTeam[]

Request:
  GET /api/v1/teams [server-only]
  Query params: user_id?

Note: This endpoint does NOT support pagination parameters like limit/cursor.
Use optional user_id filter to get teams a specific user belongs to.

Response:
  { items: [ServerTeamCrud, ...] }

Does not error.


## createTeam(options)

Arguments:
  options.displayName: string
  options.profileImageUrl: string?
  options.creatorUserId: string? - user to add as creator/member

Returns: ServerTeam

Request:
  POST /api/v1/teams [server-only]
  Body: { 
    display_name: string, 
    profile_image_url?: string, 
    creator_user_id?: string 
  }

Response:
  ServerTeamCrud object

Does not error.


## grantProduct(options)

Arguments:
  Customer identification (one of):
    options.userId: string
    options.teamId: string
    options.customCustomerId: string
  
  Product identification (one of):
    options.productId: string - existing product ID
    options.product: InlineProduct - inline product definition
  
  options.quantity: number? - default 1

Returns: void

Request:
  POST /api/v1/customers/{customer_type}/{customer_id}/products [server-only]
  Body: { 
    product_id?: string,
    product?: { name, description, ... },
    quantity?: number 
  }

Does not error.


## sendEmail(options)

Arguments:
  options.to: string | string[] - recipient email(s)
  options.subject: string
  options.html: string? - HTML body
  options.text: string? - plain text body

Returns: void

Request:
  POST /api/v1/emails [server-only]
  Body: { 
    to: string | string[], 
    subject: string, 
    html?: string, 
    text?: string 
  }

Does not error.


## getEmailDeliveryStats()

Returns: EmailDeliveryInfo

Request:
  GET /api/v1/emails/delivery-stats [server-only]

Response:
  {
    delivered: number,
    bounced: number,
    complained: number,
    total: number
  }

EmailDeliveryInfo:
  delivered: number - emails successfully delivered
  bounced: number - emails that bounced (hard or soft)
  complained: number - emails marked as spam by recipients
  total: number - total emails sent

Does not error.


## createOAuthProvider(options)

Arguments:
  options.userId: string
  options.accountId: string
  options.providerConfigId: string
  options.email: string
  options.allowSignIn: bool
  options.allowConnectedAccounts: bool

Returns: ServerOAuthProvider (on success)

Request:
  POST /api/v1/users/{userId}/oauth-providers [server-only]
  Body: {
    account_id: string,
    provider_config_id: string,
    email: string,
    allow_sign_in: bool,
    allow_connected_accounts: bool
  }

Errors:
  OAuthProviderAccountIdAlreadyUsedForSignIn
    code: "oauth_provider_account_id_already_used_for_sign_in"
    message: "This OAuth account is already linked to another user for sign-in."


## getDataVaultStore(id)

Arguments:
  id: string - data vault store ID

Returns: DataVaultStore

The Data Vault is a simple key-value store for storing sensitive data server-side.
Each store is isolated and identified by its ID.

DataVaultStore:
  id: string - the store ID

  get(key: string): Promise<string | null>
    GET /api/v1/data-vault/stores/{storeId}/items/{key} [server-only]
    Returns the value for the key, or null if not found.
    
  set(key: string, value: string): Promise<void>
    PUT /api/v1/data-vault/stores/{storeId}/items/{key} [server-only]
    Body: { value: string }
    Sets or updates the value for the key.
    
  delete(key: string): Promise<void>
    DELETE /api/v1/data-vault/stores/{storeId}/items/{key} [server-only]
    Deletes the key-value pair. No error if key doesn't exist.
    
  list(): Promise<string[]>
    GET /api/v1/data-vault/stores/{storeId}/items [server-only]
    Returns all keys in the store.

Does not error.


## getItem(options)

Arguments:
  Customer identification (one of):
    options.userId: string
    options.teamId: string
    options.customCustomerId: string
  options.itemId: string

Returns: ServerItem

Request:
  GET /api/v1/customers/{customer_type}/{customer_id}/items/{itemId} [server-only]

Response:
  { id: string, quantity: number }

Does not error.


## listProducts(options)

Arguments:
  Customer identification (one of):
    options.userId: string
    options.teamId: string
    options.customCustomerId: string
  options.cursor: string? - pagination cursor
  options.limit: number? - max results

Returns: CustomerProductsList

Request:
  GET /api/v1/customers/{customer_type}/{customer_id}/products [server-only]
  Query params: cursor?, limit?

Response:
  { 
    items: [{ id, name, quantity, ... }],
    pagination: { next_cursor?: string }
  }

Does not error.
