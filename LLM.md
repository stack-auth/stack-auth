# Stack Auth API Documentation

## Overview

Stack Auth is a comprehensive authentication and user management platform that provides:
- User authentication (password, OAuth, magic links, passkeys)
- User and team management
- Permission systems
- Email templates and notifications
- REST API and SDKs for JavaScript/TypeScript, React, and Next.js

## Installation

```bash
npm install @stackframe/stack        # Full Next.js integration
npm install @stackframe/react       # React-only components
npm install @stackframe/js          # Vanilla JavaScript
```

## Quick Start

### Next.js Setup

```typescript
// stack.ts
import { StackApp } from '@stackframe/stack';

export const stackApp = new StackApp({
  projectId: 'your-project-id',
  publishableClientKey: 'your-publishable-key',
});
```

```tsx
// app/layout.tsx
import { StackProvider } from '@stackframe/stack';
import { stackApp } from '../stack';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <StackProvider app={stackApp}>
          {children}
        </StackProvider>
      </body>
    </html>
  );
}
```

### React Setup

```typescript
// stack.ts
import { StackApp } from '@stackframe/react';

export const stackApp = new StackApp({
  projectId: 'your-project-id',
  publishableClientKey: 'your-publishable-key',
  baseUrl: 'https://api.stack-auth.com',
});
```

```tsx
// App.tsx
import { StackProvider } from '@stackframe/react';
import { stackApp } from './stack';

function App() {
  return (
    <StackProvider app={stackApp}>
      {/* Your app content */}
    </StackProvider>
  );
}
```


## Core SDK Classes

### StackApp

Main application class for client-side usage.

```typescript
import { StackApp } from '@stackframe/stack';

const app = new StackApp({
  projectId: string,
  publishableClientKey: string,
  baseUrl?: string,  // defaults to https://api.stack-auth.com
});
```

#### Authentication Methods

```typescript
// Sign in with password
app.signInWithCredential({
  email: string,
  password: string,
}): Promise<{ user: User }>

// Sign up with password
app.signUpWithCredential({
  email: string,
  password: string,
  displayName?: string,
}): Promise<{ user: User }>

// Sign in with OAuth
app.signInWithOAuth({
  provider: 'google' | 'github' | 'facebook' | 'microsoft' | 'spotify' | 'discord' | 'gitlab' | 'apple' | 'bitbucket' | 'linkedin' | 'x',
  redirectUrl?: string,
}): Promise<void>

// Sign in with magic link
app.sendMagicLinkEmail({
  email: string,
  redirectUrl?: string,
}): Promise<void>

// Sign in with passkey
app.signInWithPasskey(): Promise<{ user: User }>

// Register passkey
app.registerPasskey(): Promise<void>

// Sign out
app.signOut(): Promise<void>
```

#### User Management

```typescript
// Get current user
app.useUser(): User | null

// Update user profile
app.updateUser({
  displayName?: string,
  profileImageUrl?: string,
}): Promise<User>

// Delete user account
app.deleteUser(): Promise<void>

// Send email verification
app.sendEmailVerificationCode(): Promise<void>

// Verify email
app.verifyEmail({ code: string }): Promise<void>
```

#### Team Management

```typescript
// Get user's teams
app.useTeams(): Team[]

// Create team
app.createTeam({
  displayName: string,
  description?: string,
}): Promise<Team>

// Update team
app.updateTeam(teamId: string, {
  displayName?: string,
  description?: string,
}): Promise<Team>

// Delete team
app.deleteTeam(teamId: string): Promise<void>

// Invite user to team
app.inviteUserToTeam({
  teamId: string,
  email: string,
}): Promise<TeamInvitation>

// Remove user from team
app.removeUserFromTeam({
  teamId: string,
  userId: string,
}): Promise<void>
```

#### Session Management

```typescript
// Get current session
app.getSession(): Session | null

// Refresh session
app.refreshSession(): Promise<Session>

// Get all user sessions
app.getSessions(): Promise<Session[]>

// Revoke session
app.revokeSession(sessionId: string): Promise<void>
```


## React Hooks

### useUser()

Returns the current user object.

```typescript
import { useUser } from '@stackframe/stack';

// Basic usage
const user = useUser(); // User | null

// With redirect on unauthenticated
const user = useUser({ or: 'redirect' }); // User (never null)

// With error on unauthenticated
const user = useUser({ or: 'throw' }); // User (never null)
```

