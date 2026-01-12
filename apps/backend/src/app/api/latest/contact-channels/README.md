# Primary Email and Contact Channel Logic

This document explains the relationship between `primary_email` on user objects and contact channels, including all edge cases and expected behaviors.

## Overview

In Stack Auth, users can have multiple **contact channels** (currently only email type is supported). One of these can be designated as the **primary email**, which is the main email address associated with the user account.

### Key Concepts

- **Contact Channel**: A communication endpoint (email) associated with a user
- **Primary Email**: The main email address for a user (reflected in `user.primary_email`)
- **Verified**: Whether the email ownership has been confirmed
- **Used for Auth**: Whether the email can be used to sign in

### Data Model

```
User
├── primary_email (derived from primary contact channel)
├── primary_email_verified (derived from primary contact channel)
├── primary_email_auth_enabled (derived from primary contact channel)
└── Contact Channels[]
    ├── value (email address)
    ├── type ("email")
    ├── is_primary (boolean)
    ├── is_verified (boolean)
    └── used_for_auth (boolean)
```

The `primary_email`, `primary_email_verified`, and `primary_email_auth_enabled` fields on the user object are **derived** from the contact channel where `is_primary = true`.

## Updating Primary Email via User Endpoint

When updating `primary_email` via `PATCH /api/v1/users/{user_id}` or `PATCH /api/v1/users/me`:

### Scenario 1: Setting primary_email when user has no email

**Behavior**: Creates a new contact channel marked as primary and unverified.

