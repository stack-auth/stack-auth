# ServerTeam

Server-side team with additional management capabilities.

Extends: Team (team.spec.md)


## Additional Properties

createdAt: Date
  When the team was created.

serverMetadata: json
  Server-only metadata, not visible to client.


## Server-specific Methods


### update(options)

options: {
  displayName?: string,
  profileImageUrl?: string | null,
  clientMetadata?: json,
  clientReadOnlyMetadata?: json,
  serverMetadata?: json,
}

PATCH /teams/{teamId} [server-only]
Body: { display_name, profile_image_url, client_metadata, client_read_only_metadata, server_metadata }
Route: apps/backend/src/app/api/latest/teams/[teamId]/route.ts

Does not error.


### listUsers()

Returns: ServerTeamUser[]

GET /teams/{teamId}/users [server-only]
Route: apps/backend/src/app/api/latest/teams/[teamId]/users/route.ts

ServerTeamUser extends ServerUser with:
  teamProfile: ServerTeamMemberProfile

Does not error.


### addUser(userId)

userId: string

POST /teams/{teamId}/users { user_id } [server-only]

Directly adds a user to the team without invitation.

Does not error.


### removeUser(userId)

userId: string

DELETE /teams/{teamId}/users/{userId} [server-only]

Does not error.


### inviteUser(options)

options.email: string
options.callbackUrl: string?

POST /teams/{teamId}/invitations { email, callback_url } [server-only]

Does not error.


### delete()

DELETE /teams/{teamId} [server-only]

Does not error.
