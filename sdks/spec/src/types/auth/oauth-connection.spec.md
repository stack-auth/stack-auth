# OAuthConnection

A connected OAuth account that can be used to access third-party APIs.


## Properties

id: string
  The OAuth provider ID (e.g., "google", "github").


## Methods


### getAccessToken()

Returns: string

POST /api/v1/connected-accounts/{id}/access-token {} [authenticated]
Route: apps/backend/src/app/api/latest/connected-accounts/[provider]/access-token/route.ts

Returns a fresh OAuth access token for the connected account.
The token is automatically refreshed if expired (if provider supports refresh).

Errors:
  OAuthConnectionTokenExpired
    code: "oauth_connection_token_expired"
    message: "The OAuth token has expired and cannot be refreshed. Please reconnect."


---

# OAuthProvider

An OAuth provider linked to a user's account.


## Properties

id: string
  Unique provider link ID.

type: string
  Provider type (e.g., "google", "github", "microsoft").

userId: string
  The user this provider is linked to.

accountId: string?
  The account ID from the OAuth provider. Optional for client-side.

email: string?
  Email associated with the OAuth account.

allowSignIn: bool
  Whether this provider can be used to sign in.

allowConnectedAccounts: bool
  Whether this provider can be used for connected account access (API access).


## Methods


### update(options)

options: {
  allowSignIn?: bool,
  allowConnectedAccounts?: bool,
}

Returns: void

PATCH /api/v1/users/me/oauth-providers/{id} { allow_sign_in, allow_connected_accounts } [authenticated]
Route: apps/backend/src/app/api/latest/users/me/oauth-providers/[id]/route.ts

Errors:
  OAuthProviderAccountIdAlreadyUsedForSignIn
    code: "oauth_provider_account_id_already_used_for_sign_in"
    message: "This OAuth account is already linked to another user for sign-in."


### delete()

DELETE /api/v1/users/me/oauth-providers/{id} [authenticated]
Route: apps/backend/src/app/api/latest/users/me/oauth-providers/[id]/route.ts

Does not error.


---

# ServerOAuthProvider

Server-side OAuth provider with additional update capabilities.

Extends: OAuthProvider

accountId is always present (not optional).


## Server-specific Methods


### update(options)

options: {
  accountId?: string,
  email?: string,
  allowSignIn?: bool,
  allowConnectedAccounts?: bool,
}

Returns: void

PATCH /api/v1/users/{userId}/oauth-providers/{id} [server-only]
Body: { account_id, email, allow_sign_in, allow_connected_accounts }

Errors:
  OAuthProviderAccountIdAlreadyUsedForSignIn
    code: "oauth_provider_account_id_already_used_for_sign_in"
    message: "This OAuth account is already linked to another user for sign-in."


### delete()

DELETE /api/v1/users/{userId}/oauth-providers/{id} [server-only]

Does not error.