### useStackApp()

Returns the current Stack app instance.

```typescript
import { useStackApp } from '@stackframe/stack';

const app = useStackApp();
```

## Pre-built UI Components

### Authentication Components

```typescript
import {
  SignIn,
  SignUp,
  AuthPage,
  CredentialSignIn,
  CredentialSignUp,
  MagicLinkSignIn,
  OAuthButton,
  OAuthButtonGroup,
} from '@stackframe/stack';

// Complete sign-in page
<SignIn />

// Complete sign-up page
<SignUp />

// Tabbed auth page (sign-in + sign-up)
<AuthPage type="sign-in" />
<AuthPage type="sign-up" />

// Individual auth methods
<CredentialSignIn />
<CredentialSignUp />
<MagicLinkSignIn />

// OAuth buttons
<OAuthButton provider="google" type="sign-in" />
<OAuthButtonGroup type="sign-in" />
```

### User Management Components

```typescript
import {
  UserButton,
  UserAvatar,
  AccountSettings,
} from '@stackframe/stack';

// User profile dropdown
<UserButton />

// User avatar
<UserAvatar user={user} size={40} />

// Complete account settings page
<AccountSettings />
```

### Team Management Components

```typescript
import {
  SelectedTeamSwitcher,
} from '@stackframe/stack';

// Team selection dropdown
<SelectedTeamSwitcher />
```

### Page Components

```typescript
import {
  EmailVerification,
  ForgotPassword,
  PasswordReset,
  MessageCard,
} from '@stackframe/stack';

// Email verification page
<EmailVerification />

// Password reset request page
<ForgotPassword />

// Password reset form page
<PasswordReset />

// Message display card
<MessageCard
  title="Success"
  message="Your account has been created"
  type="success"
/>
```

### Route Handler

```typescript
import { StackHandler } from '@stackframe/stack';

// In app/handler/[...stack]/page.tsx
export default function Handler() {
  return <StackHandler />;
}
```


## Server-Side SDK

### StackServerApp

Server-side application class for backend usage.

```typescript
import { StackServerApp } from '@stackframe/stack';

const app = new StackServerApp({
  projectId: string,
  secretServerKey: string,
  baseUrl?: string,
});
```

#### User Management (Server)

```typescript
// Get user by ID
app.getUser(userId: string): Promise<ServerUser | null>

// List users
app.listUsers({
  limit?: number,
  cursor?: string,
}): Promise<{ users: ServerUser[], hasMore: boolean, cursor?: string }>

// Create user
app.createUser({
  primaryEmail: string,
  displayName?: string,
  password?: string,
}): Promise<ServerUser>

// Update user
app.updateUser(userId: string, {
  displayName?: string,
  primaryEmail?: string,
}): Promise<ServerUser>

// Delete user
app.deleteUser(userId: string): Promise<void>
```

#### Team Management (Server)

```typescript
// Get team by ID
app.getTeam(teamId: string): Promise<ServerTeam | null>

// List teams
app.listTeams(): Promise<ServerTeam[]>

// Create team
app.createTeam({
  displayName: string,
  description?: string,
}): Promise<ServerTeam>

// Update team
app.updateTeam(teamId: string, {
  displayName?: string,
  description?: string,
}): Promise<ServerTeam>

// Delete team
app.deleteTeam(teamId: string): Promise<void>

// Add user to team
app.addUserToTeam({
  teamId: string,
  userId: string,
}): Promise<void>

// Remove user from team
app.removeUserFromTeam({
  teamId: string,
  userId: string,
}): Promise<void>
```

### StackAdminApp

Admin application class for project management.

```typescript
import { StackAdminApp } from '@stackframe/stack';

const app = new StackAdminApp({
  projectId: string,
  secretServerKey: string,
  baseUrl?: string,
});
```

#### Project Configuration

```typescript
// Get project config
app.getProject(): Promise<AdminProject>

// Update project config
app.updateProject({
  displayName?: string,
  description?: string,
  userRegistrationEnabled?: boolean,
  credentialEnabled?: boolean,
  magicLinkEnabled?: boolean,
  oauthProviders?: OAuthProviderConfig[],
}): Promise<AdminProject>

// Get OAuth providers
app.listOAuthProviders(): Promise<AdminOAuthProviderConfig[]>

// Update OAuth provider
app.updateOAuthProvider(providerId: string, {
  enabled?: boolean,
  clientId?: string,
  clientSecret?: string,
}): Promise<AdminOAuthProviderConfig>
```

