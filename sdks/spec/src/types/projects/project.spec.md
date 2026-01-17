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
  Each has: id: string, type: "google" | "github" | "microsoft" | etc.

clientTeamCreationEnabled: bool
  Whether clients can create teams.

clientUserDeletionEnabled: bool
  Whether clients can delete their own accounts.


---

# AdminProject

Full project information with admin capabilities.

Extends: Project


## Additional Properties

description: string | null
  Project description.

createdAt: Date
  When the project was created.

isProductionMode: bool
  Whether project is in production mode.

ownerTeamId: string | null
  The team that owns this project.

logoUrl: string | null
  URL to project logo.

logoFullUrl: string | null
  URL to full-size project logo.

logoDarkModeUrl: string | null
  URL to dark mode logo.

logoFullDarkModeUrl: string | null
  URL to full-size dark mode logo.

config: AdminProjectConfig
  Full project configuration (extends ProjectConfig with sensitive settings).


## Methods


### update(options)

options: {
  displayName?: string,
  description?: string,
  isProductionMode?: bool,
  logoUrl?: string | null,
  logoFullUrl?: string | null,
  logoDarkModeUrl?: string | null,
  logoFullDarkModeUrl?: string | null,
  config?: AdminProjectConfigUpdateOptions,
}

PATCH /projects/current [admin-only]
Route: apps/backend/src/app/api/latest/projects/current/route.ts

Does not error.


### delete()

DELETE /projects/current [admin-only]

Does not error.


### getConfig()

Returns: CompleteConfig

GET /projects/current/config [admin-only]

Returns the full normalized project configuration.

Does not error.


### updateConfig(config)

config: EnvironmentConfigOverride
  Use path notation to update nested properties (e.g., { "emails.server.host": "..." })
  Do NOT pass full top-level objects as they will overwrite siblings.

PATCH /projects/current/config { ...pathUpdates } [admin-only]

Does not error.


### getProductionModeErrors()

Returns: ProductionModeError[]

GET /projects/current/production-mode-errors [admin-only]

Returns a list of issues that would prevent production mode.

ProductionModeError has:
  type: string
  message: string

Does not error.


---

# AdminProjectConfig

Extended project configuration with admin-only settings.

Extends: ProjectConfig


## Additional Properties

domains: DomainConfig[]
  Trusted domains configuration.
  Each has: domain: string, handlerPath: string

emailConfig: EmailConfig
  Email sending configuration.
  Either: { type: "shared" } - use Stack's shared email
  Or: { type: "standard", host, port, username, password, senderName, senderEmail }

allowLocalhost: bool
  Whether localhost is allowed (for development).

createTeamOnSignUp: bool
  Whether to create a team for each new user.

teamCreatorDefaultPermissions: string[]
  Default permissions for team creators.

teamMemberDefaultPermissions: string[]
  Default permissions for team members.

userDefaultPermissions: string[]
  Default project-level permissions for users.

oauthAccountMergeStrategy: "link" | "prevent"
  How to handle OAuth accounts with existing emails.

allowUserApiKeys: bool
  Whether users can create API keys.

allowTeamApiKeys: bool
  Whether teams can create API keys.

oauthProviders: AdminOAuthProviderConfig[]
  Full OAuth provider configs including secrets.
  Each has: id, type, clientId, clientSecret, and provider-specific fields.
