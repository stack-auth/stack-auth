import { KnownErrors } from "@stackframe/stack-shared";
import { CurrentUserCrud } from "@stackframe/stack-shared/dist/interface/crud/current-user";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import type { RestrictedReason } from "@stackframe/stack-shared/dist/schema-fields";
import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { encodeBase64 } from "@stackframe/stack-shared/dist/utils/bytes";
import { GeoInfo } from "@stackframe/stack-shared/dist/utils/geo";
import { ReadonlyJson } from "@stackframe/stack-shared/dist/utils/json";
import { ProviderType } from "@stackframe/stack-shared/dist/utils/oauth";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { ApiKeyCreationOptions, UserApiKey, UserApiKeyFirstView } from "../api-keys";
import { AsyncStoreProperty, AuthLike } from "../common";
import { DeprecatedOAuthConnection, OAuthConnection } from "../connected-accounts";
import { ContactChannel, ContactChannelCreateOptions, ServerContactChannel, ServerContactChannelCreateOptions } from "../contact-channels";
import { Customer } from "../customers";
import { NotificationCategory } from "../notification-categories";
import { AdminTeamPermission, TeamPermission } from "../permissions";
import { AdminOwnedProject, AdminProjectCreateOptions } from "../projects";
import { EditableTeamMemberProfile, ReceivedTeamInvitation, ServerTeam, ServerTeamCreateOptions, Team, TeamCreateOptions } from "../teams";

const userGetterErrorMessage = "Stack Auth: useUser() already returns the user object. Use `const user = useUser()` (or `const user = await app.getUser()`) instead of destructuring it like `const { user } = ...`.";

export function withUserDestructureGuard<T extends object>(target: T): T {
  Object.freeze(target);
  return new Proxy(target, {
    get(target, prop, receiver) {
      if (prop === "user") {
        return guardGetter();
      }
      return target[prop as keyof T];
    },
  });
}

function guardGetter(): never {
  throw new Error(userGetterErrorMessage);
}

export type OAuthProvider = {
  readonly id: string,
  readonly type: string,
  readonly userId: string,
  readonly accountId?: string,
  readonly email?: string,
  readonly allowSignIn: boolean,
  readonly allowConnectedAccounts: boolean,
  update(data: { allowSignIn?: boolean, allowConnectedAccounts?: boolean }): Promise<Result<void,
    InstanceType<typeof KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn>
  >>,
  delete(): Promise<void>,
};

export type ServerOAuthProvider = {
  readonly id: string,
  readonly type: string,
  readonly userId: string,
  readonly accountId: string,
  readonly email?: string,
  readonly allowSignIn: boolean,
  readonly allowConnectedAccounts: boolean,
  update(data: { accountId?: string, email?: string, allowSignIn?: boolean, allowConnectedAccounts?: boolean }): Promise<Result<void,
    InstanceType<typeof KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn>
  >>,
  delete(): Promise<void>,
};


/**
 * Contains everything related to the current user session.
 */
export type Auth = AuthLike<{}> & {
  readonly _internalSession: InternalSession,

  /**
   * The current user's session, providing access to authentication tokens.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * // In React components, use the hook for reactive updates
   * const { accessToken } = user.currentSession.useTokens();
   * // Or use the async version
   * const tokens = await user.currentSession.getTokens();
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const { accessToken } = await user.currentSession.getTokens();
   * ```
   */
  readonly currentSession: {
    getTokens(): Promise<{ accessToken: string | null, refreshToken: string | null }>,
    useTokens(): { accessToken: string | null, refreshToken: string | null }, // THIS_LINE_PLATFORM react-like
  },
};

/**
 * ```
 * +----------+-------------+-------------------+
 * |    \     |   !Server   |      Server       |
 * +----------+-------------+-------------------+
 * | !Session | User        | ServerUser        |
 * | Session  | CurrentUser | CurrentServerUser |
 * +----------+-------------+-------------------+
 * ```
 *
 * The fields on each of these types are available iff:
 * BaseUser: true
 * Auth: Session
 * ServerBaseUser: Server
 * UserExtra: Session OR Server
 *
 * The types are defined as follows (in the typescript manner):
 * User = BaseUser
 * CurrentUser = BaseUser & Auth & UserExtra
 * ServerUser = BaseUser & ServerBaseUser & UserExtra
 * CurrentServerUser = BaseUser & ServerBaseUser & Auth & UserExtra
 **/

