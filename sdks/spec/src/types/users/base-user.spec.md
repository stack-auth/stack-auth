# User (BaseUser)

Base user type returned by client-side methods. Contains only publicly safe properties.


## Properties

id: string
  Unique user identifier.

displayName: string | null
  User's display name.

primaryEmail: string | null
  User's primary email address.
  Note: NOT guaranteed unique across users. Always use `id` for identification.

primaryEmailVerified: bool
  Whether the primary email has been verified.

profileImageUrl: string | null
  URL to user's profile image.

signedUpAt: Date
  When the user signed up.

clientMetadata: json
  User-writable metadata, visible to client and server.

clientReadOnlyMetadata: json
  Server-writable metadata, visible to client but not writable by client.

hasPassword: bool
  Whether user has set a password for credential auth.

otpAuthEnabled: bool
  Whether TOTP-based MFA is enabled.

passkeyAuthEnabled: bool
  Whether passkey authentication is enabled.

isMultiFactorRequired: bool
  Whether MFA is required for this user.

isAnonymous: bool
  Whether this is an anonymous user.

isRestricted: bool
  Whether user is in restricted state (signed up but hasn't completed onboarding).
  Example: email verification required but not yet verified.

restrictedReason: { type: "anonymous" | "email_not_verified" } | null
  The reason why user is restricted, or null if not restricted.


## Deprecated Properties

emailAuthEnabled: bool
  @deprecated - Use contact channel's usedForAuth instead.

oauthProviders: { id: string }[]
  @deprecated


## Methods

toClientJson()

Returns: CurrentUserCrud.Client.Read

Serialize user to JSON format matching API response.

Does not error.
