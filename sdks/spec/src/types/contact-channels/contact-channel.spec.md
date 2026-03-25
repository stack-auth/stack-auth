# ContactChannel

A contact channel (email address) associated with a user.


## Properties

id: string
  Unique contact channel identifier.

value: string
  The actual email address.

type: "email"
  Type of contact channel. Currently only "email" is supported.

isPrimary: bool
  Whether this is the user's primary email.

isVerified: bool
  Whether the email has been verified.

usedForAuth: bool
  Whether this email can be used for authentication (magic link, password reset, etc.).


## Methods


### sendVerificationEmail(options?)

options.callbackUrl: string? - URL to redirect after verification

POST /api/v1/contact-channels/{id}/send-verification-email { callback_url } [authenticated]
Route: apps/backend/src/app/api/latest/contact-channels/[id]/send-verification-email/route.ts

Sends a verification email to this contact channel.

Does not error.


### update(options)

options: {
  value?: string,
  usedForAuth?: bool,
  isPrimary?: bool,
}

PATCH /api/v1/contact-channels/{id} { value, used_for_auth, is_primary } [authenticated]
Route: apps/backend/src/app/api/latest/contact-channels/[id]/route.ts

Does not error.


### delete()

DELETE /api/v1/contact-channels/{id} [authenticated]
Route: apps/backend/src/app/api/latest/contact-channels/[id]/route.ts

Does not error.


---

# ServerContactChannel

Server-side contact channel with additional update capabilities.

Extends: ContactChannel


## Server-specific Methods


### update(options)

options: {
  value?: string,
  usedForAuth?: bool,
  isPrimary?: bool,
  isVerified?: bool,  // Server can directly set verification status
}

PATCH /api/v1/contact-channels/{id} [server-only]
Body: { value, used_for_auth, is_primary, is_verified }

Does not error.