export type BaseUser = {
  /**
   * The unique identifier of the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * console.log(user.id);
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * console.log(user.id);
   * ```
   */
  readonly id: string,

  /**
   * The display name of the user. The user can modify this value.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * return <div>Hello, {user.displayName ?? 'Guest'}</div>;
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * console.log(`User: ${user.displayName}`);
   * ```
   */
  readonly displayName: string | null,

  /**
   * The user's primary email address.
   *
   * @note This might NOT be unique across multiple users, so always use `id` for unique identification.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * return <div>Email: {user.primaryEmail ?? 'Not set'}</div>;
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * if (user.primaryEmail) {
   *   await sendEmail(user.primaryEmail, 'Welcome!');
   * }
   * ```
   */
  readonly primaryEmail: string | null,

  /**
   * Whether the primary email of the user is verified.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * if (!user.primaryEmailVerified) {
   *   return <div>Please verify your email to continue.</div>;
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * if (!user.primaryEmailVerified) {
   *   // Send reminder email
   * }
   * ```
   */
  readonly primaryEmailVerified: boolean,

  /**
   * The profile image URL of the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * return <img src={user.profileImageUrl ?? '/default-avatar.png'} alt="Profile" />;
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const avatarUrl = user.profileImageUrl ?? 'https://example.com/default.png';
   * ```
   */
  readonly profileImageUrl: string | null,

  /**
   * The date and time when the user signed up.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * return <div>Member since {user.signedUpAt.toLocaleDateString()}</div>;
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const daysSinceSignup = Math.floor((Date.now() - user.signedUpAt.getTime()) / 86400000);
   * ```
   */
  readonly signedUpAt: Date,

  /**
   * Custom metadata that can be read and written by the client.
   *
   * @note Use this for user preferences or non-sensitive data. For sensitive data, use `serverMetadata` instead.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const theme = user.clientMetadata?.theme ?? 'light';
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const preferences = user.clientMetadata?.preferences ?? {};
   * ```
   */
  readonly clientMetadata: any,

  /**
   * Read-only metadata that can only be set from the server.
   *
   * @note Useful for storing data that the client can read but not modify, such as subscription tiers or feature flags.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const isPremium = user.clientReadOnlyMetadata?.tier === 'premium';
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.update({ clientReadOnlyMetadata: { tier: 'premium' } });
   * ```
   */
  readonly clientReadOnlyMetadata: any,

  /**
   * Whether the user has a password set.
   *
   * @note Users who signed up via OAuth may not have a password.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * if (!user.hasPassword) {
   *   return <button>Set a password</button>;
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const authMethods = user.hasPassword ? ['password'] : [];
   * ```
   */
  readonly hasPassword: boolean,

  /**
   * Whether OTP/magic link authentication is enabled for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * return <div>Magic link login: {user.otpAuthEnabled ? 'Enabled' : 'Disabled'}</div>;
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * if (user.otpAuthEnabled) {
   *   // User can sign in via magic link
   * }
   * ```
   */
  readonly otpAuthEnabled: boolean,

  /**
   * Whether passkey authentication is enabled for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * return <div>Passkey login: {user.passkeyAuthEnabled ? 'Enabled' : 'Disabled'}</div>;
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * if (user.passkeyAuthEnabled) {
   *   // User can sign in via passkey
   * }
   * ```
   */
  readonly passkeyAuthEnabled: boolean,

  /**
   * Whether multi-factor authentication is required for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * if (user.isMultiFactorRequired) {
   *   return <div>MFA is required for your account.</div>;
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const securityLevel = user.isMultiFactorRequired ? 'high' : 'standard';
   * ```
   */
  readonly isMultiFactorRequired: boolean,

  /**
   * Whether the user is an anonymous user.
   *
   * @note Anonymous users are temporary and should be prompted to create a full account to persist their data.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * if (user.isAnonymous) {
   *   return <button>Create an account to save your progress</button>;
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * if (user.isAnonymous) {
   *   // Don't send marketing emails to anonymous users
   * }
   * ```
   */
  readonly isAnonymous: boolean,

  /**
   * Whether the user is in restricted state (signed up but hasn't completed onboarding requirements).
   * For example, if email verification is required but the user hasn't verified their email yet.
   *
   * @note Restricted users have limited access. Check `restrictedReason` to determine why and guide the user accordingly.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * if (user.isRestricted) {
   *   return <RestrictedUserBanner reason={user.restrictedReason} />;
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * if (user.isRestricted) {
   *   return new Response('Account restricted', { status: 403 });
   * }
   * ```
   */
  readonly isRestricted: boolean,

  /**
   * The reason why the user is restricted.
   *
   * Possible values:
   * - `{ type: "email_not_verified" }` - User needs to verify their email
   * - `{ type: "anonymous" }` - User is anonymous and needs to create an account
   * - `{ type: "restricted_by_administrator" }` - Admin has restricted this user
   *
   * Returns `null` if the user is not restricted.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * if (user.restrictedReason?.type === 'email_not_verified') {
   *   return <div>Please verify your email to continue.</div>;
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * if (user.restrictedReason?.type === 'restricted_by_administrator') {
   *   // Log admin restriction event
   * }
   * ```
   */
  readonly restrictedReason: RestrictedReason | null,

  /**
   * Converts the user object to the format expected by the Stack Auth API.
   *
   * @note Useful for serializing user data in API responses or caching.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const json = user.toClientJson();
   * localStorage.setItem('cachedUser', JSON.stringify(json));
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * return Response.json(user.toClientJson());
   * ```
   */
  toClientJson(): CurrentUserCrud["Client"]["Read"],

  /**
   * Whether email/password authentication is enabled for this user.
   * @deprecated Use contact channel's usedForAuth instead
   */
  readonly emailAuthEnabled: boolean,
  /**
   * List of OAuth providers connected to this user's account.
   * @deprecated Use getConnectedAccount() instead
   */
  readonly oauthProviders: readonly { id: string }[],
}

