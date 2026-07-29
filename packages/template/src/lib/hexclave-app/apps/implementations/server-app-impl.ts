import { HexclaveServerInterface, KnownErrors } from "@hexclave/shared";
import type { AnalyticsQueryOptions, AnalyticsQueryResponse } from "@hexclave/shared/dist/interface/crud/analytics";
import { ContactChannelsCrud } from "@hexclave/shared/dist/interface/crud/contact-channels";
import { ItemCrud } from "@hexclave/shared/dist/interface/crud/items";
import { NotificationPreferenceCrud } from "@hexclave/shared/dist/interface/crud/notification-preferences";
import { OAuthProviderCrud } from "@hexclave/shared/dist/interface/crud/oauth-providers";
import type { CustomerProductsListResponse } from "@hexclave/shared/dist/interface/crud/products";
import { TeamApiKeysCrud, UserApiKeysCrud, teamApiKeysCreateOutputSchema, userApiKeysCreateOutputSchema } from "@hexclave/shared/dist/interface/crud/project-api-keys";
import { ProjectPermissionDefinitionsCrud, ProjectPermissionsCrud } from "@hexclave/shared/dist/interface/crud/project-permissions";
import { TeamInvitationCrud } from "@hexclave/shared/dist/interface/crud/team-invitation";
import { TeamMemberProfilesCrud } from "@hexclave/shared/dist/interface/crud/team-member-profiles";
import { TeamPermissionDefinitionsCrud, TeamPermissionsCrud } from "@hexclave/shared/dist/interface/crud/team-permissions";
import { TeamsCrud } from "@hexclave/shared/dist/interface/crud/teams";
import { UsersCrud } from "@hexclave/shared/dist/interface/crud/users";
import { InternalSession } from "@hexclave/shared/dist/sessions";
import { CUSTOM_TELEMETRY_MAX_PARENT_CHAIN, HTTP_CLIENT_SPAN_TYPE, LIB_SPAN_TYPE, TELEMETRY_UUID_RE } from "@hexclave/shared/dist/utils/analytics-wire";
import type { AsyncCache } from "@hexclave/shared/dist/utils/caches";
import { isBrowserLike } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { ProviderType } from "@hexclave/shared/dist/utils/oauth";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { suspend } from "@hexclave/shared/dist/utils/react";
import { Result } from "@hexclave/shared/dist/utils/results";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import { WebAuthnError, startRegistration } from "@simplewebauthn/browser";
import { useMemo } from "react"; // THIS_LINE_PLATFORM react-like
import * as yup from "yup";
import { constructRedirectUrl } from "../../../../utils/url";
import { ApiKey, ApiKeyCreationOptions, ApiKeyUpdateOptions, apiKeyCreationOptionsToCrud, apiKeyUpdateOptionsToCrud } from "../../api-keys";
import { ConvexCtx, GetCurrentUserOptions, RequestLike } from "../../common";
import { DeprecatedOAuthConnection, OAuthConnection } from "../../connected-accounts";
import { ServerContactChannel, ServerContactChannelCreateOptions, ServerContactChannelUpdateOptions, serverContactChannelCreateOptionsToCrud, serverContactChannelUpdateOptionsToCrud } from "../../contact-channels";
import { Customer, CustomerProductsList, CustomerProductsRequestOptions, InlineProduct, ServerItem } from "../../customers";
import { DataVaultStore } from "../../data-vault";
import { EmailDeliveryInfo, SendEmailOptions } from "../../email";
import { NotificationCategory } from "../../notification-categories";
import { AdminProjectPermissionDefinition, AdminTeamPermission, AdminTeamPermissionDefinition } from "../../permissions";
import { EditableTeamMemberProfile, ReceivedTeamInvitation, SentTeamInvitation, ServerListTeamsOptions, ServerListUsersOptions, ServerTeam, ServerTeamCreateOptions, ServerTeamUpdateOptions, ServerTeamUser, Team, serverTeamCreateOptionsToCrud, serverTeamUpdateOptionsToCrud } from "../../teams";
import { ProjectCurrentServerUser, ServerOAuthProvider, ServerUser, ServerUserCreateOptions, ServerUserUpdateOptions, serverUserCreateOptionsToCrud, serverUserUpdateOptionsToCrud, withUserDestructureGuard } from "../../users";
import { StackServerAppConstructorOptions } from "../interfaces/server-app";
import { _HexclaveClientAppImplIncomplete } from "./client-app-impl";
import { clientVersion, createCache, createCacheBySession, getDefaultExtraRequestHeaders, getDefaultProjectId, getDefaultPublishableClientKey, getDefaultSecretServerKey, resolveApiUrls, resolveConstructorOptions } from "./common";
import { assertValidSpanStartInput, autoDetectedBackgroundTaskHook, getCustomTelemetryNameError, preCaught, registerTelemetryBackgroundTask, rejectedPreCaught, resolveParentIds, withSpanImpl, getCustomTelemetryDataError, type Span, type SpanRef, type SpanUpdateRow, type StartSpanOptions, type TrackOptions } from "./telemetry-core";
import { buildErrorEventData, installServerErrorMonitor } from "./error-capture";
import { DEFAULT_CONSOLE_CAPTURE_LEVELS } from "./observability-config";
import { createLogger, installConsoleCapture, type LogEmitItem } from "./logs";
import { requireTelemetryResource } from "./telemetry-config";
import { createSpanHandle } from "./span-handle";
import { generateUuid } from "./telemetry-transport";
import { getAmbientSpanRefs } from "./span-context";
import { beginHttpClientSpanCore, sanitizeHttpClientUrl, shouldCaptureNetworkRequest, type HttpRequestSpanHandle } from "./network-capture";
import { installServerFetchInstrumentation } from "./server-fetch-instrumentation";
import { buildFetchInitWithSpanContext, decodeSpanContextHeader, encodeSpanContextHeader, readSpanContextHeader, SPAN_CONTEXT_HEADER, type RequestSpanInfo, type SpanPropagationContext } from "./span-propagation";
import { getServerRequestContext, runWithServerRequestContext, withExplicitServerUser, type ServerRequestSpanContext } from "./server-request-context";
import { registerLibrarySpanBridge, type BeginLibrarySpanInfo, type LibrarySpanBridgeRegistration, type LibrarySpanHandle } from "./library-span-bridge";

import { useAsyncCache } from "./common"; // THIS_LINE_PLATFORM react-like

export class _HexclaveServerAppImplIncomplete<HasTokenStore extends boolean, ProjectId extends string> extends _HexclaveClientAppImplIncomplete<HasTokenStore, ProjectId> {
  declare protected _interface: HexclaveServerInterface;

  // TODO override the client user cache to use the server user cache, so we save some requests
  private readonly _currentServerUserCache = createCacheBySession(async (session) => {
    if (session.isKnownToBeInvalid()) {
      // see comment in _currentUserCache for more details on why we do this
      return null;
    }
    return await this._interface.getServerUserByToken(session);
  });
  private readonly _serverUsersCache = createCache<[
    cursor?: string,
    limit?: number,
    orderBy?: 'signedUpAt' | 'lastActiveAt',
    desc?: boolean,
    query?: string,
    includeRestricted?: boolean,
    includeAnonymous?: boolean,
    onlyAnonymous?: boolean,
    teamId?: string,
    excludedEmailDomains?: string,
  ], UsersCrud['Server']['List']>(async ([cursor, limit, orderBy, desc, query, includeRestricted, includeAnonymous, onlyAnonymous, teamId, excludedEmailDomains]) => {
    if (onlyAnonymous && !includeAnonymous) {
      throw new HexclaveAssertionError("onlyAnonymous=true requires includeAnonymous=true");
    }
    const excludedEmailDomainList = excludedEmailDomains?.split(",");
    if (onlyAnonymous) {
      return await this._interface.listServerUsers({ cursor, limit, orderBy, desc, query, excludedEmailDomains: excludedEmailDomainList, includeRestricted, includeAnonymous: true, onlyAnonymous: true, teamId });
    }
    return await this._interface.listServerUsers({ cursor, limit, orderBy, desc, query, excludedEmailDomains: excludedEmailDomainList, includeRestricted, includeAnonymous, teamId });
  });
  private readonly _serverUserCache = createCache<string[], UsersCrud['Server']['Read'] | null>(async ([userId]) => {
    const user = await this._interface.getServerUserById(userId);
    return Result.or(user, null);
  });
  private readonly _serverTeamsCache = createCache<[
    userId?: string,
    orderBy?: 'createdAt',
    desc?: boolean,
    cursor?: string,
    limit?: number,
    query?: string,
  ], TeamsCrud['Server']['List']>(async ([userId, orderBy, desc, cursor, limit, query]) => {
    return await this._interface.listServerTeamsPaginated({ userId, orderBy, desc, cursor, limit, query });
  });
  private readonly _serverTeamCache = createCache<string[], TeamsCrud['Server']['Read'] | null>(async ([teamId]) => {
    // The previous list-and-find implementation treated unknown or malformed IDs as null; preserve that behavior without making an invalid request.
    if (!isUuid(teamId)) {
      return null;
    }
    try {
      return await this._interface.getServerTeam(teamId);
    } catch (error) {
      if (KnownErrors.TeamNotFound.isInstance(error)) {
        return null;
      }
      throw error;
    }
  });

  protected async _refreshTeamMembership(teamId: string, userId: string) {
    await Promise.all([
      this._serverTeamMemberProfilesCache.refresh([teamId]),
      this._serverTeamsCache.refreshWhere(([u]) => u === userId || u === undefined),
      this._serverUsersCache.refreshWhere((key) => key[8] === teamId),
    ]);
  }
  private readonly _serverUserTeamInvitationsCache = createCache<string[], TeamInvitationCrud['Client']['Read'][]>(async ([userId]) => {
    return await this._interface.listServerUserTeamInvitations(userId);
  });
  private readonly _serverTeamUserPermissionsCache = createCache<
    [string, string, boolean],
    TeamPermissionsCrud['Server']['Read'][]
  >(async ([teamId, userId, recursive]) => {
    return await this._interface.listServerTeamPermissions({ teamId, userId, recursive }, null);
  });
  // Bulk variant: one request returning permissions for every member of a
  // team. Used by the dashboard's team-member table to avoid N per-row
  // calls. Keyed without userId so it's a distinct cache entry from the
  // per-user lookup above.
  private readonly _serverAllTeamMemberPermissionsCache = createCache<
    [string, boolean],
    TeamPermissionsCrud['Server']['Read'][]
  >(async ([teamId, recursive]) => {
    return await this._interface.listServerTeamPermissions({ teamId, recursive }, null);
  });
  private readonly _serverUserProjectPermissionsCache = createCache<
    [string, boolean],
    ProjectPermissionsCrud['Server']['Read'][]
  >(async ([userId, recursive]) => {
    return await this._interface.listServerProjectPermissions({ userId, recursive }, null);
  });
  /** @deprecated Used by legacy getConnectedAccount(providerId) — uses old per-provider access token endpoint */
  private readonly _serverUserOAuthConnectionAccessTokensCache = createCache<[string, string, string], { accessToken: string } | null>(
    async ([userId, providerId, scope]) => {
      try {
        const result = await this._interface.createServerProviderAccessToken(userId, providerId, scope || "");
        return { accessToken: result.access_token };
      } catch (err) {
        if (!(KnownErrors.OAuthAccessTokenNotAvailable.isInstance(err) || KnownErrors.OAuthConnectionDoesNotHaveRequiredScope.isInstance(err) || KnownErrors.OAuthConnectionNotConnectedToUser.isInstance(err))) {
          throw err;
        }
      }
      return null;
    }
  );
  /** @deprecated Used by legacy getConnectedAccount(providerId) — combines token check + redirect */
  private readonly _serverUserOAuthConnectionCache = createCache<[string, ProviderType, string, boolean], DeprecatedOAuthConnection | null>(
    async ([userId, providerId, scope, redirect]) => {
      return await this._getUserOAuthConnectionCacheFn({
        getUser: async () => Result.orThrow(await this._serverUserCache.getOrWait([userId], "write-only")),
        getOrWaitOAuthToken: async () => Result.orThrow(await this._serverUserOAuthConnectionAccessTokensCache.getOrWait([userId, providerId, scope || ""] as const, "write-only")),
        // IF_PLATFORM react-like
        useOAuthToken: () => useAsyncCache(this._serverUserOAuthConnectionAccessTokensCache, [userId, providerId, scope || ""] as const, "user.useConnectedAccount()"),
        // END_PLATFORM
        providerId,
        scope,
        redirect,
        session: null,
      });
    }
  );
  private readonly _serverUserConnectedAccountsCache = createCache<[string], OAuthConnection[]>(
    async ([userId]) => {
      const result = await this._interface.listServerConnectedAccounts(userId);
      return result.items.map((item) => this._createServerOAuthConnectionFromCrudItem(userId, item));
    }
  );
  private readonly _serverUserOAuthConnectionAccessTokensByAccountCache = createCache<[string, string, string, string], { accessToken: string } | null>(
    async ([userId, providerId, providerAccountId, scope]) => {
      try {
        const result = await this._interface.createServerProviderAccessTokenByAccount(userId, providerId, providerAccountId, scope || "");
        return { accessToken: result.access_token };
      } catch (err) {
        if (!(KnownErrors.OAuthAccessTokenNotAvailable.isInstance(err) || KnownErrors.OAuthConnectionDoesNotHaveRequiredScope.isInstance(err) || KnownErrors.OAuthConnectionNotConnectedToUser.isInstance(err))) {
          throw err;
        }
      }
      return null;
    }
  );
  private readonly _serverTeamMemberProfilesCache = createCache<[string], TeamMemberProfilesCrud['Server']['Read'][]>(
    async ([teamId]) => {
      return await this._interface.listServerTeamMemberProfiles({ teamId });
    }
  );
  private readonly _serverTeamInvitationsCache = createCache<[string], TeamInvitationCrud['Server']['Read'][]>(
    async ([teamId]) => {
      return await this._interface.listServerTeamInvitations({ teamId });
    }
  );
  private readonly _serverUserTeamProfileCache = createCache<[string, string], TeamMemberProfilesCrud['Client']['Read']>(
    async ([teamId, userId]) => {
      return await this._interface.getServerTeamMemberProfile({ teamId, userId });
    }
  );
  private readonly _serverContactChannelsCache = createCache<[string], ContactChannelsCrud['Server']['Read'][]>(
    async ([userId]) => {
      return await this._interface.listServerContactChannels(userId);
    }
  );
  private readonly _serverNotificationCategoriesCache = createCache<[string], NotificationPreferenceCrud['Server']['Read'][]>(
    async ([userId]) => {
      return await this._interface.listServerNotificationCategories(userId);
    }
  );
  private readonly _serverDataVaultStoreValueCache = createCache<[string, string, string], string | null>(async ([storeId, key, secret]) => {
    return await this._interface.getDataVaultStoreValue(secret, storeId, key);
  });

  private readonly _emailDeliveryInfoCache = createCache(async () => {
    return await this._interface.getEmailDeliveryInfo();
  });

  private readonly _serverUserApiKeysCache = createCache<[string], UserApiKeysCrud['Server']['Read'][]>(
    async ([userId]) => {
      const result = await this._interface.listProjectApiKeys({
        user_id: userId,
      }, null, "server");
      return result as UserApiKeysCrud['Server']['Read'][];
    }
  );

  private readonly _serverTeamApiKeysCache = createCache<[string], TeamApiKeysCrud['Server']['Read'][]>(
    async ([teamId]) => {
      const result = await this._interface.listProjectApiKeys({
        team_id: teamId,
      }, null, "server");
      return result as TeamApiKeysCrud['Server']['Read'][];
    }
  );