#### Email Configuration

```typescript
// Get email templates
app.listEmailTemplates(): Promise<EmailTemplate[]>

// Update email template
app.updateEmailTemplate(type: string, {
  subject?: string,
  content?: string,
}): Promise<EmailTemplate>

// Send email
app.sendEmail({
  to: string,
  subject: string,
  html?: string,
  text?: string,
}): Promise<void>
```


## REST API

Base URL: `https://api.stack-auth.com/api/v1`

### Authentication

All API requests require authentication via headers:

```http
Authorization: Bearer <access_token>
X-Stack-Project-Id: <project_id>
X-Stack-Publishable-Client-Key: <publishable_key>  # For client requests
X-Stack-Secret-Server-Key: <secret_key>           # For server requests
```

### Authentication Endpoints

#### Password Authentication

```http
# Sign in with password
POST /auth/password/sign-in
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

# Sign up with password
POST /auth/password/sign-up
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "John Doe"
}

# Update password
POST /auth/password/update
Content-Type: application/json

{
  "oldPassword": "oldpass123",
  "newPassword": "newpass123"
}

# Send password reset code
POST /auth/password/send-reset-code
Content-Type: application/json

{
  "email": "user@example.com"
}

# Reset password with code
POST /auth/password/reset
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "newpass123"
}
```

#### OAuth Authentication

```http
# Get OAuth authorization URL
GET /auth/oauth/authorize/{provider_id}?redirect_url=<url>

# Handle OAuth callback
POST /auth/oauth/callback/{provider_id}
Content-Type: application/json

{
  "code": "oauth_code",
  "state": "oauth_state"
}
```

#### Magic Link Authentication

```http
# Send magic link
POST /auth/otp/send-sign-in-code
Content-Type: application/json

{
  "email": "user@example.com",
  "redirectUrl": "https://yourapp.com/callback"
}

# Sign in with magic link code
POST /auth/otp/sign-in
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456"
}
```

#### Passkey Authentication

```http
# Initiate passkey registration
POST /auth/passkey/initiate-passkey-registration

# Complete passkey registration
POST /auth/passkey/register
Content-Type: application/json

{
  "credential": { /* WebAuthn credential */ }
}

# Initiate passkey authentication
POST /auth/passkey/initiate-passkey-authentication

# Complete passkey authentication
POST /auth/passkey/sign-in
Content-Type: application/json

{
  "credential": { /* WebAuthn credential */ }
}
```

#### Session Management

```http
# Get current session
GET /auth/sessions/current

# Refresh session
POST /auth/sessions/current/refresh

# List all sessions
GET /auth/sessions

# Revoke session
DELETE /auth/sessions/{session_id}
```

### User Management Endpoints

```http
# Get current user
GET /users/me

# Update current user
PATCH /users/me
Content-Type: application/json

{
  "displayName": "New Name",
  "profileImageUrl": "https://example.com/avatar.jpg"
}

# Delete current user
DELETE /users/me

# Get user by ID (server-side)
GET /users/{user_id}

# List users (server-side)
GET /users?limit=10&cursor=abc123

# Create user (server-side)
POST /users
Content-Type: application/json

{
  "primaryEmail": "user@example.com",
  "displayName": "John Doe",
  "password": "password123"
}

# Update user (server-side)
PATCH /users/{user_id}
Content-Type: application/json

{
  "displayName": "Updated Name"
}

# Delete user (server-side)
DELETE /users/{user_id}
```


### Team Management Endpoints

```http
# List user's teams
GET /teams

# Get team by ID
GET /teams/{team_id}

# Create team
POST /teams
Content-Type: application/json

{
  "displayName": "My Team",
  "description": "Team description"
}

# Update team
PATCH /teams/{team_id}
Content-Type: application/json

{
  "displayName": "Updated Team Name"
}

# Delete team
DELETE /teams/{team_id}

# List team members
GET /team-memberships?team_id={team_id}

# Add user to team
POST /team-memberships
Content-Type: application/json

{
  "teamId": "team_123",
  "userId": "user_456"
}

# Remove user from team
DELETE /team-memberships/{team_id}/{user_id}

# Send team invitation
POST /team-invitations
Content-Type: application/json

{
  "teamId": "team_123",
  "email": "user@example.com"
}

# Accept team invitation
POST /team-invitations/accept
Content-Type: application/json

{
  "code": "invitation_code"
}

# List team invitations
GET /team-invitations?team_id={team_id}

# Cancel team invitation
DELETE /team-invitations/{invitation_id}
```

