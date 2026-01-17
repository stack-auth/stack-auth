# CurrentUser

The authenticated user with methods to modify their own data.

Extends: User (base-user.spec.md)

Also includes:
  - Auth methods (signOut, getAccessToken, etc.)
  - Customer methods (payments/customer.spec.md)


## Additional Properties

selectedTeam: Team | null
  User's currently selected team.
  Constructed from selected_team in API response.


## Session Properties

currentSession.getTokens()
  Returns: { accessToken: string | null, refreshToken: string | null }
  Get current session tokens.


## update(options)

options: {
  displayName?: string | null,
  clientMetadata?: json,
  selectedTeamId?: string | null,
  profileImageUrl?: string | null,
  otpAuthEnabled?: bool,
  passkeyAuthEnabled?: bool,
  primaryEmail?: string | null,
  totpMultiFactorSecret?: bytes | null,
}

PATCH /users/me [authenticated]
Body: only include provided fields, convert to snake_case
Route: apps/backend/src/app/api/latest/users/me/route.ts

Update local properties on success.

Does not error.


## delete()

DELETE /users/me [authenticated]
Route: apps/backend/src/app/api/latest/users/me/route.ts

Clear stored tokens after success.

Does not error.


## setDisplayName(displayName)

displayName: string | null

Shorthand for update({ displayName }).

Does not error.


## setClientMetadata(metadata)

metadata: json

Shorthand for update({ clientMetadata: metadata }).

Does not error.


## updatePassword(options)

options.oldPassword: string
options.newPassword: string

PATCH /users/me { old_password, new_password } [authenticated]

Errors:
  PasswordConfirmationMismatch
    code: "password_confirmation_mismatch"
    message: "The current password is incorrect."
    
  PasswordRequirementsNotMet
    code: "password_requirements_not_met"
    message: "The new password does not meet the project's requirements."


## setPassword(options)

options.password: string

POST /users/me/password { password } [authenticated]

For users without existing password (OAuth-only, anonymous).

Errors:
  PasswordRequirementsNotMet
    code: "password_requirements_not_met"
    message: "The password does not meet the project's requirements."


## Team Methods


### listTeams()

Returns: Team[]

GET /users/me/teams [authenticated]
Route: apps/backend/src/app/api/latest/users/me/teams/route.ts

Construct Team for each item.

Does not error.


### getTeam(teamId)

teamId: string

Returns: Team | null

Call listTeams(), find by id, return null if not found.

Does not error.


### createTeam(options)

options.displayName: string
options.profileImageUrl: string?

Returns: Team

POST /teams { display_name, profile_image_url, creator_user_id: "me" } [authenticated]
Route: apps/backend/src/app/api/latest/teams/route.ts

Then select the new team via update({ selectedTeamId: newTeam.id }).

Does not error.


### setSelectedTeam(teamOrId)

teamOrId: Team | string | null

Shorthand for update({ selectedTeamId: extractId(teamOrId) }).

Does not error.


### leaveTeam(team)

team: Team

DELETE /teams/{teamId}/users/me [authenticated]

Does not error.


### getTeamProfile(team)

team: Team

Returns: EditableTeamMemberProfile

GET /teams/{teamId}/users/me/profile [authenticated]

EditableTeamMemberProfile has:
  displayName: string | null
  profileImageUrl: string | null
  update(options): Promise<void>

Does not error.


## Contact Channel Methods


### listContactChannels()

Returns: ContactChannel[]

GET /contact-channels [authenticated]
Route: apps/backend/src/app/api/latest/contact-channels/route.ts

Does not error.


### createContactChannel(options)

options.type: "email"
options.value: string (the email address)
options.usedForAuth: bool
options.isPrimary: bool?

Returns: ContactChannel

POST /contact-channels { type, value, used_for_auth, is_primary, user_id: "me" } [authenticated]

Does not error.


## OAuth Provider Methods


### listOAuthProviders()

Returns: OAuthProvider[]

GET /users/me/oauth-providers [authenticated]
Route: apps/backend/src/app/api/latest/users/me/oauth-providers/route.ts

OAuthProvider has:
  id: string
  type: string
  userId: string
  accountId: string?
  email: string?
  allowSignIn: bool
  allowConnectedAccounts: bool
  update(data): Promise<Result<void, OAuthProviderAccountIdAlreadyUsedForSignIn>>
  delete(): Promise<void>

