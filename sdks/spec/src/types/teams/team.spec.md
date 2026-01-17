# Team

A team/organization that users can belong to.


## Properties

id: string
  Unique team identifier.

displayName: string
  Team's display name.

profileImageUrl: string | null
  URL to team's profile image.

clientMetadata: json
  Team-writable metadata, visible to client and server.

clientReadOnlyMetadata: json
  Server-writable metadata, visible to client but not writable by client.


## Methods


### update(options)

options: {
  displayName?: string,
  profileImageUrl?: string | null,
  clientMetadata?: json,
}

PATCH /teams/{teamId} [authenticated]
Body: { display_name, profile_image_url, client_metadata }
Route: apps/backend/src/app/api/latest/teams/[teamId]/route.ts

Does not error.


### delete()

DELETE /teams/{teamId} [authenticated]
Route: apps/backend/src/app/api/latest/teams/[teamId]/route.ts

Does not error.


### inviteUser(options)

options.email: string
options.callbackUrl: string?

POST /teams/{teamId}/invitations { email, callback_url } [authenticated]

Sends invitation email to the specified address.

Does not error.


### listUsers()

Returns: TeamUser[]

GET /teams/{teamId}/users [authenticated]
Route: apps/backend/src/app/api/latest/teams/[teamId]/users/route.ts

TeamUser has:
  id: string
  teamProfile: TeamMemberProfile

TeamMemberProfile has:
  displayName: string | null
  profileImageUrl: string | null

Does not error.


### listInvitations()

Returns: TeamInvitation[]

GET /teams/{teamId}/invitations [authenticated]

TeamInvitation has:
  id: string
  recipientEmail: string | null
  expiresAt: Date
  revoke(): Promise<void>

Does not error.


### createApiKey(options)

options.description: string
options.expiresAt: Date?
options.scope: string?

Returns: TeamApiKeyFirstView

POST /teams/{teamId}/api-keys { description, expires_at, scope } [authenticated]

TeamApiKeyFirstView extends TeamApiKey with:
  apiKey: string - the actual key value (only shown once)

Does not error.


### listApiKeys()

Returns: TeamApiKey[]

GET /teams/{teamId}/api-keys [authenticated]

TeamApiKey has:
  id: string
  description: string
  expiresAt: Date | null
  createdAt: Date

Does not error.


## Customer Methods

Team also implements Customer interface. See payments/customer.spec.md for:
- getItem(itemId)
- listItems()
- hasItem(itemId)
- getItemQuantity(itemId)
- listProducts()
- getBilling()
- getPaymentMethodSetupIntent()