### Permission Management Endpoints

```http
# List project permission definitions
GET /project-permission-definitions

# Create project permission definition
POST /project-permission-definitions
Content-Type: application/json

{
  "id": "read_posts",
  "description": "Can read posts"
}

# Update project permission definition
PATCH /project-permission-definitions/{permission_id}

# Delete project permission definition
DELETE /project-permission-definitions/{permission_id}

# List user's project permissions
GET /project-permissions?user_id={user_id}

# Grant project permission to user
POST /project-permissions
Content-Type: application/json

{
  "userId": "user_123",
  "permissionId": "read_posts"
}

# Revoke project permission from user
DELETE /project-permissions/{user_id}/{permission_id}

# List team permission definitions
GET /team-permission-definitions

# Create team permission definition
POST /team-permission-definitions
Content-Type: application/json

{
  "id": "manage_team",
  "description": "Can manage team settings"
}

# List user's team permissions
GET /team-permissions?team_id={team_id}&user_id={user_id}

# Grant team permission to user
POST /team-permissions
Content-Type: application/json

{
  "teamId": "team_123",
  "userId": "user_456",
  "permissionId": "manage_team"
}

# Revoke team permission from user
DELETE /team-permissions/{team_id}/{user_id}/{permission_id}
```

### Email Management Endpoints

```http
# Send email
POST /emails/send-email
Content-Type: application/json

{
  "to": "user@example.com",
  "subject": "Welcome!",
  "html": "<h1>Welcome to our app!</h1>",
  "text": "Welcome to our app!"
}

# List email templates
GET /email-templates

# Get email template
GET /email-templates/{template_type}

# Update email template
PATCH /email-templates/{template_type}
Content-Type: application/json

{
  "subject": "New Subject",
  "content": "<h1>New Content</h1>"
}

# Render email template
POST /emails/render-email
Content-Type: application/json

{
  "templateType": "magic_link",
  "variables": {
    "magicLink": "https://example.com/auth?token=abc123"
  }
}
```

### Contact Channel Endpoints

```http
# List contact channels
GET /contact-channels

# Create contact channel
POST /contact-channels
Content-Type: application/json

{
  "type": "email",
  "value": "user@example.com"
}

# Send verification code
POST /contact-channels/send-verification-code
Content-Type: application/json

{
  "contactChannelId": "channel_123"
}

# Verify contact channel
POST /contact-channels/verify
Content-Type: application/json

{
  "contactChannelId": "channel_123",
  "code": "123456"
}

# Delete contact channel
DELETE /contact-channels/{user_id}/{contact_channel_id}
```


### API Key Management Endpoints

```http
# List user API keys
GET /user-api-keys

# Create user API key
POST /user-api-keys
Content-Type: application/json

{
  "description": "My API Key",
  "expiresAt": "2024-12-31T23:59:59Z",
  "hasPublishableClientKey": true,
  "hasSecretServerKey": true
}

# Get user API key
GET /user-api-keys/{api_key_id}

# Update user API key
PATCH /user-api-keys/{api_key_id}
Content-Type: application/json

{
  "description": "Updated API Key"
}

# Delete user API key
DELETE /user-api-keys/{api_key_id}

# List team API keys
GET /team-api-keys?team_id={team_id}

# Create team API key
POST /team-api-keys
Content-Type: application/json

{
  "teamId": "team_123",
  "description": "Team API Key",
  "expiresAt": "2024-12-31T23:59:59Z"
}

# Delete team API key
DELETE /team-api-keys/{api_key_id}
```

### Project Management Endpoints

```http
# Get current project
GET /projects/current

# Update project (admin)
PATCH /projects/current
Content-Type: application/json

{
  "displayName": "My App",
  "description": "My awesome app",
  "config": {
    "signUpEnabled": true,
    "credentialEnabled": true,
    "magicLinkEnabled": true,
    "oauthProviders": [
      {
        "id": "google",
        "enabled": true
      }
    ]
  }
}
```

### Webhook Endpoints

```http
# Get webhook signing token
GET /webhooks/svix-token
```

## Type Definitions

### User Types