**Test**: [`users-primary-email.test.ts` - "should be able to set primary_email when user has no email"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### Scenario 2: Changing to a new email address

**Behavior**:
1. The old primary email becomes a non-primary contact channel (demoted)
2. A new contact channel is created marked as primary
3. The new email is **always unverified** (even if the old one was verified)

**Tests**:
- [`users-primary-email.test.ts` - "should be able to change primary_email to a new email"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)
- [`users-primary-email.test.ts` - "should set new email as unverified even if old email was verified"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)
- [`users-primary-email.test.ts` - "old primary email should become non-primary contact channel after change"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### Scenario 3: Changing to an existing non-primary contact channel

**Behavior**:
1. The old primary email is demoted to non-primary
2. The existing contact channel is **upgraded** to primary
3. The verification status is **preserved** (if it was verified, it stays verified)

**Tests**:
- [`users-primary-email.test.ts` - "should be able to change primary_email to an existing non-primary contact channel"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)
- [`users-primary-email.test.ts` - "should preserve verification status when switching to existing verified contact channel"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)
- [`users-primary-email.test.ts` - "should preserve unverified status when switching to existing unverified contact channel"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### Scenario 4: Setting primary_email to null

**Behavior**: The primary contact channel is **demoted** to non-primary (not deleted). The contact channel remains on the user but is no longer the primary email.

**Note**: This means setting `primary_email` to a value and then to `null` is NOT a no-op—it leaves a non-primary contact channel behind.

**Test**: [`users-primary-email.test.ts` - "should be able to set primary_email to null (demotes to non-primary, does not delete)"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### Scenario 5: Setting primary_email to the same value (no-op)

**Behavior**: No changes are made; verification status is preserved.

**Test**: [`users-primary-email.test.ts` - "should handle setting primary_email to the same email (no-op)"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

## Server-Side Additional Fields

When using server access, you can also set:

- `primary_email_verified`: Set the verification status directly
- `primary_email_auth_enabled`: Enable/disable using this email for authentication

**Tests**:
- [`users-primary-email.test.ts` - "should be able to set primary_email and primary_email_verified together"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)
- [`users-primary-email.test.ts` - "should be able to set primary_email_auth_enabled when changing primary_email"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

## Email Uniqueness Rules

### Uniqueness for `used_for_auth`

Emails that are `used_for_auth = true` must be unique across all users in a project. Two users cannot have the same email as an auth-enabled email.

**Test**: [`users-primary-email.test.ts` - "should not be able to set primary_email to email already used by another user with used_for_auth"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### Non-auth emails

Emails that are NOT used for auth (`used_for_auth = false`) can be shared across users.

### Duplicate Contact Channels

A user cannot have two contact channels with the same email address. Attempting to create a duplicate will fail.

**Test**: [`contact-channels.test.ts` - "cannot create duplicate contact channels"](../../../../../../e2e/tests/backend/endpoints/api/v1/contact-channels/contact-channels.test.ts)

## Validation Rules

### Invalid Email Format

Emails must be valid email format. Invalid formats return 400 error.

**Test**: [`users-primary-email.test.ts` - "should reject invalid email format"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### Empty String

Empty string is not a valid email. Returns 400 error.

**Test**: [`users-primary-email.test.ts` - "should reject empty string as email"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### Case Insensitivity

Email addresses are treated case-insensitively for comparison purposes.

**Test**: [`users-primary-email.test.ts` - "should handle case insensitivity in email addresses"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

## Integration with Pending User Status

When `onboarding.requireEmailVerification` is enabled in project config:

### User becomes pending when:

1. Setting an unverified email as primary
2. Changing from a verified email to a new (unverified) email

**Tests**:
- [`users-primary-email.test.ts` - "should make user pending when setting unverified email with requireEmailVerification enabled"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)
- [`users-primary-email.test.ts` - "changing from verified to unverified email should make user pending"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### User does NOT become pending when:

1. Switching to an already-verified existing contact channel

**Test**: [`users-primary-email.test.ts` - "switching to verified existing contact channel should not make user pending"](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts)

### Client-side Guardrails

The account settings UI prevents users from removing their primary verified email when `requireEmailVerification` is enabled, to avoid accidentally putting themselves in pending status.

**Note**: No E2E test currently covers this client-side behavior specifically.

## Contact Channel Endpoint Operations

### Creating Contact Channels

`POST /api/v1/contact-channels`

- New contact channels are **not primary** by default
- Client-created channels are **unverified** by default
- Server-created channels can set `is_verified: true`

**Tests**:
- [`contact-channels.test.ts` - "create contact channel on the client"](../../../../../../e2e/tests/backend/endpoints/api/v1/contact-channels/contact-channels.test.ts)
- [`contact-channels.test.ts` - "create contact channel on the server"](../../../../../../e2e/tests/backend/endpoints/api/v1/contact-channels/contact-channels.test.ts)

### Updating Contact Channel to Primary

`PATCH /api/v1/contact-channels/{user_id}/{channel_id}` with `is_primary: true`

- The previous primary channel (if any) is automatically demoted
- This is an alternative to updating `primary_email` on the user object

**Test**: [`contact-channels.test.ts` - "updates contact channel primary status"](../../../../../../e2e/tests/backend/endpoints/api/v1/contact-channels/contact-channels.test.ts)

### Setting Primary to Non-Primary

`PATCH /api/v1/contact-channels/{user_id}/{channel_id}` with `is_primary: false`

- Sets the channel to non-primary
- The user's `primary_email` becomes `null`

**Test**: [`contact-channels.test.ts` - "sets a primary contact channel to non-primary"](../../../../../../e2e/tests/backend/endpoints/api/v1/contact-channels/contact-channels.test.ts)

### Deleting Contact Channels

`DELETE /api/v1/contact-channels/{user_id}/{channel_id}`

- If deleting the primary contact channel, `primary_email` becomes `null`
- Associated auth methods are also deleted

**Test**: [`contact-channels.test.ts` - "delete contact channel on the client"](../../../../../../e2e/tests/backend/endpoints/api/v1/contact-channels/contact-channels.test.ts)

## Related Files

### Backend Logic
- [`../users/crud.tsx`](../users/crud.tsx) - User CRUD operations including primary email update logic
- [`./crud.tsx`](./crud.tsx) - Contact channel CRUD operations

### Client SDK
- [`packages/template/src/lib/stack-app/users/index.ts`](../../../../../../../packages/template/src/lib/stack-app/users/index.ts) - User types and update options

### E2E Tests
- [`users-primary-email.test.ts`](../../../../../../e2e/tests/backend/endpoints/api/v1/users-primary-email.test.ts) - Primary email update tests
- [`contact-channels.test.ts`](../../../../../../e2e/tests/backend/endpoints/api/v1/contact-channels/contact-channels.test.ts) - Contact channel tests
- [`pending-users.test.ts`](../../../../../../e2e/tests/backend/endpoints/api/v1/pending-users.test.ts) - Pending user status tests

