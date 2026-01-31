# Project

Basic project information returned by getProject().


## Properties

id: string
  Unique project identifier.

displayName: string
  Project's display name.

config: ProjectConfig
  Project configuration. See below.


---

# ProjectConfig

Client-visible project configuration.


## Properties

signUpEnabled: bool
  Whether new user sign-ups are allowed.

credentialEnabled: bool
  Whether email/password authentication is enabled.

magicLinkEnabled: bool
  Whether magic link authentication is enabled.

passkeyEnabled: bool
  Whether passkey authentication is enabled.

oauthProviders: OAuthProviderConfig[]
  List of enabled OAuth providers.
  Each has: id: string

clientTeamCreationEnabled: bool
  Whether clients can create teams.

clientUserDeletionEnabled: bool
  Whether clients can delete their own accounts.

allowUserApiKeys: bool
  Whether users can create API keys.

allowTeamApiKeys: bool
  Whether teams can create API keys.
