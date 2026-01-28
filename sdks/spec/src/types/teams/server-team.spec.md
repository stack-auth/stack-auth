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

PATCH /api/v1/teams/{teamId} [server-only]
Body: { display_name, profile_image_url, client_metadata, client_read_only_metadata, server_metadata }
Route: apps/backend/src/app/api/latest/teams/[teamId]/route.ts

Does not error.


### listUsers()

Returns: ServerTeamUser[]

GET /api/v1/users?team_id={teamId} [server-only]

Returns all users who are members of the specified team.

ServerTeamUser:
  Extends ServerUser with:
  teamProfile: ServerTeamMemberProfile

See types/teams/team-member-profile.spec.md for ServerTeamMemberProfile.

Does not error.


### addUser(userId)

userId: string

POST /api/v1/team-memberships/{teamId}/{userId} [server-only]

Directly adds a user to the team without invitation.

Does not error.


### removeUser(userId)

userId: string

DELETE /api/v1/team-memberships/{teamId}/{userId} [server-only]

Does not error.


### inviteUser(options)

options.email: string
options.callbackUrl: string?

POST /api/v1/team-invitations/send-code { email, team_id, callback_url } [server-only]

Does not error.


### delete()

DELETE /api/v1/teams/{teamId} [server-only]

Does not error.
