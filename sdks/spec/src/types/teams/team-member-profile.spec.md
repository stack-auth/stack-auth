# TeamMemberProfile

A user's profile within a specific team. Teams can have per-user display names
and profile images that differ from the user's global profile.


## Properties

displayName: string | null
  The user's display name within this team.

profileImageUrl: string | null
  The user's profile image URL within this team.


---

# EditableTeamMemberProfile

The current user's editable profile within a team.

Extends: TeamMemberProfile


## Methods


### update(options)

options.displayName: string | null?
options.profileImageUrl: string | null?

PATCH /api/v1/teams/{teamId}/users/me/profile { display_name, profile_image_url } [authenticated]

Updates the current user's profile within the team.

Does not error.


---

# ServerTeamMemberProfile

Server-side team member profile with additional management capabilities.

Extends: TeamMemberProfile


## Additional Properties

userId: string
  The user ID this profile belongs to.


## Methods


### update(options)

options.displayName: string | null?
options.profileImageUrl: string | null?

PATCH /api/v1/teams/{teamId}/users/{userId}/profile [server-only]
Body: { display_name, profile_image_url }

Does not error.