export type UserExtra = {
  /**
   * Sets the display name of the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * await user.setDisplayName('John Doe');
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.setDisplayName('John Doe');
   * ```
   */
  setDisplayName(displayName: string | null): Promise<void>,

  /**
   * Sends a verification email to the user's primary email address.
   * @deprecated Use contact channel's sendVerificationEmail instead
   */
  sendVerificationEmail(): Promise<KnownErrors["EmailAlreadyVerified"] | void>,

  /**
   * Sets the client metadata for the user.
   *
   * @note This replaces all client metadata. To update specific fields, merge with existing metadata first.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * await user.setClientMetadata({
   *   ...user.clientMetadata,
   *   theme: 'dark',
   *   language: 'en',
   * });
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.setClientMetadata({ onboardingComplete: true });
   * ```
   */
  setClientMetadata(metadata: any): Promise<void>,

  /**
   * Updates the user's password. Requires the current password for verification.
   *
   * @note Use this when the user knows their current password. For password reset flows, use `setPassword` instead.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const result = await user.updatePassword({
   *   oldPassword: 'current-password',
   *   newPassword: 'new-secure-password',
   * });
   * if (result instanceof KnownErrors.PasswordConfirmationMismatch) {
   *   alert('Current password is incorrect');
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.updatePassword({
   *   oldPassword: 'current-password',
   *   newPassword: 'new-secure-password',
   * });
   * ```
   */
  updatePassword(options: { oldPassword: string, newPassword: string}): Promise<KnownErrors["PasswordConfirmationMismatch"] | KnownErrors["PasswordRequirementsNotMet"] | void>,

  /**
   * Sets a password for the user without requiring the current password.
   *
   * @note Use this for users who signed up via OAuth and don't have a password yet, or after verifying identity through another method (e.g., email reset link).
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const result = await user.setPassword({ password: 'new-secure-password' });
   * if (result instanceof KnownErrors.PasswordRequirementsNotMet) {
   *   alert('Password does not meet requirements');
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.setPassword({ password: 'new-secure-password' });
   * ```
   */
  setPassword(options: { password: string }): Promise<KnownErrors["PasswordRequirementsNotMet"] | void>,

  /**
   * Updates multiple fields of the user at once.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * await user.update({
   *   displayName: 'New Name',
   *   clientMetadata: { theme: 'dark' },
   * });
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.update({
   *   displayName: 'New Name',
   *   clientMetadata: { theme: 'dark' },
   * });
   * ```
   */
  update(update: UserUpdateOptions): Promise<void>,

  /**
   * React hook to get all contact channels for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const contactChannels = user.useContactChannels();
   * return (
   *   <ul>
   *     {contactChannels.map(channel => (
   *       <li key={channel.id}>{channel.value}</li>
   *     ))}
   *   </ul>
   * );
   * ```
   */
  useContactChannels(): ContactChannel[], // THIS_LINE_PLATFORM react-like
  /**
   * Lists all contact channels for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const channels = await user.listContactChannels();
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const channels = await user.listContactChannels();
   * ```
   */
  listContactChannels(): Promise<ContactChannel[]>,
  /**
   * Creates a new contact channel for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const channel = await user.createContactChannel({
   *   type: 'email',
   *   value: 'backup@example.com',
   * });
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const channel = await user.createContactChannel({
   *   type: 'email',
   *   value: 'backup@example.com',
   * });
   * ```
   */
  createContactChannel(data: ContactChannelCreateOptions): Promise<ContactChannel>,

  /**
   * React hook to get all notification categories.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const categories = user.useNotificationCategories();
   * return (
   *   <ul>
   *     {categories.map(cat => (
   *       <li key={cat.id}>{cat.displayName}</li>
   *     ))}
   *   </ul>
   * );
   * ```
   */
  useNotificationCategories(): NotificationCategory[], // THIS_LINE_PLATFORM react-like
  /**
   * Lists all notification categories.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const categories = await user.listNotificationCategories();
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const categories = await user.listNotificationCategories();
   * ```
   */
  listNotificationCategories(): Promise<NotificationCategory[]>,

  /**
   * Deletes the user account.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * await user.delete();
   * // User is now signed out and account is deleted
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.delete();
   * ```
   */
  delete(): Promise<void>,

  /**
   * Gets an OAuth connected account for the user.
   *
   * @deprecated Use `getOrLinkConnectedAccount` for redirect behavior, or `getConnectedAccount({ provider, providerAccountId })` for existence check.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const googleAccount = await user.getConnectedAccount('google', {
   *   or: 'redirect',
   *   scopes: ['https://www.googleapis.com/auth/calendar'],
   * });
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const googleAccount = await user.getConnectedAccount('google');
   * ```
   */
  getConnectedAccount(id: ProviderType, options: { or: 'redirect', scopes?: string[] }): Promise<DeprecatedOAuthConnection>,
  /** @deprecated Use `getConnectedAccount({ provider, providerAccountId })` for existence check, or `getOrLinkConnectedAccount` for redirect behavior. */
  getConnectedAccount(id: ProviderType, options?: { or?: 'redirect' | 'throw' | 'return-null', scopes?: string[] }): Promise<DeprecatedOAuthConnection | null>,
  /** Get a specific connected account by provider and providerAccountId. Returns null if not found. */
  getConnectedAccount(account: { provider: string, providerAccountId: string }): Promise<OAuthConnection | null>,

  /**
   * React hook to get an OAuth connected account for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const googleAccount = user.useConnectedAccount('google', {
   *   or: 'redirect',
   *   scopes: ['https://www.googleapis.com/auth/calendar'],
   * });
   * // Use googleAccount.accessToken to call Google APIs
   * ```
   */
  // IF_PLATFORM react-like
  /** @deprecated Use `useOrLinkConnectedAccount` for redirect behavior, or `useConnectedAccount({ provider, providerAccountId })` for existence check. */
  useConnectedAccount(id: ProviderType, options: { or: 'redirect', scopes?: string[] }): DeprecatedOAuthConnection,
  /** @deprecated Use `useConnectedAccount({ provider, providerAccountId })` for existence check, or `useOrLinkConnectedAccount` for redirect behavior. */
  useConnectedAccount(id: ProviderType, options?: { or?: 'redirect' | 'throw' | 'return-null', scopes?: string[] }): DeprecatedOAuthConnection | null,
  /** Get a specific connected account by provider and providerAccountId. Returns null if not found. */
  useConnectedAccount(account: { provider: string, providerAccountId: string }): OAuthConnection | null,
  // END_PLATFORM

  /** List all connected accounts for this user (only those with allowConnectedAccounts enabled). */
  listConnectedAccounts(): Promise<OAuthConnection[]>,
  /** React hook to list all connected accounts. */
  useConnectedAccounts(): OAuthConnection[], // THIS_LINE_PLATFORM react-like
  /** Redirect the user to the OAuth flow to link a new connected account. Always redirects, never returns. */
  linkConnectedAccount(provider: string, options?: { scopes?: string[] }): Promise<void>,
  /** Get a connected account for the given provider, or redirect to link one if none exists or the token/scopes are insufficient. */
  getOrLinkConnectedAccount(provider: string, options?: { scopes?: string[] }): Promise<OAuthConnection>,
  /** React hook: get a connected account for the given provider, or redirect to link one if none exists or the token/scopes are insufficient. */
  useOrLinkConnectedAccount(provider: string, options?: { scopes?: string[] }): OAuthConnection, // THIS_LINE_PLATFORM react-like

  /**
   * Checks if the user has a specific permission.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const canEdit = await user.hasPermission(team, 'edit');
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const canEdit = await user.hasPermission(team, 'edit');
   * ```
   */
  hasPermission(scope: Team, permissionId: string): Promise<boolean>,
  hasPermission(permissionId: string): Promise<boolean>,

  /**
   * Gets a specific permission for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const permission = await user.getPermission(team, 'admin');
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const permission = await user.getPermission(team, 'admin');
   * ```
   */
  getPermission(scope: Team, permissionId: string): Promise<TeamPermission | null>,
  getPermission(permissionId: string): Promise<TeamPermission | null>,

  /**
   * Lists all permissions for the user in a given scope.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const permissions = await user.listPermissions(team, { recursive: true });
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const permissions = await user.listPermissions(team);
   * ```
   */
  listPermissions(scope: Team, options?: { recursive?: boolean }): Promise<TeamPermission[]>,
  listPermissions(options?: { recursive?: boolean }): Promise<TeamPermission[]>,

  // IF_PLATFORM react-like
  /**
   * React hook to get all permissions for the user in a given scope.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const permissions = user.usePermissions(team);
   * return (
   *   <ul>
   *     {permissions.map(p => <li key={p.id}>{p.id}</li>)}
   *   </ul>
   * );
   * ```
   */
  usePermissions(scope: Team, options?: { recursive?: boolean }): TeamPermission[],
  usePermissions(options?: { recursive?: boolean }): TeamPermission[],

  /**
   * React hook to get a specific permission for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const adminPermission = user.usePermission(team, 'admin');
   * if (adminPermission) {
   *   return <AdminPanel />;
   * }
   * ```
   */
  usePermission(scope: Team, permissionId: string): TeamPermission | null,
  usePermission(permissionId: string): TeamPermission | null,
  // END_PLATFORM

  /**
   * The currently selected team for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * if (user.selectedTeam) {
   *   return <div>Current team: {user.selectedTeam.displayName}</div>;
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const teamId = user.selectedTeam?.id;
   * ```
   */
  readonly selectedTeam: Team | null,

  /**
   * Sets the selected team for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * await user.setSelectedTeam(team);
   * // Or by ID
   * await user.setSelectedTeam('team-id');
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.setSelectedTeam('team-id');
   * ```
   */
  setSelectedTeam(teamOrId: string | Team | null): Promise<void>,

  /**
   * Creates a new team with the user as a member.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const team = await user.createTeam({
   *   displayName: 'My Team',
   * });
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const team = await user.createTeam({
   *   displayName: 'My Team',
   * });
   * ```
   */
  createTeam(data: TeamCreateOptions): Promise<Team>,
  /**
   * Removes the user from the specified team.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * await user.leaveTeam(team);
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.leaveTeam(team);
   * ```
   */
  leaveTeam(team: Team): Promise<void>,

  /**
   * Lists all pending team invitations sent to any of the current user's verified email addresses.
   *
   * This allows the user to discover which teams have invited them, even if they haven't
   * joined those teams yet. Only invitations sent to verified email addresses are included.
   *
   * @returns An array of `ReceivedTeamInvitation` objects, each containing the team ID, team
   * display name, recipient email, and expiration date.
   *
   * @example
   * ```ts
   * const invitations = await user.listTeamInvitations();
   * for (const invitation of invitations) {
   *   console.log(`Invited to ${invitation.teamDisplayName} via ${invitation.recipientEmail}`);
   * }
   * ```
   */
  listTeamInvitations(): Promise<ReceivedTeamInvitation[]>,
  /**
   * Lists all pending team invitations sent to any of the current user's verified email addresses.
   *
   * React hook version of `listTeamInvitations()`. Automatically re-renders when invitations change.
   */
  useTeamInvitations(): ReceivedTeamInvitation[], // THIS_LINE_PLATFORM react-like

  /**
   * Gets all active sessions for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const sessions = await user.getActiveSessions();
   * return (
   *   <ul>
   *     {sessions.map(s => <li key={s.id}>{s.device}</li>)}
   *   </ul>
   * );
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const sessions = await user.getActiveSessions();
   * ```
   */
  getActiveSessions(): Promise<ActiveSession[]>,
  /**
   * Revokes a specific session for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * await user.revokeSession(sessionId);
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.revokeSession(sessionId);
   * ```
   */
  revokeSession(sessionId: string): Promise<void>,
  /**
   * Gets the user's profile within a specific team.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const profile = await user.getTeamProfile(team);
   * console.log(profile.displayName);
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const profile = await user.getTeamProfile(team);
   * ```
   */
  getTeamProfile(team: Team): Promise<EditableTeamMemberProfile>,
  /**
   * React hook to get the user's profile within a specific team.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const profile = user.useTeamProfile(team);
   * return <div>Team name: {profile.displayName}</div>;
   * ```
   */
  useTeamProfile(team: Team): EditableTeamMemberProfile, // THIS_LINE_PLATFORM react-like

  /**
   * Creates a new API key for the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const apiKey = await user.createApiKey({
   *   description: 'My API key',
   *   expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
   * });
   * // Save apiKey.secretApiKey - it won't be shown again
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const apiKey = await user.createApiKey({
   *   description: 'Server-created key',
   * });
   * ```
   */
  createApiKey(options: ApiKeyCreationOptions<"user">): Promise<UserApiKeyFirstView>,

  /**
   * React hook to get all OAuth providers connected to the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const providers = user.useOAuthProviders();
   * return (
   *   <ul>
   *     {providers.map(p => <li key={p.id}>{p.type}</li>)}
   *   </ul>
   * );
   * ```
   */
  useOAuthProviders(): OAuthProvider[], // THIS_LINE_PLATFORM react-like
  /**
   * Lists all OAuth providers connected to the user.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const providers = await user.listOAuthProviders();
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const providers = await user.listOAuthProviders();
   * ```
   */
  listOAuthProviders(): Promise<OAuthProvider[]>,

  /**
   * React hook to get a specific OAuth provider by ID.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const googleProvider = user.useOAuthProvider('google');
   * if (googleProvider) {
   *   return <div>Connected to Google</div>;
   * }
   * ```
   */
  useOAuthProvider(id: string): OAuthProvider | null, // THIS_LINE_PLATFORM react-like
  /**
   * Gets a specific OAuth provider by ID.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const googleProvider = await user.getOAuthProvider('google');
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * const googleProvider = await user.getOAuthProvider('google');
   * ```
   */
  getOAuthProvider(id: string): Promise<OAuthProvider | null>,

  /**
   * Registers a passkey for the user for passwordless authentication.
   *
   * @example-client
   * ```tsx
   * const user = useUser();
   * const result = await user.registerPasskey();
   * if (result.status === 'ok') {
   *   alert('Passkey registered successfully!');
   * }
   * ```
   *
   * @example-server
   * ```ts
   * const user = await stackServerApp.getUser();
   * await user.registerPasskey();
   * ```
   */
  registerPasskey(options?: { hostname?: string }): Promise<Result<undefined, KnownErrors["PasskeyRegistrationFailed"] | KnownErrors["PasskeyWebAuthnError"]>>,
}
& AsyncStoreProperty<"apiKeys", [], UserApiKey[], true>
& AsyncStoreProperty<"team", [id: string], Team | null, false>
& AsyncStoreProperty<"teams", [], Team[], true>
& AsyncStoreProperty<"teamInvitations", [], ReceivedTeamInvitation[], true>
& AsyncStoreProperty<"permission", [scope: Team, permissionId: string, options?: { recursive?: boolean }], TeamPermission | null, false>
& AsyncStoreProperty<"permissions", [scope: Team, options?: { recursive?: boolean }], TeamPermission[], true>;

