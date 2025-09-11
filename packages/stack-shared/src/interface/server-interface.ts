import { decryptValue, encryptValue, hashKey } from "../helpers/vault/client-side";
import { KnownErrors } from "../known-errors";
import { AccessToken, InternalSession, RefreshToken } from "../sessions";
import { StackAssertionError } from "../utils/errors";
import { filterUndefined } from "../utils/objects";
import { Result } from "../utils/results";
import { urlString } from "../utils/urls";
import {
  ClientInterfaceOptions,
  StackClientInterface
} from "./client-interface";
import { ConnectedAccountAccessTokenCrud } from "./crud/connected-accounts";
import { ContactChannelsCrud } from "./crud/contact-channels";
import { CurrentUserCrud } from "./crud/current-user";
import { ItemCrud } from "./crud/items";
import { NotificationPreferenceCrud } from "./crud/notification-preferences";
import { OAuthProviderCrud } from "./crud/oauth-providers";
import { ProjectPermissionsCrud } from "./crud/project-permissions";
import { SessionsCrud } from "./crud/sessions";
import { TeamInvitationCrud } from "./crud/team-invitation";
import { TeamMemberProfilesCrud } from "./crud/team-member-profiles";
import { TeamMembershipsCrud } from "./crud/team-memberships";
import { TeamPermissionsCrud } from "./crud/team-permissions";
import { TeamsCrud } from "./crud/teams";
import { UsersCrud } from "./crud/users";

export type ServerAuthApplicationOptions = (
  & ClientInterfaceOptions
  & (
    | {
      readonly secretServerKey: string,
    }
    | {
      readonly projectOwnerSession: InternalSession,
    }
  )
);

export class StackServerInterface extends StackClientInterface {
  constructor(public override options: ServerAuthApplicationOptions) {
    super(options);
  }

  protected async sendServerRequest(path: string, options: RequestInit, session: InternalSession | null, requestType: "server" | "admin" = "server") {
    return await this.sendClientRequest(
      path,
      {
        ...options,
        headers: {
          "x-stack-secret-server-key": "secretServerKey" in this.options ? this.options.secretServerKey : "",
          ...options.headers,
        },
      },
      session,
      requestType,
    );
  }

  protected async sendServerRequestAndCatchKnownError<E extends typeof KnownErrors[keyof KnownErrors]>(
    path: string,
    requestOptions: RequestInit,
    tokenStoreOrNull: InternalSession | null,
    errorsToCatch: readonly E[],
  ): Promise<Result<
    Response & {
      usedTokens: {
        accessToken: AccessToken,
        refreshToken: RefreshToken | null,
      } | null,
    },
    InstanceType<E>
  >> {
    try {
      return Result.ok(await this.sendServerRequest(path, requestOptions, tokenStoreOrNull));
    } catch (e) {
      for (const errorType of errorsToCatch) {
        if (errorType.isInstance(e)) {
          return Result.error(e as InstanceType<E>);
        }
      }
      throw e;
    }
  }

  async createServerUser(data: UsersCrud['Server']['Create']): Promise<UsersCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      "/users",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async getServerUserByToken(session: InternalSession): Promise<CurrentUserCrud['Server']['Read'] | null> {
    const responseOrError = await this.sendServerRequestAndCatchKnownError(
      "/users/me",
      {},
      session,
      [KnownErrors.CannotGetOwnUserWithoutUser],
    );
    if (responseOrError.status === "error") {
      if (KnownErrors.CannotGetOwnUserWithoutUser.isInstance(responseOrError.error)) {
        return null;
      } else {
        throw new StackAssertionError("Unexpected uncaught error", { cause: responseOrError.error });
      }
    }
    const response = responseOrError.data;
    const user: CurrentUserCrud['Server']['Read'] = await response.json();
    if (!(user as any)) throw new StackAssertionError("User endpoint returned null; this should never happen");
    return user;
  }

  async getServerUserById(userId: string): Promise<Result<UsersCrud['Server']['Read']>> {
    const responseOrError = await this.sendServerRequestAndCatchKnownError(
      urlString`/users/${userId}`,
      {},
      null,
      [KnownErrors.UserNotFound],
    );
    if (responseOrError.status === "error") {
      return Result.error(responseOrError.error);
    }
    const user: UsersCrud['Server']['Read'] = await responseOrError.data.json();
    return Result.ok(user);
  }