  private readonly _convexIdentitySubjectCache = createCache<[ConvexCtx], string | null>(
    async ([ctx]) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? identity.subject : null;
    }
  );

  private readonly _serverCheckApiKeyCache = createCache<["user" | "team", string], UserApiKeysCrud['Server']['Read'] | TeamApiKeysCrud['Server']['Read'] | null>(async ([type, apiKey]) => {
    const result = await this._interface.checkProjectApiKey(
      type,
      apiKey,
      null,
      "server",
    );
    return result;
  });

  private readonly _serverOAuthProvidersCache = createCache<[string], OAuthProviderCrud['Server']['Read'][]>(
    async ([userId]) => {
      return await this._interface.listServerOAuthProviders({ user_id: userId });
    }
  );

  private readonly _serverTeamItemsCache = createCache<[string, string], ItemCrud['Client']['Read']>(
    async ([teamId, itemId]) => {
      return await this._interface.getItem({ teamId, itemId }, null, "server");
    }
  );

  private readonly _serverUserItemsCache = createCache<[string, string], ItemCrud['Client']['Read']>(
    async ([userId, itemId]) => {
      return await this._interface.getItem({ userId, itemId }, null, "server");
    }
  );

  private readonly _serverCustomItemsCache = createCache<[string, string], ItemCrud['Client']['Read']>(
    async ([customCustomerId, itemId]) => {
      return await this._interface.getItem({ customCustomerId, itemId }, null, "server");
    }
  );

  private readonly _serverUserProductsCache = createCache<[string, string | null, number | null], CustomerProductsListResponse>(
    async ([userId, cursor, limit]) => {
      return await this._interface.listProducts({
        customer_type: "user",
        customer_id: userId,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
      }, null, "server");
    }
  );

  private readonly _serverTeamProductsCache = createCache<[string, string | null, number | null], CustomerProductsListResponse>(
    async ([teamId, cursor, limit]) => {
      return await this._interface.listProducts({
        customer_type: "team",
        customer_id: teamId,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
      }, null, "server");
    }
  );

  private readonly _serverCustomProductsCache = createCache<[string, string | null, number | null], CustomerProductsListResponse>(
    async ([customCustomerId, cursor, limit]) => {
      return await this._interface.listProducts({
        customer_type: "custom",
        customer_id: customCustomerId,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
      }, null, "server");
    }
  );

  protected _createServerCustomer(userIdOrTeamId: string, type: "user" | "team"): Omit<Customer<true>, "id"> {
    const app = this;
    const productsCache = type === "user" ? app._serverUserProductsCache : app._serverTeamProductsCache;
    const customerOptions = type === "user" ? { userId: userIdOrTeamId } : { teamId: userIdOrTeamId };
    return {
      ...this._createCustomer(userIdOrTeamId, type, null),
      async getItem(itemId: string) {
        return await app.getItem({ itemId, ...customerOptions });
      },
      // IF_PLATFORM react-like
      useItem(itemId: string) {
        return app.useItem({ itemId, ...customerOptions });
      },
      // END_PLATFORM
      async grantProduct(productOptions: { productId: string, quantity?: number } | { product: InlineProduct, quantity?: number }) {
        if (type === "user") {
          if ("productId" in productOptions) {
            await app.grantProduct({ userId: userIdOrTeamId, productId: productOptions.productId, quantity: productOptions.quantity });
          } else {
            await app.grantProduct({ userId: userIdOrTeamId, product: productOptions.product, quantity: productOptions.quantity });
          }
        } else {
          if ("productId" in productOptions) {
            await app.grantProduct({ teamId: userIdOrTeamId, productId: productOptions.productId, quantity: productOptions.quantity });
          } else {
            await app.grantProduct({ teamId: userIdOrTeamId, product: productOptions.product, quantity: productOptions.quantity });
          }
        }
        await productsCache.refresh([userIdOrTeamId, null, null]);
      },
      async createCheckoutUrl(options: { productId: string, returnUrl?: string } | { product: InlineProduct, returnUrl?: string }) {
        const productIdOrInline = "productId" in options ? options.productId : options.product;
        return await app._interface.createCheckoutUrl(type, userIdOrTeamId, productIdOrInline, null, options.returnUrl, "server");
      },
    };
  }

  private async _updateServerUser(userId: string, update: ServerUserUpdateOptions): Promise<UsersCrud['Server']['Read']> {
    const result = await this._interface.updateServerUser(userId, serverUserUpdateOptionsToCrud(update));
    await this._refreshUsers();
    return result;
  }

  protected _serverEditableTeamProfileFromCrud(crud: TeamMemberProfilesCrud['Client']['Read']): EditableTeamMemberProfile {
    const app = this;
    return {
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      async update(update: { displayName?: string, profileImageUrl?: string }) {
        await app._interface.updateServerTeamMemberProfile({
          teamId: crud.team_id,
          userId: crud.user_id,
          profile: {
            display_name: update.displayName,
            profile_image_url: update.profileImageUrl,
          },
        });
        await app._serverUserTeamProfileCache.refresh([crud.team_id, crud.user_id]);
      }
    };
  }

  protected _serverContactChannelFromCrud(userId: string, crud: ContactChannelsCrud['Server']['Read']): ServerContactChannel {
    const app = this;
    return {
      id: crud.id,
      value: crud.value,
      type: crud.type,
      isVerified: crud.is_verified,
      isPrimary: crud.is_primary,
      usedForAuth: crud.used_for_auth,
      async sendVerificationEmail(options?: { callbackUrl?: string }) {
        await app._interface.sendServerContactChannelVerificationEmail(userId, crud.id, options?.callbackUrl ?? constructRedirectUrl(app._getUrls().emailVerification, "callbackUrl"));
      },
      async update(data: ServerContactChannelUpdateOptions) {
        await app._interface.updateServerContactChannel(userId, crud.id, serverContactChannelUpdateOptionsToCrud(data));
        await Promise.all([
          app._serverContactChannelsCache.refresh([userId]),
          app._serverUserCache.refresh([userId])
        ]);
      },
      async delete() {
        await app._interface.deleteServerContactChannel(userId, crud.id);
        await Promise.all([
          app._serverContactChannelsCache.refresh([userId]),
          app._serverUserCache.refresh([userId])
        ]);
      },
    };
  }

  protected _serverNotificationCategoryFromCrud(userId: string, crud: NotificationPreferenceCrud['Server']['Read']): NotificationCategory {
    const app = this;
    return {
      id: crud.notification_category_id,
      name: crud.notification_category_name,
      enabled: crud.enabled,
      canDisable: crud.can_disable,

      async setEnabled(enabled: boolean) {
        await app._interface.setServerNotificationsEnabled(userId, crud.notification_category_id, enabled);
        await app._serverNotificationCategoriesCache.refresh([userId]);
      },
    };
  }

  protected _serverOAuthProviderFromCrud(crud: OAuthProviderCrud['Server']['Read']) {
    const app = this;
    return {
      id: crud.id,
      type: crud.type,
      userId: crud.user_id,
      accountId: crud.account_id,
      email: crud.email,
      allowSignIn: crud.allow_sign_in,
      allowConnectedAccounts: crud.allow_connected_accounts,

      async update(data: { accountId?: string, email?: string, allowSignIn?: boolean, allowConnectedAccounts?: boolean }): Promise<Result<void,
        InstanceType<typeof KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn>
      >> {
        try {
          await app._interface.updateServerOAuthProvider(crud.user_id, crud.id, {
            account_id: data.accountId,
            email: data.email,
            allow_sign_in: data.allowSignIn,
            allow_connected_accounts: data.allowConnectedAccounts,
          });
          await Promise.all([
            app._serverOAuthProvidersCache.refresh([crud.user_id]),
            app._serverUserConnectedAccountsCache.refresh([crud.user_id]),
          ]);
          return Result.ok(undefined);
        } catch (error) {
          if (KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn.isInstance(error)) {
            return Result.error(error);
          }
          throw error;
        }
      },

      async delete() {
        await app._interface.deleteServerOAuthProvider(crud.user_id, crud.id);
        await Promise.all([
          app._serverOAuthProvidersCache.refresh([crud.user_id]),
          app._serverUserConnectedAccountsCache.refresh([crud.user_id]),
        ]);
      },
    };
  }

  constructor(options: StackServerAppConstructorOptions<HasTokenStore, ProjectId>, extraOptions?: { uniqueIdentifier?: string, checkString?: string, interface?: HexclaveServerInterface }) {
    const resolvedOptions = resolveConstructorOptions(options);

    const publishableClientKey = resolvedOptions.publishableClientKey ?? getDefaultPublishableClientKey();

    super(resolvedOptions, {
      ...extraOptions,
      interface: extraOptions?.interface ?? (() => {
        const apiUrls = resolveApiUrls(resolvedOptions.baseUrl);
        return new HexclaveServerInterface({
          getBaseUrl: () => apiUrls()[0],
          getApiUrls: apiUrls,
          projectId: resolvedOptions.projectId ?? getDefaultProjectId(),
          extraRequestHeaders: resolvedOptions.extraRequestHeaders ?? getDefaultExtraRequestHeaders(),
          clientVersion,
          ...(publishableClientKey != null ? { publishableClientKey } : {}),
          secretServerKey: resolvedOptions.secretServerKey ?? getDefaultSecretServerKey(),
        });
      })(),
    });

    // Install the outbound-fetch instrumentation and the uncaught-error
    // monitor EAGERLY at construction: requiring `hexclaveInstrumentation()`
    // glue or a first `{ request }` call for baseline server telemetry was the
    // single biggest piece of setup wiring, and a project without the
    // analytics app self-disables after the first rejected batch (see
    // _disableServerTelemetry). Construction always happens in customer module
    // scope — after frameworks like Next.js have applied their own fetch patch
    // at runtime startup — so the composition ordering documented in
    // server-fetch-instrumentation.ts still holds. Two exclusions, both
    // states the lazy install path could never reach before:
    // - browser-like environments: the CLIENT wrappers own fetch there (and
    //   when client analytics is off, nothing should patch it) — the
    //   _clientAnalytics guard inside the install methods doesn't cover
    //   analytics-disabled browser apps, so gate on the environment;
    // - projectOwnerSession-backed apps (the dashboard's per-project admin
    //   apps): they have no server key, so their batches could never be
    //   accepted — eager install would only produce doomed sends.
    if (!isBrowserLike() && !("projectOwnerSession" in this._interface.options) && this._observabilityOptions?.enabled !== false) {
      this._installServerFetchInstrumentation();
      this._installServerErrorMonitor();
      // Automatic console capture (warn+error by default), same eager-install
      // rationale as above. Server-side the delivery path is the server
      // telemetry buffer behind _emitLog, which this exclusion block already
      // guarantees can produce accepted batches (non-browser + a real server
      // key). Browser-like environments install through the client constructor
      // instead (gated on an active client analytics facade there).
      const captureConsoleLevels = this._observabilityOptions?.logs?.captureConsole ?? DEFAULT_CONSOLE_CAPTURE_LEVELS;
      if (captureConsoleLevels.length > 0) {
        installConsoleCapture({
          levels: captureConsoleLevels,
          logger: createLogger({ emit: (item) => this._emitLog(item), origin: "console" }),
          projectId: this.projectId,
          serviceName: requireTelemetryResource(this._telemetryOptions).service.name,
        });
      }
    }
  }


  protected _serverApiKeyFromCrud(crud: TeamApiKeysCrud['Client']['Read']): ApiKey<"team">;
  protected _serverApiKeyFromCrud(crud: UserApiKeysCrud['Client']['Read']): ApiKey<"user">;
  protected _serverApiKeyFromCrud(crud: yup.InferType<typeof teamApiKeysCreateOutputSchema>): ApiKey<"team", true>;
  protected _serverApiKeyFromCrud(crud: yup.InferType<typeof userApiKeysCreateOutputSchema>): ApiKey<"user", true>;
  protected _serverApiKeyFromCrud(crud: TeamApiKeysCrud['Client']['Read'] | UserApiKeysCrud['Client']['Read'] | yup.InferType<typeof teamApiKeysCreateOutputSchema> | yup.InferType<typeof userApiKeysCreateOutputSchema>): ApiKey<"user" | "team", boolean> {
    return {
      ...this._baseApiKeyFromCrud(crud),
      async revoke() {
        await this.update({ revoked: true });
      },
      update: async (options: ApiKeyUpdateOptions) => {
        await this._interface.updateProjectApiKey(
          crud.type === "team" ? { team_id: crud.team_id } : { user_id: crud.user_id },
          crud.id,
          await apiKeyUpdateOptionsToCrud(crud.type, options),
          null,
          "server");
        if (crud.type === "team") {
          await this._serverTeamApiKeysCache.refresh([crud.team_id]);
        } else {
          await this._serverUserApiKeysCache.refresh([crud.user_id]);
        }
      },
    };
  }

  protected _createServerOAuthConnectionFromCrudItem(
    userId: string,
    item: { provider: string, provider_account_id: string },
  ): OAuthConnection {
    const app = this;
    const providerId = item.provider;
    const providerAccountId = item.provider_account_id;
    return {
      id: providerId, // deprecated, for backward compat
      provider: providerId,
      providerAccountId,
      async getAccessToken(options?: { scopes?: string[] }) {
        const scopeString = options?.scopes?.join(" ") ?? "";
        const result = Result.orThrow(await app._serverUserOAuthConnectionAccessTokensByAccountCache.getOrWait([userId, providerId, providerAccountId, scopeString], "write-only"));
        if (!result) {
          const scopeDetail = scopeString ? `The requested scopes [${scopeString}] are not available on the existing token.` : "The OAuth refresh token has likely been revoked or expired.";
          return Result.error(new KnownErrors.OAuthAccessTokenNotAvailable(providerId, `${scopeDetail} The user needs to re-authorize by calling \`linkConnectedAccount\` or using \`getOrLinkConnectedAccount\`.`));
        }
        return Result.ok(result);
      },
      // IF_PLATFORM react-like
      useAccessToken(options?: { scopes?: string[] }) {
        const scopeString = options?.scopes?.join(" ") ?? "";
        const result = useAsyncCache(app._serverUserOAuthConnectionAccessTokensByAccountCache, [userId, providerId, providerAccountId, scopeString] as const, "connection.useAccessToken()");
        if (!result) {
          const scopeDetail = scopeString ? `The requested scopes [${scopeString}] are not available on the existing token.` : "The OAuth refresh token has likely been revoked or expired.";
          return Result.error(new KnownErrors.OAuthAccessTokenNotAvailable(providerId, `${scopeDetail} The user needs to re-authorize by calling \`linkConnectedAccount\` or using \`getOrLinkConnectedAccount\`.`));
        }
        return Result.ok(result);
      },
      // END_PLATFORM
    };
  }

  protected _serverUserFromCrud(crud: UsersCrud['Server']['Read']): ServerUser {
    const app = this;

    /** @deprecated The string-based overloads are deprecated. Use `getConnectedAccount({ provider, providerAccountId })` for existence check. */
    async function getConnectedAccount(id: ProviderType, options?: { scopes?: string[] }): Promise<DeprecatedOAuthConnection | null>;
    async function getConnectedAccount(id: ProviderType, options: { or: 'redirect', scopes?: string[] }): Promise<DeprecatedOAuthConnection>;
    async function getConnectedAccount(account: { provider: string, providerAccountId: string }): Promise<OAuthConnection | null>;
    async function getConnectedAccount(
      idOrAccount: ProviderType | { provider: string, providerAccountId: string },
      options?: { or?: 'redirect', scopes?: string[] }
    ): Promise<DeprecatedOAuthConnection | OAuthConnection | null> {
      const scopeString = options?.scopes?.join(" ") ?? "";

      // Check if it's the new object-based API
      if (typeof idOrAccount === 'object' && 'provider' in idOrAccount && 'providerAccountId' in idOrAccount) {
        const { provider, providerAccountId } = idOrAccount;
        // Check if the account exists in the connected accounts list
        const connectedAccounts = Result.orThrow(await app._serverUserConnectedAccountsCache.getOrWait([crud.id], "write-only"));
        const found = connectedAccounts.find(
          a => a.provider === provider && a.providerAccountId === providerAccountId
        );
        if (!found) {
          return null;
        }
        return found;
      }

      // Original behavior: by provider ID (returns first match)
      return Result.orThrow(await app._serverUserOAuthConnectionCache.getOrWait([crud.id, idOrAccount, scopeString, options?.or === 'redirect'], "write-only"));
    }

    // IF_PLATFORM react-like
    /** @deprecated The string-based overloads are deprecated. Use `useConnectedAccount({ provider, providerAccountId })` for existence check. */
    function useConnectedAccount(id: ProviderType, options?: { scopes?: string[] }): DeprecatedOAuthConnection | null;
    function useConnectedAccount(id: ProviderType, options: { or: 'redirect', scopes?: string[] }): DeprecatedOAuthConnection;
    function useConnectedAccount(account: { provider: string, providerAccountId: string }): OAuthConnection | null;
    function useConnectedAccount(
      idOrAccount: ProviderType | { provider: string, providerAccountId: string },
      options?: { or?: 'redirect', scopes?: string[] }
    ): DeprecatedOAuthConnection | OAuthConnection | null {
      const scopeString = options?.scopes?.join(" ") ?? "";

      // Check if it's the new object-based API
      if (typeof idOrAccount === 'object' && 'provider' in idOrAccount && 'providerAccountId' in idOrAccount) {
        const { provider, providerAccountId } = idOrAccount;
        // Check if the account exists in the connected accounts list
        const connectedAccounts = useAsyncCache(
          app._serverUserConnectedAccountsCache,
          [crud.id] as const,
          "user.useConnectedAccount()"
        );
        const found = connectedAccounts.find(
          a => a.provider === provider && a.providerAccountId === providerAccountId
        );
        return found ?? null;
      }

      // Original behavior: by provider ID (returns first match)
      return useAsyncCache(app._serverUserOAuthConnectionCache, [crud.id, idOrAccount, scopeString, options?.or === 'redirect'] as const, "user.useConnectedAccount()");
    }
    // END_PLATFORM

    const serverUser = withUserDestructureGuard({
      ...super._createBaseUser(crud),
      lastActiveAt: new Date(crud.last_active_at_millis),
      serverMetadata: crud.server_metadata,
      restrictedByAdminPrivateDetails: crud.restricted_by_admin_private_details,
      countryCode: crud.country_code,
      riskScores: {
        signUp: {
          bot: crud.risk_scores.sign_up.bot,
          freeTrialAbuse: crud.risk_scores.sign_up.free_trial_abuse,
        },
      },
      async setPrimaryEmail(email: string | null, options?: { verified?: boolean }) {
        await app._updateServerUser(crud.id, { primaryEmail: email, primaryEmailVerified: options?.verified });
      },
      async grantPermission(scopeOrPermissionId: Team | string, permissionId?: string): Promise<void> {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== 'string' && permissionId) {
          const scope = scopeOrPermissionId;
          await app._interface.grantServerTeamUserPermission(scope.id, crud.id, permissionId);

          for (const recursive of [true, false]) {
            await app._serverTeamUserPermissionsCache.refresh([scope.id, crud.id, recursive]);
            await app._serverAllTeamMemberPermissionsCache.refresh([scope.id, recursive]);
          }
        } else {
          const pId = scopeOrPermissionId as string;
          await app._interface.grantServerProjectPermission(crud.id, pId);

          for (const recursive of [true, false]) {
            await app._serverUserProjectPermissionsCache.refresh([crud.id, recursive]);
          }
        }
      },
      async revokePermission(scopeOrPermissionId: Team | string, permissionId?: string): Promise<void> {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== 'string' && permissionId) {
          const scope = scopeOrPermissionId;
          await app._interface.revokeServerTeamUserPermission(scope.id, crud.id, permissionId);

          for (const recursive of [true, false]) {
            await app._serverTeamUserPermissionsCache.refresh([scope.id, crud.id, recursive]);
            await app._serverAllTeamMemberPermissionsCache.refresh([scope.id, recursive]);
          }
        } else {
          const pId = scopeOrPermissionId as string;
          await app._interface.revokeServerProjectPermission(crud.id, pId);

          for (const recursive of [true, false]) {
            await app._serverUserProjectPermissionsCache.refresh([crud.id, recursive]);
          }
        }
      },
      async delete() {
        const res = await app._interface.deleteServerUser(crud.id);
        await app._refreshUsers();
        return res;
      },
      async createSession(options: { expiresInMillis?: number, isImpersonation?: boolean }) {
        // TODO this should also refresh the access token when it expires (like InternalSession)
        const tokens = await app._interface.createServerUserSession(crud.id, options.expiresInMillis ?? 1000 * 60 * 60 * 24 * 365, options.isImpersonation ?? false);
        return {
          async getTokens() {
            return tokens;
          },
        };
      },

      async getActiveSessions() {
        const sessions = await app._interface.listServerSessions(crud.id);
        return sessions.items.map((session) => app._clientSessionFromCrud(session));
      },

      async revokeSession(sessionId: string) {
        await app._interface.deleteServerSession(sessionId);
      },
      async setDisplayName(displayName: string | null) {
        return await this.update({ displayName });
      },
      async setClientMetadata(metadata: Record<string, any>) {
        return await this.update({ clientMetadata: metadata });
      },
      async setClientReadOnlyMetadata(metadata: Record<string, any>) {
        return await this.update({ clientReadOnlyMetadata: metadata });
      },
      async setServerMetadata(metadata: Record<string, any>) {
        return await this.update({ serverMetadata: metadata });
      },
      async setSelectedTeam(team: Team | string | null) {
        return await this.update({ selectedTeamId: typeof team === 'string' ? team : team?.id ?? null });
      },
      getConnectedAccount,
      useConnectedAccount, // THIS_LINE_PLATFORM react-like
      async listConnectedAccounts() {
        return Result.orThrow(await app._serverUserConnectedAccountsCache.getOrWait([crud.id], "write-only"));
      },
      // IF_PLATFORM react-like
      useConnectedAccounts() {
        return useAsyncCache(app._serverUserConnectedAccountsCache, [crud.id] as const, "user.useConnectedAccounts()");
      },
      // END_PLATFORM
      async linkConnectedAccount(): Promise<void> {
        throw new HexclaveAssertionError("linkConnectedAccount is not available for server users. OAuth flows must be initiated on the client side.");
      },
      async getOrLinkConnectedAccount(): Promise<OAuthConnection> {
        throw new HexclaveAssertionError("getOrLinkConnectedAccount is not available for server users. OAuth flows must be initiated on the client side.");
      },
      // IF_PLATFORM react-like
      useOrLinkConnectedAccount(): OAuthConnection {
        throw new HexclaveAssertionError("useOrLinkConnectedAccount is not available for server users. OAuth flows must be initiated on the client side.");
      },
      // END_PLATFORM
      selectedTeam: crud.selected_team ? app._serverTeamFromCrud(crud.selected_team) : null,
      // Unlike the app-level getTeam/useTeam (which fetch any team by id),
      // the user-scoped variants search the user's own team list on purpose:
      // they must return null for teams the user is not a member of, and some
      // callers rely on that as a membership check.
      async getTeam(teamId: string) {
        const teams = await this.listTeams();
        return teams.find((t) => t.id === teamId) ?? null;
      },
      // IF_PLATFORM react-like
      useTeam(teamId: string) {
        const teams = this.useTeams();
        return useMemo(() => {
          return teams.find((t) => t.id === teamId) ?? null;
        }, [teams, teamId]);
      },
      // END_PLATFORM
      async listTeams(options?: ServerListTeamsOptions): Promise<ServerTeam[] & { nextCursor: string | null }> {
        const result = Result.orThrow(await app._serverTeamsCache.getOrWait([crud.id, options?.orderBy, options?.desc, options?.cursor, options?.limit, options?.query] as const, "write-only"));
        const teams: any = result.items.map((t) => app._serverTeamFromCrud(t));
        teams.nextCursor = result.pagination?.next_cursor ?? null;
        return teams as any;
      },
      // IF_PLATFORM react-like
      useTeams(options?: ServerListTeamsOptions): ServerTeam[] & { nextCursor: string | null } {
        const result = useAsyncCache(app._serverTeamsCache, [crud.id, options?.orderBy, options?.desc, options?.cursor, options?.limit, options?.query] as const, "user.useTeams()");
        return useMemo(() => {
          const teams: any = result.items.map((t) => app._serverTeamFromCrud(t));
          teams.nextCursor = result.pagination?.next_cursor ?? null;
          return teams as any;
        }, [result]);
      },
      // END_PLATFORM
      createTeam: async (data: Omit<ServerTeamCreateOptions, "creatorUserId">) => {
        const team = await app._interface.createServerTeam(serverTeamCreateOptionsToCrud({
          creatorUserId: crud.id,
          ...data,
        }));
        await app._serverTeamsCache.refreshWhere(() => true);
        await app._updateServerUser(crud.id, { selectedTeamId: team.id });
        return app._serverTeamFromCrud(team);
      },
      leaveTeam: async (team: Team) => {
        await app._interface.leaveServerTeam({ teamId: team.id, userId: crud.id });
        await app._refreshTeamMembership(team.id, crud.id);
      },
      async listTeamInvitations() {
        const invitations = Result.orThrow(await app._serverUserTeamInvitationsCache.getOrWait([crud.id], "write-only"));
        return invitations.map((inv) => app._serverReceivedTeamInvitationFromCrud(crud.id, inv));
      },
      // IF_PLATFORM react-like
      useTeamInvitations() {
        const invitations = useAsyncCache(app._serverUserTeamInvitationsCache, [crud.id], "user.useTeamInvitations()");
        return useMemo(() => invitations.map((inv) => app._serverReceivedTeamInvitationFromCrud(crud.id, inv)), [invitations]);
      },
      // END_PLATFORM
      async listPermissions(scopeOrOptions?: Team | { recursive?: boolean }, options?: { recursive?: boolean }): Promise<AdminTeamPermission[]> {
        if (scopeOrOptions && 'id' in scopeOrOptions) {
          const scope = scopeOrOptions;
          const recursive = options?.recursive ?? true;
          const permissions = Result.orThrow(await app._serverTeamUserPermissionsCache.getOrWait([scope.id, crud.id, recursive], "write-only"));
          return permissions.map((crud) => app._serverPermissionFromCrud(crud));
        } else {
          const opts = scopeOrOptions;
          const recursive = opts?.recursive ?? true;
          const permissions = Result.orThrow(await app._serverUserProjectPermissionsCache.getOrWait([crud.id, recursive], "write-only"));
          return permissions.map((crud) => app._serverPermissionFromCrud(crud));
        }
      },
      // IF_PLATFORM react-like
      usePermissions(scopeOrOptions?: Team | { recursive?: boolean }, options?: { recursive?: boolean }): AdminTeamPermission[] {
        if (scopeOrOptions && 'id' in scopeOrOptions) {
          const scope = scopeOrOptions;
          const recursive = options?.recursive ?? true;
          const permissions = useAsyncCache(app._serverTeamUserPermissionsCache, [scope.id, crud.id, recursive] as const, "user.usePermissions()");
          return useMemo(() => permissions.map((crud) => app._serverPermissionFromCrud(crud)), [permissions]);
        } else {
          const opts = scopeOrOptions;
          const recursive = opts?.recursive ?? true;
          const permissions = useAsyncCache(app._serverUserProjectPermissionsCache, [crud.id, recursive] as const, "user.usePermissions()");
          return useMemo(() => permissions.map((crud) => app._serverPermissionFromCrud(crud)), [permissions]);
        }
      },
      // END_PLATFORM
      async getPermission(scopeOrPermissionId: Team | string, permissionId?: string): Promise<AdminTeamPermission | null> {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== 'string') {
          const scope = scopeOrPermissionId;
          const permissions = await this.listPermissions(scope);
          return permissions.find((p) => p.id === permissionId) ?? null;
        } else {
          const pid = scopeOrPermissionId;
          const permissions = await this.listPermissions();
          return permissions.find((p) => p.id === pid) ?? null;
        }
      },
      // IF_PLATFORM react-like
      usePermission(scopeOrPermissionId: Team | string, permissionId?: string): AdminTeamPermission | null {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== 'string') {
          const scope = scopeOrPermissionId;
          const permissions = this.usePermissions(scope);
          return useMemo(() => permissions.find((p) => p.id === permissionId) ?? null, [permissions, permissionId]);
        } else {
          const pid = scopeOrPermissionId;
          const permissions = this.usePermissions();
          return useMemo(() => permissions.find((p) => p.id === pid) ?? null, [permissions, pid]);
        }
      },
      // END_PLATFORM
      async hasPermission(scopeOrPermissionId: Team | string, permissionId?: string): Promise<boolean> {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== 'string') {
          const scope = scopeOrPermissionId;
          return (await this.getPermission(scope, permissionId as string)) !== null;
        } else {
          const pid = scopeOrPermissionId;
          return (await this.getPermission(pid)) !== null;
        }
      },
      async update(update: ServerUserUpdateOptions) {
        await app._updateServerUser(crud.id, update);
      },
      async sendVerificationEmail() {
        return await app._checkFeatureSupport("sendVerificationEmail() on ServerUser", {});
      },
      async updatePassword(options: { oldPassword: string, newPassword: string }) {
        const result = await app._interface.updatePassword(options);
        await app._serverUserCache.refresh([crud.id]);
        return result;
      },
      async setPassword(options: { password: string }) {
        const result = await this.update(options);
        await app._serverUserCache.refresh([crud.id]);
        return result;
      },
      async getTeamProfile(team: Team) {
        const result = Result.orThrow(await app._serverUserTeamProfileCache.getOrWait([team.id, crud.id], "write-only"));
        return app._serverEditableTeamProfileFromCrud(result);
      },
      // IF_PLATFORM react-like
      useTeamProfile(team: Team) {
        const result = useAsyncCache(app._serverUserTeamProfileCache, [team.id, crud.id] as const, "user.useTeamProfile()");
        return useMemo(() => app._serverEditableTeamProfileFromCrud(result), [result]);
      },
      // END_PLATFORM
      async listContactChannels() {
        const result = Result.orThrow(await app._serverContactChannelsCache.getOrWait([crud.id], "write-only"));
        return result.map((data) => app._serverContactChannelFromCrud(crud.id, data));
      },
      // IF_PLATFORM react-like
      useContactChannels() {
        const result = useAsyncCache(app._serverContactChannelsCache, [crud.id] as const, "user.useContactChannels()");
        return useMemo(() => result.map((data) => app._serverContactChannelFromCrud(crud.id, data)), [result]);
      },
      // END_PLATFORM
      createContactChannel: async (data: ServerContactChannelCreateOptions) => {
        const contactChannel = await app._interface.createServerContactChannel(serverContactChannelCreateOptionsToCrud(crud.id, data));
        await Promise.all([
          app._serverContactChannelsCache.refresh([crud.id]),
          app._serverUserCache.refresh([crud.id])
        ]);
        return app._serverContactChannelFromCrud(crud.id, contactChannel);
      },
      // IF_PLATFORM react-like
      useNotificationCategories() {
        const results = useAsyncCache(app._serverNotificationCategoriesCache, [crud.id] as const, "user.useNotificationCategories()");
        return results.map((category) => app._serverNotificationCategoryFromCrud(crud.id, category));
      },
      // END_PLATFORM
      async listNotificationCategories() {
        const results = Result.orThrow(await app._serverNotificationCategoriesCache.getOrWait([crud.id], "write-only"));
        return results.map((category) => app._serverNotificationCategoryFromCrud(crud.id, category));
      },
      // IF_PLATFORM react-like
      useApiKeys() {
        const result = useAsyncCache(app._serverUserApiKeysCache, [crud.id] as const, "user.useApiKeys()");
        return result.map((apiKey) => app._serverApiKeyFromCrud(apiKey));
      },
      // END_PLATFORM
      async listApiKeys() {
        const result = Result.orThrow(await app._serverUserApiKeysCache.getOrWait([crud.id], "write-only"));
        return result.map((apiKey) => app._serverApiKeyFromCrud(apiKey));
      },
      async createApiKey(options: ApiKeyCreationOptions<"user">) {
        const result = await app._interface.createProjectApiKey(
          await apiKeyCreationOptionsToCrud("user", crud.id, options),
          null,
          "server",
        );
        await app._serverUserApiKeysCache.refresh([crud.id]);
        return app._serverApiKeyFromCrud(result);
      },
      // IF_PLATFORM react-like
      useOAuthProviders() {
        const results = useAsyncCache(app._serverOAuthProvidersCache, [crud.id] as const, "user.useOAuthProviders()");
        return useMemo(() => results.map((oauthCrud) => app._serverOAuthProviderFromCrud(oauthCrud)), [results]);
      },
      // END_PLATFORM

      async listOAuthProviders() {
        const results = Result.orThrow(await app._serverOAuthProvidersCache.getOrWait([crud.id], "write-only"));
        return results.map((oauthCrud) => app._serverOAuthProviderFromCrud(oauthCrud));
      },

      // IF_PLATFORM react-like
      useOAuthProvider(id: string) {
        const providers = this.useOAuthProviders();
        return useMemo(() => providers.find((p) => p.id === id) ?? null, [providers, id]);
      },
      // END_PLATFORM
      async getOAuthProvider(id: string) {
        const providers = await this.listOAuthProviders();
        return providers.find((p) => p.id === id) ?? null;
      },
      async registerPasskey(options?: { hostname?: string }): Promise<Result<undefined, KnownErrors["PasskeyRegistrationFailed"] | KnownErrors["PasskeyWebAuthnError"]>> {
        // TODO remove duplicated code between this and the function in client-app-impl.ts
        const hostname = options?.hostname || (await app._getCurrentUrl())?.hostname;
        if (!hostname) {
          throw new HexclaveAssertionError("hostname must be provided if the Stack App does not have a redirect method");
        }

        // Use server interface to initiate passkey registration for this specific user
        const initiationResult = await app._interface.initiateServerPasskeyRegistration(crud.id);

        if (initiationResult.status !== "ok") {
          return Result.error(new KnownErrors.PasskeyRegistrationFailed("Failed to get initiation options for passkey registration"));
        }

        const { options_json, code } = initiationResult.data;

        // HACK: Override the rpID to be the actual domain
        if (options_json.rp.id !== "THIS_VALUE_WILL_BE_REPLACED.example.com") {
          throw new HexclaveAssertionError(`Expected returned RP ID from server to equal sentinel, but found ${options_json.rp.id}`);
        }

        options_json.rp.id = hostname;

        let attResp;
        try {
          attResp = await startRegistration({ optionsJSON: options_json });
        } catch (error: any) {
          if (error instanceof WebAuthnError) {
            return Result.error(new KnownErrors.PasskeyWebAuthnError(error.message, error.name));
          } else {
            // This should never happen
            captureError("passkey-registration-failed", error);
            return Result.error(new KnownErrors.PasskeyRegistrationFailed("Failed to start passkey registration due to unknown error"));
          }
        }

        // Create a temporary session to complete the registration
        // TODO instead of creating a new session, this should just call the endpoint in a way in which it doesn't require a session
        // (currently this shows up on session history etc... not ideal)
        const { accessToken, refreshToken } = await app._interface.createServerUserSession(crud.id, 60000 * 2, false);
        const tempSession = new InternalSession({
          accessToken,
          refreshToken,
          refreshAccessTokenCallback: async () => null,
        });

        const registrationResult = await app._interface.registerPasskey({ credential: attResp, code }, tempSession);

        await app._serverUserCache.refresh([crud.id]);
        return registrationResult;
      },
      ...app._createServerCustomer(crud.id, "user"),
    } satisfies ServerUser);

    return serverUser;
  }

  protected _serverTeamUserFromCrud(crud: TeamMemberProfilesCrud["Server"]["Read"]): ServerTeamUser {
    const teamUser = withUserDestructureGuard({
      ...this._serverUserFromCrud(crud.user),
      teamProfile: {
        displayName: crud.display_name,
        profileImageUrl: crud.profile_image_url,
      },
    } satisfies ServerTeamUser);

    return teamUser;
  }

  protected _serverSentTeamInvitationFromCrud(crud: TeamInvitationCrud['Server']['Read']): SentTeamInvitation {
    return {
      id: crud.id,
      recipientEmail: crud.recipient_email,
      expiresAt: new Date(crud.expires_at_millis),
      revoke: async () => {
        await this._interface.revokeServerTeamInvitation(crud.id, crud.team_id);
        await this._serverTeamInvitationsCache.refresh([crud.team_id]);
      },
    };
  }

  protected _serverReceivedTeamInvitationFromCrud(userId: string, crud: TeamInvitationCrud['Client']['Read']): ReceivedTeamInvitation {
    const app = this;
    return {
      id: crud.id,
      teamId: crud.team_id,
      teamDisplayName: crud.team_display_name,
      recipientEmail: crud.recipient_email,
      expiresAt: new Date(crud.expires_at_millis),
      accept: async () => {
        await app._interface.acceptServerTeamInvitationById(crud.id, userId);
        await Promise.all([
          app._serverUserTeamInvitationsCache.refresh([userId]),
          app._serverTeamInvitationsCache.refresh([crud.team_id]),
          app._refreshTeamMembership(crud.team_id, userId),
        ]);
      },
    };
  }

  protected override _currentUserFromCrud(crud: UsersCrud['Server']['Read'], session: InternalSession): ProjectCurrentServerUser<ProjectId> {
    const currentUser = withUserDestructureGuard({
      ...this._serverUserFromCrud(crud),
      ...this._createAuth(session),
      ...this._isInternalProject() ? this._createInternalUserExtra(session) : {},
    } satisfies ServerUser);

    return currentUser as ProjectCurrentServerUser<ProjectId>;
  }

  protected _serverTeamFromCrud(crud: TeamsCrud['Server']['Read']): ServerTeam {
    const app = this;
    return {
      id: crud.id,
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      createdAt: new Date(crud.created_at_millis),
      clientMetadata: crud.client_metadata,
      clientReadOnlyMetadata: crud.client_read_only_metadata,
      serverMetadata: crud.server_metadata,
      async update(update: Partial<ServerTeamUpdateOptions>) {
        await app._interface.updateServerTeam(crud.id, serverTeamUpdateOptionsToCrud(update));
        await Promise.all([
          app._serverTeamCache.refresh([crud.id]),
          app._serverTeamsCache.refreshWhere(() => true),
          app._serverUsersCache.refreshWhere(() => true),
        ]);
      },
      async delete() {
        await app._interface.deleteServerTeam(crud.id);
        await Promise.all([
          app._serverTeamCache.refresh([crud.id]),
          app._serverTeamsCache.refreshWhere(() => true),
          app._serverUsersCache.refreshWhere(() => true),
        ]);
      },
      async listUsers() {
        const result = Result.orThrow(await app._serverTeamMemberProfilesCache.getOrWait([crud.id], "write-only"));
        return result.map(u => app._serverTeamUserFromCrud(u));
      },
      // IF_PLATFORM react-like
      useUsers() {
        const result = useAsyncCache(app._serverTeamMemberProfilesCache, [crud.id] as const, "team.useUsers()");
        return useMemo(() => result.map(u => app._serverTeamUserFromCrud(u)), [result]);
      },
      // END_PLATFORM
      async addUser(userId) {
        await app._interface.addServerUserToTeam({
          teamId: crud.id,
          userId,
        });
        await app._refreshTeamMembership(crud.id, userId);
      },
      async removeUser(userId) {
        await app._interface.removeServerUserFromTeam({
          teamId: crud.id,
          userId,
        });
        await app._refreshTeamMembership(crud.id, userId);
      },
      async inviteUser(options: { email: string, callbackUrl?: string }) {
        await app._interface.sendServerTeamInvitation({
          teamId: crud.id,
          email: options.email,
          callbackUrl: options.callbackUrl ?? constructRedirectUrl(app._getUrls().teamInvitation, "callbackUrl"),
        });
        await app._serverTeamInvitationsCache.refresh([crud.id]);
      },
      async listInvitations() {
        const result = Result.orThrow(await app._serverTeamInvitationsCache.getOrWait([crud.id], "write-only"));
        return result.map((crud) => app._serverSentTeamInvitationFromCrud(crud));
      },
      // IF_PLATFORM react-like
      useInvitations() {
        const result = useAsyncCache(app._serverTeamInvitationsCache, [crud.id] as const, "team.useInvitations()");
        return useMemo(() => result.map((crud) => app._serverSentTeamInvitationFromCrud(crud)), [result]);
      },
      // END_PLATFORM
      // IF_PLATFORM react-like
      useApiKeys() {
        const result = useAsyncCache(app._serverTeamApiKeysCache, [crud.id] as const, "team.useApiKeys()");
        return result.map((apiKey) => app._serverApiKeyFromCrud(apiKey));
      },
      // END_PLATFORM
      async listApiKeys() {
        const result = Result.orThrow(await app._serverTeamApiKeysCache.getOrWait([crud.id], "write-only"));
        return result.map((apiKey) => app._serverApiKeyFromCrud(apiKey));
      },
      async createApiKey(options: ApiKeyCreationOptions<"team">) {
        const result = await app._interface.createProjectApiKey(
          await apiKeyCreationOptionsToCrud("team", crud.id, options),
          null,
          "server",
        );
        await app._serverTeamApiKeysCache.refresh([crud.id]);
        return app._serverApiKeyFromCrud(result);
      },
      ...app._createServerCustomer(crud.id, "team"),
    };
  }

  protected _serverItemFromCrud(customer: { type: "user" | "team" | "custom", id: string }, crud: ItemCrud['Client']['Read']): ServerItem {
    const app = this;
    return {
      displayName: crud.display_name,
      quantity: crud.quantity,
      nonNegativeQuantity: Math.max(0, crud.quantity),
      increaseQuantity: async (delta: number) => {
        const updateOptions = customer.type === "user"
          ? { itemId: crud.id, userId: customer.id }
          : customer.type === "team"
            ? { itemId: crud.id, teamId: customer.id }
            : { itemId: crud.id, customCustomerId: customer.id };
        await app._interface.updateItemQuantity(updateOptions, { delta });
        if (customer.type === "user") await app._serverUserItemsCache.refresh([customer.id, crud.id]);
        else if (customer.type === "team") await app._serverTeamItemsCache.refresh([customer.id, crud.id]);
        else await app._serverCustomItemsCache.refresh([customer.id, crud.id]);
      },
      decreaseQuantity: async (delta: number) => {
        const updateOptions = customer.type === "user"
          ? { itemId: crud.id, userId: customer.id }
          : customer.type === "team"
            ? { itemId: crud.id, teamId: customer.id }
            : { itemId: crud.id, customCustomerId: customer.id };
        await app._interface.updateItemQuantity(updateOptions, { delta: -delta, allow_negative: true });
        if (customer.type === "user") await app._serverUserItemsCache.refresh([customer.id, crud.id]);
        else if (customer.type === "team") await app._serverTeamItemsCache.refresh([customer.id, crud.id]);
        else await app._serverCustomItemsCache.refresh([customer.id, crud.id]);
      },
      tryDecreaseQuantity: async (delta: number) => {
        try {
          const updateOptions = customer.type === "user"
            ? { itemId: crud.id, userId: customer.id }
            : customer.type === "team"
              ? { itemId: crud.id, teamId: customer.id }
              : { itemId: crud.id, customCustomerId: customer.id };
          await app._interface.updateItemQuantity(updateOptions, { delta: -delta });
          if (customer.type === "user") await app._serverUserItemsCache.refresh([customer.id, crud.id]);
          else if (customer.type === "team") await app._serverTeamItemsCache.refresh([customer.id, crud.id]);
          else await app._serverCustomItemsCache.refresh([customer.id, crud.id]);
          return true;
        } catch (error) {
          if (error instanceof KnownErrors.ItemQuantityInsufficientAmount) {
            return false;
          }
          throw error;
        }
      },
    };
  }

  protected async _getUserApiKey(options: { apiKey: string }): Promise<ApiKey<"user"> | null> {
    const crud = Result.orThrow(await this._serverCheckApiKeyCache.getOrWait(["user", options.apiKey], "write-only")) as UserApiKeysCrud['Server']['Read'] | null;
    return crud ? this._serverApiKeyFromCrud(crud) : null;
  }

  protected async _getTeamApiKey(options: { apiKey: string }): Promise<ApiKey<"team"> | null> {
    const crud = Result.orThrow(await this._serverCheckApiKeyCache.getOrWait(["team", options.apiKey], "write-only")) as TeamApiKeysCrud['Server']['Read'] | null;
    return crud ? this._serverApiKeyFromCrud(crud) : null;
  }
  // IF_PLATFORM react-like
  protected _useUserApiKey(options: { apiKey: string }): ApiKey<"user"> | null {
    const crud = useAsyncCache(this._serverCheckApiKeyCache, ["user", options.apiKey] as const, "serverApp.useUserApiKey()") as UserApiKeysCrud['Server']['Read'] | null;
    return useMemo(() => crud ? this._serverApiKeyFromCrud(crud) : null, [crud]);
  }
  // END_PLATFORM
  // IF_PLATFORM react-like
  protected _useTeamApiKey(options: { apiKey: string }): ApiKey<"team"> | null {
    const crud = useAsyncCache(this._serverCheckApiKeyCache, ["team", options.apiKey] as const, "serverApp.useTeamApiKey()") as TeamApiKeysCrud['Server']['Read'] | null;
    return useMemo(() => crud ? this._serverApiKeyFromCrud(crud) : null, [crud]);
  }
  // END_PLATFORM
  protected async _getUserByApiKey(apiKey: string): Promise<ServerUser | null> {
    const apiKeyObject = await this._getUserApiKey({ apiKey });
    if (apiKeyObject === null) {
      return null;
    }
    return await this.getServerUserById(apiKeyObject.userId);
  }

  protected async _getUserByConvex(ctx: ConvexCtx, includeAnonymous: boolean): Promise<ServerUser | null> {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return null;
    }
    const user = await this.getServerUserById(identity.subject);
    if (user?.isAnonymous && !includeAnonymous) {
      return null;
    }
    return user;
  }
  // IF_PLATFORM react-like
  protected _useUserByConvex(ctx: ConvexCtx, includeAnonymous: boolean): ServerUser | null {
    const subject = useAsyncCache(this._convexIdentitySubjectCache, [ctx] as const, "serverApp.useUserByConvex()");
    if (subject === null) {
      return null;
    }
    const user = this.useUserById(subject);
    if (user?.isAnonymous && !includeAnonymous) {
      return null;
    }
    return user;
  }
  // END_PLATFORM
  // IF_PLATFORM react-like
  protected _useUserByApiKey(apiKey: string): ServerUser | null {
    const apiKeyObject = this._useUserApiKey({ apiKey });
    if (apiKeyObject === null) {
      return null;
    }
    return this.useUserById(apiKeyObject.userId);
  }
  // END_PLATFORM

  protected async _getTeamByApiKey(apiKey: string): Promise<ServerTeam | null> {
    const apiKeyObject = await this._getTeamApiKey({ apiKey });
    if (apiKeyObject === null) {
      return null;
    }
    return await this.getTeam(apiKeyObject.teamId);
  }
  // IF_PLATFORM react-like
  protected _useTeamByApiKey(apiKey: string): ServerTeam | null {
    const apiKeyObject = this._useTeamApiKey({ apiKey });
    if (apiKeyObject === null) {
      return null;
    }
    return this.useTeam(apiKeyObject.teamId);
  }
  // END_PLATFORM

  async createUser(options: ServerUserCreateOptions): Promise<ServerUser> {
    const crud = await this._interface.createServerUser(serverUserCreateOptionsToCrud(options));
    await this._refreshUsers();
    return this._serverUserFromCrud(crud);
  }

  async getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'redirect' }): Promise<ProjectCurrentServerUser<ProjectId>>;
  async getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'throw' }): Promise<ProjectCurrentServerUser<ProjectId>>;
  async getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'anonymous' }): Promise<ProjectCurrentServerUser<ProjectId>>;
  async getUser(options?: GetCurrentUserOptions<HasTokenStore>): Promise<ProjectCurrentServerUser<ProjectId> | null>;
  async getUser(id: string): Promise<ServerUser | null>;
  async getUser(options: { apiKey: string }): Promise<ServerUser | null>;
  async getUser(options: { from: "convex", ctx: ConvexCtx, or?: "return-null" | "anonymous" }): Promise<ServerUser | null>;
  async getUser(options?: string | GetCurrentUserOptions<HasTokenStore> | { apiKey: string } | { from: "convex", ctx: ConvexCtx }): Promise<ProjectCurrentServerUser<ProjectId> | ServerUser | null> {
    if (typeof options === "string") {
      return await this.getServerUserById(options);
    } else if (typeof options === "object" && "apiKey" in options) {
      return await this._getUserByApiKey(options.apiKey);
    } else if (typeof options === "object" && "from" in options && options.from as string === "convex") {
      return await this._getUserByConvex(options.ctx, "or" in options && options.or === "anonymous");
    } else {
      options = options as GetCurrentUserOptions<HasTokenStore> | undefined;

      // Validate that includeRestricted: false and or: 'anonymous' are mutually exclusive
      if (options?.or === 'anonymous' && options.includeRestricted === false) {
        throw new Error("Cannot use { or: 'anonymous' } with { includeRestricted: false }. Anonymous users implicitly include restricted users.");
      }

      // TODO this code is duplicated from the client app; fix that
      this._ensurePersistentTokenStore(options?.tokenStore);
      const session = await this._getSession(options?.tokenStore);
      let crud = Result.orThrow(await this._currentServerUserCache.getOrWait([session], "write-only"));
      const includeAnonymous = options?.or === "anonymous" || options?.or === "anonymous-if-exists[deprecated]";
      const includeRestricted = options?.includeRestricted === true || includeAnonymous;

      if (crud === null || (crud.is_anonymous && !includeAnonymous) || (crud.is_restricted && !includeRestricted)) {
        switch (options?.or) {
          case 'redirect': {
            if (!crud?.is_anonymous && crud?.is_restricted) {
              await this.redirectToOnboarding({ replace: true });
            } else {
              await this.redirectToSignIn({ replace: true });
            }
            // TODO: see client-app-impl. We probably want to `await neverResolve()` here instead of returning null
            break;
          }
          case 'throw': {
            throw new Error("User is not signed in but getUser was called with { or: 'throw' }");
          }
          case 'anonymous': {
            const tokens = await this._signUpAnonymously();
            return await this.getUser({ tokenStore: tokens, or: "anonymous-if-exists[deprecated]", includeRestricted: true }) ?? throwErr("Something went wrong while signing up anonymously");
          }
          case undefined:
          case "anonymous-if-exists[deprecated]":
          case "return-null": {
            return null;
          }
        }
      }

      return crud && this._currentUserFromCrud(crud, session);
    }
  }

  async getServerUser(): Promise<ProjectCurrentServerUser<ProjectId> | null> {
    console.warn("hexclaveServerApp.getServerUser is deprecated; use hexclaveServerApp.getUser instead");
    return await this.getUser();
  }

  async getServerUserById(userId: string): Promise<ServerUser | null> {
    const crud = Result.orThrow(await this._serverUserCache.getOrWait([userId], "write-only"));
    return crud && this._serverUserFromCrud(crud);
  }

  // IF_PLATFORM react-like
  useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'redirect' }): ProjectCurrentServerUser<ProjectId>;
  useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'throw' }): ProjectCurrentServerUser<ProjectId>;
  useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'anonymous' }): ProjectCurrentServerUser<ProjectId>;
  useUser(options?: GetCurrentUserOptions<HasTokenStore>): ProjectCurrentServerUser<ProjectId> | null;
  useUser(id: string): ServerUser | null;
  useUser(options: { apiKey: string }): ServerUser | null;
  useUser(options: { from: "convex", ctx: ConvexCtx, or?: "return-null" | "anonymous" }): ServerUser | null;
  useUser(options?: GetCurrentUserOptions<HasTokenStore> | string | { apiKey: string } | { from: "convex", ctx: ConvexCtx }): ProjectCurrentServerUser<ProjectId> | ServerUser | null {
    if (typeof options === "string") {
      return this.useUserById(options);
    } else if (typeof options === "object" && "apiKey" in options) {
      return this._useUserByApiKey(options.apiKey);
    } else if (typeof options === "object" && "from" in options && options.from as string === "convex") {
      return this._useUserByConvex(options.ctx, "or" in options && options.or === "anonymous");
    } else {
      options = options as GetCurrentUserOptions<HasTokenStore> | undefined;
      // TODO this code is duplicated from the client app; fix that

      // Validate that includeRestricted: false and or: 'anonymous' are mutually exclusive
      if (options?.or === 'anonymous' && options.includeRestricted === false) {
        throw new Error("Cannot use { or: 'anonymous' } with { includeRestricted: false }. Anonymous users implicitly include restricted users.");
      }

      this._ensurePersistentTokenStore(options?.tokenStore);

      const session = this._useSession(options?.tokenStore);
      let crud = useAsyncCache(this._currentServerUserCache, [session] as const, "serverApp.useUser()");
      const includeAnonymous = options?.or === "anonymous" || options?.or === "anonymous-if-exists[deprecated]";
      const includeRestricted = options?.includeRestricted === true || includeAnonymous;

      if (crud === null) {
        switch (options?.or) {
          case 'redirect': {
            runAsynchronously(this.redirectToSignIn({ replace: true }));
            suspend();
            throw new HexclaveAssertionError("suspend should never return");
          }
          case 'throw': {
            throw new Error("User is not signed in but useUser was called with { or: 'throw' }");
          }
          case 'anonymous': {
            // TODO we should think about the behavior when calling useUser (or getUser) in anonymous with a custom token store. signUpAnonymously always sets the current token store on app level, instead of the one passed to this function
            // TODO we shouldn't reload & suspend here, instead we should use a promise that resolves to the new anonymous user
            runAsynchronously(async () => {
              await this._signUpAnonymously();
              if (typeof window !== "undefined") {
                window.location.reload();
              }
            });
            suspend();
            throw new HexclaveAssertionError("suspend should never return");
          }
          case undefined:
          case "anonymous-if-exists[deprecated]":
          case "return-null": {
            // do nothing
          }
        }
      }

      return useMemo(() => {
        return crud && this._currentUserFromCrud(crud, session);
      }, [crud, session, options?.or]);
    }
  }
  // END_PLATFORM
  // IF_PLATFORM react-like
  useUserById(userId: string): ServerUser | null {
    const crud = useAsyncCache(this._serverUserCache, [userId], "serverApp.useUserById()");
    return useMemo(() => {
      return crud && this._serverUserFromCrud(crud);
    }, [crud]);
  }
  // END_PLATFORM

  async listUsers(options?: ServerListUsersOptions): Promise<ServerUser[] & { nextCursor: string | null }> {
    const excludedEmailDomains = options?.excludedEmailDomains && options.excludedEmailDomains.length > 0 ? options.excludedEmailDomains.join(",") : undefined;
    const crud = Result.orThrow(await this._serverUsersCache.getOrWait([options?.cursor, options?.limit, options?.orderBy, options?.desc, options?.query, options?.includeRestricted, options?.includeAnonymous, options?.onlyAnonymous, options?.teamId, excludedEmailDomains], "write-only"));
    const result: any = crud.items.map((j) => this._serverUserFromCrud(j));
    result.nextCursor = crud.pagination?.next_cursor ?? null;
    return result as any;
  }

  // IF_PLATFORM react-like
  useUsers(options?: ServerListUsersOptions): ServerUser[] & { nextCursor: string | null } {
    const excludedEmailDomains = options?.excludedEmailDomains && options.excludedEmailDomains.length > 0 ? options.excludedEmailDomains.join(",") : undefined;
    const crud = useAsyncCache(this._serverUsersCache, [options?.cursor, options?.limit, options?.orderBy, options?.desc, options?.query, options?.includeRestricted, options?.includeAnonymous, options?.onlyAnonymous, options?.teamId, excludedEmailDomains] as const, "serverApp.useUsers()");
    const result: any = crud.items.map((j) => this._serverUserFromCrud(j));
    result.nextCursor = crud.pagination?.next_cursor ?? null;
    return result as any;
  }
  // END_PLATFORM

  _serverPermissionFromCrud(crud: TeamPermissionsCrud['Server']['Read'] | ProjectPermissionsCrud['Server']['Read']): AdminTeamPermission {
    return {
      id: crud.id,
    };
  }

  _serverTeamPermissionDefinitionFromCrud(crud: TeamPermissionDefinitionsCrud['Admin']['Read']): AdminTeamPermissionDefinition {
    return {
      id: crud.id,
      description: crud.description,
      containedPermissionIds: crud.contained_permission_ids,
    };
  }

  _serverProjectPermissionDefinitionFromCrud(crud: ProjectPermissionDefinitionsCrud['Admin']['Read']): AdminProjectPermissionDefinition {
    return {
      id: crud.id,
      description: crud.description,
      containedPermissionIds: crud.contained_permission_ids,
    };
  }

  async getItem(options: { itemId: string, userId: string } | { itemId: string, teamId: string } | { itemId: string, customCustomerId: string }): Promise<ServerItem> {
    if ("userId" in options) {
      const result = Result.orThrow(await this._serverUserItemsCache.getOrWait([options.userId, options.itemId], "write-only"));
      return this._serverItemFromCrud({ type: "user", id: options.userId }, result);
    } else if ("teamId" in options) {
      const result = Result.orThrow(await this._serverTeamItemsCache.getOrWait([options.teamId, options.itemId], "write-only"));
      return this._serverItemFromCrud({ type: "team", id: options.teamId }, result);
    } else {
      const result = Result.orThrow(await this._serverCustomItemsCache.getOrWait([options.customCustomerId, options.itemId], "write-only"));
      return this._serverItemFromCrud({ type: "custom", id: options.customCustomerId }, result);
    }
  }

  protected async _refreshItemCache(customerType: "user" | "team" | "custom", customerId: string, itemId: string): Promise<void> {
    if (customerType === "user") {
      await this._serverUserItemsCache.refresh([customerId, itemId]);
    } else if (customerType === "team") {
      await this._serverTeamItemsCache.refresh([customerId, itemId]);
    } else {
      await this._serverCustomItemsCache.refresh([customerId, itemId]);
    }
  }

  async listProducts(options: CustomerProductsRequestOptions): Promise<CustomerProductsList> {
    if ("userId" in options) {
      const response = Result.orThrow(await this._serverUserProductsCache.getOrWait([options.userId, options.cursor ?? null, options.limit ?? null], "write-only"));
      return this._customerProductsFromResponse(response);
    } else if ("teamId" in options) {
      const response = Result.orThrow(await this._serverTeamProductsCache.getOrWait([options.teamId, options.cursor ?? null, options.limit ?? null], "write-only"));
      return this._customerProductsFromResponse(response);
    }
    const response = Result.orThrow(await this._serverCustomProductsCache.getOrWait([options.customCustomerId, options.cursor ?? null, options.limit ?? null], "write-only"));
    return this._customerProductsFromResponse(response);
  }

  // IF_PLATFORM react-like
  useItem(options: { itemId: string, userId: string } | { itemId: string, teamId: string } | { itemId: string, customCustomerId: string }): ServerItem {
    let type: "user" | "team" | "custom";
    let id: string;
    let cache: AsyncCache<[string, string], Result<ItemCrud['Client']['Read']>>;
    if ("userId" in options) {
      type = "user";
      id = options.userId;
      cache = this._serverUserItemsCache;
    } else if ("teamId" in options) {
      type = "team";
      id = options.teamId;
      cache = this._serverTeamItemsCache;
    } else {
      type = "custom";
      id = options.customCustomerId;
      cache = this._serverCustomItemsCache;
    }

    const cacheKey = [id, options.itemId] as [string, string];
    const debugLabel = "serverApp.useItem()";
    const result = useAsyncCache(cache, cacheKey, debugLabel);
    return useMemo(() => this._serverItemFromCrud({ type, id }, result), [result]);
  }
  // END_PLATFORM
  private _resolveCustomer(
    options: { userId: string } | { teamId: string } | { customCustomerId: string }
  ): { customerType: "user" | "team" | "custom", customerId: string } {
    if ("userId" in options) {
      return { customerType: "user", customerId: options.userId };
    }
    if ("teamId" in options) {
      return { customerType: "team", customerId: options.teamId };
    }
    return { customerType: "custom", customerId: options.customCustomerId };
  }

  async grantProduct(options: (
    ({ userId: string } | { teamId: string } | { customCustomerId: string }) &
    ({ productId: string } | { product: InlineProduct }) &
    { quantity?: number }
  )): Promise<void> {
    const { customerType, customerId } = this._resolveCustomer(options);

    await this._interface.grantProduct({
      customerType,
      customerId,
      productId: "productId" in options ? options.productId : undefined,
      product: "product" in options ? options.product : undefined,
      quantity: options.quantity,
    });

    const cache = customerType === "user"
      ? this._serverUserProductsCache
      : customerType === "team"
        ? this._serverTeamProductsCache
        : this._serverCustomProductsCache;
    await cache.refresh([customerId, null, null]);
  }

  async createCheckoutUrl(options: (
    ({ userId: string } | { teamId: string } | { customCustomerId: string }) &
    ({ productId: string } | { product: InlineProduct }) &
    { returnUrl?: string }
  )): Promise<string> {
    const { customerType, customerId } = this._resolveCustomer(options);

    const productIdOrInline = "productId" in options ? options.productId : options.product;
    return await this._interface.createCheckoutUrl(customerType, customerId, productIdOrInline, null, options.returnUrl, "server");
  }

  async createTeam(data: ServerTeamCreateOptions): Promise<ServerTeam> {
    const team = await this._interface.createServerTeam(serverTeamCreateOptionsToCrud(data));
    await this._serverTeamCache.refresh([team.id]);
    await this._serverTeamsCache.refreshWhere(() => true);
    return this._serverTeamFromCrud(team);
  }

  async listTeams(options?: ServerListTeamsOptions): Promise<ServerTeam[] & { nextCursor: string | null }> {
    const crud = Result.orThrow(await this._serverTeamsCache.getOrWait([undefined, options?.orderBy, options?.desc, options?.cursor, options?.limit, options?.query] as const, "write-only"));
    const teams: any = crud.items.map((t) => this._serverTeamFromCrud(t));
    teams.nextCursor = crud.pagination?.next_cursor ?? null;
    return teams as any;
  }

  // IF_PLATFORM react-like
  useTeams(options?: ServerListTeamsOptions): ServerTeam[] & { nextCursor: string | null } {
    const crud = useAsyncCache(this._serverTeamsCache, [undefined, options?.orderBy, options?.desc, options?.cursor, options?.limit, options?.query] as const, "serverApp.useTeams()");
    return useMemo(() => {
      const teams: any = crud.items.map((t) => this._serverTeamFromCrud(t));
      teams.nextCursor = crud.pagination?.next_cursor ?? null;
      return teams as any;
    }, [crud]);
  }
  // END_PLATFORM

  async listTeamMemberPermissions(teamId: string, options?: { recursive?: boolean }): Promise<{ userId: string, permissionId: string }[]> {
    const recursive = options?.recursive ?? false;
    const rows = Result.orThrow(await this._serverAllTeamMemberPermissionsCache.getOrWait([teamId, recursive] as const, "write-only"));
    return rows.map((r) => ({ userId: r.user_id, permissionId: r.id }));
  }

  // IF_PLATFORM react-like
  useTeamMemberPermissions(teamId: string, options?: { recursive?: boolean }): { userId: string, permissionId: string }[] {
    const recursive = options?.recursive ?? false;
    const rows = useAsyncCache(this._serverAllTeamMemberPermissionsCache, [teamId, recursive] as const, "serverApp.useTeamMemberPermissions()");
    return useMemo(() => rows.map((r) => ({ userId: r.user_id, permissionId: r.id })), [rows]);
  }
  // END_PLATFORM

  async getTeam(options: { apiKey: string }): Promise<ServerTeam | null>;
  async getTeam(teamId: string): Promise<ServerTeam | null>;
  async getTeam(options?: { apiKey: string } | string): Promise<ServerTeam | null> {
    if (typeof options === "object" && "apiKey" in options) {
      return await this._getTeamByApiKey(options.apiKey);
    } else {
      const teamId = options;
      if (teamId == null) {
        return null;
      }
      const team = Result.orThrow(await this._serverTeamCache.getOrWait([teamId], "write-only"));
      return team == null ? null : this._serverTeamFromCrud(team);
    }
  }

  // IF_PLATFORM react-like
  useTeam(options: { apiKey: string }): ServerTeam | null;
  useTeam(teamId: string): ServerTeam | null;
  useTeam(options?: { apiKey: string } | string): ServerTeam | null {
    if (typeof options === "object" && "apiKey" in options) {
      return this._useTeamByApiKey(options.apiKey);
    } else {
      const teamId = options;
      // "" is never a valid UUID, so the cache resolves a nullish id to null while keeping the hook call order stable.
      const team = useAsyncCache(this._serverTeamCache, [teamId ?? ""], "serverApp.useTeam()");
      return useMemo(() => {
        return team == null ? null : this._serverTeamFromCrud(team);
      }, [team]);
    }
  }
  // END_PLATFORM

  protected _createServerDataVaultStore(id: string): DataVaultStore {
    const validateOptions = (options: { secret: string }) => {
      if (typeof options.secret !== "string") throw new Error("secret must be a string, got " + typeof options.secret);
    };
    return {
      id,
      setValue: async (key, value, options) => {
        validateOptions(options);
        await this._interface.setDataVaultStoreValue(options.secret, id, key, value);
      },
      getValue: async (key, options) => {
        validateOptions(options);
        return Result.orThrow(await this._serverDataVaultStoreValueCache.getOrWait([id, key, options.secret], "write-only"));
      },
      // IF_PLATFORM react-like
      useValue: (key, options) => {
        validateOptions(options);
        return useAsyncCache(this._serverDataVaultStoreValueCache, [id, key, options.secret] as const, "store.useValue()");
      },
      // END_PLATFORM
    };
  }

  async getDataVaultStore(id: string): Promise<DataVaultStore> {
    return this._createServerDataVaultStore(id);
  }

  // IF_PLATFORM react-like
  useDataVaultStore(id: string): DataVaultStore {
    return useMemo(() => this._createServerDataVaultStore(id), [id]);
  }
  // END_PLATFORM

  async sendEmail(options: SendEmailOptions): Promise<void> {
    await this._interface.sendEmail(options);
    await this._emailDeliveryInfoCache.refresh([]);
  }

  async getEmailDeliveryStats(): Promise<EmailDeliveryInfo> {
    return Result.orThrow(await this._emailDeliveryInfoCache.getOrWait([], "write-only"));
  }

  // IF_PLATFORM react-like
  useEmailDeliveryStats(): EmailDeliveryInfo {
    return useAsyncCache(this._emailDeliveryInfoCache, [], "hexclaveServerApp.useEmailDeliveryStats()");
  }
  // END_PLATFORM

  async activateEmailCapacityBoost(): Promise<void> {
    await this._interface.activateEmailCapacityBoost();
    // Refresh the cache so UI updates immediately
    await this._emailDeliveryInfoCache.refresh([]);
  }

  async queryAnalytics(options: AnalyticsQueryOptions): Promise<AnalyticsQueryResponse> {
    return await this._interface.queryAnalytics(options);
  }

  protected override async _refreshSession(session: InternalSession) {
    await Promise.all([
      super._refreshUser(session),
      this._currentServerUserCache.refresh([session]),
    ]);
  }

  protected override async _refreshUsers() {
    await Promise.all([
      super._refreshUsers(),
      this._serverUserCache.refreshWhere(() => true),
      this._serverUsersCache.refreshWhere(() => true),
      this._serverContactChannelsCache.refreshWhere(() => true),
      this._serverOAuthProvidersCache.refreshWhere(() => true),
      this._serverUserConnectedAccountsCache.refreshWhere(() => true),
    ]);
  }

  async createOAuthProvider(options: {
    userId: string,
    providerConfigId: string,
    accountId: string,
    email: string,
    allowSignIn: boolean,
    allowConnectedAccounts: boolean,
  }): Promise<Result<ServerOAuthProvider, InstanceType<typeof KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn>>> {
    try {
      const crud = await this._interface.createServerOAuthProvider({
        user_id: options.userId,
        provider_config_id: options.providerConfigId,
        account_id: options.accountId,
        email: options.email,
        allow_sign_in: options.allowSignIn,
        allow_connected_accounts: options.allowConnectedAccounts,
      });

      await Promise.all([
        this._serverOAuthProvidersCache.refresh([options.userId]),
        this._serverUserConnectedAccountsCache.refresh([options.userId]),
      ]);
      return Result.ok(this._serverOAuthProviderFromCrud(crud));
    } catch (error) {
      if (KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn.isInstance(error)) {
        return Result.error(error);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Custom telemetry (server-key sends)
  //
  // The browser tracker (EventTracker) only exists in browser-like environments;
  // on the server there is no session to derive identity from, so trackEvent/
  // startSpan take an explicit `userId` and authenticate with the secret server
  // key. Items coalesce per (userId) in a buffer flushed on the next microtask —
  // a synchronous loop of N trackEvent calls costs one POST, not N — while every
  // call still gets its own settled-on-ack promise. `await` (or flush()) is the
  // delivery guarantee: there is no page-lifetime flush cadence on the server.
  //
  // NOTE: setGlobalSpan is app-instance-level state. Under concurrent requests
  // (one shared app instance) a global span set in one request becomes a parent
  // in all of them — prefer explicit parentIds (or span.trackEvent) on servers.
  // ---------------------------------------------------------------------------

  private readonly _serverTelemetryBuffers = new Map<string, ServerTelemetryBuffer>();
  private readonly _serverGlobalSpans = new Set<Span>();
  private readonly _serverTelemetryInFlight = new Set<Promise<void>>();
  // See the soft-cap block in setGlobalSpan.
  private _warnedServerGlobalSpanCap = false;
  // Sticky per-process off switch, set when the backend rejects a batch with
  // ANALYTICS_NOT_ENABLED. Required by the eager instrumentation install: a
  // project without the analytics app would otherwise send (and warn about) a
  // doomed batch for every outgoing fetch, forever. Mirrors the client
  // tracker's _disable().
  private _serverTelemetryDisabled = false;

  private _disableServerTelemetry(): void {
    if (this._serverTelemetryDisabled) return;
    this._serverTelemetryDisabled = true;
    this._serverTelemetryBuffers.clear();
    console.warn("Hexclave analytics: the Analytics app is not enabled for this project, so server telemetry is disabled for this process. Enable it in the Hexclave dashboard to collect events, spans, and logs.");
  }

  override trackEvent(eventType: string, data?: Record<string, unknown>, options?: TrackOptions & { userId?: string, request?: RequestLike }): Promise<void> {
    if (this._analyticsOptions?.enabled === false) {
      return rejectedPreCaught("analytics is disabled");
    }
    if (this._clientAnalytics) {
      // Browser-like environment: identity comes from the session; an explicit
      // userId would silently mis-attribute, so refuse it loudly. `request` is a
      // server-only concern (the browser auto-attaches it to outgoing fetches),
      // so it is simply ignored here.
      if (options?.userId !== undefined) {
        return rejectedPreCaught("userId is only supported for server-key telemetry; in the browser, events are attributed to the signed-in user");
      }
      return this._clientAnalytics.trackCustomEvent(eventType, data, options);
    }
    // `{ request }`: resolve the caller's session + client-propagated span context
    // (async) and run the send with that context ambient, so the event parents
    // under the client session ($refresh-token/$session-replay/$session-replay-segment).
    if (options?.request) {
      this._installServerFetchInstrumentation();
      this._installServerErrorMonitor();
      const { request, ...rest } = options;
      return (async () => {
        const context = await this._resolveServerRequestContext(request, options.userId ?? null);
        await runWithServerRequestContext(context, () => this._trackServerEvent(eventType, data, rest, context.userId));
      })();
    }
    // No explicit request: if a framework registered an ambient request
    // provider (hexclaveInstrumentation in Next.js) and we are not already
    // inside a `{ request }` scope, attribute via the framework's ambient
    // request — this is what makes bare `trackEvent` calls in route handlers
    // parent under the caller's session with zero wiring.
    if (this._ambientRequestProvider !== null && getServerRequestContext() === null) {
      return preCaught(this._runWithAmbientRequestScope(options?.userId ?? null, (userId) =>
        this._trackServerEvent(eventType, data, options, userId)));
    }
    return this._trackServerEvent(eventType, data, options, options?.userId ?? null);
  }

  override withSpan<T>(spanType: string, fn: (span: Span) => Promise<T> | T): Promise<T>;
  override withSpan<T>(spanType: string, options: StartSpanOptions & { userId?: string, request?: RequestLike }, fn: (span: Span) => Promise<T> | T): Promise<T>;
  override withSpan<T>(
    spanType: string,
    optionsOrFn: (StartSpanOptions & { userId?: string, request?: RequestLike }) | ((span: Span) => Promise<T> | T),
    maybeFn?: (span: Span) => Promise<T> | T,
  ): Promise<T> {
    const options = typeof optionsOrFn === "function" ? undefined : optionsOrFn;
    const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
    // No request (or browser): the inherited withSpan handles global/enclosing
    // ambient parenting and forwards userId to the server startSpan at runtime.
    if (!options?.request || this._clientAnalytics) {
      // Framework-ambient fallback (see trackEvent): a bare server withSpan
      // outside any `{ request }` scope adopts the framework's ambient request
      // when a provider is registered, so route-handler code never threads the
      // request by hand. Nested withSpan calls inside an existing scope keep
      // the fast inherited path — the ALS context already attributes them.
      if (!this._clientAnalytics && typeof fn === "function" && this._ambientRequestProvider !== null && getServerRequestContext() === null) {
        return this._runWithAmbientRequestScope(options?.userId ?? null, (userId) =>
          withSpanImpl((type, opts) => this._startServerSpan(type, opts, userId), spanType, options ?? {}, fn));
      }
      return super.withSpan(spanType, optionsOrFn as any, maybeFn as any);
    }
    // First `{ request }` scope on this app: also install the outbound-fetch
    // instrumentation (lazy so apps that never use request telemetry don't
    // patch global fetch) and the uncaught-error monitor beside it.
    this._installServerFetchInstrumentation();
    this._installServerErrorMonitor();
    const { request, ...rest } = options;
    return (async () => {
      const context = await this._resolveServerRequestContext(request, options.userId ?? null);
      return await runWithServerRequestContext(context, () =>
        withSpanImpl((type, opts) => this._startServerSpan(type, opts, context.userId), spanType, rest, fn));
    })();
  }

  /**
   * Resolves an incoming request into the ambient span context for a `{ request }`
   * server span: the caller's user + refresh token from the session (server-trusted)
   * and the client-propagated replay/segment/custom-parent ids from the
   * `x-hexclave-span-context` header (untrusted labels — dropped if they name a
   * different project). A valid unauthenticated request resolves to an empty
   * session; request parsing and session-resolution failures propagate.
   */
  private async _resolveServerRequestContext(request: RequestLike, explicitUserId: string | null): Promise<ServerRequestSpanContext> {
    let userId: string | null = null;
    let refreshTokenId: string | null = null;
    // Deduplication note (verified): the framework adapters resolve the session
    // for `getUser({ tokenStore: request })` as well, but the two paths share
    // state rather than doubling work — `_getOrCreateTokenStore` memoizes the
    // token store per request object (`_requestTokenStores` WeakMap) and
    // `_getSessionFromTokenStore` memoizes the InternalSession per (store,
    // session key), so both resolve to the SAME session instance. The forced
    // `fetchNewTokens()` below (deliberate: it round-trips the refresh token,
    // so the derived userId is server-verified rather than trusted from a
    // client-supplied access token) installs its fresh access token into that
    // shared session, which means the adapter's subsequent user fetch hits the
    // session's token cache instead of refreshing again. Concurrent refreshes
    // additionally coalesce on the session's internal _refreshPromise.
    const session = await this._getSession(request);
    const tokens = await session.fetchNewTokens();
    if (tokens?.refreshToken != null) {
      refreshTokenId = tokens.accessToken.payload.refresh_token_id;
      userId = tokens.accessToken.payload.sub;
    }
    const decoded = decodeSpanContextHeader(readSpanContextHeader(request.headers));
    const sameProject = decoded !== null && decoded.projectId === this.projectId ? decoded : null;
    return withExplicitServerUser({
      userId,
      refreshTokenId,
      sessionReplayId: sameProject?.sessionReplayId ?? null,
      sessionReplaySegmentId: sameProject?.sessionReplaySegmentId ?? null,
      pageViewSpanId: sameProject?.pageViewSpanId ?? null,
      httpClientSpanId: sameProject?.httpClientSpanId ?? null,
      customParentSpanIds: sameProject?.customParentSpanIds ?? [],
    }, explicitUserId);
  }

  // Framework-registered ambient request provider (hexclaveInstrumentation in
  // the Next.js integration): returns the current request's RequestLike when
  // called inside a request scope, null otherwise. Single slot with replace
  // semantics — one framework owns a runtime's ambient requests.
  private _ambientRequestProvider: (() => Promise<RequestLike | null>) | null = null;
  private _warnedAmbientRequestResolveFailure = false;

  /** See getServerAppInstrumentation. Public-but-underscored. */
  _setAmbientRequestProvider(provider: (() => Promise<RequestLike | null>) | null): void {
    this._ambientRequestProvider = provider;
  }

  /**
   * Runs `fn` inside the framework's ambient request scope, if one can be
   * resolved: provider yields a request → session + propagation header are
   * resolved exactly like an explicit `{ request }`. Every failure mode
   * degrades to running `fn` WITHOUT request context (with a warn-once for
   * genuine errors) — a bare telemetry call must never fail harder than it
   * did before ambient attribution existed, since the caller never opted into
   * request semantics.
   */
  private async _runWithAmbientRequestScope<T>(explicitUserId: string | null, fn: (userId: string | null) => Promise<T>): Promise<T> {
    let request: RequestLike | null = null;
    try {
      request = await (this._ambientRequestProvider?.() ?? null);
    } catch (error) {
      this._warnAmbientRequestResolveFailureOnce(error);
    }
    if (request !== null) {
      let context: ServerRequestSpanContext | null = null;
      try {
        context = await this._resolveServerRequestContext(request, explicitUserId);
      } catch (error) {
        this._warnAmbientRequestResolveFailureOnce(error);
      }
      if (context !== null) {
        const resolved = context;
        return await runWithServerRequestContext(resolved, () => fn(resolved.userId));
      }
    }
    return await fn(explicitUserId);
  }

  private _warnAmbientRequestResolveFailureOnce(error: unknown): void {
    if (this._warnedAmbientRequestResolveFailure) return;
    this._warnedAmbientRequestResolveFailure = true;
    console.warn("Hexclave analytics: could not resolve the ambient request for telemetry attribution; continuing without request context:", error);
  }

  /**
   * The batch context an item is buffered/attributed under: the ambient request
   * context when inside a `{ request }` scope, else just the explicit userId. A
   * later explicit userId always wins over the request-derived one.
   */
  private _currentServerBatchContext(explicitUserId: string | null): ServerRequestSpanContext {
    const ambient = getServerRequestContext();
    if (ambient) {
      return withExplicitServerUser(ambient, explicitUserId);
    }
    return { userId: explicitUserId, refreshTokenId: null, sessionReplayId: null, sessionReplaySegmentId: null, pageViewSpanId: null, httpClientSpanId: null, customParentSpanIds: [] };
  }

  override startSpan(spanType: string, options?: StartSpanOptions & { userId?: string }): Span {
    if (this._observabilityOptions?.enabled === false) {
      return super.startSpan(spanType, options);
    }
    if (this._clientAnalytics) {
      if (options?.userId !== undefined) {
        throw new Error("Hexclave analytics: userId is only supported for server-key telemetry; in the browser, spans are attributed to the signed-in user");
      }
      return this._clientAnalytics.startSpan(spanType, options);
    }
    return this._startServerSpan(spanType, options, options?.userId ?? null);
  }

  override setGlobalSpan(span: Span): void {
    if (this._clientAnalytics) {
      this._clientAnalytics.setGlobalSpan(span);
      return;
    }
    if (span.isEnded) {
      console.warn("Hexclave analytics: setGlobalSpan() called with an already-ended span; ignoring");
      return;
    }
    const existing = [...this._serverGlobalSpans].filter((candidate) => !candidate.isEnded).map((candidate) => candidate.ref());
    const resolved = resolveParentIds({ ambient: [...existing, span.ref()] });
    if ("error" in resolved) {
      throw new Error(`Hexclave analytics: ${resolved.error}`);
    }
    this._serverGlobalSpans.add(span);
    // Soft cap, mirroring the client tracker's registries: global spans are
    // app-instance state on the server, so a long-lived process registering
    // never-ended globals would otherwise leak without bound. Beyond the cap
    // the OLDEST span stops being an ambient parent (its row stays valid
    // server-side); warned once per app instance so loops cannot spam.
    if (this._serverGlobalSpans.size > SERVER_GLOBAL_SPAN_SOFT_CAP) {
      const oldest = this._serverGlobalSpans.values().next();
      if (!oldest.done) this._serverGlobalSpans.delete(oldest.value);
      if (!this._warnedServerGlobalSpanCap) {
        this._warnedServerGlobalSpanCap = true;
        console.warn(`Hexclave analytics: more than ${SERVER_GLOBAL_SPAN_SOFT_CAP} global spans are registered; dropping the oldest ones (their rows remain valid, but they stop being ambient parents). End or clear global spans you no longer need.`);
      }
    }
  }

  override clearGlobalSpan(span: Span): void {
    this._clientAnalytics?.clearGlobalSpan(span);
    this._serverGlobalSpans.delete(span);
  }

  override async flush(): Promise<void> {
    await super.flush();
    for (const buffer of [...this._serverTelemetryBuffers.values()]) {
      this._flushServerTelemetry(buffer.context);
    }
    await Promise.allSettled([...this._serverTelemetryInFlight]);
  }

  private _serverAmbientParentRefs(): SpanRef[] {
    const refs: SpanRef[] = [];
    for (const span of this._serverGlobalSpans) {
      if (!span.isEnded) refs.push(span.ref());
    }
    // Enclosing withSpan() frames — AsyncLocalStorage on servers, isolated per
    // request. If ALS is somehow unavailable, fail closed: only prologue-open
    // sync-stack frames count (never another flow's suspended frame).
    refs.push(...getAmbientSpanRefs());
    return refs;
  }

  /**
   * The client-propagated custom parents (raw uuids from the request's
   * span-context header — global spans + enclosing client withSpan frames,
   * already resolved as one farthest-to-nearest path by the sender) FIRST, then
   * `_serverAmbientParentRefs`: the client ancestry is the outer context a
   * server span nests inside, so the merged root-first list reads
   * client-chain → server frames → explicit parents. All of these are leaf
   * frames in parent resolution, so `root: true` drops them together. The
   * system ancestry (`rti-`/`sri-`/`srsi-`) is NOT here — it is composed
   * server-side from the batch context's scalar ids, so it survives `root`
   * (attribution to the session is always kept).
   */
  private _ambientParentRefsWith(batchContext: ServerRequestSpanContext): SpanRef[] {
    const propagatedParents = batchContext.customParentSpanIds;
    const propagatedLeaf = propagatedParents.at(-1);
    return [
      ...propagatedLeaf === undefined ? [] : [{
        spanId: propagatedLeaf,
        parentSpanIds: propagatedParents.slice(0, -1),
      }],
      ...this._serverAmbientParentRefs(),
    ];
  }

  private _trackServerEvent(eventType: string, data: Record<string, unknown> | undefined, options: TrackOptions | undefined, userId: string | null): Promise<void> {
    if (this._analyticsOptions?.enabled === false) {
      return rejectedPreCaught("analytics is disabled");
    }
    const nameError = getCustomTelemetryNameError("event", eventType);
    if (nameError) return rejectedPreCaught(nameError);
    return this._trackServerEventUnvalidatedType(eventType, data, options, userId);
  }

  /**
   * The name-validation-free core of _trackServerEvent, so SDK-internal system
   * events (`$`-prefixed, e.g. the `$error` sent by framework
   * instrumentation's onRequestError, or the `$log` events behind app.logger)
   * share the exact buffering/attribution path as custom events. Everything
   * else — data validation, userId validation, parent resolution — still
   * applies. `logFields` carries the `$log`-only wire fields (route-enforced:
   * required on $log items, forbidden elsewhere).
   */
  private _trackServerEventUnvalidatedType(eventType: string, data: Record<string, unknown> | undefined, options: TrackOptions | undefined, userId: string | null, logFields?: { message: string, level: string }): Promise<void> {
    if (this._serverTelemetryDisabled) {
      return rejectedPreCaught("analytics is not enabled for this project");
    }
    const dataError = getCustomTelemetryDataError(data);
    if (dataError) return rejectedPreCaught(dataError);
    if (userId !== null && !SERVER_TELEMETRY_UUID_RE.test(userId)) {
      return rejectedPreCaught(`Invalid userId ${JSON.stringify(userId)}: must be a user uuid`);
    }
    const batchContext = this._currentServerBatchContext(userId);
    const resolved = resolveParentIds({
      explicit: options?.parentIds,
      ambient: this._ambientParentRefsWith(batchContext),
      root: options?.root,
      exclude: options?.excludeParentIds,
    });
    if ("error" in resolved) return rejectedPreCaught(resolved.error);

    let settler!: TelemetrySettler;
    const promise = preCaught(new Promise<void>((resolve, reject) => {
      settler = { resolve, reject };
    }));
    const httpClientSpanId = httpClientSpanIdForServerItem(batchContext, resolved.ids);
    const buffer = this._getServerTelemetryBuffer(batchContext);
    buffer.events.push({
      event: {
        event_type: eventType,
        event_at_ms: Date.now(),
        data: { ...data ?? {} },
        ...logFields ?? {},
        ...resolved.ids.length > 0 ? { parent_span_ids: resolved.ids } : {},
        ...batchContext.pageViewSpanId !== null ? { page_view_span_id: batchContext.pageViewSpanId } : {},
        ...httpClientSpanId !== null ? { http_client_span_id: httpClientSpanId } : {},
      },
      settler,
    });
    this._afterServerTelemetryEnqueue(batchContext, buffer);
    return promise;
  }

  private _startServerSpan(spanType: string, options: StartSpanOptions | undefined, userId: string | null): Span {
    assertValidSpanStartInput(spanType, options);
    if (userId !== null && !SERVER_TELEMETRY_UUID_RE.test(userId)) {
      throw new Error(`Hexclave analytics: invalid userId ${JSON.stringify(userId)}: must be a user uuid`);
    }
    const batchContext = this._currentServerBatchContext(userId);
    const resolved = resolveParentIds({
      explicit: options?.parentIds,
      ambient: this._ambientParentRefsWith(batchContext),
      root: options?.root,
      exclude: options?.excludeParentIds,
    });
    if ("error" in resolved) {
      throw new Error(`Hexclave analytics: ${resolved.error}`);
    }

    // `handle` is assigned synchronously below; the closures can only fire after.
    let handle!: { span: Span, markInert: () => void };
    handle = createSpanHandle({
      spanId: generateUuid(),
      spanType,
      startedAtMs: options?.startedAtMs ?? Date.now(),
      parentSpanIds: resolved.ids,
      pageViewSpanId: batchContext.pageViewSpanId,
      initialData: { ...options?.data ?? {} },
      validateData: getCustomTelemetryDataError,
      // No isSuppressed / live-control registry on the server: there is no
      // sign-out rotation to inert-ify against — the buffer context is frozen
      // per span instead. The analytics-not-enabled disable is enforced at the
      // enqueue seam (_enqueueServerSpanUpdate), not per handle.
      enqueueRow: (row) => this._enqueueServerSpanUpdate(batchContext, row),
      onEnded: () => this._serverGlobalSpans.delete(handle.span),
      capabilities: {
        trackEvent: (eventType, data, trackOptions) => this._trackServerEvent(eventType, data, trackOptions, userId),
        startChildSpan: (childType, childOptions) => this._startServerSpan(childType, childOptions, userId),
        // Pinned to exactly this span's frozen chain; carries the caller's segment
        // identity when this span was resolved from a request. Raw ids — the
        // receiving backend applies the prefixes.
        getSpanPropagationHeaders: (span) => ({
          [SPAN_CONTEXT_HEADER]: encodeSpanContextHeader({
            projectId: this.projectId,
            ...batchContext.sessionReplayId ? { sessionReplayId: batchContext.sessionReplayId } : {},
            ...batchContext.sessionReplaySegmentId ? { sessionReplaySegmentId: batchContext.sessionReplaySegmentId } : {},
            ...batchContext.pageViewSpanId ? { pageViewSpanId: batchContext.pageViewSpanId } : {},
            customParentSpanIds: [...span.ref().parentSpanIds, span.spanId],
          }),
        }),
        // Server runtimes do not have a browser-like current origin, so
        // span.fetch attaches the header only for the propagation origin
        // policy (explicit allowedOrigins + the trusted-domain defaults) and
        // otherwise fails closed instead of leaking context to arbitrary
        // third-party URLs. Use getSpanPropagationHeaders() explicitly for a
        // trusted target outside that policy.
        fetch: (span, input, init) => {
          try {
            const policy = this._getPropagationOriginPolicy();
            const initWithHeader = buildFetchInitWithSpanContext({
              input,
              init,
              headerValue: span.getSpanPropagationHeaders()[SPAN_CONTEXT_HEADER],
              selfOrigin: null,
              allowedOrigins: policy.allowedOrigins,
              allowLocalhost: policy.allowLocalhost,
            });
            return globalThis.fetch(input, initWithHeader ?? init);
          } catch {
            return globalThis.fetch(input, init);
          }
        },
      },
    });
    return handle.span;
  }

  private _enqueueServerSpanUpdate(context: ServerRequestSpanContext, row: SpanUpdateRow): Promise<void> {
    if (this._serverTelemetryDisabled) {
      return rejectedPreCaught("analytics is not enabled for this project");
    }
    let settler!: TelemetrySettler;
    const promise = preCaught(new Promise<void>((resolve, reject) => {
      settler = { resolve, reject };
    }));
    // `$http-client` spans ARE the bridge nodes and must never point at
    // themselves (the batch route 400s such rows); every other span follows
    // the nearest-known-ancestor contract.
    const httpClientSpanId = row.span_type === HTTP_CLIENT_SPAN_TYPE ? null : httpClientSpanIdForServerItem(context, row.parent_span_ids);
    const stampedRow: SpanUpdateRow = {
      ...row,
      ...httpClientSpanId !== null ? { http_client_span_id: httpClientSpanId } : {},
    };
    const buffer = this._getServerTelemetryBuffer(context);
    const previous = buffer.spans.get(stampedRow.span_id);
    // Latest row per span id wins within a batch; superseded rows' settlers ride
    // along so every returned promise settles with the batch that ships.
    buffer.spans.set(stampedRow.span_id, { row: stampedRow, settlers: [...previous?.settlers ?? [], settler] });
    this._afterServerTelemetryEnqueue(context, buffer);
    return promise;
  }

  private _getServerTelemetryBuffer(context: ServerRequestSpanContext): ServerTelemetryBuffer {
    // Coalesce by the full batch context, not just userId: telemetry from two
    // requests (even the same user) that carry different client-session context
    // must ship as separate batches so each row gets the right ancestry.
    const key = serializeServerBatchKey(context);
    let buffer = this._serverTelemetryBuffers.get(key);
    if (!buffer) {
      buffer = { events: [], spans: new Map(), scheduled: false, context };
      this._serverTelemetryBuffers.set(key, buffer);
    }
    return buffer;
  }

  private _afterServerTelemetryEnqueue(context: ServerRequestSpanContext, buffer: ServerTelemetryBuffer): void {
    // Stay well under the server's 500-items-per-batch cap: ship immediately once
    // the coalesced batch is large, otherwise wait for the microtask boundary.
    if (buffer.events.length + buffer.spans.size >= SERVER_TELEMETRY_MAX_ITEMS_PER_BATCH) {
      this._flushServerTelemetry(context);
      return;
    }
    if (buffer.scheduled) return;
    buffer.scheduled = true;
    queueMicrotask(() => this._flushServerTelemetry(context));
  }

  private _flushServerTelemetry(context: ServerRequestSpanContext): void {
    const key = serializeServerBatchKey(context);
    const buffer = this._serverTelemetryBuffers.get(key);
    if (!buffer) return;
    this._serverTelemetryBuffers.delete(key);
    const events = buffer.events;
    const spanEntries = [...buffer.spans.values()];
    if (events.length === 0 && spanEntries.length === 0) return;

    const settlers: TelemetrySettler[] = events.map((entry) => entry.settler);
    for (const entry of spanEntries) {
      settlers.push(...entry.settlers);
    }

    const ctx = buffer.context;
    const payload = {
      // Versions the BATCH BODY (shape of the envelope + rows), the same way
      // the span-context header versions itself with its `v1.` prefix. The
      // backend tolerates unknown fields today; a future route can dispatch on
      // this instead of sniffing shapes.
      schema_version: 2,
      resource: requireTelemetryResource(this._telemetryOptions),
      batch_id: generateUuid(),
      sent_at_ms: Date.now(),
      ...ctx.userId !== null ? { user_id: ctx.userId } : {},
      // Resolved request context (server auth): the backend composes the
      // $refresh-token/$session-replay/$session-replay-segment ancestry from these.
      ...ctx.refreshTokenId !== null ? { refresh_token_id: ctx.refreshTokenId } : {},
      ...ctx.sessionReplayId !== null ? { session_replay_id: ctx.sessionReplayId } : {},
      ...ctx.sessionReplaySegmentId !== null ? { session_replay_segment_id: ctx.sessionReplaySegmentId } : {},
      ...events.length > 0 ? { events: events.map((entry) => entry.event) } : {},
      ...spanEntries.length > 0 ? { spans: spanEntries.map((entry) => entry.row) } : {},
    };

    const send = (async () => {
      try {
        const res = await this._interface.sendAnalyticsEventBatchAsServer(JSON.stringify(payload));
        if (res.status === "error") {
          for (const settler of settlers) settler.reject(res.error);
          // Sticky disable on the analytics-app-not-enabled rejection, matched
          // on the KnownErrors code in the error text (the server transport
          // wraps the non-ok Response into an Error message rather than a
          // parsed KnownError). Required by the eager instrumentation install:
          // without it, a project without the analytics app would send a
          // doomed batch per outgoing fetch, forever.
          if (isAnalyticsNotEnabledFailureText(res.error instanceof Error ? res.error.message : String(res.error))) {
            this._disableServerTelemetry();
            return;
          }
          console.warn("Hexclave analytics: server telemetry send failed:", res.error);
          return;
        }
        if (!res.data.ok) {
          const text = await res.data.text();
          for (const settler of settlers) settler.reject(new Error(`Hexclave analytics: server telemetry send failed: ${res.data.status} ${text}`));
          // Same sticky disable as the error-result branch above (which body
          // shape arrives depends on the transport's wrapping).
          if (isAnalyticsNotEnabledFailureText(text)) {
            this._disableServerTelemetry();
            return;
          }
          console.warn("Hexclave analytics: server telemetry send failed:", res.data.status, text);
          return;
        }
        for (const settler of settlers) settler.resolve();
      } catch (error) {
        for (const settler of settlers) settler.reject(error);
        console.warn("Hexclave analytics: server telemetry send failed:", error);
      }
    })();
    const tracked: Promise<void> = send.finally(() => {
      this._serverTelemetryInFlight.delete(tracked);
    });
    this._serverTelemetryInFlight.add(tracked);
    // Serverless keep-alive (TelemetryOptions.waitUntil): un-awaited sends must
    // survive runtime teardown. Without an explicit hook, fall back to the
    // auto-detected platform hook (currently Vercel's request context) so the
    // common serverless setup needs no wiring at all.
    registerTelemetryBackgroundTask(this._telemetryOptions?.waitUntil ?? autoDetectedBackgroundTaskHook, tracked, "server telemetry");
  }

  // ---------------------------------------------------------------------------
  // Server outbound fetch instrumentation (cross-tier bridge, server→server)
  // ---------------------------------------------------------------------------

  private _serverFetchInstrumentationInstalled = false;

  /**
   * Installs the server-side outbound `fetch` instrumentation: one
   * `$http-client` span per outgoing request (through the server telemetry
   * buffer, parented by the ambient ALS request context) and the span-context
   * header + traceparent for allowlisted origins. Idempotent per app instance;
   * called lazily on the first `withSpan({ request })` / `trackEvent({ request })`
   * — or eagerly by framework glue (see hexclaveInstrumentation in the Next.js
   * integration). Public-but-underscored: reached via
   * getServerAppInstrumentation, not part of the documented app surface.
   */
  _installServerFetchInstrumentation(): void {
    if (this._serverFetchInstrumentationInstalled) return;
    this._serverFetchInstrumentationInstalled = true;
    // Browser-like environment: the client wrappers already own fetch — a
    // second, server-flavored provider would double-instrument every request.
    if (this._clientAnalytics) return;
    if (this._observabilityOptions?.enabled === false) return;
    installServerFetchInstrumentation({
      projectId: this.projectId,
      provider: {
        getContext: () => this._getServerSpanPropagationContext(),
        // Same-origin has no meaning server-side (there is no page origin the
        // process "is on"), so the header policy is the explicit
        // allowedOrigins plus the trusted-domain-derived defaults (the
        // project's own app domains — the same policy the browser uses). We
        // deliberately do NOT bypass the origin policy for this automatic
        // wrapper — bypassing is reserved for explicit span.fetch, where the
        // call itself expresses intent; auto-attaching the context to every
        // third-party URL a server talks to would leak session labels.
        getSelfOrigin: () => null,
        getAllowedOrigins: () => this._getPropagationOriginPolicy().allowedOrigins,
        getAllowLocalhostOrigins: () => this._getPropagationOriginPolicy().allowLocalhost,
        beginRequestSpan: (info) => this._beginServerHttpRequestSpan(info),
      },
    });
  }

  /**
   * The context an outgoing SERVER request forwards (server→server hop):
   * meaningful only inside a `{ request }` scope, where the ambient ALS
   * context carries the ORIGINAL caller's identity. The incoming request's own
   * httpClientSpanId is intentionally NOT forwarded — it names the browser→
   * server hop; the wrapper adds the NEW span's id for this hop instead.
   */
  private _getServerSpanPropagationContext(): SpanPropagationContext | null {
    if (this._observabilityOptions?.spanPropagation?.enabled === false) return null;
    const ambient = getServerRequestContext();
    if (ambient === null) return null;
    const resolved = resolveParentIds({ ambient: this._ambientParentRefsWith(ambient) });
    const chain = "error" in resolved ? [] : resolved.ids;
    return {
      projectId: this.projectId,
      ...ambient.sessionReplayId !== null ? { sessionReplayId: ambient.sessionReplayId } : {},
      ...ambient.sessionReplaySegmentId !== null ? { sessionReplaySegmentId: ambient.sessionReplaySegmentId } : {},
      ...ambient.pageViewSpanId !== null ? { pageViewSpanId: ambient.pageViewSpanId } : {},
      ...chain.length > 0 ? { customParentSpanIds: chain } : {},
    };
  }

  /**
   * Server-side `$http-client` span factory (the fetch wrapper's
   * beginRequestSpan). Same config gates and keep/drop semantics as the
   * browser factory; parents come from the ambient ALS request context (the
   * client-propagated chain + server withSpan frames), and rows ship through
   * the server telemetry buffer under the batch context frozen at request
   * time. No per-page-view cap here — server volume is naturally bounded per
   * request, and long-lived batch jobs are exactly the traffic worth seeing.
   */
  private _beginServerHttpRequestSpan(info: RequestSpanInfo): HttpRequestSpanHandle | null {
    if (this._serverTelemetryDisabled) return null;
    if (this._shouldIgnoreOwnApiFetchUrl(info.url)) return null;
    const sanitizedUrl = sanitizeHttpClientUrl(info.url);
    if (sanitizedUrl === null) return null;
    // sanitizeHttpClientUrl parsed the same string successfully, so this
    // cannot throw.
    const target = new URL(info.url);
    if (!shouldCaptureNetworkRequest(this._networkCaptureConfig, target)) return null;
    const batchContext = this._currentServerBatchContext(null);
    // Ambient refs are pre-validated compatible; degrade to no custom parents
    // rather than throwing into the caller's request.
    const resolved = resolveParentIds({ ambient: this._ambientParentRefsWith(batchContext) });
    const parentSpanIds = "error" in resolved ? [] : resolved.ids;
    return beginHttpClientSpanCore({
      config: this._networkCaptureConfig,
      sanitizedUrl,
      method: info.method,
      transport: info.transport,
      parentSpanIds,
      pageViewSpanId: batchContext.pageViewSpanId,
      enqueueRow: (row) => this._enqueueServerSpanUpdate(batchContext, row),
    });
  }

  // ---------------------------------------------------------------------------
  // Library-span bridge seam (hidden OTel bridge; see library-span-bridge.ts)
  // ---------------------------------------------------------------------------

  private _warnedLibrarySpanDataError = false;

  /**
   * The seam behind the hidden OTel bridge: called SYNCHRONOUSLY at OTel
   * startSpan time so the ambient batch context and the parent chain are
   * frozen at call time (the same instant `_startServerSpan` resolves them),
   * then again on `end()` with the collected data. Exactly ONE complete
   * `$lib-span` row is enqueued per span, at end — an unended library span is
   * never shipped, unlike native spans' open-interval upserts, because the
   * bridge cannot re-write rows and half-open library spans are noise.
   *
   * Parent chain resolution restates the bridge's contract:
   *  (a) `otelParent` given → the OTel-minted ancestor wins outright; its
   *      stored root-first path already BEGINS at whatever ambient chain that
   *      ancestor resolved against, so re-merging ambient refs here would
   *      duplicate (or, under concurrency, diverge from) the prefix. Clamped
   *      to the NEAREST ancestors when arbitrary OTel nesting depth exceeds
   *      the shared wire cap.
   *  (b) no `otelParent` → ambient Hexclave refs at call time (withSpan ALS
   *      frames + the request context's client-propagated chain).
   *  (c) neither → project-level root (empty parents), still recorded.
   *
   * Note the ambient lookup is the SYNCHRONOUS one only (ALS request scopes,
   * adapter wrappers) — same as `_startServerSpan`. The async next/headers
   * ambient provider is an event/log-only affordance; a sync OTel startSpan
   * cannot await it.
   *
   * Returns null when server telemetry cannot record (browser-like env,
   * analytics disabled) — the bridge span then becomes non-recording.
   * Public-but-underscored: reached via getServerAppInstrumentation.
   */
  _beginLibrarySpan(info: BeginLibrarySpanInfo): LibrarySpanHandle | null {
    if (this._clientAnalytics) return null;
    if (this._serverTelemetryDisabled) return null;
    if (this._observabilityOptions?.enabled === false) return null;
    const batchContext = this._currentServerBatchContext(null);
    let parentSpanIds: string[];
    if (info.otelParent !== null) {
      parentSpanIds = [...info.otelParent.parentPath, info.otelParent.nativeId].slice(-CUSTOM_TELEMETRY_MAX_PARENT_CHAIN);
    } else {
      // Ambient refs are pre-validated compatible; degrade to project root
      // rather than throwing inside a third-party library's code path.
      const resolved = resolveParentIds({ ambient: this._ambientParentRefsWith(batchContext) });
      parentSpanIds = "error" in resolved ? [] : resolved.ids;
    }
    const nativeId = generateUuid();
    return {
      nativeId,
      parentPath: parentSpanIds,
      end: (endedAtMs, data) => {
        const dataError = getCustomTelemetryDataError(data);
        if (dataError !== null) {
          // The bridge caps attribute count/bytes well under the row limit,
          // so this is a should-never-happen guard; a library's span.end()
          // must never throw, so warn once instead.
          if (!this._warnedLibrarySpanDataError) {
            this._warnedLibrarySpanDataError = true;
            console.warn(`Hexclave analytics: dropping a library span whose data failed validation: ${dataError}`);
          }
          return;
        }
        const row: SpanUpdateRow = {
          span_id: nativeId,
          span_type: LIB_SPAN_TYPE,
          started_at_ms: info.startedAtMs,
          // The bridge already clamps end >= start and rounds to integer ms;
          // re-clamp here so a future second bridge caller cannot regress the
          // invariant resolveEndedAtMs enforces (throwing is not an option in
          // a library's end() path).
          ended_at_ms: Math.max(info.startedAtMs, Math.round(endedAtMs)),
          parent_span_ids: parentSpanIds,
          data,
          updated_at_ms: Date.now(),
          ...batchContext.pageViewSpanId !== null ? { page_view_span_id: batchContext.pageViewSpanId } : {},
        };
        // Fire-and-forget like the $log sink: the promise is pre-caught and
        // delivery failures already warn inside the server flush path.
        this._enqueueServerSpanUpdate(batchContext, row).catch(() => {});
      },
    };
  }

  /**
   * Registers the hidden OTel bridge with this app instance as its deps
   * (claims the process-global OTel API only if free; see
   * registerLibrarySpanBridge for the back-off rules). Returns the bridge's
   * TracerProvider for instrumentation-class wiring (Prisma etc.), or null
   * when the bridge backed off / cannot run here. Public-but-underscored:
   * reached via getServerAppInstrumentation.
   */
  async _registerLibrarySpanBridge(): Promise<LibrarySpanBridgeRegistration | null> {
    if (this._clientAnalytics) return null;
    if (this._observabilityOptions?.enabled === false) return null;
    return await registerLibrarySpanBridge({
      projectId: this.projectId,
      beginLibrarySpan: (info) => this._beginLibrarySpan(info),
    });
  }

  /**
   * Records one uncaught server-side error as a `$error` EVENT (errors are
   * instants, not intervals) through the server telemetry buffer. Built for
   * framework glue (Next.js onRequestError) and the uncaught-exception
   * monitor; a `request` links the error to the original caller's session
   * exactly like `trackEvent({ request })`. Public-but-underscored: reached
   * via getServerAppInstrumentation. The returned promise settles with batch
   * delivery and is pre-caught.
   */
  _captureServerRequestError(error: unknown, info: { mechanism: string, request?: RequestLike, data?: Record<string, unknown> }): Promise<void> {
    // Shared payload builder (see error-capture.ts): message/name/stack
    // bounded to 8KB, flattened mechanism_type/handled scalars, local
    // fingerprint for grouping, release/environment stamps.
    const data: Record<string, unknown> = {
      ...buildErrorEventData(error, {
        mechanismType: info.mechanism,
        // Every caller of this seam reports UNCAUGHT errors; a future manual
        // capture API ("captured" mechanism) would pass handled: true.
        handled: false,
        release: requireTelemetryResource(this._telemetryOptions).service.version ?? null,
        environment: requireTelemetryResource(this._telemetryOptions).deploymentEnvironmentName ?? null,
        sdkVersion: clientVersion,
      }),
      ...info.data ?? {},
    };
    if (info.request !== undefined) {
      const request = info.request;
      return preCaught((async () => {
        const context = await this._resolveServerRequestContext(request, null);
        await runWithServerRequestContext(context, () => this._trackServerEventUnvalidatedType("$error", data, undefined, context.userId));
      })());
    }
    return this._trackServerEventUnvalidatedType("$error", data, undefined, null);
  }

  private _serverErrorMonitorInstalled = false;

  /**
   * Installs the process-level uncaught-exception monitor (one `$error` event
   * per crash, `mechanism_type: "node.uncaughtexception"`). Idempotent per app
   * instance and replace-keyed per project on globalThis (HMR — see
   * installServerErrorMonitor). Installed eagerly by
   * `hexclaveInstrumentation().register()` and lazily on the first
   * `{ request }`-scoped telemetry call, mirroring the outbound-fetch install.
   * Public-but-underscored: reached via getServerAppInstrumentation.
   */
  _installServerErrorMonitor(): void {
    if (this._serverErrorMonitorInstalled) return;
    this._serverErrorMonitorInstalled = true;
    // Browser-like environment: the window.onerror/onunhandledrejection
    // capture (ClientAnalytics) owns errors there.
    if (this._clientAnalytics) return;
    if (this._observabilityOptions?.enabled === false) return;
    if (this._observabilityOptions?.errorCapture?.enabled === false) return;
    installServerErrorMonitor({
      projectId: this.projectId,
      capture: (error) => {
        // Fire-and-forget: the monitor is observation-only and the process is
        // likely about to exit. The capture flushes on the next microtask —
        // best-effort delivery; loss on a hard exit is the documented cost of
        // never touching the app's crash policy (see installServerErrorMonitor).
        this._captureServerRequestError(error, { mechanism: "node.uncaughtexception" }).catch(() => {});
      },
    });
  }

  /**
   * Server-side `$log` sink behind `app.logger` (overrides the browser sink):
   * rides the server telemetry buffer, so a log emitted inside a
   * `withSpan({ request })` scope automatically inherits the ambient batch
   * context — the caller's session/page/fetch ancestry — exactly like a
   * server event. In browser-like environments the inherited client sink wins.
   */
  protected override _emitLog(item: LogEmitItem): "ok" | "unavailable" {
    if (this._observabilityOptions?.enabled === false) return "unavailable";
    if (this._clientAnalytics) return super._emitLog(item);
    // Fire-and-forget is the logger contract; the promise is pre-caught and
    // delivery failures already warn inside the server flush path.
    const send = (userId: string | null) => this._trackServerEventUnvalidatedType("$log", item.data, undefined, userId, {
      message: item.message,
      level: item.level,
    });
    // Same framework-ambient fallback as trackEvent: a bare `app.logger.info`
    // in a route handler lands under the caller's session without wiring.
    // Inside an existing `{ request }` scope the buffer context already
    // attributes it, so the fast path stays synchronous.
    if (this._ambientRequestProvider !== null && getServerRequestContext() === null) {
      this._runWithAmbientRequestScope(null, (userId) => send(userId)).catch(() => {});
      return "ok";
    }
    send(null).catch(() => {});
    return "ok";
  }
}

/**
 * The nearest-known-ancestor contract for per-item `http_client_span_id`
 * emission (restating the backend's composition rule, buildBatchSpanRows: the
 * `hc-` prefix composes AFTER the custom chain). An item may name the caller's
 * `$http-client` fetch span only when that fetch is its NEAREST known
 * ancestor, i.e. its ENTIRE custom chain arrived via the propagation header. A
 * server-opened span in the chain sits between the fetch and the item, so such
 * items chain through their root span and OMIT the id — the root
 * `withSpan({ request })` span (parents = the header chain) and request-level
 * events qualify; spans/events nested under a server span do not. Exported for
 * tests.
 */
export function httpClientSpanIdForServerItem(context: ServerRequestSpanContext, parentSpanIds: readonly string[]): string | null {
  if (context.httpClientSpanId === null) return null;
  const propagated = new Set(context.customParentSpanIds);
  return parentSpanIds.every((id) => propagated.has(id)) ? context.httpClientSpanId : null;
}

export type ServerAppInstrumentation = {
  installServerFetchInstrumentation: () => void,
  installServerErrorMonitor: () => void,
  captureServerRequestError: (error: unknown, info: { mechanism: string, request?: RequestLike, data?: Record<string, unknown> }) => Promise<void>,
  /**
   * Registers the framework's ambient request provider: a function that
   * returns the current request's RequestLike when called inside a request
   * scope (null outside one — that is a normal state, not an error). Once
   * registered, bare `trackEvent` / `withSpan` / logger calls with no explicit
   * `{ request }` attribute to the ambient request automatically. Single slot,
   * replace semantics; pass null to unregister.
   */
  setAmbientRequestProvider: (provider: (() => Promise<RequestLike | null>) | null) => void,
  /**
   * Claims the process-global OpenTelemetry API for the hidden library-span
   * bridge (only if no other provider is registered — never clobbers a user's
   * own OTel setup). Resolves with the bridge's TracerProvider for wiring
   * instrumentation-class libraries, or null when the bridge backed off.
   */
  registerLibrarySpanBridge: () => Promise<LibrarySpanBridgeRegistration | null>,
  /** The library-span bridge's row seam; see _beginLibrarySpan. */
  beginLibrarySpan: (info: BeginLibrarySpanInfo) => LibrarySpanHandle | null,
};

/**
 * SDK-internal accessor for the instrumentation hooks framework integrations
 * need (Next.js `instrumentation.ts` glue). The integrations only see the
 * public StackServerApp interface; this narrows via instanceof — no casts, no
 * interface pollution — and returns null for anything that is not a real
 * server app (e.g. structural mocks), letting callers fail loud with their own
 * message. New instrumentation hooks should extend this seam rather than
 * adding another accessor.
 */
export function getServerAppInstrumentation(app: unknown): ServerAppInstrumentation | null {
  if (!(app instanceof _HexclaveServerAppImplIncomplete)) return null;
  return {
    installServerFetchInstrumentation: () => app._installServerFetchInstrumentation(),
    installServerErrorMonitor: () => app._installServerErrorMonitor(),
    captureServerRequestError: (error, info) => app._captureServerRequestError(error, info),
    setAmbientRequestProvider: (provider) => app._setAmbientRequestProvider(provider),
    registerLibrarySpanBridge: () => app._registerLibrarySpanBridge(),
    beginLibrarySpan: (info) => app._beginLibrarySpan(info),
  };
}

// Hoisted to shared so the tracker, header codec, server buffer, and batch
// route validate identically — drift here 400s whole batches server-side.
const SERVER_TELEMETRY_UUID_RE = TELEMETRY_UUID_RE;

/**
 * Whether a failed batch send's text (error message or raw response body —
 * the transport wraps non-ok responses into an Error whose message embeds the
 * body, so both shapes reduce to a substring check on the KnownErrors code)
 * is the analytics-app-not-enabled rejection that must sticky-disable server
 * telemetry for the process.
 */
function isAnalyticsNotEnabledFailureText(text: string): boolean {
  return text.includes("ANALYTICS_NOT_ENABLED");
}

// Matches the client tracker's LIVE_SPAN_REGISTRY_SOFT_CAP; see setGlobalSpan.
const SERVER_GLOBAL_SPAN_SOFT_CAP = 1000;

/**
 * Buffer coalescing key. customParentSpanIds, pageViewSpanId, and
 * httpClientSpanId are intentionally excluded — they are per-item fields (they
 * ride on each row), not part of the batch identity, so items sharing
 * user/refresh/replay/segment still batch together.
 */
function serializeServerBatchKey(context: ServerRequestSpanContext): string {
  return JSON.stringify([context.userId, context.refreshTokenId, context.sessionReplayId, context.sessionReplaySegmentId]);
}
// Below the route's 500-items cap with headroom, so a coalesced batch can never
// be rejected for size.
const SERVER_TELEMETRY_MAX_ITEMS_PER_BATCH = 400;

type TelemetrySettler = {
  resolve: () => void,
  reject: (error: unknown) => void,
};

type ServerTelemetryBuffer = {
  events: {
    event: {
      event_type: string,
      event_at_ms: number,
      data: Record<string, unknown>,
      // `$log`-only wire fields (route-enforced) — see the client TrackedEvent.
      message?: string,
      level?: string,
      parent_span_ids?: string[],
      page_view_span_id?: string,
      http_client_span_id?: string,
    },
    settler: TelemetrySettler,
  }[],
  spans: Map<string, { row: SpanUpdateRow, settlers: TelemetrySettler[] }>,
  scheduled: boolean,
  // The batch context every item in this buffer shares; becomes the payload's
  // user_id / refresh_token_id / session_replay_id / session_replay_segment_id.
  context: ServerRequestSpanContext,
};