Does not error.


### getOAuthProvider(id)

id: string

Returns: OAuthProvider | null

Find in listOAuthProviders() by id.

Does not error.


## Connected Account Methods


### getConnectedAccount(providerId, options?)

providerId: string (e.g., "google", "github")
options.scopes: string[]? - required OAuth scopes
options.or: "redirect" | "throw" | "return-null"
  Default: "return-null"

Returns: OAuthConnection | null

POST /connected-accounts/{providerId}/access-token { scope: scopes.join(" ") } [authenticated]
Route: apps/backend/src/app/api/latest/connected-accounts/[provider]/access-token/route.ts

On success: return OAuthConnection with { id, getAccessToken() }

On error "oauth_scope_not_granted" or "oauth_connection_not_connected":
  - or="redirect": redirect to OAuth flow with additional scopes [BROWSER-ONLY]
  - or="throw": throw the error
  - or="return-null": return null

Errors (only when or="throw"):
  OAuthConnectionNotConnectedToUser
    code: "oauth_connection_not_connected"
    message: "You don't have this OAuth provider connected."
    
  OAuthConnectionDoesNotHaveRequiredScope
    code: "oauth_scope_not_granted"
    message: "The connected OAuth account doesn't have the required permissions."


## Permission Methods


### hasPermission(scope?, permissionId)

scope: Team? - if omitted, checks project-level permission
permissionId: string

Returns: bool

GET /users/me/permissions?team_id={teamId}&permission_id={permissionId} [authenticated]

Does not error.


### getPermission(scope?, permissionId)

scope: Team?
permissionId: string

Returns: TeamPermission | null

Find permission by id in listPermissions().

Does not error.


### listPermissions(scope?, options?)

scope: Team?
options.recursive: bool? - include inherited permissions

Returns: TeamPermission[]

GET /users/me/permissions?team_id={teamId}&recursive={recursive} [authenticated]

Does not error.


## Session Methods


### getActiveSessions()

Returns: ActiveSession[]

GET /users/me/sessions [authenticated]

ActiveSession has:
  id: string
  userId: string
  createdAt: Date
  isImpersonation: bool
  lastUsedAt: Date | null
  isCurrentSession: bool
  geoInfo: GeoInfo?

Does not error.


### revokeSession(sessionId)

sessionId: string

DELETE /users/me/sessions/{sessionId} [authenticated]

Does not error.


## Passkey Methods


### registerPasskey(options?)  [BROWSER-ONLY]

options.hostname: string?

Returns: Result<void, PasskeyRegistrationFailed | PasskeyWebAuthnError>

Implementation:
1. POST /auth/passkey/register/initiate {} [authenticated]
   Response: { options_json, code }
2. Replace options_json.rp.id with actual hostname
3. Call WebAuthn startRegistration(options_json)
4. POST /auth/passkey/register { credential, code } [authenticated]

Errors (in Result):
  PasskeyRegistrationFailed
    code: "passkey_registration_failed"
    message: "Failed to register passkey. Please try again."
    
  PasskeyWebAuthnError
    code: "passkey_webauthn_error"
    message: "WebAuthn error: {errorName}."


## API Key Methods


### listApiKeys()

Returns: UserApiKey[]

GET /users/me/api-keys [authenticated]

Does not error.


### createApiKey(options)

options.description: string
options.expiresAt: Date?
options.scope: string? - the scope/permissions
options.teamId: string? - for team-scoped keys

Returns: UserApiKeyFirstView

POST /users/me/api-keys { description, expires_at, scope, team_id } [authenticated]

UserApiKeyFirstView extends UserApiKey with:
  apiKey: string - the actual key value (only shown once)

Does not error.


## Notification Methods


### listNotificationCategories()

Returns: NotificationCategory[]

GET /notification-categories [authenticated]

Does not error.


## Auth Methods (from StackClientApp)

signOut(options?)
  Same as StackClientApp.signOut()

getAccessToken()
  Same as StackClientApp.getAccessToken()

getRefreshToken()
  Same as StackClientApp.getRefreshToken()

getAuthHeaders()
  Same as StackClientApp.getAuthHeaders()


## Deprecated Methods

sendVerificationEmail()
  @deprecated - Use contact channel's sendVerificationEmail instead.
  
  Errors:
    EmailAlreadyVerified
      code: "email_already_verified"
      message: "This email is already verified."