export type InternalUserExtra =
  & {
    createProject(newProject: AdminProjectCreateOptions): Promise<AdminOwnedProject>,
    transferProject(projectIdToTransfer: string, newTeamId: string): Promise<void>,
  }
  & AsyncStoreProperty<"ownedProjects", [], AdminOwnedProject[], true>

export type User = BaseUser;

export type CurrentUser = BaseUser & Auth & UserExtra & Customer;

export type CurrentInternalUser = CurrentUser & InternalUserExtra;

export type ProjectCurrentUser<ProjectId> = ProjectId extends "internal" ? CurrentInternalUser : CurrentUser;

export type TokenPartialUser = Pick<
  User,
  | "id"
  | "displayName"
  | "primaryEmail"
  | "primaryEmailVerified"
  | "isAnonymous"
  | "isMultiFactorRequired"
  | "isRestricted"
  | "restrictedReason"
>

export type SyncedPartialUser = TokenPartialUser & Pick<
  User,
  | "id"
  | "displayName"
  | "primaryEmail"
  | "primaryEmailVerified"
  | "profileImageUrl"
  | "signedUpAt"
  | "clientMetadata"
  | "clientReadOnlyMetadata"
  | "isAnonymous"
  | "hasPassword"
  | "isRestricted"
  | "restrictedReason"
