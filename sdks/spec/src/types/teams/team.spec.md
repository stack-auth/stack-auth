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

PATCH /api/v1/teams/{teamId} [authenticated]
Body: { display_name, profile_image_url, client_metadata }
Route: apps/backend/src/app/api/latest/teams/[teamId]/route.ts

Does not error.


### delete()

DELETE /api/v1/teams/{teamId} [authenticated]
Route: apps/backend/src/app/api/latest/teams/[teamId]/route.ts

Does not error.


### inviteUser(options)

options.email: string
options.callbackUrl: string?

POST /api/v1/team-invitations/send-code { email, team_id, callback_url } [authenticated]

Sends invitation email to the specified address.

Does not error.


### listUsers()

Returns: TeamUser[]

GET /api/v1/teams/{teamId}/users [authenticated]
Route: apps/backend/src/app/api/latest/teams/[teamId]/users/route.ts

TeamUser:
  id: string - user ID
  teamProfile: TeamMemberProfile - user's profile within this team

See types/teams/team-member-profile.spec.md for TeamMemberProfile.

Does not error.


### listInvitations()

Returns: TeamInvitation[]

GET /api/v1/teams/{teamId}/invitations [authenticated]

TeamInvitation:
  id: string - invitation ID
  recipientEmail: string | null - email the invitation was sent to
  expiresAt: Date - when the invitation expires
  
  revoke(): Promise<void>
    DELETE /api/v1/teams/{teamId}/invitations/{id} [authenticated]
    Revokes the invitation so it can no longer be accepted.

Does not error.


### createApiKey(options)

options.description: string
options.expiresAt: Date?
options.scope: string?

Returns: TeamApiKeyFirstView

POST /api/v1/teams/{teamId}/api-keys { description, expires_at, scope } [authenticated]

See types/common/api-keys.spec.md for TeamApiKeyFirstView.
The apiKey property is only returned once at creation time.

Does not error.


### listApiKeys()

Returns: TeamApiKey[]

GET /api/v1/teams/{teamId}/api-keys [authenticated]

See types/common/api-keys.spec.md for TeamApiKey.

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
