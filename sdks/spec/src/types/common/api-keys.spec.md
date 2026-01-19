# ApiKey (Base)

Base type for API keys.


## Properties

id: string
  Unique API key identifier.

description: string
  User-provided description of what this key is for.

expiresAt: Date | null
  When the key expires, or null if it never expires.

createdAt: Date
  When the key was created.

isValid: bool
  Whether the key is currently valid (not expired, not revoked).


## Methods


### revoke()

DELETE /api/v1/api-keys/{id} [authenticated]

Revokes the API key immediately.

Does not error.


### update(options)

options.description: string?
options.expiresAt: Date | null?

PATCH /api/v1/api-keys/{id} { description, expires_at } [authenticated]

Does not error.


---

# UserApiKey

An API key owned by a user.

Extends: ApiKey


## Additional Properties

userId: string
  The user who owns this key.

teamId: string | null
  If this key is scoped to a team, the team ID.


---

# UserApiKeyFirstView

Returned only when creating a new API key. Contains the actual key value.

Extends: UserApiKey


## Additional Properties

apiKey: string
  The actual API key value. Only returned once at creation time.
  Store this securely - it cannot be retrieved again.


---

# TeamApiKey

An API key owned by a team.

Extends: ApiKey


## Additional Properties

teamId: string
  The team that owns this key.


---

# TeamApiKeyFirstView

Returned only when creating a new team API key.

Extends: TeamApiKey


## Additional Properties

apiKey: string
  The actual API key value. Only returned once at creation time.