  async listServerTeamInvitations(options: {
    teamId: string,
  }): Promise<TeamInvitationCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(
      urlString`/team-invitations?team_id=${options.teamId}`,
      {},
      null,
    );
    const result = await response.json() as TeamInvitationCrud['Server']['List'];
    return result.items;
  }

  async revokeServerTeamInvitation(invitationId: string, teamId: string) {
    await this.sendServerRequest(
      urlString`/team-invitations/${invitationId}?team_id=${teamId}`,
      { method: "DELETE" },
      null,
    );
  }

  async listServerTeamMemberProfiles(
    options: {
      teamId: string,
    },
  ): Promise<TeamMemberProfilesCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(
      urlString`/team-member-profiles?team_id=${options.teamId}`,
      {},
      null,
    );
    const result = await response.json() as TeamMemberProfilesCrud['Server']['List'];
    return result.items;
  }

  async getServerTeamMemberProfile(
    options: {
      teamId: string,
      userId: string,
    },
  ): Promise<TeamMemberProfilesCrud['Client']['Read']> {
    const response = await this.sendServerRequest(
      urlString`/team-member-profiles/${options.teamId}/${options.userId}`,
      {},
      null,
    );
    return await response.json();
  }

  async listServerTeamPermissions(
    options: {
      userId?: string,
      teamId?: string,
      recursive: boolean,
    },
    session: InternalSession | null,
  ): Promise<TeamPermissionsCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(
      `/team-permissions?${new URLSearchParams(filterUndefined({
        user_id: options.userId,
        team_id: options.teamId,
        recursive: options.recursive.toString(),
      }))}`,
      {},
      session,
    );
    const result = await response.json() as TeamPermissionsCrud['Server']['List'];
    return result.items;
  }

  async listServerProjectPermissions(
    options: {
      userId?: string,
      recursive: boolean,
    },
    session: InternalSession | null,
  ): Promise<ProjectPermissionsCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(
      `/project-permissions?${new URLSearchParams(filterUndefined({
        user_id: options.userId,
        recursive: options.recursive.toString(),
      }))}`,
      {},
      session,
    );
    const result = await response.json() as ProjectPermissionsCrud['Server']['List'];
    return result.items;
  }

  async listServerUsers(options: {
    cursor?: string,
    limit?: number,
    orderBy?: 'signedUpAt',
    desc?: boolean,
    query?: string,
    includeAnonymous?: boolean,
  }): Promise<UsersCrud['Server']['List']> {
    const searchParams = new URLSearchParams(filterUndefined({
      cursor: options.cursor,
      limit: options.limit?.toString(),
      desc: options.desc?.toString(),
      ...options.orderBy ? {
        order_by: {
          signedUpAt: "signed_up_at",
        }[options.orderBy],
      } : {},
      ...options.query ? {
        query: options.query,
      } : {},
      ...options.includeAnonymous ? {
        include_anonymous: 'true',
      } : {},
    }));
    const response = await this.sendServerRequest("/users?" + searchParams.toString(), {}, null);
    return await response.json();
  }

  async listServerTeams(options?: {
    userId?: string,
  }): Promise<TeamsCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(
      `/teams?${new URLSearchParams(filterUndefined({
        user_id: options?.userId,
      }))}`,
      {},
      null
    );
    const result = await response.json() as TeamsCrud['Server']['List'];
    return result.items;
  }

  async getServerTeam(teamId: string): Promise<TeamsCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      `/teams/${teamId}`,
      {},
      null
    );
    return await response.json();
  }

  async listServerTeamUsers(teamId: string): Promise<UsersCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(`/users?team_id=${teamId}`, {}, null);
    const result = await response.json() as UsersCrud['Server']['List'];
    return result.items;
  }

  /* when passing a session, the user will be added to the team */
  async createServerTeam(data: TeamsCrud['Server']['Create']): Promise<TeamsCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      "/teams",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null
    );
    return await response.json();
  }

  async updateServerTeam(teamId: string, data: TeamsCrud['Server']['Update']): Promise<TeamsCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      urlString`/teams/${teamId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async deleteServerTeam(teamId: string): Promise<void> {
    await this.sendServerRequest(
      urlString`/teams/${teamId}`,
      { method: "DELETE" },
      null,
    );
  }

  async addServerUserToTeam(options: {
    userId: string,
    teamId: string,
  }): Promise<TeamMembershipsCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      urlString`/team-memberships/${options.teamId}/${options.userId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
    return await response.json();
  }

  async removeServerUserFromTeam(options: {
    userId: string,
    teamId: string,
  }) {
    await this.sendServerRequest(
      urlString`/team-memberships/${options.teamId}/${options.userId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
  }

  async updateServerUser(userId: string, update: UsersCrud['Server']['Update']): Promise<UsersCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      urlString`/users/${userId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(update),
      },
      null,
    );
    return await response.json();
  }

  async createServerProviderAccessToken(
    userId: string,
    provider: string,
    scope: string,
  ): Promise<ConnectedAccountAccessTokenCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      urlString`/connected-accounts/${userId}/${provider}/access-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ scope }),
      },
      null,
    );
    return await response.json();
  }

  async createServerUserSession(userId: string, expiresInMillis: number, isImpersonation: boolean): Promise<{ accessToken: string, refreshToken: string }> {
    const response = await this.sendServerRequest(
      "/auth/sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          expires_in_millis: expiresInMillis,
          is_impersonation: isImpersonation,
        }),
      },
      null,
    );
    const result = await response.json();
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
    };
  }

  async leaveServerTeam(
    options: {
      teamId: string,
      userId: string,
    },
  ) {
    await this.sendClientRequest(
      urlString`/team-memberships/${options.teamId}/${options.userId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
  }

  async updateServerTeamMemberProfile(options: {
    teamId: string,
    userId: string,
    profile: TeamMemberProfilesCrud['Server']['Update'],
  }) {
    await this.sendServerRequest(
      urlString`/team-member-profiles/${options.teamId}/${options.userId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(options.profile),
      },
      null,
    );
  }

  async grantServerTeamUserPermission(teamId: string, userId: string, permissionId: string) {
    await this.sendServerRequest(
      urlString`/team-permissions/${teamId}/${userId}/${permissionId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
  }

  async grantServerProjectPermission(userId: string, permissionId: string) {
    await this.sendServerRequest(
      urlString`/project-permissions/${userId}/${permissionId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
  }

  async revokeServerTeamUserPermission(teamId: string, userId: string, permissionId: string) {
    await this.sendServerRequest(
      urlString`/team-permissions/${teamId}/${userId}/${permissionId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
  }

  async revokeServerProjectPermission(userId: string, permissionId: string) {
    await this.sendServerRequest(
      urlString`/project-permissions/${userId}/${permissionId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
  }

  async deleteServerUser(userId: string) {
    await this.sendServerRequest(
      urlString`/users/${userId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
  }

  async createServerContactChannel(
    data: ContactChannelsCrud['Server']['Create'],
  ): Promise<ContactChannelsCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      "/contact-channels",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async updateServerContactChannel(
    userId: string,
    contactChannelId: string,
    data: ContactChannelsCrud['Server']['Update'],
  ): Promise<ContactChannelsCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      urlString`/contact-channels/${userId}/${contactChannelId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async deleteServerContactChannel(
    userId: string,
    contactChannelId: string,
  ): Promise<void> {
    await this.sendServerRequest(
      urlString`/contact-channels/${userId}/${contactChannelId}`,
      {
        method: "DELETE",
      },
      null,
    );
  }

  async listServerContactChannels(
    userId: string,
  ): Promise<ContactChannelsCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(
      urlString`/contact-channels?user_id=${userId}`,
      {
        method: "GET",
      },
      null,
    );
    const json = await response.json() as ContactChannelsCrud['Server']['List'];
    return json.items;
  }

  async listServerNotificationCategories(
    userId: string,
  ): Promise<NotificationPreferenceCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(
      urlString`/emails/notification-preference/${userId}`,
      {
        method: "GET",
      },
      null,
    );
    const json = await response.json() as NotificationPreferenceCrud['Server']['List'];
    return json.items;
  }

  async setServerNotificationsEnabled(
    userId: string,
    notificationCategoryId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.sendServerRequest(
      urlString`/emails/notification-preference/${userId}/${notificationCategoryId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled,
        }),
      },
      null,
    );
  }

  async sendServerContactChannelVerificationEmail(
    userId: string,
    contactChannelId: string,
    callbackUrl: string,
  ): Promise<void> {
    await this.sendServerRequest(
      urlString`/contact-channels/${userId}/${contactChannelId}/send-verification-code`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ callback_url: callbackUrl }),
      },
      null,
    );
  }


  async listServerSessions(userId: string): Promise<SessionsCrud['Server']['Read'][]> {
    const response = await this.sendServerRequest(
      urlString`/auth/sessions?user_id=${userId}`,
      {
        method: "GET",
      },
      null,
    );
    return await response.json();
  }

  async deleteServerSession(sessionId: string) {
    await this.sendServerRequest(
      urlString`/auth/sessions/${sessionId}`,
      {
        method: "DELETE",
      },
      null,
    );
  }


  async sendServerTeamInvitation(options: {
    email: string,
    teamId: string,
    callbackUrl: string,
  }): Promise<void> {
    await this.sendServerRequest(
      "/team-invitations/send-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: options.email,
          team_id: options.teamId,
          callback_url: options.callbackUrl,
        }),
      },
      null,
    );
  }

  async updatePassword(
    options: { oldPassword: string, newPassword: string },
  ): Promise<KnownErrors["PasswordConfirmationMismatch"] | KnownErrors["PasswordRequirementsNotMet"] | undefined> {
    const res = await this.sendServerRequestAndCatchKnownError(
      "/auth/password/update",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          old_password: options.oldPassword,
          new_password: options.newPassword,
        }),
      },
      null,
      [KnownErrors.PasswordConfirmationMismatch, KnownErrors.PasswordRequirementsNotMet]
    );

    if (res.status === "error") {
      return res.error;
    }
  }

  // OAuth Providers CRUD operations
  async createServerOAuthProvider(
    data: OAuthProviderCrud['Server']['Create'],
  ): Promise<OAuthProviderCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      "/oauth-providers",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }


  async listServerOAuthProviders(
    options: {
      user_id?: string,
    } = {},
  ): Promise<OAuthProviderCrud['Server']['Read'][]> {
    const queryParams = new URLSearchParams(filterUndefined(options));
    const response = await this.sendServerRequest(
      `/oauth-providers${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        method: "GET",
      },
      null,
    );
    const result = await response.json();
    return result.items;
  }

  async updateServerOAuthProvider(
    userId: string,
    providerId: string,
    data: OAuthProviderCrud['Server']['Update'],
  ): Promise<OAuthProviderCrud['Server']['Read']> {
    const response = await this.sendServerRequest(
      urlString`/oauth-providers/${userId}/${providerId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async deleteServerOAuthProvider(
    userId: string,
    providerId: string,
  ): Promise<void> {
    const response = await this.sendServerRequest(
      urlString`/oauth-providers/${userId}/${providerId}`,
      {
        method: "DELETE",
      },
      null,
    );
    return await response.json();
  }

  async sendEmail(options: {
    userIds?: string[],
    allUsers?: true,
    themeId?: string | null | false,
    html?: string,
    subject?: string,
    notificationCategoryName?: string,
    templateId?: string,
    variables?: Record<string, any>,
    draftId?: string,
  }): Promise<Result<void, KnownErrors["RequiresCustomEmailServer"] | KnownErrors["SchemaError"] | KnownErrors["UserIdDoesNotExist"]>> {
    const res = await this.sendServerRequest(
      "/emails/send-email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_ids: options.userIds,
          all_users: options.allUsers,
          theme_id: options.themeId,
          html: options.html,
          subject: options.subject,
          notification_category_name: options.notificationCategoryName,
          template_id: options.templateId,
          variables: options.variables,
          draft_id: options.draftId,
        }),
      },
      null,
    );
    return Result.ok(undefined);
  }

  async updateItemQuantity(
    options: (
      { itemId: string, userId: string } |
      { itemId: string, teamId: string } |
      { itemId: string, customCustomerId: string }
    ),
    data: ItemCrud['Server']['Update'],
  ): Promise<void> {
    let customerType: "user" | "team" | "custom";
    let customerId: string;
    const itemId: string = options.itemId;

    if ("userId" in options) {
      customerType = "user";
      customerId = options.userId;
    } else if ("teamId" in options) {
      customerType = "team";
      customerId = options.teamId;
    } else if ("customCustomerId" in options) {
      customerType = "custom";
      customerId = options.customCustomerId;
    } else {
      throw new StackAssertionError("updateItemQuantity requires one of userId, teamId, or customCustomerId");
    }

    const queryParams = new URLSearchParams({ allow_negative: (data.allow_negative ?? false).toString() });
    await this.sendServerRequest(
      `/payments/items/${customerType}/${customerId}/${itemId}/update-quantity?${queryParams.toString()}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delta: data.delta, expires_at: data.expires_at, description: data.description }),
      },
      null
    );
  }

  async getDataVaultStoreValue(secret: string, storeId: string, key: string) {
    const hashedKey = await hashKey(secret, key);
    const response = await this.sendServerRequestAndCatchKnownError(
      `/data-vault/stores/${storeId}/get`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashed_key: hashedKey }),
      },
      null,
      [KnownErrors.DataVaultStoreHashedKeyDoesNotExist] as const,
    );
    if (response.status === "error") {
      if (KnownErrors.DataVaultStoreHashedKeyDoesNotExist.isInstance(response.error)) {
        return null;
      } else {
        throw new StackAssertionError("Unexpected uncaught error", { cause: response.error });
      }
    }
    const json = await response.data.json();
    const encryptedValue = json.encrypted_value;
    if (typeof encryptedValue !== "string") throw new StackAssertionError("encrypted_value is not a string", { type: typeof encryptedValue });
    return await decryptValue(secret, key, encryptedValue);
  }

  async setDataVaultStoreValue(secret: string, storeId: string, key: string, value: string) {
    const hashedKey = await hashKey(secret, key);
    const encryptedValue = await encryptValue(secret, key, value);
    await this.sendServerRequest(
      `/data-vault/stores/${storeId}/set`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashed_key: hashedKey, encrypted_value: encryptedValue }),
      },
      null,
    );
  }
}
