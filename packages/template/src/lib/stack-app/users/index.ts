import { KnownErrors } from "@stackframe/stack-shared";
import { CurrentUserCrud } from "@stackframe/stack-shared/dist/interface/crud/current-user";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { encodeBase64 } from "@stackframe/stack-shared/dist/utils/bytes";
import { GeoInfo } from "@stackframe/stack-shared/dist/utils/geo";
import { ReadonlyJson } from "@stackframe/stack-shared/dist/utils/json";
import { ProviderType } from "@stackframe/stack-shared/dist/utils/oauth";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { ApiKeyCreationOptions, UserApiKey, UserApiKeyFirstView } from "../api-keys";
import { AsyncStoreProperty, AuthLike } from "../common";
import { OAuthConnection } from "../connected-accounts";
import { ContactChannel, ContactChannelCreateOptions, ServerContactChannel, ServerContactChannelCreateOptions } from "../contact-channels";
import { Customer } from "../customers";
import { NotificationCategory } from "../notification-categories";
import { AdminTeamPermission, TeamPermission } from "../permissions";
import { AdminOwnedProject, AdminProjectCreateOptions } from "../projects";
import { EditableTeamMemberProfile, ServerTeam, ServerTeamCreateOptions, Team, TeamCreateOptions } from "../teams";

const userGetterErrorMessage = "Stack Auth: useUser() already returns the user object. Use `const user = useUser()` (or `const user = await app.getUser()`) instead of destructuring it like `const { user } = ...`.";