```typescript
interface User {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  primaryEmailVerified: boolean;
  profileImageUrl: string | null;
  signedUpAt: Date;
  hasPassword: boolean;
  oauthProviders: OAuthProvider[];
  selectedTeam: Team | null;
}

interface ServerUser extends User {
  // Additional server-side fields
  projectId: string;
  clientMetadata: Record<string, any>;
  serverMetadata: Record<string, any>;
}

interface CurrentUser extends User {
  // Additional client-side methods
  update(data: { displayName?: string; profileImageUrl?: string }): Promise<CurrentUser>;
  delete(): Promise<void>;
  sendEmailVerificationCode(): Promise<void>;
  createTeam(data: TeamCreateOptions): Promise<Team>;
  leaveTeam(teamId: string): Promise<void>;
}
```

### Team Types

```typescript
interface Team {
  id: string;
  displayName: string;
  description: string | null;
  createdAt: Date;
  profileImageUrl: string | null;
  creatorUserId: string;
}

interface TeamUser {
  id: string;
  displayName: string | null;
  profileImageUrl: string | null;
  primaryEmail: string | null;
}

interface TeamInvitation {
  id: string;
  teamId: string;
  email: string;
  inviterUserId: string;
  createdAt: Date;
  expiresAt: Date;
}

interface TeamCreateOptions {
  displayName: string;
  description?: string;
}

interface TeamUpdateOptions {
  displayName?: string;
  description?: string;
}
```

### Session Types

```typescript
interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  lastActiveAt: Date;
}
```

### OAuth Types

```typescript
type OAuthProvider = 
  | 'google'
  | 'github'
  | 'facebook'
  | 'microsoft'
  | 'spotify'
  | 'discord'
  | 'gitlab'
  | 'apple'
  | 'bitbucket'
  | 'linkedin'
  | 'x';

interface OAuthConnection {
  id: string;
  providerId: OAuthProvider;
  providerAccountId: string;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  scopes: string[];
}
```

### Permission Types

```typescript
interface ProjectPermission {
  id: string;
  description: string | null;
}

interface TeamPermission {
  id: string;
  description: string | null;
}
```

### Email Types

```typescript
interface EmailTemplate {
  type: 'magic_link' | 'email_verification' | 'password_reset' | 'team_invitation';
  subject: string;
  content: string;
}

interface ContactChannel {
  id: string;
  type: 'email';
  value: string;
  verified: boolean;
  isPrimary: boolean;
  usedForAuth: boolean;
}
```


## Email Template System

### Email Editor

Stack Auth provides a visual email template editor for customizing authentication emails.

```typescript
import EmailEditor from '@stackframe/stack-emails/dist/editor/editor';

<EmailEditor
  document={emailDocument}
  subject={emailSubject}
  metadata={templateMetadata}
  onSave={(document, subject) => {
    // Save template
  }}
  onCancel={() => {
    // Cancel editing
  }}
  projectDisplayName="My App"
  confirmAlertMessage="Are you sure you want to leave?"
  setNeedConfirm={setNeedConfirm}
/>
```

### Email Template Types

- `magic_link` - Magic link sign-in emails
- `email_verification` - Email verification emails
- `password_reset` - Password reset emails
- `team_invitation` - Team invitation emails

### Template Variables

Templates support Handlebars-style variables:

- `{{ projectDisplayName }}` - Project name
- `{{ userDisplayName }}` - User's display name
- `{{ otp }}` - One-time password/code
- `{{ magicLink }}` - Magic link URL
- `{{ resetLink }}` - Password reset link
- `{{ teamName }}` - Team name (for invitations)
- `{{ inviterName }}` - Inviter's name (for invitations)

## Error Handling

### KnownError Types

Stack Auth provides structured error handling with specific error types:

```typescript
import { KnownErrors } from '@stackframe/stack';

try {
  await app.signInWithCredential({ email, password });
} catch (error) {
  if (error instanceof KnownErrors.InvalidCredentials) {
    // Handle invalid credentials
  } else if (error instanceof KnownErrors.UserEmailAlreadyExists) {
    // Handle existing user
  } else if (error instanceof KnownErrors.EmailNotVerified) {
    // Handle unverified email
  }
}
```

### Common Error Types

- `InvalidCredentials` - Wrong email/password
- `UserEmailAlreadyExists` - Email already registered
- `EmailNotVerified` - Email verification required
- `UserNotFound` - User doesn't exist
- `TeamNotFound` - Team doesn't exist
- `PermissionDenied` - Insufficient permissions
- `RateLimitExceeded` - Too many requests
- `InvalidRequest` - Malformed request
- `InternalServerError` - Server error