>;


export type ActiveSession = {
  id: string,
  userId: string,
  createdAt: Date,
  isImpersonation: boolean,
  lastUsedAt: Date | undefined,
  isCurrentSession: boolean,
  geoInfo?: GeoInfo,
};

export type UserUpdateOptions = {
  displayName?: string | null,
  clientMetadata?: ReadonlyJson,
  selectedTeamId?: string | null,
  totpMultiFactorSecret?: Uint8Array | null,
  profileImageUrl?: string | null,
  otpAuthEnabled?: boolean,
  passkeyAuthEnabled?: boolean,
  primaryEmail?: string | null,
}
export function userUpdateOptionsToCrud(options: UserUpdateOptions): CurrentUserCrud["Client"]["Update"] {
  return {
    display_name: options.displayName,
    client_metadata: options.clientMetadata,
    selected_team_id: options.selectedTeamId,
    totp_secret_base64: options.totpMultiFactorSecret != null ? encodeBase64(options.totpMultiFactorSecret) : options.totpMultiFactorSecret,
    profile_image_url: options.profileImageUrl,
    otp_auth_enabled: options.otpAuthEnabled,
    passkey_auth_enabled: options.passkeyAuthEnabled,
    primary_email: options.primaryEmail,
  };
}


export type ServerBaseUser = {
  /**
   * Sets the primary email for the user (server-side only).
   */
  setPrimaryEmail(email: string | null, options?: { verified?: boolean | undefined }): Promise<void>,

  /**
   * The date and time when the user was last active.
   */
  readonly lastActiveAt: Date,

  /**
   * Server-only metadata that can only be read and written from the server.
   */
  readonly serverMetadata: any,
  /**
   * Sets the server metadata for the user.
   */
  setServerMetadata(metadata: any): Promise<void>,
  /**
   * Sets the client read-only metadata that clients can read but not write.
   */
  setClientReadOnlyMetadata(metadata: any): Promise<void>,

  /**
   * Whether the user is restricted by an administrator. Can be set manually or by sign-up rules.
   */
  readonly restrictedByAdmin: boolean,

  /**
   * Public reason shown to the user explaining why they are restricted. Optional.
   */
  readonly restrictedByAdminReason: string | null,

  /**
   * Private details about the restriction (e.g., which sign-up rule triggered). Only visible to server access and above.
   */
  readonly restrictedByAdminPrivateDetails: string | null,

  /**
   * Creates a new team (server-side only).
   */
  createTeam(data: Omit<ServerTeamCreateOptions, "creatorUserId">): Promise<ServerTeam>,

  /**
   * React hook to get all contact channels for the user (server version).
   */
  useContactChannels(): ServerContactChannel[], // THIS_LINE_PLATFORM react-like
  /**
   * Lists all contact channels for the user (server version).
   */
  listContactChannels(): Promise<ServerContactChannel[]>,
  /**
   * Creates a new contact channel for the user (server-side only).
   */
  createContactChannel(data: ServerContactChannelCreateOptions): Promise<ServerContactChannel>,

  /**
   * Updates the user's information (server-side only).
   */
  update(user: ServerUserUpdateOptions): Promise<void>,

  /**
   * Grants a permission to the user (server-side only).
   */
  grantPermission(scope: Team, permissionId: string): Promise<void>,
  grantPermission(permissionId: string): Promise<void>,

  /**
   * Revokes a permission from the user (server-side only).
   */
  revokePermission(scope: Team, permissionId: string): Promise<void>,
  revokePermission(permissionId: string): Promise<void>,

  /**
   * Gets a specific permission for the user (server version).
   */
  getPermission(scope: Team, permissionId: string): Promise<TeamPermission | null>,
  getPermission(permissionId: string): Promise<TeamPermission | null>,

  hasPermission(scope: Team, permissionId: string): Promise<boolean>,
  hasPermission(permissionId: string): Promise<boolean>,

  listPermissions(scope: Team, options?: { recursive?: boolean }): Promise<TeamPermission[]>,
  listPermissions(options?: { recursive?: boolean }): Promise<TeamPermission[]>,

  // IF_PLATFORM react-like
  /**
   * React hook to get all permissions for the user in a given scope (server version).
   */
  usePermissions(scope: Team, options?: { recursive?: boolean }): TeamPermission[],
  usePermissions(options?: { recursive?: boolean }): TeamPermission[],

  /**
   * React hook to get a specific permission for the user (server version).
   */
  usePermission(scope: Team, permissionId: string): TeamPermission | null,
  usePermission(permissionId: string): TeamPermission | null,
  // END_PLATFORM

  /**
   * React hook to get all OAuth providers connected to the user (server version).
   */
  useOAuthProviders(): ServerOAuthProvider[], // THIS_LINE_PLATFORM react-like
  /**
   * Lists all OAuth providers connected to the user (server version).
   */
  listOAuthProviders(): Promise<ServerOAuthProvider[]>,

  /**
   * React hook to get a specific OAuth provider by ID (server version).
   */
  useOAuthProvider(id: string): ServerOAuthProvider | null, // THIS_LINE_PLATFORM react-like
  /**
   * Gets a specific OAuth provider by ID (server version).
   */
  getOAuthProvider(id: string): Promise<ServerOAuthProvider | null>,

  /**
   * Creates a new session for the user. Can be used for impersonation.
   */
  createSession(options?: { expiresInMillis?: number, isImpersonation?: boolean }): Promise<{
    getTokens(): Promise<{ accessToken: string | null, refreshToken: string | null }>,
  }>,
}
& AsyncStoreProperty<"team", [id: string], ServerTeam | null, false>
& AsyncStoreProperty<"teams", [], ServerTeam[], true>
& AsyncStoreProperty<"permission", [scope: Team, permissionId: string, options?: { direct?: boolean }], AdminTeamPermission | null, false>
& AsyncStoreProperty<"permissions", [scope: Team, options?: { direct?: boolean }], AdminTeamPermission[], true>;