export function attachUserDestructureGuard(target: object): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, "user");
  if (descriptor?.get === guardGetter) {
    return;
  }

  Object.defineProperty(target, "user", {
    get: guardGetter,
    configurable: false,
    enumerable: false,
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
   * The current user's session.
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
   */
  readonly id: string,

  /**
   * The display name of the user. The user can modify this value.
   */
  readonly displayName: string | null,

  /**
   * The user's primary email address.
   *
   * Note: This might NOT be unique across multiple users, so always use `id` for unique identification.
   */
  readonly primaryEmail: string | null,

  /**
   * Whether the primary email of the user is verified.
   */
  readonly primaryEmailVerified: boolean,

  /**
   * The profile image URL of the user.
   */
  readonly profileImageUrl: string | null,

  /**
   * The date and time when the user signed up.
   */
  readonly signedUpAt: Date,

  /**
   * Custom metadata that can be read and written by the client.
   */
  readonly clientMetadata: any,

  /**
   * Read-only metadata that can only be set from the server.
   */
  readonly clientReadOnlyMetadata: any,

  /**
   * Whether the user has a password set.
   */
  readonly hasPassword: boolean,

  /**
   * Whether OTP/magic link authentication is enabled for the user.
   */
  readonly otpAuthEnabled: boolean,

  /**
   * Whether passkey authentication is enabled for the user.
   */
  readonly passkeyAuthEnabled: boolean,

  /**
   * Whether multi-factor authentication is required for the user.
   */
  readonly isMultiFactorRequired: boolean,

  /**
   * Whether the user is an anonymous user.
   */
  readonly isAnonymous: boolean,

  /**
   * Converts the user object to the format expected by the Stack Auth API.
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
   */
  setDisplayName(displayName: string): Promise<void>,

  /**
   * Sends a verification email to the user's primary email address.
   * @deprecated Use contact channel's sendVerificationEmail instead
   */
  sendVerificationEmail(): Promise<KnownErrors["EmailAlreadyVerified"] | void>,

  /**
   * Sets the client metadata for the user.
   */
  setClientMetadata(metadata: any): Promise<void>,

  /**
   * Updates the user's password.
   */
  updatePassword(options: { oldPassword: string, newPassword: string}): Promise<KnownErrors["PasswordConfirmationMismatch"] | KnownErrors["PasswordRequirementsNotMet"] | void>,

  /**
   * Sets a password for the user.
   */
  setPassword(options: { password: string }): Promise<KnownErrors["PasswordRequirementsNotMet"] | void>,

  /**
   * Updates multiple fields of the user at once.
   */
  update(update: UserUpdateOptions): Promise<void>,

  /**
   * React hook to get all contact channels for the user.
   */
  useContactChannels(): ContactChannel[], // THIS_LINE_PLATFORM react-like
  /**
   * Lists all contact channels for the user.
   */
  listContactChannels(): Promise<ContactChannel[]>,
  /**
   * Creates a new contact channel for the user.
   */
  createContactChannel(data: ContactChannelCreateOptions): Promise<ContactChannel>,

  /**
   * React hook to get all notification categories.
   */
  useNotificationCategories(): NotificationCategory[], // THIS_LINE_PLATFORM react-like
  /**
   * Lists all notification categories.
   */
  listNotificationCategories(): Promise<NotificationCategory[]>,

  /**
   * Deletes the user account.
   */
  delete(): Promise<void>,

  /**
   * Gets an OAuth connected account for the user.
   */
  getConnectedAccount(id: ProviderType, options: { or: 'redirect', scopes?: string[] }): Promise<OAuthConnection>,
  getConnectedAccount(id: ProviderType, options?: { or?: 'redirect' | 'throw' | 'return-null', scopes?: string[] }): Promise<OAuthConnection | null>,

  /**
   * React hook to get an OAuth connected account for the user.
   */
  // IF_PLATFORM react-like
  useConnectedAccount(id: ProviderType, options: { or: 'redirect', scopes?: string[] }): OAuthConnection,
  useConnectedAccount(id: ProviderType, options?: { or?: 'redirect' | 'throw' | 'return-null', scopes?: string[] }): OAuthConnection | null,
  // END_PLATFORM

  /**
   * Checks if the user has a specific permission.
   */
  hasPermission(scope: Team, permissionId: string): Promise<boolean>,
  hasPermission(permissionId: string): Promise<boolean>,

  /**
   * Gets a specific permission for the user.
   */
  getPermission(scope: Team, permissionId: string): Promise<TeamPermission | null>,
  getPermission(permissionId: string): Promise<TeamPermission | null>,

  /**
   * Lists all permissions for the user in a given scope.
   */
  listPermissions(scope: Team, options?: { recursive?: boolean }): Promise<TeamPermission[]>,
  listPermissions(options?: { recursive?: boolean }): Promise<TeamPermission[]>,

  // IF_PLATFORM react-like
  /**
   * React hook to get all permissions for the user in a given scope.
   */
  usePermissions(scope: Team, options?: { recursive?: boolean }): TeamPermission[],
  usePermissions(options?: { recursive?: boolean }): TeamPermission[],

  /**
   * React hook to get a specific permission for the user.
   */
  usePermission(scope: Team, permissionId: string): TeamPermission | null,
  usePermission(permissionId: string): TeamPermission | null,
  // END_PLATFORM

  /**
   * The currently selected team for the user.
   */
  readonly selectedTeam: Team | null,
  /**
   * Sets the selected team for the user.
   */
  setSelectedTeam(team: Team | null): Promise<void>,
  /**
   * Creates a new team with the user as a member.
   */
  createTeam(data: TeamCreateOptions): Promise<Team>,
  /**
   * Removes the user from the specified team.
   */
  leaveTeam(team: Team): Promise<void>,

  /**
   * Gets all active sessions for the user.
   */
  getActiveSessions(): Promise<ActiveSession[]>,
  /**
   * Revokes a specific session for the user.
   */
  revokeSession(sessionId: string): Promise<void>,
  /**
   * Gets the user's profile within a specific team.
   */
  getTeamProfile(team: Team): Promise<EditableTeamMemberProfile>,
  /**
   * React hook to get the user's profile within a specific team.
   */
  useTeamProfile(team: Team): EditableTeamMemberProfile, // THIS_LINE_PLATFORM react-like

  /**
   * Creates a new API key for the user.
   */
  createApiKey(options: ApiKeyCreationOptions<"user">): Promise<UserApiKeyFirstView>,

  /**
   * React hook to get all OAuth providers connected to the user.
   */
  useOAuthProviders(): OAuthProvider[], // THIS_LINE_PLATFORM react-like
  /**
   * Lists all OAuth providers connected to the user.
   */
  listOAuthProviders(): Promise<OAuthProvider[]>,

  /**
   * React hook to get a specific OAuth provider by ID.
   */
  useOAuthProvider(id: string): OAuthProvider | null, // THIS_LINE_PLATFORM react-like
  /**
   * Gets a specific OAuth provider by ID.
   */
  getOAuthProvider(id: string): Promise<OAuthProvider | null>,

  /**
   * Registers a passkey for the user for passwordless authentication.
   */
  registerPasskey(options?: { hostname?: string }): Promise<Result<undefined, KnownErrors["PasskeyRegistrationFailed"] | KnownErrors["PasskeyWebAuthnError"]>>,
}
& AsyncStoreProperty<"apiKeys", [], UserApiKey[], true>
& AsyncStoreProperty<"team", [id: string], Team | null, false>
& AsyncStoreProperty<"teams", [], Team[], true>
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
  displayName?: string,
  clientMetadata?: ReadonlyJson,
  selectedTeamId?: string | null,
  totpMultiFactorSecret?: Uint8Array | null,
  profileImageUrl?: string | null,
  otpAuthEnabled?: boolean,
  passkeyAuthEnabled?:boolean,
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
} & UserUpdateOptions;
export function serverUserUpdateOptionsToCrud(options: ServerUserUpdateOptions): CurrentUserCrud["Server"]["Update"] {
  return {
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
