# Stack Auth iOS Example

A comprehensive iOS SwiftUI application for testing all Stack Auth SDK functions interactively.

## Prerequisites

- iOS 17.0+
- Swift 5.9+
- Xcode 15.0+
- A running Stack Auth backend accessible from the iOS device/simulator

## Running the Example

1. Start the Stack Auth backend:
   ```bash
   cd /path/to/stack-2
   pnpm run dev
   ```

2. Open in Xcode:
   ```bash
   cd Examples/StackAuthiOS
   open Package.swift
   ```

3. Select an iOS simulator or device and run.

**Note**: When testing on a physical device, update the base URL in Settings to point to your machine's IP address (e.g., `http://192.168.1.x:8102`).

## Features

The example app uses a tab-based navigation with the following sections:

### Auth Tab
- Sign up with email/password
- Sign in with credentials
- Sign in with wrong password (error testing)
- Sign out
- Get current user
- Get user (or throw)
- Generate OAuth URLs (Google, GitHub, Microsoft)

### User Tab
- Set display name
- Update client metadata
- Update password (correct and wrong old password)
- Get access/refresh tokens
- Get auth headers
- Get partial user from token
- List contact channels

### Teams Tab
- Create team
- List user's teams
- Select and view team details
- List team members
- Update team name

### Server Tab
- **Users**
  - Create user (basic and with all options)
  - List users
  - Get/delete user by ID
  - Create session (impersonation)

- **Teams**
  - Create team
  - List all teams
  - Add/remove users from teams
  - List team users
  - Delete team

### Settings Tab
- Configure API base URL
- Configure project ID and API keys
- View operation logs

## Default Configuration

The example is pre-configured for local development:
- Base URL: `http://localhost:8102`
- Project ID: `internal`
- Publishable Key: `this-publishable-client-key-is-for-local-development-only`
- Secret Key: `this-secret-server-key-is-for-local-development-only`

## Simulator Network Notes

When running in the iOS Simulator, `localhost` will connect to your Mac's localhost. For physical devices, use your Mac's local IP address.

## SDK Functions Covered

| Category | Functions |
|----------|-----------|
| Auth | signUpWithCredential, signInWithCredential, signOut, getUser, getOAuthUrl |
| User | setDisplayName, update (metadata), updatePassword, getAccessToken, getRefreshToken, getAuthHeaders, getPartialUser |
| Teams | createTeam, listTeams, getTeam, listUsers (team members), update |
| Contact | listContactChannels |
| Server Users | createUser, listUsers, getUser, delete, createSession |
| Server Teams | createTeam, listTeams, getTeam, addUser, removeUser, listUsers, delete |
| Errors | EmailPasswordMismatchError, UserNotSignedInError, PasswordConfirmationMismatchError |

## Testing Edge Cases

The app includes buttons specifically for testing error scenarios:
- "Sign In (Wrong Password)" - triggers EmailPasswordMismatchError
- "Get User (or throw)" - triggers UserNotSignedInError when not signed in
- "Update (Wrong Old Password)" - triggers PasswordConfirmationMismatchError
