# StackServerApp

Extends StackClientApp with server-side capabilities. Requires secretServerKey.


## Constructor

StackServerApp(options)

Extends StackClientApp constructor options with:

Required:
  secretServerKey: string - from Stack Auth dashboard

The secretServerKey enables server-only operations like listing all users,
creating users, and accessing server metadata.


## getUser(id)

id: string - user ID to look up

Returns: ServerUser | null

GET /users/{id} [server-only]
Route: apps/backend/src/app/api/latest/users/[userId]/route.ts

Construct ServerUser object (types/users/server-user.spec.md).

Does not error.


## getUser(options: { apiKey })

options.apiKey: string - API key to authenticate with
options.or: "return-null" | "anonymous"?

Returns: ServerUser | null

POST /api-keys/check { api_key } [server-only]
Returns user associated with the API key.

Does not error.


## getUser(options: { from: "convex", ctx })

options.from: "convex"
options.ctx: ConvexQueryContext - Convex query context
options.or: "return-null" | "anonymous"?

Returns: ServerUser | null

Extract token from Convex context, validate, and return user.
For Convex integration.

Does not error.


## listUsers(options?)

options.cursor: string? - pagination cursor
options.limit: number? - max results (default 100)
options.orderBy: "signedUpAt"? - sort field
options.desc: bool? - descending order
options.query: string? - search query
options.includeRestricted: bool? - include users who haven't completed onboarding
options.includeAnonymous: bool? - include anonymous users

Returns: ServerUser[] & { nextCursor: string | null }

GET /users [server-only]
Query params: cursor, limit, order_by, desc, query, include_restricted, include_anonymous
Route: apps/backend/src/app/api/latest/users/route.ts

Construct ServerUser for each item.

Does not error.


## createUser(options)

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

POST /users { ... } [server-only]
Route: apps/backend/src/app/api/latest/users/route.ts

Does not error.


## getTeam(id)

id: string - team ID

Returns: ServerTeam | null

GET /teams/{id} [server-only]
Route: apps/backend/src/app/api/latest/teams/[teamId]/route.ts

Construct ServerTeam object (types/teams/server-team.spec.md).

Does not error.


## getTeam(options: { apiKey })

options.apiKey: string - team API key

Returns: ServerTeam | null

POST /api-keys/check { api_key } [server-only]
Returns team associated with the API key.

Does not error.


## listTeams()

Returns: ServerTeam[]

GET /teams [server-only]
Route: apps/backend/src/app/api/latest/teams/route.ts

Does not error.


## createTeam(options)

options.displayName: string
options.profileImageUrl: string?
options.creatorUserId: string? - user to add as creator/member

Returns: ServerTeam

POST /teams { display_name, profile_image_url, creator_user_id } [server-only]
Route: apps/backend/src/app/api/latest/teams/route.ts

Does not error.


## grantProduct(options)

Customer identification (one of):
  options.userId: string
  options.teamId: string
  options.customCustomerId: string

Product identification (one of):
  options.productId: string - existing product ID
  options.product: InlineProduct - inline product definition

options.quantity: number? - default 1

POST /customers/{type}/{id}/products { product_id | product, quantity } [server-only]
Route: apps/backend/src/app/api/latest/customers/[...]/products/route.ts

Does not error.


## sendEmail(options)

options.to: string | string[] - recipient email(s)
options.subject: string
options.html: string? - HTML body
options.text: string? - plain text body

POST /emails { to, subject, html, text } [server-only]
Route: apps/backend/src/app/api/latest/emails/route.ts

Does not error.


## getEmailDeliveryStats()

Returns: EmailDeliveryInfo

GET /emails/delivery-stats [server-only]
Route: apps/backend/src/app/api/latest/emails/delivery-stats/route.ts

Returns: {
  delivered: number,
  bounced: number,
  complained: number,
  total: number,
}

Does not error.


## createOAuthProvider(options)

options.userId: string
options.accountId: string
options.providerConfigId: string
options.email: string
options.allowSignIn: bool
options.allowConnectedAccounts: bool

Returns: Result<ServerOAuthProvider, OAuthProviderAccountIdAlreadyUsedForSignIn>

POST /users/{userId}/oauth-providers { ... } [server-only]
Route: apps/backend/src/app/api/latest/users/[userId]/oauth-providers/route.ts

Errors:
  OAuthProviderAccountIdAlreadyUsedForSignIn
    code: "oauth_provider_account_id_already_used_for_sign_in"
    message: "This OAuth account is already linked to another user for sign-in."


## getDataVaultStore(id)

id: string - data vault store ID

Returns: DataVaultStore

GET /data-vault/stores/{id} [server-only]

DataVaultStore has:
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>

Does not error.


## getItem(options)

Customer identification (one of):
  options.userId: string
  options.teamId: string
  options.customCustomerId: string

options.itemId: string

Returns: ServerItem

GET /customers/{type}/{id}/items/{itemId} [server-only]
Route: apps/backend/src/app/api/latest/customers/[...]/items/[itemId]/route.ts

ServerItem has:
  id: string
  quantity: number

Does not error.


## listProducts(options)

options: CustomerProductsRequestOptions

Returns: CustomerProductsList

GET /customers/{type}/{id}/products [server-only]

Does not error.