## Configuration

### Environment Variables

```bash
# Required
STACK_PROJECT_ID=your-project-id
STACK_PUBLISHABLE_CLIENT_KEY=your-publishable-key
STACK_SECRET_SERVER_KEY=your-secret-key

# Optional
STACK_BASE_URL=https://api.stack-auth.com  # Default
NEXT_PUBLIC_STACK_PROJECT_ID=your-project-id
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=your-publishable-key
```

### Project Configuration

```typescript
interface ProjectConfig {
  id: string;
  displayName: string;
  description: string | null;
  createdAt: Date;
  userRegistrationEnabled: boolean;
  credentialEnabled: boolean;
  magicLinkEnabled: boolean;
  passkeyEnabled: boolean;
  oauthProviders: {
    id: OAuthProvider;
    enabled: boolean;
    clientId: string;
    clientSecret: string;
  }[];
  emailConfig: {
    senderName: string;
    senderEmail: string;
  };
  domains: {
    domain: string;
    handlerPath: string;
  }[];
}
```

## Middleware (Next.js)

### Route Protection

```typescript
// middleware.ts
import { stackMiddleware } from '@stackframe/stack/middleware';

export default stackMiddleware({
  // Protect these routes
  protectedPaths: ['/dashboard', '/profile'],
  // Redirect unauthenticated users here
  signInPath: '/sign-in',
  // Redirect authenticated users away from these routes
  authPaths: ['/sign-in', '/sign-up'],
  // Redirect authenticated users here
  afterSignInPath: '/dashboard',
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

## Webhooks

### Webhook Events

Stack Auth sends webhooks for various events:

- `user.created` - New user registered
- `user.updated` - User profile updated
- `user.deleted` - User account deleted
- `user.signed_in` - User signed in
- `user.signed_out` - User signed out
- `team.created` - New team created
- `team.updated` - Team updated
- `team.deleted` - Team deleted
- `team.member_added` - User added to team
- `team.member_removed` - User removed from team

### Webhook Payload

```typescript
interface WebhookPayload {
  type: string;
  data: {
    user?: User;
    team?: Team;
    // Event-specific data
  };
  timestamp: string;
  projectId: string;
}
```

### Webhook Verification

```typescript
import { verifyWebhookSignature } from '@stackframe/stack';

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get('stack-signature');
  
  const isValid = verifyWebhookSignature({
    payload,
    signature,
    secret: process.env.STACK_WEBHOOK_SECRET,
  });
  
  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }
  
  const event = JSON.parse(payload);
  // Handle webhook event
  
  return new Response('OK');
}
```

## Best Practices

### Security

1. **Never expose secret keys** - Keep `STACK_SECRET_SERVER_KEY` server-side only
2. **Use HTTPS** - Always use HTTPS in production
3. **Validate permissions** - Check user permissions before sensitive operations
4. **Rate limiting** - Implement rate limiting for auth endpoints
5. **Webhook verification** - Always verify webhook signatures

### Performance

1. **Cache user data** - Cache user information to reduce API calls
2. **Batch operations** - Use batch APIs when available
3. **Optimize redirects** - Minimize redirect chains
4. **Lazy load components** - Load auth components only when needed

### User Experience

1. **Progressive enhancement** - Ensure basic functionality without JavaScript
2. **Loading states** - Show loading indicators during auth operations
3. **Error messages** - Provide clear, actionable error messages
4. **Accessibility** - Ensure auth components are accessible
5. **Mobile optimization** - Test auth flows on mobile devices

## Migration Guide

### From Other Auth Providers

1. **Export user data** from your current provider
2. **Set up Stack Auth** project and configure settings
3. **Implement Stack Auth** in your application
4. **Import user data** using the admin API
5. **Update authentication flows** to use Stack Auth
6. **Test thoroughly** before switching over

### Version Upgrades

Check the [CHANGELOG.md](./CHANGELOG.md) for breaking changes and migration instructions when upgrading Stack Auth versions.

## Support

- **Documentation**: https://docs.stack-auth.com
- **GitHub Issues**: https://github.com/stack-auth/stack-auth/issues
- **Discord Community**: https://discord.stack-auth.com
- **Email Support**: support@stack-auth.com