/**
 * A user including sensitive fields that should only be used on the server, never sent to the client
 * (such as sensitive information and serverMetadata).
 */
export type ServerUser = ServerBaseUser & BaseUser & UserExtra & Customer<true>;

export type CurrentServerUser = Auth & ServerUser;

export type CurrentInternalServerUser = CurrentServerUser & InternalUserExtra;

export type ProjectCurrentServerUser<ProjectId> = ProjectId extends "internal" ? CurrentInternalServerUser : CurrentServerUser;

export type SyncedPartialServerUser = SyncedPartialUser & Pick<
  ServerUser,
  | "serverMetadata"
>;

export type ServerUserUpdateOptions = {
  primaryEmail?: string | null,
  primaryEmailVerified?: boolean,
  primaryEmailAuthEnabled?: boolean,
  clientReadOnlyMetadata?: ReadonlyJson,
  serverMetadata?: ReadonlyJson,
  password?: string,
  restrictedByAdmin?: boolean,
  restrictedByAdminReason?: string | null,
  restrictedByAdminPrivateDetails?: string | null,
} & UserUpdateOptions;
export function serverUserUpdateOptionsToCrud(options: ServerUserUpdateOptions): CurrentUserCrud["Server"]["Update"] {
  // Base update options
  const baseUpdate: CurrentUserCrud["Server"]["Update"] = {
    display_name: options.displayName,
    primary_email: options.primaryEmail,
    client_metadata: options.clientMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    server_metadata: options.serverMetadata,
    selected_team_id: options.selectedTeamId,
    primary_email_auth_enabled: options.primaryEmailAuthEnabled,
    primary_email_verified: options.primaryEmailVerified,
    password: options.password,
    profile_image_url: options.profileImageUrl,
    totp_secret_base64: options.totpMultiFactorSecret != null ? encodeBase64(options.totpMultiFactorSecret) : options.totpMultiFactorSecret,
  };
  // Add admin restriction fields (may not be in generated types yet but will be at runtime)
  return {
    ...baseUpdate,
    restricted_by_admin: options.restrictedByAdmin,
    restricted_by_admin_reason: options.restrictedByAdminReason,
    restricted_by_admin_private_details: options.restrictedByAdminPrivateDetails,
  } as CurrentUserCrud["Server"]["Update"];
}


export type ServerUserCreateOptions = {
  primaryEmail?: string | null,
  primaryEmailAuthEnabled?: boolean,
  password?: string,
  otpAuthEnabled?: boolean,
  displayName?: string,
  primaryEmailVerified?: boolean,
  clientMetadata?: any,
  clientReadOnlyMetadata?: any,
  serverMetadata?: any,
}
export function serverUserCreateOptionsToCrud(options: ServerUserCreateOptions): UsersCrud["Server"]["Create"] {
  return {
    primary_email: options.primaryEmail,
    password: options.password,
    otp_auth_enabled: options.otpAuthEnabled,
    primary_email_auth_enabled: options.primaryEmailAuthEnabled,
    display_name: options.displayName,
    primary_email_verified: options.primaryEmailVerified,
    client_metadata: options.clientMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    server_metadata: options.serverMetadata,
  };
}
