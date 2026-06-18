import { WebAuthnError, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { KnownError, KnownErrors, HexclaveClientInterface } from "@hexclave/shared";
import type { RequestListener } from "@hexclave/shared/dist/interface/client-interface";
import { ContactChannelsCrud } from "@hexclave/shared/dist/interface/crud/contact-channels";
import { CurrentUserCrud } from "@hexclave/shared/dist/interface/crud/current-user";
import type { CustomerInvoicesListResponse } from "@hexclave/shared/dist/interface/crud/invoices";
import { ItemCrud } from "@hexclave/shared/dist/interface/crud/items";
import { NotificationPreferenceCrud } from "@hexclave/shared/dist/interface/crud/notification-preferences";
import { OAuthProviderCrud } from "@hexclave/shared/dist/interface/crud/oauth-providers";
import type { CustomerProductsListResponse } from "@hexclave/shared/dist/interface/crud/products";
import { TeamApiKeysCrud, UserApiKeysCrud, teamApiKeysCreateOutputSchema, userApiKeysCreateOutputSchema } from "@hexclave/shared/dist/interface/crud/project-api-keys";
import { ProjectPermissionsCrud } from "@hexclave/shared/dist/interface/crud/project-permissions";
import { ClientProjectsCrud } from "@hexclave/shared/dist/interface/crud/projects";
import { SessionsCrud } from "@hexclave/shared/dist/interface/crud/sessions";
import { TeamInvitationCrud } from "@hexclave/shared/dist/interface/crud/team-invitation";
import { TeamMemberProfilesCrud } from "@hexclave/shared/dist/interface/crud/team-member-profiles";
import { TeamPermissionsCrud } from "@hexclave/shared/dist/interface/crud/team-permissions";
import { TeamsCrud } from "@hexclave/shared/dist/interface/crud/teams";
import { UsersCrud } from "@hexclave/shared/dist/interface/crud/users";
import type { RestrictedReason } from "@hexclave/shared/dist/schema-fields";
import { InternalSession } from "@hexclave/shared/dist/sessions";
import { decodeBase32, decodeBase64, encodeBase32, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { scrambleDuringCompileTime } from "@hexclave/shared/dist/utils/compile-time";
import { isBrowserLike } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { parseJson } from "@hexclave/shared/dist/utils/json";
import { DependenciesMap } from "@hexclave/shared/dist/utils/maps";
import { ProviderType } from "@hexclave/shared/dist/utils/oauth";
import { deepPlainEquals, omit } from "@hexclave/shared/dist/utils/objects";
import { neverResolve, runAsynchronously, wait } from "@hexclave/shared/dist/utils/promises";
import { suspend, suspendIfSsr, use } from "@hexclave/shared/dist/utils/react";
import { getTrustedParentDomain, validateRedirectUrl } from "@hexclave/shared/dist/utils/redirect-urls";
import { Result } from "@hexclave/shared/dist/utils/results";
import { Store, storeLock } from "@hexclave/shared/dist/utils/stores";
import { deindent, mergeScopeStrings } from "@hexclave/shared/dist/utils/strings";
import type { TurnstileAction } from "@hexclave/shared/dist/utils/turnstile";
import { BotChallengeExecutionFailedError, BotChallengeUserCancelledError, withBotChallengeFlow } from "@hexclave/shared/dist/utils/turnstile-flow";
import { createUrlIfValid, getRelativePart, isRelative } from "@hexclave/shared/dist/utils/urls";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import * as tanstackStartServerContext from "@hexclave/tanstack-start/tanstack-start-server-context"; // THIS_LINE_PLATFORM tanstack-start
import * as TanStackRouter from "@tanstack/react-router"; // THIS_LINE_PLATFORM tanstack-start
import * as cookie from "cookie";
import * as NextNavigationUnscrambled from "next/navigation"; // import the entire module to get around some static compiler warnings emitted by Next.js in some cases | THIS_LINE_PLATFORM next
import React, { useCallback, useMemo } from "react"; // THIS_LINE_PLATFORM react-like
import type * as yup from "yup";
import { constructRedirectUrl } from "../../../../utils/url";
import { callOAuthCallback, getNewOAuthProviderOrScopeUrl } from "../../../auth";
import { CookieHelper, createBrowserCookieHelper, createCookieHelper, createPlaceholderCookieHelper, deleteCookie, deleteCookieClient, getCookieClient, isSecure as isSecureCookieContext, saveVerifierAndState, setOrDeleteCookie, setOrDeleteCookieClient } from "../../../cookie";
import { envVars } from "../../../../generated/env";
import { ApiKey, ApiKeyCreationOptions, ApiKeyUpdateOptions, apiKeyCreationOptionsToCrud } from "../../api-keys";
import { ConvexCtx, GetCurrentPartialUserOptions, GetCurrentUserOptions, HandlerUrlOptions, HandlerUrls, OAuthScopesOnSignIn, RedirectMethod, RedirectToOptions, RequestLike, ResolvedHandlerUrls, TokenStoreInit, hexclaveAppInternalsSymbol } from "../../common";
import { DeprecatedOAuthConnection, OAuthConnection } from "../../connected-accounts";
import { ContactChannel, ContactChannelCreateOptions, ContactChannelUpdateOptions, contactChannelCreateOptionsToCrud, contactChannelUpdateOptionsToCrud } from "../../contact-channels";
import { Customer, CustomerBilling, CustomerDefaultPaymentMethod, CustomerInvoiceStatus, CustomerInvoicesList, CustomerInvoicesListOptions, CustomerInvoicesRequestOptions, CustomerPaymentMethodSetupIntent, CustomerProductsList, CustomerProductsListOptions, CustomerProductsRequestOptions, Item } from "../../customers";
import { NotificationCategory } from "../../notification-categories";
import { TeamPermission } from "../../permissions";
import { AdminOwnedProject, AdminProjectUpdateOptions, Project, adminProjectCreateOptionsToCrud } from "../../projects";
import { EditableTeamMemberProfile, ReceivedTeamInvitation, SentTeamInvitation, Team, TeamCreateOptions, TeamUpdateOptions, TeamUser, teamCreateOptionsToCrud, teamUpdateOptionsToCrud } from "../../teams";
import { buildCliAuthConfirmUrl, getHostedHandlerUrl, isHostedHandlerUrlForProject, resolveHandlerUrls } from "../../url-targets";
import { ActiveSession, Auth, BaseUser, CurrentUser, InternalUserExtra, OAuthProvider, ProjectCurrentUser, SyncedPartialUser, TokenPartialUser, UserExtra, UserUpdateOptions, userUpdateOptionsToCrud, withUserDestructureGuard } from "../../users";
import { StackClientApp, StackClientAppConstructorOptions, StackClientAppJson } from "../interfaces/client-app";
import { _HexclaveAdminAppImplIncomplete } from "./admin-app-impl";
import { TokenObject, clientVersion, createCache, createCacheBySession, createEmptyTokenStore, getAnalyticsBaseUrl, getDefaultExtraRequestHeaders, getDefaultProjectId, getDefaultPublishableClientKey, getUrls, resolveApiUrls, resolveConstructorOptions } from "./common";
import { EventTracker } from "./event-tracker";
import type { CrossDomainHandoffParams } from "./redirect-page-urls";
import { crossDomainAuthQueryParams, getCrossDomainHandoffParamsFromCurrentUrl, planRedirectToHandler } from "./redirect-page-urls";
import { subscribeSessionRefresh } from "./session-refresh-subscription";
import { AnalyticsOptions, SessionRecorder, analyticsOptionsFromJson, analyticsOptionsToJson, getSessionReplayOptions } from "./session-replay";

// IF_PLATFORM react-like
import { useAsyncCache } from "./common";
// END_PLATFORM
// IF_PLATFORM js-like
import { mountClickmapOverlay } from "../../../../clickmap";
import { mountDevTool } from "../../../../dev-tool";
// END_PLATFORM

let isReactServer = false;
// IF_PLATFORM next
import * as sc from "@hexclave/sc";
import { cookies } from "@hexclave/sc";
isReactServer = sc.isReactServer;

// NextNavigation.useRouter does not exist in react-server environments and some bundlers try to be helpful and throw a warning. Ignore the warning.
const NextNavigation = scrambleDuringCompileTime(NextNavigationUnscrambled);
// END_PLATFORM

const prefetchedCrossDomainHandoffTtlMs = 55 * 60 * 1000;

const nestedCrossDomainAuthQueryParams = {
  refreshTokenId: "stack_nested_cross_domain_auth_refresh_token_id",
  callbackUrl: "stack_nested_cross_domain_auth_callback_url",
  redirectUri: "redirect_uri",
  state: "state",
  codeChallenge: "code_challenge",
  codeChallengeMethod: "code_challenge_method",
  afterCallbackRedirectUrl: "after_callback_redirect_url",
} as const;

function getRedirectHelperInstruction(handlerName: string): string {
  if (handlerName === "handler") {
    return "Use a page-specific redirect helper such as app.redirectToSignIn() instead.";
  }
  const redirectMethodName = `redirectTo${handlerName.slice(0, 1).toUpperCase()}${handlerName.slice(1)}`;
  return `Use app.${redirectMethodName}() instead.`;
}

function createUrlsForPublicAccess(options: {
  urls: ResolvedHandlerUrls,
  projectId: string,
}): Readonly<ResolvedHandlerUrls> {
  const hostedUrlNames = new Set(
    Object.entries(options.urls)
      .filter(([, url]) => isHostedHandlerUrlForProject({ url, projectId: options.projectId }))
      .map(([handlerName]) => handlerName),
  );

  return new Proxy(options.urls, {
    get(target, property, receiver) {
      if (typeof property === "string" && hostedUrlNames.has(property)) {
        throw new Error(
          `app.urls.${property} cannot be used when this app is configured to use hosted components. ` +
          "`app.urls` is static and does not include the runtime redirect-back, cross-domain auth, or sign-out state required by hosted components. " +
          getRedirectHelperInstruction(property),
        );
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

const oauthCallbackResponseQueryParams = ["code", "state", "error", "error_description", "errorCode", "message", "details"] as const;

const allClientApps = new Map<string, [checkString: string | undefined, app: StackClientApp<any, any>]>();
const STACK_AUTHORIZATION_VALUE_PREFIX = "stackauth_";
// Hexclave rebrand (PR 1, invisible compat layer): the parser accepts the new
// `hexclave_` prefix in addition to the legacy `stackauth_`, but the emitter
// MUST keep emitting `stackauth_`. `getAuthorizationHeader()` is a documented
// public SDK API whose return shape is part of the wire contract — changing
// the emitted prefix here would silently break customer/server parsers and
// version-skewed apps. The emitter flips to `hexclave_` in the user-visible
// PR 2, not in this invisible compat-only PR.
const HEXCLAVE_AUTHORIZATION_VALUE_PREFIX = "hexclave_";

function getAuthorizationHeaderValueFromAuthJson(authJson: { accessToken: string | null, refreshToken: string | null }): string | null {
  if (authJson.accessToken == null && authJson.refreshToken == null) {
    return null;
  }

  const encodedAuthJson = encodeBase64(new TextEncoder().encode(JSON.stringify(authJson)));
  return `Bearer ${STACK_AUTHORIZATION_VALUE_PREFIX}${encodedAuthJson}`;
}

function getAuthJsonFromAuthorizationHeaderValue(authorizationHeaderValue: string): { accessToken: string | null, refreshToken: string | null } | null {
  const match = authorizationHeaderValue.match(/^Bearer\s+(.+)$/i);
  if (match == null) {
    return null;
  }

  const credential = match[1].trim();
  // Hexclave rebrand: accept either the new or the legacy prefix; slice whichever matched.
  const matchedPrefix = credential.startsWith(HEXCLAVE_AUTHORIZATION_VALUE_PREFIX)
    ? HEXCLAVE_AUTHORIZATION_VALUE_PREFIX
    : credential.startsWith(STACK_AUTHORIZATION_VALUE_PREFIX)
      ? STACK_AUTHORIZATION_VALUE_PREFIX
      : null;
  if (matchedPrefix == null) {
    return null;
  }

  const encodedAuthJson = credential.slice(matchedPrefix.length);
  if (encodedAuthJson.length === 0) {
    throw new Error("Invalid Authorization header format. Expected `Bearer stackauth_<base64(getAuthJson())>`.");
  }

  let parsed: unknown;
  try {
    const decodedAuthJson = new TextDecoder().decode(decodeBase64(encodedAuthJson));
    parsed = JSON.parse(decodedAuthJson);
  } catch (e) {
    throw new Error("Invalid stackauth authorization header.", { cause: e });
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid stackauth authorization payload. Expected an object.");
  }

  const accessToken = Reflect.get(parsed, "accessToken");
  const refreshToken = Reflect.get(parsed, "refreshToken");
  if (accessToken != null && typeof accessToken !== "string") {
    throw new Error("Invalid stackauth authorization payload. `accessToken` must be a string or null.");
  }
  if (refreshToken != null && typeof refreshToken !== "string") {
    throw new Error("Invalid stackauth authorization payload. `refreshToken` must be a string or null.");
  }

  return {
    accessToken: accessToken ?? null,
    refreshToken: refreshToken ?? null,
  };
}

function getHeaderValueFromRequestLikeHeaders(headers: RequestLike["headers"], name: string): string | null {
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name);
  }

  const lowerCaseName = name.toLowerCase();
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() === lowerCaseName) {
      return headerValue;
    }
  }
  return null;
}

// IF_PLATFORM tanstack-start
function getTanStackStartRequestHeader(name: string): string | null {
  const { getRequestHeader } = tanstackStartServerContext;
  if (getRequestHeader == null) {
    throw new HexclaveAssertionError("TanStack Start request headers are only available during server rendering");
  }
  return getRequestHeader(name) ?? null;
}
// END_PLATFORM

async function getServerRequestHost(): Promise<string | null> {
  // IF_PLATFORM next
  return (await sc.headers?.())?.get("host") ?? null;
  // ELSE_IF_PLATFORM tanstack-start
  return getTanStackStartRequestHeader("host");
  // ELSE_PLATFORM
  return null;
  // END_PLATFORM
}

type HexclaveClientAppImplConstructorOptionsResolved<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppConstructorOptions<HasTokenStore, ProjectId> & { inheritsFrom?: undefined };

export class _HexclaveClientAppImplIncomplete<HasTokenStore extends boolean, ProjectId extends string = string> implements StackClientApp<HasTokenStore, ProjectId> {
  /**
   * There is a circular dependency between the admin app and the client app, as the former inherits from the latter and
   * the latter needs to use the former when creating a new instance of an internal project.
   *
   * To break it, we set the admin app here lazily instead of importing it directly. This variable is set by ./index.ts,
   * which imports both this file and ./admin-app-impl.ts.
   */
  static readonly LazyStackAdminAppImpl: { value: typeof import("./admin-app-impl")._HexclaveAdminAppImplIncomplete | undefined } = { value: undefined };

  protected readonly _options: HexclaveClientAppImplConstructorOptionsResolved<HasTokenStore, ProjectId>;
  protected readonly _extraOptions: { uniqueIdentifier?: string, checkString?: string, interface?: HexclaveClientInterface } | undefined;
  protected _uniqueIdentifier: string | undefined = undefined;
  protected _interface: HexclaveClientInterface;
  protected readonly _tokenStoreInit: TokenStoreInit<HasTokenStore>;
  protected readonly _redirectMethod: RedirectMethod | undefined;
  protected readonly _urlOptions: HandlerUrlOptions;
  protected readonly _oauthScopesOnSignIn: Partial<OAuthScopesOnSignIn>;

  private readonly _analyticsOptions: AnalyticsOptions | undefined;
  private _sessionRecorder: SessionRecorder | null = null;
  private _eventTracker: EventTracker | null = null;

  private __DEMO_ENABLE_SLIGHT_FETCH_DELAY = false;
  private readonly _ownedAdminApps = new DependenciesMap<[InternalSession, string], _HexclaveAdminAppImplIncomplete<false, string>>();

  private readonly _currentUserCache = createCacheBySession(async (session) => {
    if (this.__DEMO_ENABLE_SLIGHT_FETCH_DELAY) {
      await wait(2000);
    }
    if (session.isKnownToBeInvalid()) {
      // let's save ourselves a network request
      //
      // this also makes a certain race condition less likely to happen. particularly, it's quite common for code to
      // look like this:
      //
      //     const user = await useUser({ or: "required" });
      //     const something = user.useSomething();
      //
      // now, let's say the session is invalidated. this will trigger a refresh to refresh both the user and the
      // something. however, it's not guaranteed that the user will return first, so useUser might still return a
      // user object while the something request has already completed (and failed, because the session is invalid).
      // by returning null quickly here without a request, it is very very likely for the user request to complete
      // first.
      //
      // TODO HACK: the above is a bit of a hack, and we should probably think of more consistent ways to handle this.
      // it also only works for the user endpoint, and only if the session is known to be invalid.
      return null;
    }
    return await this._interface.getClientUserByToken(session);
  });
  private readonly _currentProjectCache = createCache(async () => {
    return Result.orThrow(await this._interface.getClientProject());
  });
  private readonly _ownedProjectsCache = createCacheBySession(async (session) => {
    return await this._interface.listProjects(session);
  });
  private readonly _currentUserPermissionsCache = createCacheBySession<
    [string, boolean],
    TeamPermissionsCrud['Client']['Read'][]
  >(async (session, [teamId, recursive]) => {
    return await this._interface.listCurrentUserTeamPermissions({ teamId, recursive }, session);
  });
  private readonly _currentUserProjectPermissionsCache = createCacheBySession<
    [boolean],
    ProjectPermissionsCrud['Client']['Read'][]
  >(async (session, [recursive]) => {
    return await this._interface.listCurrentUserProjectPermissions({ recursive }, session);
  });
  private readonly _currentUserTeamsCache = createCacheBySession(async (session) => {
    return await this._interface.listCurrentUserTeams(session);
  });
  /** @deprecated Used by legacy getConnectedAccount(providerId) — uses old per-provider access token endpoint */
  private readonly _currentUserOAuthConnectionAccessTokensCache = createCacheBySession<[string, string], { accessToken: string } | null>(
    async (session, [providerId, scope]) => {
      try {
        const result = await this._interface.createProviderAccessToken(providerId, scope || "", session);
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
  private readonly _currentUserOAuthConnectionCache = createCacheBySession<[ProviderType, string, boolean], DeprecatedOAuthConnection | null>(
    async (session, [providerId, scope, redirect]) => {
      return await this._getUserOAuthConnectionCacheFn({
        getUser: async () => Result.orThrow(await this._currentUserCache.getOrWait([session], "write-only")),
        getOrWaitOAuthToken: async () => Result.orThrow(await this._currentUserOAuthConnectionAccessTokensCache.getOrWait([session, providerId, scope || ""] as const, "write-only")),
        // IF_PLATFORM react-like
        useOAuthToken: () => useAsyncCache(this._currentUserOAuthConnectionAccessTokensCache, [session, providerId, scope || ""] as const, "connection.useAccessToken()"),
        // END_PLATFORM
        providerId,
        scope,
        redirect,
        session,
      });
    }
  );
  private readonly _currentUserConnectedAccountsCache = createCacheBySession<[], OAuthConnection[]>(
    async (session) => {
      const result = await this._interface.listConnectedAccounts(session);
      return result.items.map((item) => this._createOAuthConnectionFromCrudItem(item, session));
    }
  );
  private readonly _currentUserOAuthConnectionAccessTokensByAccountCache = createCacheBySession<[string, string, string], { accessToken: string } | null>(
    async (session, [providerId, providerAccountId, scope]) => {
      try {
        const result = await this._interface.createProviderAccessTokenByAccount(providerId, providerAccountId, scope, session);
        return { accessToken: result.access_token };
      } catch (err) {
        if (KnownErrors.OAuthAccessTokenNotAvailable.isInstance(err) || KnownErrors.OAuthConnectionDoesNotHaveRequiredScope.isInstance(err) || KnownErrors.OAuthConnectionNotConnectedToUser.isInstance(err)) {
          return null;
        }
        throw err;
      }
    }
  );
  private readonly _currentUserValidConnectedAccountForProviderCache = createCacheBySession<[string, string], OAuthConnection>(
    async (session, [provider, scopeString]) => {
      const connectedAccounts = Result.orThrow(await this._currentUserConnectedAccountsCache.getOrWait([session], "write-only"));
      const matchingAccounts = connectedAccounts.filter(a => a.provider === provider);
      const scopes = scopeString ? scopeString.split(" ") : undefined;

      for (const account of matchingAccounts) {
        const tokenResult = await account.getAccessToken({ scopes });
        if (tokenResult.status === "ok") {
          return account;
        }
      }

      const location = await getNewOAuthProviderOrScopeUrl(
        this._interface,
        {
          provider,
          redirectUrl: this._getOAuthCallbackRedirectUri(),
          errorRedirectUrl: this.urls.error,
          providerScope: mergeScopeStrings(scopeString, (this._oauthScopesOnSignIn[provider as ProviderType] ?? []).join(" ")),
        },
        session,
      );
      await this._redirectTo({ url: location });
      return await neverResolve();
    }
  );
  private readonly _teamMemberProfilesCache = createCacheBySession<[string], TeamMemberProfilesCrud['Client']['Read'][]>(
    async (session, [teamId]) => {
      return await this._interface.listTeamMemberProfiles({ teamId }, session);
    }
  );
  private readonly _teamInvitationsCache = createCacheBySession<[string], TeamInvitationCrud['Client']['Read'][]>(
    async (session, [teamId]) => {
      return await this._interface.listTeamInvitations({ teamId }, session);
    }
  );
  private readonly _currentUserTeamProfileCache = createCacheBySession<[string], TeamMemberProfilesCrud['Client']['Read']>(
    async (session, [teamId]) => {
      return await this._interface.getTeamMemberProfile({ teamId, userId: 'me' }, session);
    }
  );
  private readonly _currentUserTeamInvitationsCache = createCacheBySession(async (session) => {
    return await this._interface.listCurrentUserTeamInvitations(session);
  });
  private readonly _clientContactChannelsCache = createCacheBySession<[], ContactChannelsCrud['Client']['Read'][]>(
    async (session) => {
      return await this._interface.listClientContactChannels(session);
    }
  );

  private readonly _userApiKeysCache = createCacheBySession<[], UserApiKeysCrud['Client']['Read'][]>(
    async (session) => {
      const results = await this._interface.listProjectApiKeys({ user_id: 'me' }, session, "client");
      return results as UserApiKeysCrud['Client']['Read'][];
    }
  );

  private readonly _teamApiKeysCache = createCacheBySession<[string], TeamApiKeysCrud['Client']['Read'][]>(
    async (session, [teamId]) => {
      const results = await this._interface.listProjectApiKeys({ team_id: teamId }, session, "client");
      return results as TeamApiKeysCrud['Client']['Read'][];
    }
  );

  private readonly _notificationCategoriesCache = createCacheBySession<[], NotificationPreferenceCrud['Client']['Read'][]>(
    async (session) => {
      const results = await this._interface.listNotificationCategories(session);
      return results as NotificationPreferenceCrud['Client']['Read'][];
    }
  );

  private readonly _currentUserOAuthProvidersCache = createCacheBySession<[], OAuthProviderCrud['Client']['Read'][]>(
    async (session) => {
      return await this._interface.listOAuthProviders({ user_id: 'me' }, session);
    }
  );

  private readonly _userItemCache = createCacheBySession<[string, string], ItemCrud['Client']['Read']>(
    async (session, [userId, itemId]) => {
      return await this._interface.getItem({ userId, itemId }, session);
    }
  );

  private readonly _teamItemCache = createCacheBySession<[string, string], ItemCrud['Client']['Read']>(
    async (session, [teamId, itemId]) => {
      return await this._interface.getItem({ teamId, itemId }, session);
    }
  );

  private readonly _customItemCache = createCacheBySession<[string, string], ItemCrud['Client']['Read']>(
    async (session, [customCustomerId, itemId]) => {
      return await this._interface.getItem({ customCustomerId, itemId }, session);
    }
  );

  private readonly _userProductsCache = createCacheBySession<[string, string | null, number | null], CustomerProductsListResponse>(
    async (session, [userId, cursor, limit]) => {
      return await this._interface.listProducts({
        customer_type: "user",
        customer_id: userId,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
      }, session);
    }
  );

  private readonly _teamProductsCache = createCacheBySession<[string, string | null, number | null], CustomerProductsListResponse>(
    async (session, [teamId, cursor, limit]) => {
      return await this._interface.listProducts({
        customer_type: "team",
        customer_id: teamId,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
      }, session);
    }
  );

  private readonly _customProductsCache = createCacheBySession<[string, string | null, number | null], CustomerProductsListResponse>(
    async (session, [customCustomerId, cursor, limit]) => {
      return await this._interface.listProducts({
        customer_type: "custom",
        customer_id: customCustomerId,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
      }, session);
    }
  );

  private readonly _userInvoicesCache = createCacheBySession<[string, string | null, number | null], CustomerInvoicesListResponse>(
    async (session, [userId, cursor, limit]) => {
      return await this._interface.listInvoices({
        customer_type: "user",
        customer_id: userId,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
      }, session);
    }
  );

  private readonly _teamInvoicesCache = createCacheBySession<[string, string | null, number | null], CustomerInvoicesListResponse>(
    async (session, [teamId, cursor, limit]) => {
      return await this._interface.listInvoices({
        customer_type: "team",
        customer_id: teamId,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
      }, session);
    }
  );

  private readonly _customerBillingCache = createCacheBySession<["user" | "team", string], {
    has_customer: boolean,
    default_payment_method: {
      id: string,
      brand: string | null,
      last4: string | null,
      exp_month: number | null,
      exp_year: number | null,
    } | null,
  }>(
    async (session, [customerType, customerId]) => {
      return await this._interface.getCustomerBilling(customerType, customerId, session);
    }
  );

  private readonly _convexPartialUserCache = createCache<[unknown], TokenPartialUser | null>(
    async ([ctx]) => await this._getPartialUserFromConvex(ctx as any)
  );

  private readonly _trustedParentDomainCache = createCache<[string], string | null>(
    async ([domain]) => await this._getTrustedParentDomain(domain)
  );

  private _anonymousSignUpInProgress: Promise<{ accessToken: string, refreshToken: string }> | null = null;
  private _prefetchedCrossDomainHandoffParams: CrossDomainHandoffParams | null = null;
  private _prefetchedCrossDomainHandoffParamsFetchedAt = 0;
  private _isPrefetchingCrossDomainHandoffParams = false;
  private _pendingAuthResolutionPromises: Promise<unknown>[] = [];

  protected async _createCookieHelper(overrideTokenStoreInit?: TokenStoreInit): Promise<CookieHelper> {
    const tokenStoreInit = overrideTokenStoreInit === undefined ? this._tokenStoreInit : overrideTokenStoreInit;
    if (tokenStoreInit === 'nextjs-cookie' || tokenStoreInit === 'cookie') {
      return await createCookieHelper();
    } else {
      return await createPlaceholderCookieHelper();
    }
  }

  /** @deprecated Used by legacy getConnectedAccount(providerId) — combines user check + token check + redirect into one cache */
  protected async _getUserOAuthConnectionCacheFn(options: {
    getUser: () => Promise<CurrentUserCrud['Client']['Read'] | null>,
    getOrWaitOAuthToken: () => Promise<{ accessToken: string } | null>,
    // IF_PLATFORM react-like
    useOAuthToken: () => { accessToken: string } | null,
    // END_PLATFORM
    providerId: ProviderType,
    scope: string | null,
  } & ({ redirect: true, session: InternalSession | null } | { redirect: false }),): Promise<DeprecatedOAuthConnection | null> {
    const user = await options.getUser();
    let hasConnection = true;
    if (!user || !user.oauth_providers.find((p) => p.id === options.providerId)) {
      hasConnection = false;
    }

    const token = await options.getOrWaitOAuthToken();
    if (!token) {
      hasConnection = false;
    }

    if (!hasConnection && options.redirect) {
      if (!options.session) {
        throw new Error(deindent`
          Cannot add new scopes to a user that is not a CurrentUser. Please ensure that you are calling this function on a CurrentUser object, or remove the 'or: redirect' option.

          Often, you can solve this by calling this function in the browser instead, or by removing the 'or: redirect' option and dealing with the case where the user doesn't have enough permissions.
        `);
      }
      const location = await getNewOAuthProviderOrScopeUrl(
        this._interface,
        {
          provider: options.providerId,
          redirectUrl: this._getOAuthCallbackRedirectUri(),
          errorRedirectUrl: this.urls.error,
          providerScope: mergeScopeStrings(options.scope || "", (this._oauthScopesOnSignIn[options.providerId] ?? []).join(" ")),
        },
        options.session,
      );
      await this._redirectTo({ url: location });
      return await neverResolve();
    } else if (!hasConnection) {
      return null;
    }

    // Find the matching oauth provider to get the providerAccountId
    // At this point, user is guaranteed to be non-null because we returned early if !hasConnection
    const matchingProvider = user!.oauth_providers.find((p) => p.id === options.providerId);
    const providerAccountId = matchingProvider?.account_id ?? "";

    return {
      id: options.providerId, // deprecated, for backward compat
      provider: options.providerId,
      providerAccountId,
      async getAccessToken() {
        const result = await options.getOrWaitOAuthToken();
        if (!result) {
          throw new HexclaveAssertionError(`Failed to retrieve an access token for this connected account (provider: ${options.providerId}). This usually means the OAuth refresh token has been revoked or expired. The user needs to re-authorize by calling \`linkConnectedAccount\` or using \`getOrLinkConnectedAccount\`.`);
        }
        return result;
      },
      // IF_PLATFORM react-like
      useAccessToken() {
        const result = options.useOAuthToken();
        if (!result) {
          throw new HexclaveAssertionError(`Failed to retrieve an access token for this connected account (provider: ${options.providerId}). This usually means the OAuth refresh token has been revoked or expired. The user needs to re-authorize by calling \`linkConnectedAccount\` or using \`getOrLinkConnectedAccount\`.`);
        }
        return result;
      }
      // END_PLATFORM
    };
  }

  protected _createOAuthConnectionFromCrudItem(
    item: { provider: string, provider_account_id: string },
    session: InternalSession,
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
        const result = Result.orThrow(await app._currentUserOAuthConnectionAccessTokensByAccountCache.getOrWait([session, providerId, providerAccountId, scopeString], "write-only"));
        if (!result) {
          const scopeDetail = scopeString ? `The requested scopes [${scopeString}] are not available on the existing token.` : "The OAuth refresh token has likely been revoked or expired.";
          return Result.error(new KnownErrors.OAuthAccessTokenNotAvailable(providerId, `${scopeDetail} The user needs to re-authorize by calling \`linkConnectedAccount\` or using \`getOrLinkConnectedAccount\`.`));
        }
        return Result.ok(result);
      },
      // IF_PLATFORM react-like
      useAccessToken(options?: { scopes?: string[] }) {
        const scopeString = options?.scopes?.join(" ") ?? "";
        const result = useAsyncCache(app._currentUserOAuthConnectionAccessTokensByAccountCache, [session, providerId, providerAccountId, scopeString] as const, "connection.useAccessToken()");
        if (!result) {
          const scopeDetail = scopeString ? `The requested scopes [${scopeString}] are not available on the existing token.` : "The OAuth refresh token has likely been revoked or expired.";
          return Result.error(new KnownErrors.OAuthAccessTokenNotAvailable(providerId, `${scopeDetail} The user needs to re-authorize by calling \`linkConnectedAccount\` or using \`getOrLinkConnectedAccount\`.`));
        }
        return Result.ok(result);
      },
      // END_PLATFORM
    };
  }

  constructor(options: StackClientAppConstructorOptions<HasTokenStore, ProjectId>, extraOptions?: { uniqueIdentifier?: string, checkString?: string, interface?: HexclaveClientInterface }) {
    const resolvedOptions = resolveConstructorOptions(options);

    if (!_HexclaveClientAppImplIncomplete.LazyStackAdminAppImpl.value) {
      throw new HexclaveAssertionError("Admin app implementation not initialized. Did you import the _HexclaveClientApp from hexclave-app/apps/implementations/index.ts? You can't import it directly from ./apps/implementations/client-app-impl.ts as that causes a circular dependency (see the comment at _LazyHexclaveAdminAppImpl for more details).");
    }

    this._options = resolvedOptions;
    this._extraOptions = extraOptions;

    const projectId = resolvedOptions.projectId ?? getDefaultProjectId();
    if (projectId !== "internal" && !(projectId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i))) {
      throw new Error(`Invalid project ID: ${projectId}. Project IDs must be UUIDs. Please check your environment variables and/or your StackApp.`);
    }

    const publishableClientKey = resolvedOptions.publishableClientKey ?? getDefaultPublishableClientKey();

    if (extraOptions && extraOptions.interface) {
      this._interface = extraOptions.interface;
    } else {
      const apiUrls = resolveApiUrls(resolvedOptions.baseUrl);
      this._interface = new HexclaveClientInterface({
        getBaseUrl: () => apiUrls()[0],
        getAnalyticsBaseUrl: () => getAnalyticsBaseUrl(apiUrls()[0]),
        getApiUrls: apiUrls,
        extraRequestHeaders: resolvedOptions.extraRequestHeaders ?? getDefaultExtraRequestHeaders(),
        projectId,
        clientVersion,
        ...(publishableClientKey != null ? { publishableClientKey } : {}),
        prepareRequest: async () => {
          await cookies?.(); // THIS_LINE_PLATFORM next
        }
      });
    }

    this._tokenStoreInit = resolvedOptions.tokenStore;
    this._redirectMethod = resolvedOptions.redirectMethod || (isBrowserLike() ? "window" : "none");
    this._redirectMethod = resolvedOptions.redirectMethod || "nextjs"; // THIS_LINE_PLATFORM next
    this._redirectMethod = resolvedOptions.redirectMethod || "tanstack-start"; // THIS_LINE_PLATFORM tanstack-start
    this._urlOptions = resolvedOptions.urls ?? {};
    this._oauthScopesOnSignIn = resolvedOptions.oauthScopesOnSignIn ?? {};
    if (isBrowserLike() && (resolvedOptions.tokenStore === "cookie" || resolvedOptions.tokenStore === "nextjs-cookie")) {
      runAsynchronously(this._trustedParentDomainCache.getOrWait([window.location.hostname], "write-only"));
      this._ensureCrossSubdomainCookieExists();
    }

    if (extraOptions && extraOptions.uniqueIdentifier) {
      this._uniqueIdentifier = extraOptions.uniqueIdentifier;
      this._initUniqueIdentifier();
    }

    this._analyticsOptions = resolvedOptions.analytics;

    const getAnalyticsSession = async (): Promise<InternalSession> => {
      this._ensurePersistentTokenStore();
      const partialUser = await this.getPartialUser({ from: 'token', or: 'anonymous-if-exists' });
      if (partialUser) {
        return await this._getSession();
      }
      const anonUser = await this.getUser({ or: "anonymous" });
      return anonUser._internalSession;
    };

    const analyticsEnabled = this._analyticsOptions?.enabled !== false;

    const sessionReplayOptions = getSessionReplayOptions(this._analyticsOptions);
    if (analyticsEnabled && isBrowserLike() && this._hasPersistentTokenStore() && sessionReplayOptions.enabled) {
      this._sessionRecorder = new SessionRecorder({
        projectId: this.projectId,
        sendBatch: async (body, opts) => {
          return await this._interface.sendSessionReplayBatch(body, await getAnalyticsSession(), opts);
        },
      }, sessionReplayOptions);
      this._sessionRecorder.start();
    }

    if (analyticsEnabled && isBrowserLike() && this._hasPersistentTokenStore()) {
      this._eventTracker = new EventTracker({
        projectId: this.projectId,
        sendBatch: async (body, opts) => {
          return await this._interface.sendAnalyticsEventBatch(body, await getAnalyticsSession(), opts);
        },
      });
      this._eventTracker.start();
    }

    if (
      isBrowserLike()
      && (this._isOAuthCallbackUrlHosted() || this._currentUrlLooksLikeNestedCrossDomainOAuthCallback())
      && (this._currentUrlLooksLikeHexclaveOAuthCallback() || this._currentUrlLooksLikeOAuthCallbackError())
    ) {
      this._trackPendingAuthResolution(async () => {
        if (isBrowserLike()) {
          await this._handleHostedOAuthCallbackDuringStartup();
        }
      });
    }

    if (isBrowserLike()) {
      // The OAuth callback resolution scheduled above synchronously strips `code` and `state`
      // from the URL before its token exchange, so the nested handler must decide based on the
      // URL the page was loaded with, not whatever is in the address bar when it runs.
      const urlAtConstructionTime = new URL(window.location.href);
      this._trackPendingAuthResolution(async () => {
        await this._maybeHandleNestedCrossDomainAuth(urlAtConstructionTime);
      });
    }

    // IF_PLATFORM js-like
    if (isBrowserLike() && resolvedOptions.devTool !== false) {
      mountDevTool(this as any);
    }
    if (isBrowserLike()) {
      // Independent of the dev tool: the clickmap overlay only ever renders
      // when a dashboard-minted token is handed over, so the listener is
      // mounted unconditionally (the heavy UI is lazy-loaded on demand).
      mountClickmapOverlay(this as any);
    }
    // END_PLATFORM
  }

  protected _initUniqueIdentifier() {
    if (!this._uniqueIdentifier) {
      throw new HexclaveAssertionError("Unique identifier not initialized");
    }
    if (allClientApps.has(this._uniqueIdentifier)) {
      throw new HexclaveAssertionError("A Stack client app with the same unique identifier already exists");
    }
    allClientApps.set(this._uniqueIdentifier, [this._extraOptions?.checkString ?? undefined, this]);
  }

  protected _trackPendingAuthResolution(callback: () => Promise<unknown>) {
    const promise = (async () => {
      await Promise.resolve();
      try {
        await callback();
      } catch (error) {
        // Startup auth transitions gate session finality, but malformed nested-auth URLs should
        // not make every app-level session consumer fail while the tracker is cleaning up.
        captureError("pending-auth-resolution-failed", error);
      }
    })();
    this._pendingAuthResolutionPromises.push(promise);
    runAsynchronously(async () => {
      try {
        await promise;
      } finally {
        this._pendingAuthResolutionPromises = this._pendingAuthResolutionPromises.filter(p => p !== promise);
      }
    });
  }

  protected async _awaitPendingAuthResolutions(
    overrideTokenStoreInit?: TokenStoreInit,
    options?: { awaitPendingAuthResolutions?: boolean },
  ) {
    if (
      options?.awaitPendingAuthResolutions === false
      || overrideTokenStoreInit !== undefined
      || !this._hasPersistentTokenStore()
      || this._pendingAuthResolutionPromises.length === 0
    ) {
      return;
    }
    // A page may construct the app while OAuth callback or nested cross-domain auth is still
    // deciding whether it will replace the current session. Until those startup transitions
    // finish, auth consumers should not treat the current token store as final.
    await Promise.all(this._pendingAuthResolutionPromises);
  }

  // IF_PLATFORM react-like
  protected _usePendingAuthResolutions(overrideTokenStoreInit?: TokenStoreInit) {
    if (
      overrideTokenStoreInit !== undefined
      || !this._hasPersistentTokenStore()
      || this._pendingAuthResolutionPromises.length === 0
    ) {
      return;
    }
    use(Promise.all(this._pendingAuthResolutionPromises));
  }
  // END_PLATFORM

  protected _isOAuthCallbackUrlHosted(): boolean {
    const oauthCallbackTarget = this._urlOptions.oauthCallback ?? this._urlOptions.default;
    return typeof oauthCallbackTarget !== "string" && oauthCallbackTarget?.type === "hosted";
  }

  protected _currentUrlLooksLikeOAuthCallback(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    const currentUrl = new URL(window.location.href);
    return (
      currentUrl.searchParams.has("code") && currentUrl.searchParams.has("state")
    ) || (
      currentUrl.searchParams.has("errorCode") && currentUrl.searchParams.has("message")
    ) || (
      this._currentUrlLooksLikeOAuthCallbackError()
    );
  }

  protected _currentUrlLooksLikeOAuthCallbackError(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has("errorCode") && currentUrl.searchParams.has("message")) {
      return true;
    }
    return (
      (currentUrl.searchParams.has("error") || currentUrl.searchParams.has("error_description"))
      && !(currentUrl.searchParams.has("code") && currentUrl.searchParams.has("state"))
    );
  }

  protected _currentUrlLooksLikeHexclaveOAuthCallback(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    const currentUrl = new URL(window.location.href);
    const state = currentUrl.searchParams.get("state");
    if (!currentUrl.searchParams.has("code") || state == null) {
      return false;
    }
    return getCookieClient(`stack-oauth-outer-${state}`) != null
      || currentUrl.searchParams.has(nestedCrossDomainAuthQueryParams.refreshTokenId);
  }

  protected _currentUrlLooksLikeNestedCrossDomainOAuthCallback(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    const currentUrl = new URL(window.location.href);
    return currentUrl.searchParams.has("code")
      && currentUrl.searchParams.has("state")
      && currentUrl.searchParams.has(nestedCrossDomainAuthQueryParams.refreshTokenId);
  }

  protected _getOAuthCallbackRedirectUri(): string {
    if (!this._isOAuthCallbackUrlHosted()) {
      return this.urls.oauthCallback;
    }
    if (typeof window === "undefined") {
      throw new HexclaveAssertionError("Hosted OAuth callback URLs require a browser environment to use the current URL as the redirect URI");
    }

    const currentUrl = new URL(window.location.href);
    for (const param of oauthCallbackResponseQueryParams) {
      currentUrl.searchParams.delete(param);
    }
    return currentUrl.toString();
  }

  protected async _redirectToOAuthCallbackError(error: KnownError): Promise<void> {
    const errorUrl = new URL(this._getUrls().error, window.location.href);
    errorUrl.searchParams.set("errorCode", error.errorCode);
    errorUrl.searchParams.set("message", error.message);
    errorUrl.searchParams.set("details", JSON.stringify(error.details ?? {}));
    await this._redirectIfTrusted(errorUrl.toString(), { replace: true });
  }

  protected async _handleHostedOAuthCallbackDuringStartup(): Promise<void> {
    try {
      await this.callOAuthCallback({ dontWarnAboutMissingQueryParams: true });
    } catch (error) {
      if (KnownError.isKnownError(error)) {
        await this._redirectToOAuthCallbackError(error);
        return;
      }
      throw error;
    }
  }

  protected async _fetchCurrentRefreshTokenIdIfSignedIn(options?: {
    awaitPendingAuthResolutions?: boolean,
    overrideTokenStoreInit?: TokenStoreInit,
  }): Promise<string | null> {
    const session = await this._getSession(options?.overrideTokenStoreInit, options);
    // Nested cross-domain auth passes this ID to another origin, which later
    // asks us to prove the same raw refresh token. A cached access token can be
    // valid but stale relative to the refresh token, so mint from the refresh
    // token that owns this session before exposing the ID.
    const tokens = await session.fetchNewTokens();
    if (tokens?.refreshToken == null) {
      return null;
    }
    return tokens.accessToken.payload.refresh_token_id;
  }

  protected async _addNestedCrossDomainAuthParamsToRedirectUrl(options: {
    url: string,
    currentUrl: URL,
    awaitPendingAuthResolutions?: boolean,
    overrideTokenStoreInit?: TokenStoreInit,
  }): Promise<string> {
    const targetUrl = new URL(options.url, options.currentUrl);
    if (targetUrl.origin === options.currentUrl.origin) {
      return options.url;
    }

    const refreshTokenId = await this._fetchCurrentRefreshTokenIdIfSignedIn({
      awaitPendingAuthResolutions: options.awaitPendingAuthResolutions,
      overrideTokenStoreInit: options.overrideTokenStoreInit,
    });
    if (refreshTokenId == null) {
      return options.url;
    }

    targetUrl.searchParams.set(nestedCrossDomainAuthQueryParams.refreshTokenId, refreshTokenId);
    targetUrl.searchParams.set(
      nestedCrossDomainAuthQueryParams.callbackUrl,
      new URL(this._getOAuthCallbackRedirectUri(), options.currentUrl).toString(),
    );
    return targetUrl.toString();
  }

  protected async _maybeHandleNestedCrossDomainAuth(urlAtConstructionTime?: URL): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const currentUrl = new URL(window.location.href);
    // A real OAuth callback wins over nested handoff detection on the final return to b.com.
    // The OAuth callback resolution strips `code` and `state` from the live URL before this
    // runs, so the check must also consult the URL captured at construction time — otherwise
    // we'd re-bounce to the source domain while the token exchange is still in flight.
    if (currentUrl.searchParams.has("code") && currentUrl.searchParams.has("state")) return false;
    if (urlAtConstructionTime != null && urlAtConstructionTime.searchParams.has("code") && urlAtConstructionTime.searchParams.has("state")) return false;
    const refreshTokenId = currentUrl.searchParams.get(nestedCrossDomainAuthQueryParams.refreshTokenId);
    if (refreshTokenId == null) return false;

    const redirectUri = currentUrl.searchParams.get(nestedCrossDomainAuthQueryParams.redirectUri);
    const state = currentUrl.searchParams.get(nestedCrossDomainAuthQueryParams.state);
    const codeChallenge = currentUrl.searchParams.get(nestedCrossDomainAuthQueryParams.codeChallenge);
    if (redirectUri != null || state != null || codeChallenge != null) {
      if (redirectUri == null || state == null || codeChallenge == null) {
        throw new HexclaveAssertionError("Nested cross-domain auth callback URL is missing OAuth request parameters", {
          redirectUri,
          state,
          codeChallenge,
        });
      }

      // We are back on a.com acting as the OAuth provider. Only mint the code if the current
      // source session matches the refresh-token ID that b.com requested.
      if ((currentUrl.searchParams.get(nestedCrossDomainAuthQueryParams.codeChallengeMethod) ?? "S256") !== "S256") {
        throw new HexclaveAssertionError("Nested cross-domain auth only supports S256 PKCE");
      }
      if (isRelative(redirectUri)) {
        throw new Error("Nested cross-domain auth redirect URI must be absolute.");
      }
      const redirectUriUrl = new URL(redirectUri);
      if (!await this._isTrusted(redirectUriUrl.toString())) {
        throw new Error(`Nested cross-domain auth redirect URI ${redirectUri} is not trusted.`);
      }
      const afterCallbackRedirectUrlString = currentUrl.searchParams.get(nestedCrossDomainAuthQueryParams.afterCallbackRedirectUrl);
      const afterCallbackRedirectUrl = afterCallbackRedirectUrlString == null
        ? redirectUriUrl
        : new URL(afterCallbackRedirectUrlString, redirectUriUrl);
      if (!await this._isTrusted(afterCallbackRedirectUrl.toString())) {
        throw new Error(`Nested cross-domain auth after-callback redirect URL ${afterCallbackRedirectUrlString} is not trusted.`);
      }
      const currentRefreshTokenId = await this._fetchCurrentRefreshTokenIdIfSignedIn({ awaitPendingAuthResolutions: false });
      if (currentRefreshTokenId !== refreshTokenId) {
        throw new Error("Nested cross-domain auth source session does not match the requested refresh token ID.");
      }
      await this._redirectTo({
        url: await this._createCrossDomainAuthRedirectUrl({
          redirectUri: redirectUriUrl.toString(),
          state,
          codeChallenge,
          afterCallbackRedirectUrl: afterCallbackRedirectUrl.toString(),
          awaitPendingAuthResolutions: false,
        }),
        replace: true,
      });
      return true;
    }

    // We are on b.com. Bounce to the trusted callback on a.com with a normal OAuth request
    // shape; a.com will verify the source session and issue the one-time code.
    const currentRefreshTokenId = await this._fetchCurrentRefreshTokenIdIfSignedIn({ awaitPendingAuthResolutions: false });
    if (currentRefreshTokenId === refreshTokenId) return false;
    if (currentRefreshTokenId != null) {
      const session = await this._getSession(undefined, { awaitPendingAuthResolutions: false });
      session.markInvalid();
    }
    const callbackUrlString = currentUrl.searchParams.get(nestedCrossDomainAuthQueryParams.callbackUrl);
    if (callbackUrlString == null) {
      throw new HexclaveAssertionError("Nested cross-domain auth URL is missing callback URL");
    }
    if (isRelative(callbackUrlString)) {
      throw new Error("Nested cross-domain auth callback URL must be absolute.");
    }
    const callbackUrl = new URL(callbackUrlString);
    const isTrusted = await this._isTrusted(callbackUrl.toString());
    if (!isTrusted) {
      throw new Error(`Nested cross-domain auth callback URL ${callbackUrlString} is not trusted.`);
    }

    const afterCallbackRedirectUrl = new URL(currentUrl);
    afterCallbackRedirectUrl.searchParams.delete(nestedCrossDomainAuthQueryParams.refreshTokenId);
    afterCallbackRedirectUrl.searchParams.delete(nestedCrossDomainAuthQueryParams.callbackUrl);
    const nestedHandoffSourceUrl = new URL(currentUrl);
    nestedHandoffSourceUrl.searchParams.delete(crossDomainAuthQueryParams.state);
    nestedHandoffSourceUrl.searchParams.delete(crossDomainAuthQueryParams.codeChallenge);
    const { state: newState, codeChallenge: newCodeChallenge } = await this._getCrossDomainHandoffParamsForRedirect(nestedHandoffSourceUrl);
    const nestedRedirectUri = new URL(currentUrl);

    callbackUrl.searchParams.set(nestedCrossDomainAuthQueryParams.refreshTokenId, refreshTokenId);
    callbackUrl.searchParams.set(nestedCrossDomainAuthQueryParams.redirectUri, nestedRedirectUri.toString());
    callbackUrl.searchParams.set(nestedCrossDomainAuthQueryParams.state, newState);
    callbackUrl.searchParams.set(nestedCrossDomainAuthQueryParams.codeChallenge, newCodeChallenge);
    callbackUrl.searchParams.set(nestedCrossDomainAuthQueryParams.codeChallengeMethod, "S256");
    callbackUrl.searchParams.set(nestedCrossDomainAuthQueryParams.afterCallbackRedirectUrl, afterCallbackRedirectUrl.toString());
    await this._redirectTo({ url: callbackUrl, replace: true });
    return true;
  }

  /**
   * Cloudflare workers does not allow use of randomness on the global scope (on which the Stack app is probably
   * initialized). For that reason, we generate the unique identifier lazily when it is first needed instead of in the
   * constructor.
   */
  protected _getUniqueIdentifier() {
    if (!this._uniqueIdentifier) {
      this._uniqueIdentifier = generateUuid();
      this._initUniqueIdentifier();
    }
    return this._uniqueIdentifier!;
  }

  protected async _checkFeatureSupport(name: string, options: any) {
    return await this._interface.checkFeatureSupport({ ...options, name });
  }

  protected _useCheckFeatureSupport(name: string, options: any): never {
    runAsynchronously(this._checkFeatureSupport(name, options));
    throw new HexclaveAssertionError(`${name} is not currently supported. Please reach out to Stack support for more information.`);
  }

  protected _memoryTokenStore = createEmptyTokenStore();
  protected _nextServerCookiesTokenStores = new WeakMap<object, Store<TokenObject>>();
  protected _requestTokenStores = new WeakMap<RequestLike, Store<TokenObject>>();
  protected _storedBrowserCookieTokenStore: Store<TokenObject> | null = null;
  private _mostRecentQueuedCookieRefreshIndex: number = 0;
  protected get _legacyRefreshTokenCookieName() {
    return `stack-refresh-${this.projectId}`;
  }
  protected get _refreshTokenCookieName() {
    return `hexclave-refresh-${this.projectId}`;
  }
  private _getRefreshTokenDefaultCookieNameForSecure(secure: boolean): string {
    return `${secure ? "__Host-" : ""}${this._refreshTokenCookieName}--default`;
  }
  private _getCustomRefreshCookieName(domain: string): string {
    const encoded = encodeBase32(new TextEncoder().encode(domain.toLowerCase()));
    return `${this._refreshTokenCookieName}--custom-${encoded}`;
  }
  private _getDomainFromCustomRefreshCookieName(name: string): string | null {
    for (const base of [this._refreshTokenCookieName, this._legacyRefreshTokenCookieName]) {
      const prefix = `${base}--custom-`;
      if (!name.startsWith(prefix)) continue;
      try {
        return new TextDecoder().decode(decodeBase32(name.slice(prefix.length)));
      } catch {
        return null;
      }
    }
    return null;
  }
  private _formatRefreshCookieValue(refreshToken: string, updatedAt: number): string {
    return JSON.stringify({
      refresh_token: refreshToken,
      updated_at_millis: updatedAt,
    });
  }
  private _formatAccessCookieValue(refreshToken: string | null, accessToken: string | null): string | null {
    return refreshToken && accessToken ? JSON.stringify([refreshToken, accessToken]) : null;
  }
  private _parseStructuredRefreshCookie(value: string | undefined): { refreshToken: string, updatedAt: number | null } | null {
    if (!value) {
      return null;
    }
    const parsed = parseJson(value);
    if (parsed.status !== "ok" || typeof parsed.data !== "object" || parsed.data === null) {
      console.warn("Failed to parse structured refresh cookie");
      return null;
    }
    const data = parsed.data;
    const refreshToken = "refresh_token" in data && typeof data.refresh_token === "string" ? data.refresh_token : null;
    const updatedAt = "updated_at_millis" in data && typeof data.updated_at_millis === "number" ? data.updated_at_millis : null;
    if (!refreshToken) {
      console.warn("Refresh token not found in structured refresh cookie");
      return null;
    }
    return {
      refreshToken,
      updatedAt,
    };

  }
  private _extractRefreshTokenFromCookieMap(cookies: cookie.Cookies): { refreshToken: string | null, updatedAt: number | null } {
    const { legacyNames, structuredPrefixes } = this._getRefreshTokenCookieNamePatterns();
    const currentStructuredPrefixes = [
      `${this._refreshTokenCookieName}--`,
      `__Host-${this._refreshTokenCookieName}--`,
    ];
    const getNewestStructuredCookie = (prefixes: string[]) => {
      let selected: { refreshToken: string, updatedAt: number | null } | null = null;
      for (const [name, value] of Object.entries(cookies)) {
        if (!prefixes.some(prefix => name.startsWith(prefix))) continue;
        const parsed = this._parseStructuredRefreshCookie(value);
        if (!parsed) continue;
        const candidateUpdatedAt = parsed.updatedAt ?? Number.NEGATIVE_INFINITY;
        const selectedUpdatedAt = selected?.updatedAt ?? Number.NEGATIVE_INFINITY;
        if (!selected || candidateUpdatedAt > selectedUpdatedAt) {
          selected = parsed;
        }
      }
      return selected;
    };

    const currentStructuredCookie = getNewestStructuredCookie(currentStructuredPrefixes);
    if (currentStructuredCookie) {
      return {
        refreshToken: currentStructuredCookie.refreshToken,
        updatedAt: currentStructuredCookie.updatedAt ?? null,
      };
    }

    // Legacy cookies are migration-only. Once a Hexclave cookie exists, it wins;
    // otherwise an old SDK tab with an anonymous legacy cookie can sign a
    // new-SDK tab out through the compatibility read.
    for (const name of legacyNames) {
      const value = cookies[name];
      if (value) {
        return { refreshToken: value, updatedAt: null };
      }
    }

    const selected = getNewestStructuredCookie(structuredPrefixes);

    if (!selected) {
      return { refreshToken: null, updatedAt: null };
    }

    return {
      refreshToken: selected.refreshToken,
      updatedAt: selected.updatedAt ?? null,
    };
  }
  protected _getTokensFromCookies(cookies: cookie.Cookies): TokenObject {
    const { refreshToken } = this._extractRefreshTokenFromCookieMap(cookies);
    const accessTokenCookie = cookies[this._accessTokenCookieName] ?? cookies[this._legacyAccessTokenCookieName] ?? null;
    let accessToken: string | null = null;
    if (accessTokenCookie && accessTokenCookie.startsWith('[\"')) {
      const parsed = parseJson(accessTokenCookie);
      if (
        parsed.status === "ok" &&
        typeof parsed.data === "object" &&
        parsed.data !== null &&
        Array.isArray(parsed.data) &&
        parsed.data.length === 2 &&
        typeof parsed.data[0] === "string" &&
        typeof parsed.data[1] === "string"
      ) {
        if (parsed.data[0] === refreshToken) {
          accessToken = parsed.data[1];
        }
      } else {
        console.warn("Access token cookie has invalid format");
      }
    }
    return {
      refreshToken,
      accessToken,
    };
  }
  private _getCurrentBrowserCookieTokenStoreValue(old: TokenObject | null): TokenObject {
    const tokens = this._getTokensFromCookies(this._getAllBrowserCookies());
    return {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken ?? (old?.refreshToken === tokens.refreshToken ? old.accessToken : null),
    };
  }
  protected get _accessTokenCookieName() {
    // The access token, unlike the refresh token, should not depend on the project ID. We never want to store the
    // access token in cookies more than once because of how big it is (there's a limit of 4096 bytes for all cookies
    // together). This means that, if you have multiple projects on the same domain, some of them will need to refetch
    // the access token on page reload.
    return `hexclave-access`;
  }
  protected get _legacyAccessTokenCookieName() {
    return `stack-access`;
  }
  private _getAllBrowserCookies(): cookie.Cookies {
    if (!isBrowserLike()) {
      throw new HexclaveAssertionError("Cannot get browser cookies on the server!");
    }
    return cookie.parseCookie(document.cookie || "");
  }
  private _getRefreshTokenCookieNamePatterns(): { legacyNames: string[], structuredPrefixes: string[] } {
    return {
      legacyNames: [this._legacyRefreshTokenCookieName, "stack-refresh"],
      structuredPrefixes: [
        `${this._refreshTokenCookieName}--`,
        `__Host-${this._refreshTokenCookieName}--`,
        `${this._legacyRefreshTokenCookieName}--`,
        `__Host-${this._legacyRefreshTokenCookieName}--`,
      ],
    };
  }
  private _collectRefreshTokenCookieNames(cookies: cookie.Cookies): Set<string> {
    const { legacyNames, structuredPrefixes } = this._getRefreshTokenCookieNamePatterns();
    const names = new Set<string>();
    for (const name of legacyNames) {
      if (cookies[name]) {
        names.add(name);
      }
    }
    for (const name of Object.keys(cookies)) {
      if (structuredPrefixes.some(prefix => name.startsWith(prefix))) {
        names.add(name);
      }
    }
    return names;
  }
  private _prepareRefreshCookieUpdate(
    existingCookies: cookie.Cookies,
    refreshToken: string | null,
    accessToken: string | null,
    defaultCookieName: string,
  ) {
    const cookieNames = this._collectRefreshTokenCookieNames(existingCookies);
    cookieNames.delete(defaultCookieName);
    const updatedAt = refreshToken ? Date.now() : null;
    const refreshCookieValue = refreshToken && updatedAt !== null ? this._formatRefreshCookieValue(refreshToken, updatedAt) : null;
    const accessTokenPayload = this._formatAccessCookieValue(refreshToken, accessToken);
    return {
      updatedAt,
      refreshCookieValue,
      accessTokenPayload,
      cookieNamesToDelete: [...cookieNames],
    };
  }

  private _ensureCrossSubdomainCookieExists() {
    runAsynchronously(async () => {
      const hostname = window.location.hostname;
      const domain = await this._trustedParentDomainCache.getOrWait([hostname], "read-write");
      if (domain.status === "error" || !domain.data) {
        return;
      }
      const cookies = this._getAllBrowserCookies();
      const customCookieName = this._getCustomRefreshCookieName(domain.data);
      if (cookies[customCookieName]) {
        return;
      }
      const { refreshToken, updatedAt } = this._extractRefreshTokenFromCookieMap(cookies);
      if (refreshToken && updatedAt) {
        const value = this._formatRefreshCookieValue(refreshToken, updatedAt);
        setOrDeleteCookieClient(customCookieName, value, { maxAge: 60 * 60 * 24 * 365, domain: domain.data });
      }
    });
  }
  private _queueCustomRefreshCookieUpdate(refreshToken: string | null, updatedAt: number | null, context: "browser" | "server") {
    runAsynchronously(async () => {
      this._mostRecentQueuedCookieRefreshIndex++;
      const updateIndex = this._mostRecentQueuedCookieRefreshIndex;
      let hostname;
      if (isBrowserLike()) {
        hostname = window.location.hostname;
      } else {
        hostname = await getServerRequestHost();
      }
      if (!hostname) {
        console.warn("No hostname found when queueing custom refresh cookie update");
        return;
      }
      const domain = await this._trustedParentDomainCache.getOrWait([hostname], "read-write");

      const cookieOptions = { maxAge: 60 * 60 * 24 * 365, noOpIfServerComponent: true };
      const setCookie = async (targetDomain: string, value: string | null) => {
        const name = this._getCustomRefreshCookieName(targetDomain);
        const options = { ...cookieOptions, domain: targetDomain };
        if (context === "browser") {
          setOrDeleteCookieClient(name, value, options);
        } else {
          await setOrDeleteCookie(name, value, options);
        }
      };

      if (domain.status === "error" || !domain.data || updateIndex !== this._mostRecentQueuedCookieRefreshIndex) {
        return;
      }
      const value = refreshToken && updatedAt ? this._formatRefreshCookieValue(refreshToken, updatedAt) : null;
      await setCookie(domain.data, value);
      const isSecure = await isSecureCookieContext();
      const defaultName = this._getRefreshTokenDefaultCookieNameForSecure(isSecure);
      if (context === "browser") {
        setOrDeleteCookieClient(defaultName, null, cookieOptions);
      } else {
        await setOrDeleteCookie(defaultName, null, cookieOptions);
      }
    });
  }
  private async _getTrustedRedirectConfig(): Promise<{ allowLocalhost: boolean, trustedDomains: string[] }> {
    const project = Result.orThrow(await this._currentProjectCache.getOrWait([], "write-only"));
    return {
      allowLocalhost: project.config.allow_localhost,
      trustedDomains: [
        ...project.config.domains.map(d => d.domain),
        new URL(getHostedHandlerUrl({ projectId: this.projectId, pagePath: "" })).origin,
      ],
    };
  }

  private async _getTrustedParentDomain(currentDomain: string): Promise<string | null> {
    return getTrustedParentDomain(currentDomain, (await this._getTrustedRedirectConfig()).trustedDomains);
  }

  protected _getBrowserCookieTokenStore(): Store<TokenObject> {
    if (!isBrowserLike()) {
      throw new Error("Cannot use cookie token store on the server!");
    }

    if (this._storedBrowserCookieTokenStore === null) {
      this._storedBrowserCookieTokenStore = new Store<TokenObject>(this._getCurrentBrowserCookieTokenStoreValue(null));
      let hasSucceededInWriting = true;

      setInterval(() => {
        if (hasSucceededInWriting) {
          const oldValue = this._storedBrowserCookieTokenStore!.get();
          const currentValue = this._getCurrentBrowserCookieTokenStoreValue(oldValue);
          if (!deepPlainEquals(currentValue, oldValue)) {
            this._storedBrowserCookieTokenStore!.set(currentValue);
          }
        }
      }, 100);
      this._storedBrowserCookieTokenStore.onChange((value) => {
        try {
          const refreshToken = value.refreshToken;
          const secure = window.location.protocol === "https:";
          const defaultName = this._getRefreshTokenDefaultCookieNameForSecure(secure);
          const { updatedAt, refreshCookieValue, accessTokenPayload, cookieNamesToDelete } = this._prepareRefreshCookieUpdate(
            this._getAllBrowserCookies(),
            refreshToken,
            value.accessToken ?? null,
            defaultName,
          );
          setOrDeleteCookieClient(defaultName, refreshCookieValue, { maxAge: 60 * 60 * 24 * 365, secure });
          setOrDeleteCookieClient(this._accessTokenCookieName, accessTokenPayload, { maxAge: 60 * 60 * 24 });
          cookieNamesToDelete.forEach((name) => {
            const domain = this._getDomainFromCustomRefreshCookieName(name);
            deleteCookieClient(name, domain ? { domain } : {});
          });
          this._queueCustomRefreshCookieUpdate(refreshToken, updatedAt, "browser");
          hasSucceededInWriting = true;
        } catch (e) {
          if (!isBrowserLike()) {
            // Setting cookies inside RSCs is not allowed, so we just ignore it
            hasSucceededInWriting = false;
          } else {
            throw e;
          }
        }
      });
    } else {
      const oldValue = this._storedBrowserCookieTokenStore.get();
      const currentValue = this._getCurrentBrowserCookieTokenStoreValue(oldValue);
      if (!deepPlainEquals(currentValue, oldValue)) {
        this._storedBrowserCookieTokenStore.set(currentValue);
      }
    }

    return this._storedBrowserCookieTokenStore;
  };
  protected _getOrCreateTokenStore(cookieHelper: CookieHelper, overrideTokenStoreInit?: TokenStoreInit): Store<TokenObject> {
    const tokenStoreInit = overrideTokenStoreInit === undefined ? this._tokenStoreInit : overrideTokenStoreInit;

    switch (tokenStoreInit) {
      case "cookie": {
        // IF_PLATFORM tanstack-start
        if (!isBrowserLike()) {
          return this._getOrCreateTokenStore(cookieHelper, "nextjs-cookie");
        }
        // END_PLATFORM
        return this._getBrowserCookieTokenStore();
      }
      case "nextjs-cookie": {
        if (isBrowserLike()) {
          return this._getBrowserCookieTokenStore();
        } else {
          const tokens = this._getTokensFromCookies(cookieHelper.getAll());
          const store = new Store<TokenObject>(tokens);
          store.onChange((value) => {
            runAsynchronously(async () => {
              // TODO HACK this is a bit of a hack; while the order happens to work in practice (because the only actual
              // async operation is waiting for the `cookies()` to resolve which always happens at the same time during
              // the same request), it's not guaranteed to be free of race conditions if there are many updates happening
              // at the same time
              //
              // instead, we should create a per-request cookie helper outside of the store onChange and reuse that
              //
              // but that's kinda hard to do because Next.js doesn't expose a documented way to find out which request
              // we're currently processing, and hence we can't find out which per-request cookie helper to use
              //
              // so hack it is
              const refreshToken = value.refreshToken;
              const secure = await isSecureCookieContext();
              const defaultName = this._getRefreshTokenDefaultCookieNameForSecure(secure);
              const { updatedAt, refreshCookieValue, accessTokenPayload, cookieNamesToDelete } = this._prepareRefreshCookieUpdate(
                cookieHelper.getAll(),
                refreshToken,
                value.accessToken ?? null,
                defaultName,
              );
              await Promise.all([
                setOrDeleteCookie(defaultName, refreshCookieValue, { maxAge: 60 * 60 * 24 * 365, noOpIfServerComponent: true }),
                setOrDeleteCookie(this._accessTokenCookieName, accessTokenPayload, { maxAge: 60 * 60 * 24, noOpIfServerComponent: true }),
              ]);
              if (cookieNamesToDelete.length > 0) {
                await Promise.all(
                  cookieNamesToDelete.map((name) => {
                    const domain = this._getDomainFromCustomRefreshCookieName(name);
                    return deleteCookie(name, { noOpIfServerComponent: true, ...(domain ? { domain } : {}) });
                  }),
                );
              }
              this._queueCustomRefreshCookieUpdate(refreshToken, updatedAt, "server");
            });
          });
          return store;
        }
      }
      case "memory": {
        return this._memoryTokenStore;
      }
      default: {
        if (tokenStoreInit === null) {
          return createEmptyTokenStore();
        } else if (typeof tokenStoreInit === "object" && "headers" in tokenStoreInit) {
          if (this._requestTokenStores.has(tokenStoreInit)) return this._requestTokenStores.get(tokenStoreInit)!;

          // Authorization header (recommended)
          const authorizationHeader = getHeaderValueFromRequestLikeHeaders(tokenStoreInit.headers, "authorization");
          if (authorizationHeader) {
            const authJson = getAuthJsonFromAuthorizationHeaderValue(authorizationHeader);
            if (authJson != null) {
              const tokenStore = new Store<TokenObject>({
                accessToken: authJson.accessToken,
                refreshToken: authJson.refreshToken,
              });
              this._requestTokenStores.set(tokenStoreInit, tokenStore);
              return tokenStore;
            }
          }

          // x-stack-auth header (legacy)
          const stackAuthHeader = getHeaderValueFromRequestLikeHeaders(tokenStoreInit.headers, "x-stack-auth");
          if (stackAuthHeader) {
            let parsed;
            try {
              parsed = JSON.parse(stackAuthHeader);
              if (typeof parsed !== "object") throw new Error("x-stack-auth header must be a JSON object");
              if (parsed === null) throw new Error("x-stack-auth header must not be null");
            } catch (e) {
              throw new Error("Invalid x-stack-auth header.", { cause: e });
            }
            return this._getOrCreateTokenStore(cookieHelper, {
              accessToken: parsed.accessToken ?? null,
              refreshToken: parsed.refreshToken ?? null,
            });
          }

          // read from cookies
          const cookieHeader = getHeaderValueFromRequestLikeHeaders(tokenStoreInit.headers, "cookie");
          const parsed = cookie.parseCookie(cookieHeader || "");
          const res = new Store<TokenObject>(this._getTokensFromCookies(parsed));
          this._requestTokenStores.set(tokenStoreInit, res);
          return res;
        } else if ("accessToken" in tokenStoreInit || "refreshToken" in tokenStoreInit) {
          return new Store<TokenObject>({
            refreshToken: tokenStoreInit.refreshToken,
            accessToken: tokenStoreInit.accessToken,
          });
        }

        throw new Error(`Invalid token store ${tokenStoreInit}`);
      }
    }
  }

  // IF_PLATFORM react-like
  protected _useTokenStore(overrideTokenStoreInit?: TokenStoreInit): Store<TokenObject> {
    // IF_PLATFORM tanstack-start
    if (!isBrowserLike()) {
      return this._getOrCreateTokenStore(use(createCookieHelper()), overrideTokenStoreInit);
    }
    // END_PLATFORM
    suspendIfSsr();
    const cookieHelper = createBrowserCookieHelper();
    const tokenStore = this._getOrCreateTokenStore(cookieHelper, overrideTokenStoreInit);
    return tokenStore;
  }
  // END_PLATFORM

  /**
   * A map from token stores and session keys to sessions.
   *
   * This isn't just a map from session keys to sessions for two reasons:
   *
   * - So we can garbage-collect Session objects when the token store is garbage-collected
   * - So different token stores are separated and don't leak information between each other, eg. if the same user sends two requests to the same server they should get a different session object
   */
  private _sessionsByTokenStoreAndSessionKey = new WeakMap<Store<TokenObject>, Map<string, InternalSession>>();
  protected _getSessionFromTokenStore(tokenStore: Store<TokenObject>): InternalSession {
    const tokenObj = tokenStore.get();
    const sessionKey = InternalSession.calculateSessionKey(tokenObj);
    const existing = sessionKey ? this._sessionsByTokenStoreAndSessionKey.get(tokenStore)?.get(sessionKey) : null;
    if (existing) return existing;

    const session = this._interface.createSession({
      refreshToken: tokenObj.refreshToken,
      accessToken: tokenObj.accessToken,
    });
    session.onAccessTokenChange((newAccessToken) => {
      tokenStore.update((old) => InternalSession.calculateSessionKey(old) === sessionKey ? {
        ...old,
        accessToken: newAccessToken?.token ?? null
      } : old);
    });
    session.onInvalidate(() => {
      tokenStore.update((old) => InternalSession.calculateSessionKey(old) === sessionKey ? {
        ...old,
        accessToken: null,
        refreshToken: null,
      } : old);
    });

    let sessionsBySessionKey = this._sessionsByTokenStoreAndSessionKey.get(tokenStore) ?? new Map();
    this._sessionsByTokenStoreAndSessionKey.set(tokenStore, sessionsBySessionKey);
    sessionsBySessionKey.set(sessionKey, session);
    return session;
  }

  protected async _getSession(
    overrideTokenStoreInit?: TokenStoreInit,
    options?: { awaitPendingAuthResolutions?: boolean },
  ): Promise<InternalSession> {
    await this._awaitPendingAuthResolutions(overrideTokenStoreInit, options);
    const tokenStore = this._getOrCreateTokenStore(await this._createCookieHelper(overrideTokenStoreInit), overrideTokenStoreInit);
    const session = this._getSessionFromTokenStore(tokenStore);
    return session;
  }

  // IF_PLATFORM react-like
  protected _useSession(overrideTokenStoreInit?: TokenStoreInit): InternalSession {
    this._usePendingAuthResolutions(overrideTokenStoreInit);
    const tokenStore = this._useTokenStore(overrideTokenStoreInit);
    const subscribe = useCallback((cb: () => void) => {
      return subscribeSessionRefresh({
        tokenStore,
        getSession: () => this._getSessionFromTokenStore(tokenStore),
        onTokenStoreChange: cb,
      });
    }, [tokenStore]);
    const getSnapshot = useCallback(() => this._getSessionFromTokenStore(tokenStore), [tokenStore]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }
  // END_PLATFORM

  protected async _signInToAccountWithTokens(tokens: { accessToken: string | null, refreshToken: string }) {
    if (!("accessToken" in tokens) || !("refreshToken" in tokens)) {
      throw new HexclaveAssertionError("Invalid tokens object; can't sign in with this", { tokens });
    }
    const tokenStore = this._getOrCreateTokenStore(await this._createCookieHelper());
    tokenStore.set(tokens);

    // If these tokens resolve to a session we already have (eg. the RDE dashboard re-installing a freshly minted
    // access token for the same access-only session), push the new token into it in place; constructing a new
    // session here would cold-invalidate every session-scoped cache and suspend the UI on each refresh.
    const session = this._getSessionFromTokenStore(tokenStore);
    session.updateAccessToken(tokens);

    // Pre-fetch the current user so the cache is warm when useUser() re-renders (write-only, so it never suspends).
    runAsynchronously(this._currentUserCache.getOrWait([session], "write-only"));
  }

  protected _getTokenStoreInitForFreshTokens(tokens: { accessToken: string | null, refreshToken: string }): TokenStoreInit | undefined {
    if (tokens.accessToken == null) {
      return undefined;
    }
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  protected _hasPersistentTokenStore(overrideTokenStoreInit?: TokenStoreInit): this is StackClientApp<true, ProjectId> {
    return (overrideTokenStoreInit !== undefined ? overrideTokenStoreInit : this._tokenStoreInit) !== null;
  }

  protected _ensurePersistentTokenStore(overrideTokenStoreInit?: TokenStoreInit): asserts this is StackClientApp<true, ProjectId> {
    if (!this._hasPersistentTokenStore(overrideTokenStoreInit)) {
      throw new Error("Cannot call this function on a Stack app without a persistent token store. Make sure the tokenStore option on the constructor is set to a non-null value when initializing Stack.\n\nStack uses token stores to access access tokens of the current user. For example, on web frontends it is commonly the string value 'cookies' for cookie storage.");
    }
  }

  protected _isInternalProject(): this is { projectId: "internal" } {
    return this.projectId === "internal";
  }

  protected _ensureInternalProject(): asserts this is { projectId: "internal" } {
    if (!this._isInternalProject()) {
      throw new Error("Cannot call this function on a Stack app with a project ID other than 'internal'.");
    }
  }

  protected _clientProjectFromCrud(crud: ClientProjectsCrud['Client']['Read']): Project {
    return {
      id: crud.id,
      displayName: crud.display_name,
      config: {
        signUpEnabled: crud.config.sign_up_enabled,
        credentialEnabled: crud.config.credential_enabled,
        magicLinkEnabled: crud.config.magic_link_enabled,
        passkeyEnabled: crud.config.passkey_enabled,
        clientTeamCreationEnabled: crud.config.client_team_creation_enabled,
        clientUserDeletionEnabled: crud.config.client_user_deletion_enabled,
        allowTeamApiKeys: crud.config.allow_team_api_keys,
        allowUserApiKeys: crud.config.allow_user_api_keys,
        oauthProviders: crud.config.enabled_oauth_providers.map((p) => ({
          id: p.id,
        })),
      }
    };
  }

  protected _clientPermissionFromCrud(crud: TeamPermissionsCrud['Client']['Read'] | ProjectPermissionsCrud['Client']['Read']): TeamPermission {
    return {
      id: crud.id,
    };
  }

  protected _clientTeamUserFromCrud(crud: TeamMemberProfilesCrud['Client']['Read']): TeamUser {
    return {
      id: crud.user_id,
      teamProfile: {
        displayName: crud.display_name,
        profileImageUrl: crud.profile_image_url,
      }
    };
  }

  protected _clientSentTeamInvitationFromCrud(session: InternalSession, crud: TeamInvitationCrud['Client']['Read']): SentTeamInvitation {
    return {
      id: crud.id,
      recipientEmail: crud.recipient_email,
      expiresAt: new Date(crud.expires_at_millis),
      revoke: async () => {
        await this._interface.revokeTeamInvitation(crud.id, crud.team_id, session);
        await this._teamInvitationsCache.refresh([session, crud.team_id]);
      },
    };
  }

  protected _clientReceivedTeamInvitationFromCrud(session: InternalSession, crud: TeamInvitationCrud['Client']['Read']): ReceivedTeamInvitation {
    const app = this;
    return {
      id: crud.id,
      teamId: crud.team_id,
      teamDisplayName: crud.team_display_name,
      recipientEmail: crud.recipient_email,
      expiresAt: new Date(crud.expires_at_millis),
      accept: async () => {
        await app._interface.acceptTeamInvitationById(crud.id, session);
        await Promise.all([
          app._currentUserTeamInvitationsCache.refresh([session]),
          app._currentUserTeamsCache.refresh([session]),
          app._teamInvitationsCache.refresh([session, crud.team_id]),
        ]);
      },
    };
  }

  protected _baseApiKeyFromCrud(
    crud: TeamApiKeysCrud['Client']['Read'] | UserApiKeysCrud['Client']['Read'] | yup.InferType<typeof teamApiKeysCreateOutputSchema> | yup.InferType<typeof userApiKeysCreateOutputSchema>
  ): Omit<ApiKey<"user", boolean>, "revoke" | "update"> | Omit<ApiKey<"team", boolean>, "revoke" | "update"> {
    return {
      id: crud.id,
      description: crud.description,
      expiresAt: crud.expires_at_millis ? new Date(crud.expires_at_millis) : undefined,
      manuallyRevokedAt: crud.manually_revoked_at_millis ? new Date(crud.manually_revoked_at_millis) : null,
      createdAt: new Date(crud.created_at_millis),
      ...(crud.type === "team" ? { type: "team", teamId: crud.team_id } : { type: "user", userId: crud.user_id }),
      value: typeof crud.value === "string" ? crud.value : {
        lastFour: crud.value.last_four,
      },
      isValid: function () {
        return this.whyInvalid() === null;
      },
      whyInvalid: function () {
        if (this.manuallyRevokedAt) {
          return "manually-revoked";
        }
        if (this.expiresAt && this.expiresAt < new Date()) {
          return "expired";
        }
        return null;
      },
    };
  }


  protected _clientApiKeyFromCrud(session: InternalSession, crud: TeamApiKeysCrud['Client']['Read']): ApiKey<"team">;
  protected _clientApiKeyFromCrud(session: InternalSession, crud: UserApiKeysCrud['Client']['Read']): ApiKey<"user">;
  protected _clientApiKeyFromCrud(session: InternalSession, crud: yup.InferType<typeof teamApiKeysCreateOutputSchema>): ApiKey<"team", true>;
  protected _clientApiKeyFromCrud(session: InternalSession, crud: yup.InferType<typeof userApiKeysCreateOutputSchema>): ApiKey<"user", true>;
  protected _clientApiKeyFromCrud(session: InternalSession, crud: TeamApiKeysCrud['Client']['Read'] | UserApiKeysCrud['Client']['Read'] | yup.InferType<typeof teamApiKeysCreateOutputSchema> | yup.InferType<typeof userApiKeysCreateOutputSchema>): ApiKey<"user" | "team", boolean> {
    return {
      ...this._baseApiKeyFromCrud(crud),
      async revoke() {
        await this.update({ revoked: true });
      },
      update: async (options: ApiKeyUpdateOptions) => {
        await this._interface.updateProjectApiKey(crud.type === "team" ? { team_id: crud.team_id } : { user_id: crud.user_id }, crud.id, options, session, "client");
        if (crud.type === "team") {
          await this._teamApiKeysCache.refresh([session, crud.team_id]);
        } else {
          await this._userApiKeysCache.refresh([session]);
        }
      },
    };
  }

  protected _clientTeamFromCrud(crud: TeamsCrud['Client']['Read'], session: InternalSession): Team {
    const app = this;
    return {
      id: crud.id,
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      clientMetadata: crud.client_metadata,
      clientReadOnlyMetadata: crud.client_read_only_metadata,
      ...this._createCustomer(crud.id, "team", session),
      async inviteUser(options: { email: string, callbackUrl?: string }) {
        await app._interface.sendTeamInvitation({
          teamId: crud.id,
          email: options.email,
          session,
          callbackUrl: options.callbackUrl ?? constructRedirectUrl(app._getUrls().teamInvitation, "callbackUrl"),
        });
        await app._teamInvitationsCache.refresh([session, crud.id]);
      },
      async listUsers() {
        const result = Result.orThrow(await app._teamMemberProfilesCache.getOrWait([session, crud.id], "write-only"));
        return result.map((crud) => app._clientTeamUserFromCrud(crud));
      },
      // IF_PLATFORM react-like
      useUsers() {
        const result = useAsyncCache(app._teamMemberProfilesCache, [session, crud.id] as const, "team.useUsers()");
        return result.map((crud) => app._clientTeamUserFromCrud(crud));
      },
      // END_PLATFORM
      async listInvitations() {
        const result = Result.orThrow(await app._teamInvitationsCache.getOrWait([session, crud.id], "write-only"));
        return result.map((crud) => app._clientSentTeamInvitationFromCrud(session, crud));
      },
      // IF_PLATFORM react-like
      useInvitations() {
        const result = useAsyncCache(app._teamInvitationsCache, [session, crud.id] as const, "team.useInvitations()");
        return result.map((crud) => app._clientSentTeamInvitationFromCrud(session, crud));
      },
      // END_PLATFORM
      async update(data: TeamUpdateOptions) {
        await app._interface.updateTeam({ data: teamUpdateOptionsToCrud(data), teamId: crud.id }, session);
        await app._currentUserTeamsCache.refresh([session]);
      },
      async delete() {
        await app._interface.deleteTeam(crud.id, session);
        await app._currentUserTeamsCache.refresh([session]);
      },

      // IF_PLATFORM react-like
      useApiKeys() {
        const result = useAsyncCache(app._teamApiKeysCache, [session, crud.id] as const, "team.useApiKeys()");
        return result.map((crud) => app._clientApiKeyFromCrud(session, crud));
      },
      // END_PLATFORM

      async listApiKeys() {
        const results = Result.orThrow(await app._teamApiKeysCache.getOrWait([session, crud.id], "write-only"));
        return results.map((crud) => app._clientApiKeyFromCrud(session, crud));
      },

      async createApiKey(options: ApiKeyCreationOptions<"team">) {
        const result = await app._interface.createProjectApiKey(
          await apiKeyCreationOptionsToCrud("team", crud.id, options),
          session,
          "client",
        );
        await app._teamApiKeysCache.refresh([session, crud.id]);
        return app._clientApiKeyFromCrud(session, result);
      },
    };
  }

  protected _clientContactChannelFromCrud(crud: ContactChannelsCrud['Client']['Read'], session: InternalSession): ContactChannel {
    const app = this;
    return {
      id: crud.id,
      value: crud.value,
      type: crud.type,
      isVerified: crud.is_verified,
      isPrimary: crud.is_primary,
      usedForAuth: crud.used_for_auth,

      async sendVerificationEmail(options?: { callbackUrl?: string }) {
        await app._interface.sendCurrentUserContactChannelVerificationEmail(
          crud.id,
          options?.callbackUrl || constructRedirectUrl(app._getUrls().emailVerification, "callbackUrl"),
          session
        );
      },
      async update(data: ContactChannelUpdateOptions) {
        await app._interface.updateClientContactChannel(crud.id, contactChannelUpdateOptionsToCrud(data), session);
        await app._clientContactChannelsCache.refresh([session]);
      },
      async delete() {
        await app._interface.deleteClientContactChannel(crud.id, session);
        await app._clientContactChannelsCache.refresh([session]);
      },
    };
  }
  protected _clientNotificationCategoryFromCrud(crud: NotificationPreferenceCrud['Client']['Read'], session: InternalSession): NotificationCategory {
    const app = this;
    return {
      id: crud.notification_category_id,
      name: crud.notification_category_name,
      enabled: crud.enabled,
      canDisable: crud.can_disable,

      async setEnabled(enabled: boolean) {
        await app._interface.setNotificationsEnabled(crud.notification_category_id, enabled, session);
        await app._notificationCategoriesCache.refresh([session]);
      },
    };
  }
  protected _clientOAuthProviderFromCrud(crud: OAuthProviderCrud['Client']['Read'], session: InternalSession): OAuthProvider {
    const app = this;
    return {
      id: crud.id,
      type: crud.type,
      userId: crud.user_id,
      email: crud.email,
      allowSignIn: crud.allow_sign_in,
      allowConnectedAccounts: crud.allow_connected_accounts,

      async update(data: { allowSignIn?: boolean, allowConnectedAccounts?: boolean }): Promise<Result<void,
        InstanceType<typeof KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn>
      >> {
        try {
          await app._interface.updateOAuthProvider(
            crud.user_id,
            crud.id,
            {
              allow_sign_in: data.allowSignIn,
              allow_connected_accounts: data.allowConnectedAccounts,
            },
            session
          );
          await Promise.all([
            app._currentUserOAuthProvidersCache.refresh([session]),
            app._currentUserConnectedAccountsCache.refresh([session]),
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
        await app._interface.deleteOAuthProvider(crud.user_id, crud.id, session);
        await Promise.all([
          app._currentUserOAuthProvidersCache.refresh([session]),
          app._currentUserConnectedAccountsCache.refresh([session]),
        ]);
      },
    };
  }

  protected _clientItemFromCrud(crud: ItemCrud['Client']['Read']): Item {
    const app = this;
    return {
      displayName: crud.display_name,
      quantity: crud.quantity,
      nonNegativeQuantity: Math.max(0, crud.quantity),
    };
  }

  protected _customerProductsFromResponse(response: CustomerProductsListResponse): CustomerProductsList {
    const products = response.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      displayName: item.product.display_name,
      customerType: item.product.customer_type,
      isServerOnly: item.product.server_only,
      stackable: item.product.stackable,
      type: item.type,
      subscription: item.subscription ? {
        subscriptionId: item.subscription.subscription_id,
        currentPeriodEnd: item.subscription.current_period_end ? new Date(item.subscription.current_period_end) : null,
        cancelAtPeriodEnd: item.subscription.cancel_at_period_end,
        isCancelable: item.subscription.is_cancelable,
      } : null,
      switchOptions: item.switch_options?.map((option) => ({
        productId: option.product_id,
        displayName: option.product.display_name,
        prices: option.product.prices,
      })),
    }));
    return Object.assign(products, { nextCursor: response.pagination.next_cursor ?? null });
  }

  protected _customerInvoicesFromResponse(response: CustomerInvoicesListResponse): CustomerInvoicesList {
    const invoices = response.items.map((item) => ({
      status: item.status as CustomerInvoiceStatus,
      amountTotal: item.amount_total,
      hostedInvoiceUrl: item.hosted_invoice_url,
      createdAt: new Date(item.created_at_millis),
    }));
    return Object.assign(invoices, { nextCursor: response.pagination.next_cursor ?? null });
  }

  protected _customerBillingFromResponse(response: {
    has_customer: boolean,
    default_payment_method: {
      id: string,
      brand: string | null,
      last4: string | null,
      exp_month: number | null,
      exp_year: number | null,
    } | null,
  }): CustomerBilling {
    return {
      hasCustomer: response.has_customer,
      defaultPaymentMethod: response.default_payment_method,
    };
  }

  protected _createAuth(session: InternalSession): Auth {
    const app = this;
    return {
      _internalSession: session,
      currentSession: {
        async getTokens() {
          const tokens = await session.getOrFetchLikelyValidTokens(20_000, 75_000);
          return {
            accessToken: tokens?.accessToken.token ?? null,
            refreshToken: tokens?.refreshToken?.token ?? null,
          };
        },
        // IF_PLATFORM react-like
        useTokens() {
          const subscribe = useCallback((cb: () => void) => {
            const { unsubscribe: unsubscribeInvalidate } = session.onInvalidate(cb);
            const { unsubscribe: unsubscribeAccessTokenChange } = session.onAccessTokenChange(cb);
            return () => {
              unsubscribeInvalidate();
              unsubscribeAccessTokenChange();
            };
          }, [session]);
          const getSnapshot = useCallback(() => {
            return session.isKnownToBeInvalid()
              ? null
              : session.getAccessTokenIfNotExpiredYet(20_000, 75_000)?.token ?? null;
          }, [session]);

          let accessToken = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
          if (accessToken === null && !session.isKnownToBeInvalid()) {
            // note: tokens is never actually assigned here in practice because getOrFetchLikelyValidTokens is always a fresh promise so the `use` hook always throws, but this is more idiomatic and makes the type checker happy
            accessToken = use(session.getOrFetchLikelyValidTokens(20_000, 75_000))?.accessToken.token ?? null;
          }
          return {
            accessToken,
            refreshToken: session.getRefreshToken()?.token ?? null,
          };
        },
        // END_PLATFORM
      },
      async getAccessToken(): Promise<string | null> {
        const tokens = await this.currentSession.getTokens();
        return tokens.accessToken;
      },
      // IF_PLATFORM react-like
      useAccessToken(): string | null {
        return this.currentSession.useTokens().accessToken;
      },
      // END_PLATFORM
      async getRefreshToken(): Promise<string | null> {
        const tokens = await this.currentSession.getTokens();
        return tokens.refreshToken;
      },
      // IF_PLATFORM react-like
      useRefreshToken(): string | null {
        return this.currentSession.useTokens().refreshToken;
      },
      // END_PLATFORM
      async getAuthorizationHeader(): Promise<string | null> {
        return getAuthorizationHeaderValueFromAuthJson(await this.getAuthJson());
      },
      // IF_PLATFORM react-like
      useAuthorizationHeader(): string | null {
        return getAuthorizationHeaderValueFromAuthJson(this.useAuthJson());
      },
      // END_PLATFORM
      async getAuthHeaders(): Promise<{ "x-stack-auth": string }> {
        return {
          "x-stack-auth": JSON.stringify(await this.getAuthJson()),
        };
      },
      // IF_PLATFORM react-like
      useAuthHeaders(): { "x-stack-auth": string } {
        return {
          "x-stack-auth": JSON.stringify(this.useAuthJson()),
        };
      },
      // END_PLATFORM
      async getAuthJson(): Promise<{ accessToken: string | null, refreshToken: string | null }> {
        const tokens = await this.currentSession.getTokens();
        return tokens;
      },
      // IF_PLATFORM react-like
      useAuthJson(): { accessToken: string | null, refreshToken: string | null } {
        return this.currentSession.useTokens();
      },
      // END_PLATFORM
      signOut(options?: { redirectUrl?: URL | string }) {
        return app._signOut(session, options);
      },
    };
  }

  protected _editableTeamProfileFromCrud(crud: TeamMemberProfilesCrud['Client']['Read'], session: InternalSession): EditableTeamMemberProfile {
    const app = this;
    return {
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      async update(update: { displayName?: string, profileImageUrl?: string }) {
        await app._interface.updateTeamMemberProfile({
          teamId: crud.team_id,
          userId: crud.user_id,
          profile: {
            display_name: update.displayName,
            profile_image_url: update.profileImageUrl,
          },
        }, session);
        await app._currentUserTeamProfileCache.refresh([session, crud.team_id]);
      }
    };
  }

  protected _createBaseUser(crud: NonNullable<CurrentUserCrud['Client']['Read']> | UsersCrud['Server']['Read']): BaseUser {
    return {
      id: crud.id,
      displayName: crud.display_name,
      primaryEmail: crud.primary_email,
      primaryEmailVerified: crud.primary_email_verified,
      profileImageUrl: crud.profile_image_url,
      signedUpAt: new Date(crud.signed_up_at_millis),
      clientMetadata: crud.client_metadata,
      clientReadOnlyMetadata: crud.client_read_only_metadata,
      hasPassword: crud.has_password,
      emailAuthEnabled: crud.auth_with_email,
      otpAuthEnabled: crud.otp_auth_enabled,
      oauthProviders: crud.oauth_providers,
      passkeyAuthEnabled: crud.passkey_auth_enabled,
      isMultiFactorRequired: crud.requires_totp_mfa,
      isAnonymous: crud.is_anonymous,
      isRestricted: crud.is_restricted,
      restrictedReason: crud.restricted_reason,
      toClientJson(): CurrentUserCrud['Client']['Read'] {
        return crud;
      }
    };
  }

  protected _createUserExtraFromCurrent(crud: NonNullable<CurrentUserCrud['Client']['Read']>, session: InternalSession): UserExtra {
    const app = this;
    /**
     * @deprecated The string-based overloads are deprecated. Use `getOrLinkConnectedAccount` for redirect behavior,
     * or `getConnectedAccount({ provider, providerAccountId })` for existence check.
     */
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
        const connectedAccounts = Result.orThrow(await app._currentUserConnectedAccountsCache.getOrWait([session], "write-only"));
        const found = connectedAccounts.find(
          a => a.provider === provider && a.providerAccountId === providerAccountId
        );
        if (!found) {
          return null;
        }
        return found;
      }

      // Original behavior: by provider ID (returns first match)
      return Result.orThrow(await app._currentUserOAuthConnectionCache.getOrWait([session, idOrAccount, scopeString, options?.or === 'redirect'], "write-only"));
    }

    // IF_PLATFORM react-like
    /**
     * @deprecated The string-based overloads are deprecated. Use `useOrLinkConnectedAccount` for redirect behavior,
     * or `useConnectedAccount({ provider, providerAccountId })` for existence check.
     */
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
          app._currentUserConnectedAccountsCache,
          [session] as const,
          "user.useConnectedAccount()"
        );
        const found = connectedAccounts.find(
          a => a.provider === provider && a.providerAccountId === providerAccountId
        );
        return found ?? null;
      }

      // Original behavior: by provider ID (returns first match)
      return useAsyncCache(app._currentUserOAuthConnectionCache, [session, idOrAccount, scopeString, options?.or === 'redirect'] as const, "user.useConnectedAccount()");
    }
    // END_PLATFORM
    return {
      async getActiveSessions() {
        const sessions = await app._interface.listSessions(session);
        return sessions.items.map((crud) => app._clientSessionFromCrud(crud));
      },
      async revokeSession(sessionId: string) {
        await app._interface.deleteSession(sessionId, session);
      },
      setDisplayName(displayName: string | null) {
        return this.update({ displayName });
      },
      setClientMetadata(metadata: Record<string, any>) {
        return this.update({ clientMetadata: metadata });
      },
      async setSelectedTeam(team: Team | string | null) {
        await this.update({ selectedTeamId: typeof team === 'string' ? team : team?.id ?? null });
      },
      getConnectedAccount,
      useConnectedAccount, // THIS_LINE_PLATFORM react-like
      async listConnectedAccounts() {
        return Result.orThrow(await app._currentUserConnectedAccountsCache.getOrWait([session], "write-only"));
      },
      // IF_PLATFORM react-like
      useConnectedAccounts() {
        return useAsyncCache(app._currentUserConnectedAccountsCache, [session] as const, "user.useConnectedAccounts()");
      },
      // END_PLATFORM
      async linkConnectedAccount(provider: string, options?: { scopes?: string[] }) {
        const scopeString = options?.scopes?.join(" ") ?? "";
        const location = await getNewOAuthProviderOrScopeUrl(
          app._interface,
          {
            provider,
            redirectUrl: app._getOAuthCallbackRedirectUri(),
            errorRedirectUrl: app._getUrls().error,
            providerScope: mergeScopeStrings(scopeString, (app._oauthScopesOnSignIn[provider as ProviderType] ?? []).join(" ")),
          },
          session,
        );
        await app._redirectTo({ url: location });
        return await neverResolve();
      },
      async getOrLinkConnectedAccount(provider: string, options?: { scopes?: string[] }) {
        const connectedAccounts = Result.orThrow(await app._currentUserConnectedAccountsCache.getOrWait([session], "write-only"));
        const matchingAccounts = connectedAccounts.filter(a => a.provider === provider);

        for (const account of matchingAccounts) {
          const tokenResult = await account.getAccessToken({ scopes: options?.scopes });
          if (tokenResult.status === "ok") {
            return account;
          }
        }

        // No valid account found or all tokens unavailable — redirect to OAuth flow
        await this.linkConnectedAccount(provider, options);
        return await neverResolve();
      },
      // IF_PLATFORM react-like
      useOrLinkConnectedAccount(provider: string, options?: { scopes?: string[] }): OAuthConnection {
        const scopeString = options?.scopes?.join(" ") ?? "";
        return useAsyncCache(app._currentUserValidConnectedAccountForProviderCache, [session, provider, scopeString] as const, "user.useOrLinkConnectedAccount()");
      },
      // END_PLATFORM
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
      async listTeams() {
        const teams = Result.orThrow(await app._currentUserTeamsCache.getOrWait([session], "write-only"));
        return teams.map((crud) => app._clientTeamFromCrud(crud, session));
      },
      // IF_PLATFORM react-like
      useTeams() {
        const teams = useAsyncCache(app._currentUserTeamsCache, [session], "user.useTeams()");
        return useMemo(() => teams.map((crud) => app._clientTeamFromCrud(crud, session)), [teams]);
      },
      // END_PLATFORM
      async createTeam(data: TeamCreateOptions) {
        const crud = await app._interface.createClientTeam(teamCreateOptionsToCrud(data, 'me'), session);
        await app._currentUserTeamsCache.refresh([session]);
        await this.update({ selectedTeamId: crud.id });
        return app._clientTeamFromCrud(crud, session);
      },
      async leaveTeam(team: Team) {
        await app._interface.leaveTeam(team.id, session);
        // TODO: refresh cache
      },
      async listTeamInvitations() {
        const invitations = Result.orThrow(await app._currentUserTeamInvitationsCache.getOrWait([session], "write-only"));
        return invitations.map((crud) => app._clientReceivedTeamInvitationFromCrud(session, crud));
      },
      // IF_PLATFORM react-like
      useTeamInvitations() {
        const invitations = useAsyncCache(app._currentUserTeamInvitationsCache, [session], "user.useTeamInvitations()");
        return useMemo(() => invitations.map((crud) => app._clientReceivedTeamInvitationFromCrud(session, crud)), [invitations]);
      },
      // END_PLATFORM
      async listPermissions(scopeOrOptions?: Team | { recursive?: boolean }, options?: { recursive?: boolean }): Promise<TeamPermission[]> {
        if (scopeOrOptions && 'id' in scopeOrOptions) {
          const scope = scopeOrOptions;
          const recursive = options?.recursive ?? true;
          const permissions = Result.orThrow(await app._currentUserPermissionsCache.getOrWait([session, scope.id, recursive], "write-only"));
          return permissions.map((crud) => app._clientPermissionFromCrud(crud));
        } else {
          const opts = scopeOrOptions;
          const recursive = opts?.recursive ?? true;
          const permissions = Result.orThrow(await app._currentUserProjectPermissionsCache.getOrWait([session, recursive], "write-only"));
          return permissions.map((crud) => app._clientPermissionFromCrud(crud));
        }
      },
      // IF_PLATFORM react-like
      usePermissions(scopeOrOptions?: Team | { recursive?: boolean }, options?: { recursive?: boolean }): TeamPermission[] {
        if (scopeOrOptions && 'id' in scopeOrOptions) {
          const scope = scopeOrOptions;
          const recursive = options?.recursive ?? true;
          const permissions = useAsyncCache(app._currentUserPermissionsCache, [session, scope.id, recursive] as const, "user.usePermissions()");
          return useMemo(() => permissions.map((crud) => app._clientPermissionFromCrud(crud)), [permissions]);
        } else {
          const opts = scopeOrOptions;
          const recursive = opts?.recursive ?? true;
          const permissions = useAsyncCache(app._currentUserProjectPermissionsCache, [session, recursive] as const, "user.usePermissions()");
          return useMemo(() => permissions.map((crud) => app._clientPermissionFromCrud(crud)), [permissions]);
        }
      },
      // END_PLATFORM
      // IF_PLATFORM react-like
      usePermission(scopeOrPermissionId: Team | string, permissionId?: string): TeamPermission | null {
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
      async getPermission(scopeOrPermissionId: Team | string, permissionId?: string): Promise<TeamPermission | null> {
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
      async hasPermission(scopeOrPermissionId: Team | string, permissionId?: string): Promise<boolean> {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== 'string') {
          const scope = scopeOrPermissionId;
          return (await this.getPermission(scope, permissionId as string)) !== null;
        } else {
          const pid = scopeOrPermissionId;
          return (await this.getPermission(pid)) !== null;
        }
      },
      async update(update) {
        return await app._updateClientUser(update, session);
      },
      async sendVerificationEmail(options?: { callbackUrl?: string }) {
        if (!crud.primary_email) {
          throw new HexclaveAssertionError("User does not have a primary email");
        }
        return await app._interface.sendVerificationEmail(
          crud.primary_email,
          options?.callbackUrl ?? constructRedirectUrl(app._getUrls().emailVerification, "callbackUrl"),
          session
        );
      },
      async updatePassword(options: { oldPassword: string, newPassword: string }) {
        const result = await app._interface.updatePassword(options, session);
        await app._currentUserCache.refresh([session]);
        return result;
      },
      async setPassword(options: { password: string }) {
        const result = await app._interface.setPassword(options, session);
        await app._currentUserCache.refresh([session]);
        return result;
      },
      selectedTeam: crud.selected_team && this._clientTeamFromCrud(crud.selected_team, session),
      async getTeamProfile(team: Team) {
        const result = Result.orThrow(await app._currentUserTeamProfileCache.getOrWait([session, team.id], "write-only"));
        return app._editableTeamProfileFromCrud(result, session);
      },
      // IF_PLATFORM react-like
      useTeamProfile(team: Team) {
        const result = useAsyncCache(app._currentUserTeamProfileCache, [session, team.id] as const, "user.useTeamProfile()");
        return app._editableTeamProfileFromCrud(result, session);
      },
      // END_PLATFORM
      async delete() {
        await app._interface.deleteCurrentUser(session);
        session.markInvalid();
      },
      async listContactChannels() {
        const result = Result.orThrow(await app._clientContactChannelsCache.getOrWait([session], "write-only"));
        return result.map((crud) => app._clientContactChannelFromCrud(crud, session));
      },
      // IF_PLATFORM react-like
      useContactChannels() {
        const result = useAsyncCache(app._clientContactChannelsCache, [session] as const, "user.useContactChannels()");
        return result.map((crud) => app._clientContactChannelFromCrud(crud, session));
      },
      // END_PLATFORM
      async createContactChannel(data: ContactChannelCreateOptions) {
        const crud = await app._interface.createClientContactChannel(contactChannelCreateOptionsToCrud('me', data), session);
        await app._clientContactChannelsCache.refresh([session]);
        return app._clientContactChannelFromCrud(crud, session);
      },
      // IF_PLATFORM react-like
      useNotificationCategories() {
        const results = useAsyncCache(app._notificationCategoriesCache, [session] as const, "user.useNotificationCategories()");
        return results.map((crud) => app._clientNotificationCategoryFromCrud(crud, session));
      },
      // END_PLATFORM
      async listNotificationCategories() {
        const results = Result.orThrow(await app._notificationCategoriesCache.getOrWait([session], "write-only"));
        return results.map((crud) => app._clientNotificationCategoryFromCrud(crud, session));
      },
      // IF_PLATFORM react-like
      useApiKeys() {
        const result = useAsyncCache(app._userApiKeysCache, [session] as const, "user.useApiKeys()");
        return result.map((crud) => app._clientApiKeyFromCrud(session, crud));
      },
      // END_PLATFORM

      async listApiKeys() {
        const results = await app._interface.listProjectApiKeys({ user_id: 'me' }, session, "client");
        return results.map((crud) => app._clientApiKeyFromCrud(session, crud));
      },

      async createApiKey(options: ApiKeyCreationOptions<"user">) {
        const result = await app._interface.createProjectApiKey(
          await apiKeyCreationOptionsToCrud("user", "me", options),
          session,
          "client",
        );
        await app._userApiKeysCache.refresh([session]);
        return app._clientApiKeyFromCrud(session, result);
      },

      // IF_PLATFORM react-like
      useOAuthProviders() {
        const results = useAsyncCache(app._currentUserOAuthProvidersCache, [session] as const, "user.useOAuthProviders()");
        return results.map((crud) => app._clientOAuthProviderFromCrud(crud, session));
      },
      // END_PLATFORM

      async listOAuthProviders() {
        const results = Result.orThrow(await app._currentUserOAuthProvidersCache.getOrWait([session], "write-only"));
        return results.map((crud) => app._clientOAuthProviderFromCrud(crud, session));
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
        const hostname = (await app._getCurrentUrl())?.hostname;
        if (!hostname) {
          throw new HexclaveAssertionError("hostname must be provided if the Stack App does not have a redirect method");
        }

        const initiationResult = await app._interface.initiatePasskeyRegistration({}, session);

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


        const registrationResult = await app._interface.registerPasskey({ credential: attResp, code }, session);

        await app._refreshUser(session);
        return registrationResult;
      },
    };
  }

  protected _createInternalUserExtra(session: InternalSession): InternalUserExtra {
    const app = this;
    this._ensureInternalProject();
    return {
      createProject(newProject: AdminProjectUpdateOptions & { displayName: string, teamId: string }) {
        return app._createProject(session, newProject);
      },
      async transferProject(projectIdToTransfer: string, newTeamId: string): Promise<void> {
        await app._interface.transferProject(session, projectIdToTransfer, newTeamId);
        await app._refreshProject();
      },
      listOwnedProjects() {
        return app._listOwnedProjects(session);
      },
      // IF_PLATFORM react-like
      useOwnedProjects() {
        return app._useOwnedProjects(session);
      },
      // END_PLATFORM
    };
  }

  protected _createCustomer(userIdOrTeamId: string, type: "user" | "team", session: InternalSession | null): Omit<Customer, "id"> {
    const app = this;
    const effectiveSession = session ?? app._interface.createSession({ refreshToken: null });
    const customerOptions = type === "user" ? { userId: userIdOrTeamId } : { teamId: userIdOrTeamId };
    return {
      async getBilling() {
        const response = Result.orThrow(await app._customerBillingCache.getOrWait([effectiveSession, type, userIdOrTeamId], "write-only"));
        return app._customerBillingFromResponse(response);
      },
      // IF_PLATFORM react-like
      useBilling() {
        const response = useAsyncCache(app._customerBillingCache, [effectiveSession, type, userIdOrTeamId] as const, "customer.useBilling()");
        return app._customerBillingFromResponse(response);
      },
      // END_PLATFORM
      async createPaymentMethodSetupIntent(): Promise<CustomerPaymentMethodSetupIntent> {
        const body = await app._interface.createCustomerPaymentMethodSetupIntent(type, userIdOrTeamId, effectiveSession);
        return {
          clientSecret: body.client_secret,
          stripeAccountId: body.stripe_account_id,
        };
      },
      async setDefaultPaymentMethodFromSetupIntent(setupIntentId: string): Promise<CustomerDefaultPaymentMethod> {
        const body = await app._interface.setDefaultCustomerPaymentMethodFromSetupIntent(type, userIdOrTeamId, setupIntentId, effectiveSession);
        await app._customerBillingCache.refresh([effectiveSession, type, userIdOrTeamId]);
        return body.default_payment_method;
      },
      async getItem(itemId: string) {
        return await app.getItem({ itemId, ...customerOptions });
      },
      // IF_PLATFORM react-like
      useItem(itemId: string) {
        return app.useItem({ itemId, ...customerOptions });
      },
      // END_PLATFORM
      async listProducts(options?: CustomerProductsListOptions) {
        return await app.listProducts({ ...options, ...customerOptions });
      },
      // IF_PLATFORM react-like
      useProducts(options?: CustomerProductsListOptions) {
        return app.useProducts({ ...options, ...customerOptions });
      },
      // END_PLATFORM
      async listInvoices(options?: CustomerInvoicesListOptions) {
        return await app.listInvoices({ ...options, ...customerOptions });
      },
      // IF_PLATFORM react-like
      useInvoices(options?: CustomerInvoicesListOptions) {
        return app.useInvoices({ ...options, ...customerOptions });
      },
      // END_PLATFORM
      async createCheckoutUrl(options: { productId: string, returnUrl?: string }) {
        return await app._interface.createCheckoutUrl(type, userIdOrTeamId, options.productId, effectiveSession, options.returnUrl, "client");
      },
      async switchSubscription(options: { fromProductId: string, toProductId: string, priceId?: string, quantity?: number }) {
        await app._interface.switchSubscription({
          customer_type: type,
          customer_id: userIdOrTeamId,
          from_product_id: options.fromProductId,
          to_product_id: options.toProductId,
          price_id: options.priceId,
          quantity: options.quantity,
        }, effectiveSession);
        await app._customerBillingCache.refresh([effectiveSession, type, userIdOrTeamId]);
        if (type === "user") {
          await app._userProductsCache.invalidateWhere(([cachedSession, userId]) => cachedSession === effectiveSession && userId === userIdOrTeamId);
        } else {
          await app._teamProductsCache.invalidateWhere(([cachedSession, teamId]) => cachedSession === effectiveSession && teamId === userIdOrTeamId);
        }
      },
    };
  }

  async getItem(options: { itemId: string, userId: string } | { itemId: string, teamId: string } | { itemId: string, customCustomerId: string }): Promise<Item> {
    const session = await this._getSession();
    let crud: ItemCrud['Client']['Read'];
    if ("userId" in options) {
      crud = Result.orThrow(await this._userItemCache.getOrWait([session, options.userId, options.itemId], "write-only"));
    } else if ("teamId" in options) {
      crud = Result.orThrow(await this._teamItemCache.getOrWait([session, options.teamId, options.itemId], "write-only"));
    } else {
      crud = Result.orThrow(await this._customItemCache.getOrWait([session, options.customCustomerId, options.itemId], "write-only"));
    }
    return this._clientItemFromCrud(crud);
  }

  // IF_PLATFORM react-like
  useItem(options: { itemId: string, userId: string } | { itemId: string, teamId: string } | { itemId: string, customCustomerId: string }): Item {
    const session = this._useSession();
    const [cache, ownerId] =
      "userId" in options ? [this._userItemCache, options.userId] :
        "teamId" in options ? [this._teamItemCache, options.teamId] : [this._customItemCache, options.customCustomerId];
    const crud = useAsyncCache(cache, [session, ownerId, options.itemId] as const, "app.useItem()");
    return this._clientItemFromCrud(crud);
  }
  // END_PLATFORM

  async listProducts(options: CustomerProductsRequestOptions): Promise<CustomerProductsList> {
    const currentUser = await this.getUser();
    const session = currentUser?._internalSession ?? await this._getSession();
    if ("userId" in options) {
      const response = Result.orThrow(await this._userProductsCache.getOrWait([session, options.userId, options.cursor ?? null, options.limit ?? null], "write-only"));
      return this._customerProductsFromResponse(response);
    } else if ("teamId" in options) {
      const response = Result.orThrow(await this._teamProductsCache.getOrWait([session, options.teamId, options.cursor ?? null, options.limit ?? null], "write-only"));
      return this._customerProductsFromResponse(response);
    }
    const response = Result.orThrow(await this._customProductsCache.getOrWait([session, options.customCustomerId, options.cursor ?? null, options.limit ?? null], "write-only"));
    return this._customerProductsFromResponse(response);
  }

  async listInvoices(options: CustomerInvoicesRequestOptions): Promise<CustomerInvoicesList> {
    const session = await this._getSession();
    if ("userId" in options) {
      const response = Result.orThrow(await this._userInvoicesCache.getOrWait([session, options.userId, options.cursor ?? null, options.limit ?? null], "write-only"));
      return this._customerInvoicesFromResponse(response);
    }
    const response = Result.orThrow(await this._teamInvoicesCache.getOrWait([session, options.teamId, options.cursor ?? null, options.limit ?? null], "write-only"));
    return this._customerInvoicesFromResponse(response);
  }

  async cancelSubscription(options: { productId: string, subscriptionId?: string } | { productId: string, subscriptionId?: string, teamId: string }): Promise<void> {
    const session = await this._getSession();
    const user = await this.getUser();
    if (!user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    const customerType = "teamId" in options ? "team" : "user";
    const customerId = "teamId" in options ? options.teamId : user.id;
    await this._interface.cancelSubscription({
      customer_type: customerType,
      customer_id: customerId,
      product_id: options.productId,
      subscription_id: options.subscriptionId,
    }, session);
    if (customerType === "user") {
      await this._userProductsCache.invalidateWhere(([cachedSession, userId]) => cachedSession === session && userId === customerId);
    } else {
      await this._teamProductsCache.invalidateWhere(([cachedSession, teamId]) => cachedSession === session && teamId === customerId);
    }
  }
  // IF_PLATFORM react-like
  useProducts(options: CustomerProductsRequestOptions): CustomerProductsList {
    const session = this._useSession();
    const cache = "userId" in options ? this._userProductsCache : "teamId" in options ? this._teamProductsCache : this._customProductsCache;
    const debugLabel = "clientApp.useProducts()";
    const customerId = "userId" in options ? options.userId : "teamId" in options ? options.teamId : options.customCustomerId;
    const response = useAsyncCache(cache, [session, customerId, options.cursor ?? null, options.limit ?? null] as const, debugLabel);
    return this._customerProductsFromResponse(response);
  }
  // END_PLATFORM
  // IF_PLATFORM react-like
  useInvoices(options: CustomerInvoicesRequestOptions): CustomerInvoicesList {
    const session = this._useSession();
    const cache = "userId" in options ? this._userInvoicesCache : this._teamInvoicesCache;
    const debugLabel = "clientApp.useInvoices()";
    const customerId = "userId" in options ? options.userId : options.teamId;
    const response = useAsyncCache(cache, [session, customerId, options.cursor ?? null, options.limit ?? null] as const, debugLabel);
    return this._customerInvoicesFromResponse(response);
  }
  // END_PLATFORM

  protected _currentUserFromCrud(crud: NonNullable<CurrentUserCrud['Client']['Read']>, session: InternalSession): ProjectCurrentUser<ProjectId> {
    const currentUser = withUserDestructureGuard({
      ...this._createBaseUser(crud),
      ...this._createAuth(session),
      ...this._createUserExtraFromCurrent(crud, session),
      ...this._isInternalProject() ? this._createInternalUserExtra(session) : {},
      ...this._createCustomer(crud.id, "user", session),
    } satisfies CurrentUser);
    return currentUser as ProjectCurrentUser<ProjectId>;
  }
  protected _clientSessionFromCrud(crud: SessionsCrud['Client']['Read']): ActiveSession {
    return {
      id: crud.id,
      userId: crud.user_id,
      createdAt: new Date(crud.created_at),
      isImpersonation: crud.is_impersonation,
      lastUsedAt: crud.last_used_at ? new Date(crud.last_used_at) : undefined,
      isCurrentSession: crud.is_current_session ?? false,
      geoInfo: crud.last_used_at_end_user_ip_info,
    };
  }

  protected _getOwnedAdminApp(forProjectId: string, session: InternalSession): _HexclaveAdminAppImplIncomplete<false, string> {
    if (!this._ownedAdminApps.has([session, forProjectId])) {
      this._ownedAdminApps.set([session, forProjectId], new (_HexclaveClientAppImplIncomplete.LazyStackAdminAppImpl.value!)({
        baseUrl: this._interface.options.getBaseUrl(),
        projectId: forProjectId,
        tokenStore: null,
        projectOwnerSession: session,
        noAutomaticPrefetch: true,
      }));
    }
    return this._ownedAdminApps.get([session, forProjectId])!;
  }

  get projectId(): ProjectId {
    return this._interface.projectId as ProjectId;
  }

  get version(): string {
    return clientVersion;
  }

  private _botChallengeSiteKeysWarned = false;
  private _getBotChallengeSiteKeys(): { visibleSiteKey: string, invisibleSiteKey: string } | null {
    if (!isBrowserLike()) return null;

    const visibleSiteKey = envVars.HEXCLAVE_BOT_CHALLENGE_SITE_KEY;
    if (!visibleSiteKey) {
      if (!this._botChallengeSiteKeysWarned) {
        this._botChallengeSiteKeysWarned = true;
        console.warn("[stack-auth] HEXCLAVE_BOT_CHALLENGE_SITE_KEY is not set — bot challenge fraud protection is disabled. Set the env variable to enable it.");
      }
      return null;
    }

    const invisibleSiteKey = envVars.HEXCLAVE_BOT_CHALLENGE_INVISIBLE_SITE_KEY ?? visibleSiteKey;

    return { visibleSiteKey, invisibleSiteKey };
  }

  private _getBotChallengeFlowFailure(error: unknown): { type: "cancelled" | "failed", knownError: KnownErrors["BotChallengeFailed"] } | null {
    if (error instanceof BotChallengeUserCancelledError) {
      return {
        type: "cancelled",
        knownError: new KnownErrors.BotChallengeFailed("Bot challenge cancelled by user"),
      };
    }
    if (error instanceof BotChallengeExecutionFailedError) {
      return {
        type: "failed",
        knownError: new KnownErrors.BotChallengeFailed(error.message),
      };
    }
    return null;
  }

  private _normalizeBotChallengeResult<T, E>(result: Result<T, E | KnownErrors["BotChallengeRequired"] | KnownErrors["BotChallengeFailed"]>): Result<T, E | KnownErrors["BotChallengeFailed"]> {
    if (result.status === "ok") {
      return result;
    }

    if (KnownErrors.BotChallengeRequired.isInstance(result.error)) {
      captureError("bot-challenge-unexpected-after-flow", result.error);
      return Result.error(new KnownErrors.BotChallengeFailed("Unexpected bot challenge after flow completion"));
    }

    return Result.error(result.error);
  }

  private _toInterfaceBotChallengeInput(challenge: { token?: string, phase?: "invisible" | "visible", unavailable?: true }) {
    if (challenge.unavailable) {
      return {
        phase: "visible" as const,
      };
    }

    return {
      token: challenge.token,
      phase: challenge.phase,
    };
  }

  private async _executeResultWithBotChallengeFlow<T, E>(options: {
    action: TurnstileAction,
    execute: (challenge: { token?: string, phase?: "invisible" | "visible", unavailable?: true }) => Promise<Result<T, E | KnownErrors["BotChallengeRequired"] | KnownErrors["BotChallengeFailed"]>>,
  }): Promise<Result<T, E | KnownErrors["BotChallengeFailed"]>> {
    const siteKeys = this._getBotChallengeSiteKeys();
    let result: Result<T, E | KnownErrors["BotChallengeRequired"] | KnownErrors["BotChallengeFailed"]>;

    try {
      if (siteKeys) {
        result = await withBotChallengeFlow({
          ...siteKeys,
          action: options.action,
          execute: options.execute,
          isChallengeRequired: (flowResult) => {
            return flowResult.status === "error" && KnownErrors.BotChallengeRequired.isInstance(flowResult.error);
          },
        });
      } else {
        result = await options.execute({});
      }
    } catch (e) {
      const flowFailure = this._getBotChallengeFlowFailure(e);
      if (flowFailure) {
        return Result.error(flowFailure.knownError);
      }
      throw e;
    }

    return this._normalizeBotChallengeResult(result);
  }

  protected async _isTrusted(url: string): Promise<boolean> {
    if (isRelative(url)) {
      return true;
    }
    const parsedUrl = createUrlIfValid(url);
    if (parsedUrl == null) {
      return false;
    }
    if (typeof window !== "undefined" && window.location.origin === parsedUrl.origin) {
      return true;
    }
    if (isHostedHandlerUrlForProject({ url, projectId: this.projectId })) {
      return true;
    }
    const trustedRedirectConfig = await this._getTrustedRedirectConfig();
    return validateRedirectUrl(parsedUrl, {
      allowLocalhost: trustedRedirectConfig.allowLocalhost,
      trustedDomains: trustedRedirectConfig.trustedDomains,
    });
  }

  get urls(): Readonly<ResolvedHandlerUrls> {
    return createUrlsForPublicAccess({
      urls: this._getUrls(),
      projectId: this.projectId,
    });
  }

  protected _getUrls(): Readonly<ResolvedHandlerUrls> {
    return getUrls(this._urlOptions, { projectId: this.projectId });
  }

  protected _prefetchCrossDomainHandoffParamsIfNeeded() {
    const canWriteOauthVerifierCookie = this._tokenStoreInit === "cookie" || this._tokenStoreInit === "nextjs-cookie";
    if (
      !isBrowserLike()
      || !canWriteOauthVerifierCookie
      || this._isPrefetchingCrossDomainHandoffParams
      || this._getFreshPrefetchedCrossDomainHandoffParams() != null
    ) {
      return;
    }
    this._isPrefetchingCrossDomainHandoffParams = true;
    runAsynchronously(async () => {
      try {
        if (!isBrowserLike()) {
          return;
        }
        const { state, codeChallenge } = await saveVerifierAndState();
        this._prefetchedCrossDomainHandoffParams = { state, codeChallenge };
        this._prefetchedCrossDomainHandoffParamsFetchedAt = performance.now();
      } finally {
        this._isPrefetchingCrossDomainHandoffParams = false;
      }
    });
  }

  protected _getCrossDomainHandoffParamsForUrlsGetter(currentUrl: URL): CrossDomainHandoffParams | null {
    const fromQuery = getCrossDomainHandoffParamsFromCurrentUrl(currentUrl);
    if (fromQuery != null) {
      return fromQuery;
    }

    const prefetched = this._getFreshPrefetchedCrossDomainHandoffParams();
    if (prefetched != null) {
      return prefetched;
    }

    this._prefetchCrossDomainHandoffParamsIfNeeded();
    return null;
  }

  protected async _getCrossDomainHandoffParamsForRedirect(currentUrl: URL): Promise<CrossDomainHandoffParams> {
    const fromQuery = getCrossDomainHandoffParamsFromCurrentUrl(currentUrl);
    if (fromQuery != null) {
      return fromQuery;
    }
    const prefetched = this._getFreshPrefetchedCrossDomainHandoffParams();
    if (prefetched != null) {
      return prefetched;
    }
    const { state, codeChallenge } = await saveVerifierAndState();
    this._prefetchedCrossDomainHandoffParams = { state, codeChallenge };
    this._prefetchedCrossDomainHandoffParamsFetchedAt = performance.now();
    return { state, codeChallenge };
  }

  protected _getLocalOAuthCallbackHandlerUrl(): string {
    if (this._isOAuthCallbackUrlHosted()) {
      return this._getOAuthCallbackRedirectUri();
    }

    return resolveHandlerUrls({
      urls: {
        ...this._urlOptions,
        default: { type: "handler-component" },
        oauthCallback: { type: "handler-component" },
      },
      projectId: this.projectId,
    }).oauthCallback;
  }

  protected async _createCrossDomainAuthRedirectUrl(options: {
    redirectUri: string,
    state: string,
    codeChallenge: string,
    afterCallbackRedirectUrl: string,
    awaitPendingAuthResolutions?: boolean,
    overrideTokenStoreInit?: TokenStoreInit,
  }): Promise<string> {
    const session = await this._getSession(options.overrideTokenStoreInit, { awaitPendingAuthResolutions: options.awaitPendingAuthResolutions });
    // The authorize endpoint intentionally verifies that the access token and
    // raw refresh token describe the same DB session. Force the access token to
    // be minted from the refresh token we are about to send, instead of reusing
    // a still-valid cached token from a pre-handoff session snapshot.
    await session.fetchNewTokens();
    const response = await this._interface.sendClientRequest(
      "/auth/oauth/cross-domain/authorize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          redirect_uri: options.redirectUri,
          state: options.state,
          code_challenge: options.codeChallenge,
          code_challenge_method: "S256",
          after_callback_redirect_url: options.afterCallbackRedirectUrl,
        }),
      },
      session,
    );
    if (!response.ok) {
      const responseBody = await response.text();
      throw new HexclaveAssertionError(`Cross-domain authorization endpoint failed: ${response.status} ${responseBody}`);
    }
    const result = await response.json();
    if (!("redirect_url" in result) || typeof result.redirect_url !== "string") {
      throw new HexclaveAssertionError("Cross-domain authorization endpoint returned an invalid payload", { result });
    }
    return result.redirect_url;
  }

  protected _getFreshPrefetchedCrossDomainHandoffParams(): CrossDomainHandoffParams | null {
    if (this._prefetchedCrossDomainHandoffParams == null) {
      return null;
    }
    if (performance.now() - this._prefetchedCrossDomainHandoffParamsFetchedAt > prefetchedCrossDomainHandoffTtlMs) {
      this._prefetchedCrossDomainHandoffParams = null;
      this._prefetchedCrossDomainHandoffParamsFetchedAt = 0;
      return null;
    }
    return this._prefetchedCrossDomainHandoffParams;
  }

  protected async _getCurrentUrl() {
    if (this._redirectMethod === "none") {
      return null;
    }
    return new URL(window.location.href);
  }

  protected async _redirectTo(options: { url: URL | string, replace?: boolean }) {
    if (this._redirectMethod === "none") {
      return;
      // IF_PLATFORM next
    } else if (isReactServer && this._redirectMethod === "nextjs") {
      NextNavigation.redirect(options.url.toString(), options.replace ? NextNavigation.RedirectType.replace : NextNavigation.RedirectType.push);
      // END_PLATFORM
      // IF_PLATFORM tanstack-start
    } else if (this._redirectMethod === "tanstack-start" && !isBrowserLike()) {
      throw TanStackRouter.redirect({ href: options.url.toString(), replace: options.replace });
      // END_PLATFORM
    } else if (typeof this._redirectMethod === "object" && this._redirectMethod.navigate) {
      this._redirectMethod.navigate(options.url.toString());
    } else {
      if (options.replace) {
        window.location.replace(options.url);
      } else {
        window.location.assign(options.url);
      }
    }

    await wait(2000);
  }

  // IF_PLATFORM react-like
  useNavigate(): (to: string) => void {
    if (typeof this._redirectMethod === "object") {
      return this._redirectMethod.useNavigate();
    } else if (this._redirectMethod === "window") {
      return (to: string) => window.location.assign(to);
      // IF_PLATFORM next
    } else if (this._redirectMethod === "nextjs") {
      const router = NextNavigation.useRouter();
      return (to: string) => router.push(to);
      // END_PLATFORM
      // IF_PLATFORM tanstack-start
    } else if (this._redirectMethod === "tanstack-start") {
      return (to: string) => window.location.assign(to);
      // END_PLATFORM
    } else {
      return (to: string) => { };
    }
  }
  // END_PLATFORM
  protected async _redirectIfTrusted(url: string, options?: RedirectToOptions) {
    if (!await this._isTrusted(url)) {
      throw new Error(`Redirect URL ${url} is not trusted; should be relative.`);
    }
    return await this._redirectTo({ url, ...options });
  }

  protected async _redirectToHandler(
    handlerName: keyof HandlerUrls,
    options?: RedirectToOptions,
    internalOptions?: {
      awaitPendingAuthResolutions?: boolean,
      overrideTokenStoreInit?: TokenStoreInit,
    },
  ) {
    const rawUrls = getUrls(this._urlOptions, { projectId: this.projectId });
    const rawHandlerUrl = rawUrls[handlerName];
    if (!rawHandlerUrl) {
      throw new Error(`No URL for handler name ${handlerName}`);
    }

    const currentUrl = isReactServer || typeof window === "undefined"
      ? null
      : new URL(window.location.href);
    const plan = await planRedirectToHandler({
      handlerName,
      rawHandlerUrl,
      noRedirectBack: options?.noRedirectBack === true,
      currentUrl,
      localOAuthCallbackUrl: this._getLocalOAuthCallbackHandlerUrl(),
      getCrossDomainHandoffParams: async (href) => await this._getCrossDomainHandoffParamsForRedirect(href),
    });

    if (plan.type === "cross-domain-authorize") {
      const crossDomainRedirectUrl = await this._createCrossDomainAuthRedirectUrl({
        redirectUri: plan.redirectUri,
        state: plan.state,
        codeChallenge: plan.codeChallenge,
        afterCallbackRedirectUrl: plan.afterCallbackRedirectUrl,
        awaitPendingAuthResolutions: internalOptions?.awaitPendingAuthResolutions,
        overrideTokenStoreInit: internalOptions?.overrideTokenStoreInit,
      });
      await this._redirectTo({ url: crossDomainRedirectUrl, ...options });
      return;
    }

    const redirectUrl = currentUrl != null && handlerName !== "signOut" && handlerName !== "afterSignOut" && handlerName !== "oauthCallback"
      ? await this._addNestedCrossDomainAuthParamsToRedirectUrl({
        url: plan.url,
        currentUrl,
        awaitPendingAuthResolutions: internalOptions?.awaitPendingAuthResolutions,
        overrideTokenStoreInit: internalOptions?.overrideTokenStoreInit,
      })
      : plan.url;
    await this._redirectIfTrusted(redirectUrl, options);
  }

  protected _redirectToHandlerDuringRender(handlerName: keyof HandlerUrls, options?: RedirectToOptions): boolean {
    // IF_PLATFORM tanstack-start
    if (this._redirectMethod === "tanstack-start" && !isBrowserLike()) {
      const rawUrls = getUrls(this._urlOptions, { projectId: this.projectId });
      const rawHandlerUrl = rawUrls[handlerName];
      if (!rawHandlerUrl) {
        throw new Error(`No URL for handler name ${handlerName}`);
      }
      throw TanStackRouter.redirect({ href: rawHandlerUrl, replace: options?.replace });
    }
    // END_PLATFORM
    return false;
  }

  async redirectToSignIn(options?: RedirectToOptions) { return await this._redirectToHandler("signIn", options); }
  async redirectToSignUp(options?: RedirectToOptions) { return await this._redirectToHandler("signUp", options); }
  async redirectToSignOut(options?: RedirectToOptions) {
    const configuredSignOutTarget = this._urlOptions.signOut ?? this._urlOptions.default;
    if (typeof configuredSignOutTarget !== "string" && configuredSignOutTarget?.type === "hosted") {
      return await this.signOut();
    }
    return await this._redirectToHandler("signOut", options);
  }
  async redirectToEmailVerification(options?: RedirectToOptions) { return await this._redirectToHandler("emailVerification", options); }
  async redirectToPasswordReset(options?: RedirectToOptions) { return await this._redirectToHandler("passwordReset", options); }
  async redirectToForgotPassword(options?: RedirectToOptions) { return await this._redirectToHandler("forgotPassword", options); }
  async redirectToHome(options?: RedirectToOptions) { return await this._redirectToHandler("home", options); }
  async redirectToOAuthCallback(options?: RedirectToOptions) { return await this._redirectToHandler("oauthCallback", options); }
  async redirectToMagicLinkCallback(options?: RedirectToOptions) { return await this._redirectToHandler("magicLinkCallback", options); }
  async redirectToAfterSignIn(options?: RedirectToOptions) { return await this._redirectToHandler("afterSignIn", options); }
  async redirectToAfterSignUp(options?: RedirectToOptions) { return await this._redirectToHandler("afterSignUp", options); }
  async redirectToOnboarding(options?: RedirectToOptions) { return await this._redirectToHandler("onboarding", options); }
  async redirectToAfterSignOut(options?: RedirectToOptions) { return await this._redirectToHandler("afterSignOut", options); }
  async redirectToAccountSettings(options?: RedirectToOptions) { return await this._redirectToHandler("accountSettings", options); }
  async redirectToError(options?: RedirectToOptions) { return await this._redirectToHandler("error", options); }
  async redirectToTeamInvitation(options?: RedirectToOptions) { return await this._redirectToHandler("teamInvitation", options); }
  async redirectToCliAuthConfirm(options?: RedirectToOptions) { return await this._redirectToHandler("cliAuthConfirm", options); }
  async redirectToMfa(options?: RedirectToOptions) { return await this._redirectToHandler("mfa", options); }

  async sendForgotPasswordEmail(email: string, options?: { callbackUrl?: string }): Promise<Result<undefined, KnownErrors["UserNotFound"]>> {
    return await this._interface.sendForgotPasswordEmail(email, options?.callbackUrl ?? constructRedirectUrl(this.urls.passwordReset, "callbackUrl"));
  }

  async sendMagicLinkEmail(email: string, options?: {
    callbackUrl?: string,
  }): Promise<Result<{ nonce: string }, KnownErrors["RedirectUrlNotWhitelisted"] | KnownErrors["BotChallengeFailed"]>> {
    const callbackUrl = options?.callbackUrl ?? constructRedirectUrl(this.urls.magicLinkCallback, "callbackUrl");
    return await this._executeResultWithBotChallengeFlow({
      action: "send_magic_link_email",
      execute: async (challenge) => {
        return await this._interface.sendMagicLinkEmail(email, callbackUrl, this._toInterfaceBotChallengeInput(challenge));
      },
    });
  }

  async resetPassword(options: { password: string, code: string }): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    return await this._interface.resetPassword(options);
  }

  async verifyPasswordResetCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    return await this._interface.verifyPasswordResetCode(code);
  }

  async verifyTeamInvitationCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["TeamInvitationEmailMismatch"]>> {
    return await this._interface.acceptTeamInvitation({
      type: 'check',
      code,
      session: await this._getSession(),
    });
  }

  async acceptTeamInvitation(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["TeamInvitationEmailMismatch"]>> {
    const result = await this._interface.acceptTeamInvitation({
      type: 'use',
      code,
      session: await this._getSession(),
    });

    if (result.status === 'ok') {
      return Result.ok(undefined);
    } else {
      return Result.error(result.error);
    }
  }

  async getTeamInvitationDetails(code: string): Promise<Result<{ teamDisplayName: string }, KnownErrors["VerificationCodeError"] | KnownErrors["TeamInvitationEmailMismatch"]>> {
    const result = await this._interface.acceptTeamInvitation({
      type: 'details',
      code,
      session: await this._getSession(),
    });

    if (result.status === 'ok') {
      return Result.ok({ teamDisplayName: result.data.team_display_name });
    } else {
      return Result.error(result.error);
    }
  }

  async verifyEmail(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    const result = await this._interface.verifyEmail(code);
    await this._currentUserCache.refresh([await this._getSession()]);
    await this._clientContactChannelsCache.refresh([await this._getSession()]);
    return result;
  }

  async getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'redirect' }): Promise<ProjectCurrentUser<ProjectId>>;
  async getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'throw' }): Promise<ProjectCurrentUser<ProjectId>>;
  async getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'anonymous' }): Promise<ProjectCurrentUser<ProjectId>>;
  async getUser(options?: GetCurrentUserOptions<HasTokenStore>): Promise<ProjectCurrentUser<ProjectId> | null>;
  async getUser(options?: GetCurrentUserOptions<HasTokenStore>): Promise<ProjectCurrentUser<ProjectId> | null> {
    // Validate that includeRestricted: false and or: 'anonymous' are mutually exclusive
    if (options?.or === 'anonymous' && options.includeRestricted === false) {
      throw new Error("Cannot use { or: 'anonymous' } with { includeRestricted: false }. Anonymous users implicitly include restricted users.");
    }

    this._ensurePersistentTokenStore(options?.tokenStore);
    const session = await this._getSession(options?.tokenStore);
    let crud = Result.orThrow(await this._currentUserCache.getOrWait([session], "write-only"));
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
          // TODO: We should probably `await neverResolve()` here instead of returning null. I (Konsti) wanna do it in a release with few changes though because I'm not sure if it'll break anything
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

  // IF_PLATFORM react-like
  useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'redirect' }): ProjectCurrentUser<ProjectId>;
  useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'throw' }): ProjectCurrentUser<ProjectId>;
  useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'anonymous' }): ProjectCurrentUser<ProjectId>;
  useUser(options?: GetCurrentUserOptions<HasTokenStore>): ProjectCurrentUser<ProjectId> | null;
  useUser(options?: GetCurrentUserOptions<HasTokenStore>): ProjectCurrentUser<ProjectId> | null {
    // Validate that includeRestricted: false and or: 'anonymous' are mutually exclusive
    if (options?.or === 'anonymous' && options.includeRestricted === false) {
      throw new Error("Cannot use { or: 'anonymous' } with { includeRestricted: false }. Anonymous users implicitly include restricted users.");
    }

    this._ensurePersistentTokenStore(options?.tokenStore);

    const session = this._useSession(options?.tokenStore);
    let crud = useAsyncCache(this._currentUserCache, [session] as const, "clientApp.useUser()");
    const includeAnonymous = options?.or === "anonymous" || options?.or === "anonymous-if-exists[deprecated]";
    const includeRestricted = options?.includeRestricted === true || includeAnonymous;

    if (crud === null || (crud.is_anonymous && !includeAnonymous) || (crud.is_restricted && !includeRestricted)) {
      switch (options?.or) {
        case 'redirect': {
          if (!crud?.is_anonymous && crud?.is_restricted) {
            if (!this._redirectToHandlerDuringRender("onboarding", { replace: true })) {
              runAsynchronously(this.redirectToOnboarding({ replace: true }));
            }
          } else {
            if (!this._redirectToHandlerDuringRender("signIn", { replace: true })) {
              runAsynchronously(this.redirectToSignIn({ replace: true }));
            }
          }
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
          crud = null;
          break;
        }
      }
    }

    return useMemo(() => {
      return crud && this._currentUserFromCrud(crud, session);
    }, [crud, session, options?.or]);
  }
  // END_PLATFORM

  _getTokenPartialUserFromSession(session: InternalSession, options: GetCurrentPartialUserOptions<HasTokenStore>): TokenPartialUser | null {
    const accessToken = session.getAccessTokenIfNotExpiredYet(0, null);
    if (!accessToken) {
      return null;
    }
    const isAnonymous = accessToken.payload.is_anonymous;
    if (isAnonymous && options.or !== "anonymous-if-exists") {
      return null;
    }
    return {
      id: accessToken.payload.sub,
      primaryEmail: accessToken.payload.email,
      displayName: accessToken.payload.name,
      primaryEmailVerified: accessToken.payload.email_verified,
      isAnonymous,
      isMultiFactorRequired: accessToken.payload.requires_totp_mfa,
      isRestricted: accessToken.payload.is_restricted,
      restrictedReason: accessToken.payload.restricted_reason,
    } satisfies TokenPartialUser;
  }

  async _getPartialUserFromConvex(ctx: ConvexCtx): Promise<TokenPartialUser | null> {
    const auth = await ctx.auth.getUserIdentity();
    if (!auth) {
      return null;
    }
    return {
      id: auth.subject,
      displayName: auth.name ?? null,
      primaryEmail: auth.email ?? null,
      primaryEmailVerified: auth.email_verified as boolean,
      isAnonymous: auth.is_anonymous as boolean,
      isMultiFactorRequired: auth.requires_totp_mfa as boolean,
      isRestricted: auth.is_restricted as boolean,
      restrictedReason: (auth.restricted_reason as RestrictedReason | null) ?? null,
    };
  }

  async getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'token' }): Promise<TokenPartialUser | null>;
  async getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'convex' }): Promise<TokenPartialUser | null>;
  async getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore>): Promise<SyncedPartialUser | TokenPartialUser | null> {
    switch (options.from) {
      case "token": {
        this._ensurePersistentTokenStore(options.tokenStore ?? this._tokenStoreInit);
        const session = await this._getSession(options.tokenStore);
        return this._getTokenPartialUserFromSession(session, options);
      }
      case "convex": {
        return await this._getPartialUserFromConvex(options.ctx);
      }
      default: {
        // @ts-expect-error
        throw new Error(`Invalid 'from' option: ${options.from}`);
      }
    }
  }
  // IF_PLATFORM react-like
  usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'token' }): TokenPartialUser | null;
  usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'convex' }): TokenPartialUser | null;
  usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore>): TokenPartialUser | SyncedPartialUser | null {
    switch (options.from) {
      case "token": {
        this._ensurePersistentTokenStore(options.tokenStore ?? this._tokenStoreInit);
        const session = this._useSession(options.tokenStore);
        return this._getTokenPartialUserFromSession(session, options);
      }
      case "convex": {
        const result = useAsyncCache(this._convexPartialUserCache, [options.ctx] as const, "clientApp.usePartialUser()");
        return result;
      }
      default: {
        // @ts-expect-error
        throw new Error(`Invalid 'from' option: ${options.from}`);
      }
    }
  }
  // END_PLATFORM
  getConvexClientAuth(options: { tokenStore: TokenStoreInit }): (args: { forceRefreshToken: boolean }) => Promise<string | null> {
    return async (args: { forceRefreshToken: boolean }) => {
      const session = await this._getSession(options.tokenStore ?? this._tokenStoreInit);
      if (!args.forceRefreshToken) {
        const tokens = await session.getOrFetchLikelyValidTokens(20_000, 75_000);
        return tokens?.accessToken.token ?? null;
      }
      const tokens = await session.fetchNewTokens();
      return tokens?.accessToken.token ?? null;
    };
  }

  async getConvexHttpClientAuth(options: { tokenStore: TokenStoreInit }): Promise<string> {
    const session = await this._getSession(options.tokenStore);
    const tokens = await session.getOrFetchLikelyValidTokens(20_000, 75_000);
    return tokens?.accessToken.token ?? "";
  }

  protected async _updateClientUser(update: UserUpdateOptions, session: InternalSession) {
    const res = await this._interface.updateClientUser(userUpdateOptionsToCrud(update), session);
    await this._refreshUser(session);
    return res;
  }

  async signInWithOAuth(provider: ProviderType, options?: {
    returnTo?: string,
  }) {
    if (typeof window === "undefined") {
      throw new Error("signInWithOAuth can currently only be called in a browser environment");
    }

    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    const currentUrl = new URL(window.location.href);
    const afterCallbackRedirectUrl = options?.returnTo != null
      ? constructRedirectUrl(options.returnTo, "returnTo")
      : (
        currentUrl.searchParams.has("after_auth_return_to")
          ? currentUrl.toString()
          : undefined
      );
    const siteKeys = this._getBotChallengeSiteKeys();
    const { codeChallenge, state } = await saveVerifierAndState();

    const executeOAuth = async (challenge: { token?: string, phase?: "invisible" | "visible", unavailable?: true }) => {
      return await this._interface.authorizeOAuth({
        provider,
        redirectUrl: constructRedirectUrl(this._getOAuthCallbackRedirectUri(), "redirectUrl"),
        errorRedirectUrl: constructRedirectUrl(this.urls.error, "errorRedirectUrl"),
        afterCallbackRedirectUrl,
        type: "authenticate",
        providerScope: this._oauthScopesOnSignIn[provider]?.join(" "),
        codeChallenge,
        state,
        botChallenge: this._toInterfaceBotChallengeInput(challenge),
        session,
      });
    };

    let authorizeResult;
    try {
      if (siteKeys) {
        authorizeResult = await withBotChallengeFlow({
          ...siteKeys,
          action: "oauth_authenticate",
          execute: executeOAuth,
          isChallengeRequired: (result) => {
            return result.status === "error" && KnownErrors.BotChallengeRequired.isInstance(result.error);
          },
        });
      } else {
        // Server safe: just call execute with no bot challenge params
        authorizeResult = await executeOAuth({});
      }
    } catch (e) {
      const flowFailure = this._getBotChallengeFlowFailure(e);
      if (flowFailure?.type === "cancelled") {
        return;
      }
      if (flowFailure?.type === "failed") {
        throw flowFailure.knownError;
      }
      throw e;
    }

    const location = Result.orThrow(authorizeResult);
    await this._redirectTo({ url: location });
    await neverResolve();
  }

  /**
   * Handles MFA verification by redirecting to the OTP page
   */
  protected async _experimentalMfa(error: KnownErrors['MultiFactorAuthenticationRequired'], session: InternalSession): Promise<never> {
    // Store the attempt code in session storage so the OTP page can access it
    if (typeof window !== 'undefined') {
      // Hexclave rebrand: write the MFA attempt code under the new storage key (readers prefer it, fall back to the old key).
      window.sessionStorage.setItem('hexclave_mfa_attempt_code', (error.details as any)?.attempt_code ?? throwErr("attempt code missing"));
    }

    // Redirect to the MFA page
    await this.redirectToMfa();

    throw new HexclaveAssertionError("we should have redirected in redirectToMfa()");
  }

  /**
   * @deprecated
   * TODO remove
   */
  protected async _catchMfaRequiredError<T, E>(callback: () => Promise<Result<T, E>>): Promise<Result<T | { accessToken: string, refreshToken: string, newUser: boolean }, E>> {
    try {
      return await callback();
    } catch (e) {
      if (KnownErrors.MultiFactorAuthenticationRequired.isInstance(e)) {
        return Result.ok(await this._experimentalMfa(
          e,
          await this._getSession(undefined, { awaitPendingAuthResolutions: false }),
        ));
      }
      throw e;
    }
  }

  async signInWithCredential(options: {
    email: string,
    password: string,
    noRedirect?: boolean,
  }): Promise<Result<undefined, KnownErrors["EmailPasswordMismatch"] | KnownErrors["InvalidTotpCode"]>> {
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await this._interface.signInWithCredential(options.email, options.password, session);
      });
    } catch (e) {
      if (KnownErrors.InvalidTotpCode.isInstance(e)) {
        return Result.error(e);
      }
      throw e;
    }

    if (result.status === 'ok') {
      await this._signInToAccountWithTokens(result.data);
      if (!options.noRedirect) {
        await this._redirectToHandler("afterSignIn", { replace: true }, {
          overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
        });
      }
      return Result.ok(undefined);
    } else {
      return Result.error(result.error);
    }
  }

  async signUpWithCredential(options: {
    email: string,
    password: string,
    noRedirect?: boolean,
    noVerificationCallback?: boolean,
    verificationCallbackUrl?: string,
  }): Promise<Result<undefined, KnownErrors["UserWithEmailAlreadyExists"] | KnownErrors['PasswordRequirementsNotMet'] | KnownErrors["BotChallengeFailed"]>> {
    if (options.noVerificationCallback && options.verificationCallbackUrl) {
      throw new HexclaveAssertionError("verificationCallbackUrl is not allowed when noVerificationCallback is true");
    }
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    const emailVerificationRedirectUrl = options.noVerificationCallback ? undefined : options.verificationCallbackUrl ?? constructRedirectUrl(this.urls.emailVerification, "verificationCallbackUrl");

    const executeSignUp = async (challenge: { token?: string, phase?: "invisible" | "visible", unavailable?: true }) => {
      let result = await this._interface.signUpWithCredential(
        options.email,
        options.password,
        emailVerificationRedirectUrl,
        session,
        this._toInterfaceBotChallengeInput(challenge),
      );

      // If the auto-constructed redirect URL is not whitelisted, gracefully fall back
      // to signing up without email verification rather than failing.
      // If the user explicitly provided a verificationCallbackUrl, propagate the error.
      if (result.status === 'error' &&
        result.error instanceof KnownErrors.RedirectUrlNotWhitelisted &&
        emailVerificationRedirectUrl !== undefined) {
        if (!options.verificationCallbackUrl) {
          captureError("signup-verification-url-not-whitelisted", new HexclaveAssertionError("The auto-constructed verification callback URL is not whitelisted; proceeding without email verification", { emailVerificationRedirectUrl }));

          result = await this._interface.signUpWithCredential(
            options.email,
            options.password,
            undefined, // No email verification
            session,
            this._toInterfaceBotChallengeInput(challenge),
          );
        }
      }

      return result;
    };

    let result;
    result = await this._executeResultWithBotChallengeFlow({
      action: "sign_up_with_credential",
      execute: executeSignUp,
    });

    if (result.status === 'ok') {
      await this._signInToAccountWithTokens(result.data);
      if (!options.noRedirect) {
        await this._redirectToHandler("afterSignUp", { replace: true }, {
          overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
        });
      }
      return Result.ok(undefined);
    } else {
      return Result.error(result.error);
    }
  }

  async _signUpAnonymously() {
    this._ensurePersistentTokenStore();

    if (!this._anonymousSignUpInProgress) {
      this._anonymousSignUpInProgress = (async () => {
        this._ensurePersistentTokenStore();
        const session = await this._getSession();
        const result = await this._interface.signUpAnonymously(session);
        if (result.status === "ok") {
          await this._signInToAccountWithTokens(result.data);
        } else {
          throw new HexclaveAssertionError("signUpAnonymously() should never return an error");
        }
        this._anonymousSignUpInProgress = null;
        return result.data;
      })();
    }

    return await this._anonymousSignUpInProgress;
  }

  async signInWithMagicLink(code: string, options?: { noRedirect?: boolean }): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["InvalidTotpCode"]>> {
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await this._interface.signInWithMagicLink(code, session);
      });
    } catch (e) {
      if (KnownErrors.InvalidTotpCode.isInstance(e)) {
        return Result.error(e);
      }
      throw e;
    }

    if (result.status === 'ok') {
      await this._signInToAccountWithTokens(result.data);
      if (!(options?.noRedirect)) {
        if (result.data.newUser) {
          await this._redirectToHandler("afterSignUp", { replace: true }, {
            awaitPendingAuthResolutions: false,
            overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
          });
        } else {
          await this._redirectToHandler("afterSignIn", { replace: true }, {
            awaitPendingAuthResolutions: false,
            overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
          });
        }
      }
      return Result.ok(undefined);
    } else {
      return Result.error(result.error);
    }
  }

  /**
   * Initiates a CLI authentication process that allows a command line application
   * to get a refresh token for a user's account.
   *
   * This process works as follows:
   * 1. The CLI app calls this method, which initiates the auth process with the server
   * 2. The server returns a polling code and a login code
   * 3. The CLI app opens a browser window to the appUrl with the login code as a parameter
   * 4. The user logs in through the browser and confirms the authorization
   * 5. The CLI app polls for the refresh token using the polling code
   *
   * @param options Options for the CLI login
   * @param options.appUrl The URL of the app that will handle the CLI auth confirmation
   * @param options.expiresInMillis Optional duration in milliseconds before the auth attempt expires (default: 2 hours)
   * @param options.maxAttempts Optional maximum number of polling attempts (default: Infinity)
   * @param options.waitTimeMillis Optional time to wait between polling attempts (default: 2 seconds)
   * @param options.promptLink Optional function to call with the login URL and code to prompt the user to open the browser
   * @param options.anonRefreshToken Optional anonymous refresh token from the CLI's token store to associate with this login attempt
   * @returns Result containing either the refresh token or an error
   */
  async promptCliLogin(options: {
    appUrl: string,
    expiresInMillis?: number,
    maxAttempts?: number,
    waitTimeMillis?: number,
    promptLink?: (url: string, loginCode: string) => void,
    anonRefreshToken?: string,
  }): Promise<Result<string, KnownErrors["CliAuthError"] | KnownErrors["CliAuthExpiredError"] | KnownErrors["CliAuthUsedError"]>> {
    // Step 1: Initiate the CLI auth process
    const response = await this._interface.sendClientRequest(
      "/auth/cli",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_in_millis: options.expiresInMillis,
          ...(options.anonRefreshToken != null ? { anon_refresh_token: options.anonRefreshToken } : {}),
        }),
      },
      null
    );

    if (!response.ok) {
      return Result.error(new KnownErrors.CliAuthError(`Failed to initiate CLI auth: ${response.status} ${await response.text()}`));
    }

    const initResult = await response.json();
    const pollingCode = initResult.polling_code;
    const loginCode = initResult.login_code;

    // Step 2: Open the browser for the user to authenticate and display the verification code
    const url = buildCliAuthConfirmUrl({
      cliAuthConfirmUrl: this.urls.cliAuthConfirm,
      appUrl: options.appUrl,
      loginCode,
    });
    if (options.promptLink) {
      options.promptLink(url, loginCode);
    } else {
      console.log(`Your verification code: ${loginCode}`);
      console.log(`Please visit the following URL to authenticate:\n${url}`);
    }

    // Step 3: Poll for the token
    let attempts = 0;
    while (attempts < (options.maxAttempts ?? Infinity)) {
      attempts++;
      const pollResponse = await this._interface.sendClientRequest("/auth/cli/poll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          polling_code: pollingCode,
        }),
      }, null);

      if (!pollResponse.ok) {
        return Result.error(new KnownErrors.CliAuthError(`Failed to initiate CLI auth: ${pollResponse.status} ${await pollResponse.text()}`));
      }
      const pollResult = await pollResponse.json();

      if (pollResponse.status === 201 && pollResult.status === "success") {
        return Result.ok(pollResult.refresh_token);
      }
      if (pollResult.status === "waiting") {
        await wait(options.waitTimeMillis ?? 2000);
        continue;
      }
      if (pollResult.status === "expired") {
        return Result.error(new KnownErrors.CliAuthExpiredError("CLI authentication request expired. Please try again."));
      }
      if (pollResult.status === "used") {
        return Result.error(new KnownErrors.CliAuthUsedError("This authentication token has already been used."));
      }
      return Result.error(new KnownErrors.CliAuthError(`Unexpected status from CLI auth polling: ${pollResult.status}`));
    }

    return Result.error(new KnownErrors.CliAuthError("Timed out waiting for CLI authentication."));
  }

  /*
   * Completes the MFA sign-in process by verifying the provided OTP code
   * @param totp The TOTP (Time-based One-Time Password) provided by the user
   * @param code The Attempt code provided by the user
   * @param options Additional options for the sign-in process
   * @returns A Result indicating success or failure
   */
  async signInWithMfa(totp: string, code: string, options?: { noRedirect?: boolean }): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["InvalidTotpCode"]>> {
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await this._interface.signInWithMfa(totp, code, session);
      });
    } catch (e) {
      if (e instanceof KnownErrors.InvalidTotpCode) {
        return Result.error(e);
      }
      throw e;
    }

    if (result.status === 'ok') {
      await this._signInToAccountWithTokens(result.data);
      if (!(options?.noRedirect)) {
        if (result.data.newUser) {
          await this._redirectToHandler("afterSignUp", { replace: true }, {
            overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
          });
        } else {
          await this._redirectToHandler("afterSignIn", { replace: true }, {
            overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
          });
        }
      }
      return Result.ok(undefined);
    }
    return Result.error(result.error);
  }

  async signInWithPasskey(): Promise<Result<undefined, KnownErrors["PasskeyAuthenticationFailed"] | KnownErrors["InvalidTotpCode"] | KnownErrors["PasskeyWebAuthnError"]>> {
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        const initiationResult = await this._interface.initiatePasskeyAuthentication({}, session);
        if (initiationResult.status !== "ok") {
          return Result.error(new KnownErrors.PasskeyAuthenticationFailed("Failed to get initiation options for passkey authentication"));
        }

        const { options_json, code } = initiationResult.data;

        // HACK: Override the rpID to be the actual domain
        if (options_json.rpId !== "THIS_VALUE_WILL_BE_REPLACED.example.com") {
          throw new HexclaveAssertionError(`Expected returned RP ID from server to equal sentinel, but found ${options_json.rpId}`);
        }
        options_json.rpId = window.location.hostname;

        const authentication_response = await startAuthentication({ optionsJSON: options_json });
        return await this._interface.signInWithPasskey({ authentication_response, code }, session);
      });
    } catch (error) {
      if (error instanceof WebAuthnError) {
        return Result.error(new KnownErrors.PasskeyWebAuthnError(error.message, error.name));
      } else {
        // This should never happen
        return Result.error(new KnownErrors.PasskeyAuthenticationFailed("Failed to sign in with passkey"));
      }
    }

    if (result.status === 'ok') {
      await this._signInToAccountWithTokens(result.data);
      await this._redirectToHandler("afterSignIn", { replace: true }, {
        overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
      });
      return Result.ok(undefined);
    } else {
      return Result.error(result.error);
    }
  }


  async callOAuthCallback(
    options?: {
      dontWarnAboutMissingQueryParams?: boolean,
    },
  ) {
    if (typeof window === "undefined") {
      throw new Error("callOAuthCallback can currently only be called in a browser environment");
    }
    if (this._currentUrlLooksLikeOAuthCallback()) {
      this._ensurePersistentTokenStore();
    }
    let oauthCallbackRedirectUri = this._getOAuthCallbackRedirectUri();
    const currentUrl = new URL(window.location.href);
    if (
      currentUrl.searchParams.get(crossDomainAuthQueryParams.marker) === "1"
      || currentUrl.searchParams.has(nestedCrossDomainAuthQueryParams.refreshTokenId)
    ) {
      currentUrl.searchParams.delete("code");
      currentUrl.searchParams.delete("state");
      oauthCallbackRedirectUri = currentUrl.toString();
    }
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await callOAuthCallback(this._interface, oauthCallbackRedirectUri, options);
      });
    } catch (e) {
      if (KnownErrors.InvalidTotpCode.isInstance(e)) {
        alert("Invalid TOTP code. Please try signing in again.");
        return false;
      } else {
        throw e;
      }
    }
    if (result.status === 'ok' && result.data) {
      this._ensurePersistentTokenStore();
      await this._signInToAccountWithTokens(result.data);
      // TODO fix afterCallbackRedirectUrl for MFA (currently not passed because /mfa/sign-in doesn't return it)
      // or just get rid of afterCallbackRedirectUrl entirely tbh
      if ("afterCallbackRedirectUrl" in result.data && result.data.afterCallbackRedirectUrl) {
        await this._redirectTo({ url: result.data.afterCallbackRedirectUrl, replace: true });
        return true;
      } else if (result.data.newUser) {
        await this._redirectToHandler("afterSignUp", { replace: true }, {
          awaitPendingAuthResolutions: false,
          overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
        });
        return true;
      } else {
        await this._redirectToHandler("afterSignIn", { replace: true }, {
          awaitPendingAuthResolutions: false,
          overrideTokenStoreInit: this._getTokenStoreInitForFreshTokens(result.data),
        });
        return true;
      }
    }
    return false;
  }

  protected async _signOut(session: InternalSession, options?: { redirectUrl?: URL | string }): Promise<void> {
    // Clear analytics buffers before sign-out to prevent cross-user event leakage
    this._eventTracker?.clearBuffer();
    this._sessionRecorder?.clearBuffer();

    await storeLock.withWriteLock(async () => {
      await this._interface.signOut(session);
      if (options?.redirectUrl) {
        await this._redirectTo({ url: options.redirectUrl, replace: true });
      } else {
        await this._redirectToDefaultAfterSignOut();
      }
    });
  }

  protected async _redirectToDefaultAfterSignOut(): Promise<void> {
    if (this._urlOptions.afterSignOut != null) {
      await this.redirectToAfterSignOut({ replace: true });
      return;
    }

    if (this._urlOptions.home != null) {
      await this.redirectToHome({ replace: true });
      return;
    }

    if (this._urlOptions.default?.type === "hosted" && typeof window !== "undefined") {
      await this._redirectTo({ url: getRelativePart(new URL(window.location.href)), replace: true });
      return;
    }

    await this.redirectToAfterSignOut({ replace: true });
  }

  async signOut(options?: { redirectUrl?: URL | string, tokenStore?: TokenStoreInit }): Promise<void> {
    const user = await this.getUser({ tokenStore: options?.tokenStore ?? undefined as any });
    if (user) {
      await user.signOut({ redirectUrl: options?.redirectUrl });
    }
  }

  async getAccessToken(options?: { tokenStore?: TokenStoreInit }): Promise<string | null> {
    const user = await this.getUser({ tokenStore: options?.tokenStore ?? undefined as any });
    if (user) {
      return await user.getAccessToken();
    }
    return null;
  }

  // IF_PLATFORM react-like
  useAccessToken(options?: { tokenStore?: TokenStoreInit }): string | null {
    const user = this.useUser({ tokenStore: options?.tokenStore ?? undefined as any });
    if (user) {
      return user.useAccessToken();
    }
    return null;
  }
  // END_PLATFORM

  async getRefreshToken(options?: { tokenStore?: TokenStoreInit }): Promise<string | null> {
    const user = await this.getUser({ tokenStore: options?.tokenStore ?? undefined as any });
    if (user) {
      return await user.getRefreshToken();
    }
    return null;
  }

  // IF_PLATFORM react-like
  useRefreshToken(options?: { tokenStore?: TokenStoreInit }): string | null {
    const user = this.useUser({ tokenStore: options?.tokenStore ?? undefined as any });
    if (user) {
      return user.useRefreshToken();
    }
    return null;
  }
  // END_PLATFORM

  async getAuthorizationHeader(options?: { tokenStore?: TokenStoreInit }): Promise<string | null> {
    return getAuthorizationHeaderValueFromAuthJson(await this.getAuthJson(options));
  }

  // IF_PLATFORM react-like
  useAuthorizationHeader(options?: { tokenStore?: TokenStoreInit }): string | null {
    return getAuthorizationHeaderValueFromAuthJson(this.useAuthJson(options));
  }
  // END_PLATFORM

  async getAuthHeaders(options?: { tokenStore?: TokenStoreInit }): Promise<{ "x-stack-auth": string }> {
    return {
      "x-stack-auth": JSON.stringify(await this.getAuthJson(options)),
    };
  }

  // IF_PLATFORM react-like
  useAuthHeaders(options?: { tokenStore?: TokenStoreInit }): { "x-stack-auth": string } {
    return {
      "x-stack-auth": JSON.stringify(this.useAuthJson(options)),
    };
  }
  // END_PLATFORM

  async getAuthJson(options?: { tokenStore?: TokenStoreInit }): Promise<{ accessToken: string | null, refreshToken: string | null }> {
    const user = await this.getUser({ tokenStore: options?.tokenStore ?? undefined as any });
    if (user) {
      return await user.getAuthJson();
    }
    return { accessToken: null, refreshToken: null };
  }

  // IF_PLATFORM react-like
  useAuthJson(options?: { tokenStore?: TokenStoreInit }): { accessToken: string | null, refreshToken: string | null } {
    const user = this.useUser({ tokenStore: options?.tokenStore ?? undefined as any });
    if (user) {
      return user.useAuthJson();
    }
    return { accessToken: null, refreshToken: null };
  }
  // END_PLATFORM

  async getProject(): Promise<Project> {
    const crud = Result.orThrow(await this._currentProjectCache.getOrWait([], "write-only"));
    return this._clientProjectFromCrud(crud);
  }

  // IF_PLATFORM react-like
  useProject(): Project {
    const crud = useAsyncCache(this._currentProjectCache, [], "clientApp.useProject()");
    return useMemo(() => this._clientProjectFromCrud(crud), [crud]);
  }
  // END_PLATFORM

  protected async _listOwnedProjects(session: InternalSession): Promise<AdminOwnedProject[]> {
    this._ensureInternalProject();
    const crud = Result.orThrow(await this._ownedProjectsCache.getOrWait([session], "write-only"));
    return crud.map((j) => this._getOwnedAdminApp(j.id, session)._adminOwnedProjectFromCrud(
      j,
      () => this._refreshOwnedProjects(session),
    ));
  }

  // IF_PLATFORM react-like
  protected _useOwnedProjects(session: InternalSession): AdminOwnedProject[] {
    this._ensureInternalProject();
    const projects = useAsyncCache(this._ownedProjectsCache, [session], "clientApp.useOwnedProjects()");
    return useMemo(() => projects.map((j) => this._getOwnedAdminApp(j.id, session)._adminOwnedProjectFromCrud(
      j,
      () => this._refreshOwnedProjects(session),
    )), [projects]);
  }
  // END_PLATFORM
  protected async _createProject(session: InternalSession, newProject: AdminProjectUpdateOptions & { displayName: string, teamId: string }): Promise<AdminOwnedProject> {
    this._ensureInternalProject();
    const crud = await this._interface.createProject(adminProjectCreateOptionsToCrud(newProject), session);
    const res = this._getOwnedAdminApp(crud.id, session)._adminOwnedProjectFromCrud(
      crud,
      () => this._refreshOwnedProjects(session),
    );
    await this._refreshOwnedProjects(session);
    return res;
  }

  protected async _refreshUser(session: InternalSession) {
    // TODO this should take a user ID instead of a session, and automatically refresh all sessions with that user ID
    await this._refreshSession(session);
  }

  protected async _refreshSession(session: InternalSession) {
    await Promise.all([
      this._currentUserCache.refresh([session]),
      this._currentUserConnectedAccountsCache.refresh([session]),
    ]);
    // Suggest updating the access token so it contains the updated user/session data
    session.suggestAccessTokenExpired();
  }

  protected async _refreshUsers() {
    // nothing yet
  }

  protected async _refreshProject() {
    await this._currentProjectCache.refresh([]);
  }

  protected async _refreshOwnedProjects(session: InternalSession) {
    await this._ownedProjectsCache.refresh([session]);
  }

  static get [hexclaveAppInternalsSymbol]() {
    return {
      fromClientJson: <HasTokenStore extends boolean, ProjectId extends string>(
        json: StackClientAppJson<HasTokenStore, ProjectId>
      ): StackClientApp<HasTokenStore, ProjectId> => {
        const providedCheckString = JSON.stringify(omit(json, [/* none currently */]));
        const existing = allClientApps.get(json.uniqueIdentifier);
        if (existing) {
          const [existingCheckString, clientApp] = existing;
          if (existingCheckString !== undefined && existingCheckString !== providedCheckString) {
            throw new HexclaveAssertionError("The provided app JSON does not match the configuration of the existing client app with the same unique identifier", { providedObj: json, existingString: existingCheckString });
          }
          return clientApp as any;
        }

        const { analytics, ...restJson } = omit(json, ["uniqueIdentifier"]);
        return new _HexclaveClientAppImplIncomplete<HasTokenStore, ProjectId>({
          ...restJson as any,
          analytics: analyticsOptionsFromJson(analytics),
        }, {
          uniqueIdentifier: json.uniqueIdentifier,
          checkString: providedCheckString,
        });
      }
    };
  }

  get [hexclaveAppInternalsSymbol]() {
    return {
      toClientJson: (): StackClientAppJson<HasTokenStore, ProjectId> => {
        if (typeof this._redirectMethod !== "string") {
          throw new HexclaveAssertionError("Cannot serialize to JSON from an application with a non-string redirect method");
        }

        const publishableClientKey = "publishableClientKey" in this._interface.options
          ? this._interface.options.publishableClientKey
          : undefined;

        return {
          baseUrl: this._options.baseUrl,
          projectId: this.projectId,
          ...(publishableClientKey != null ? { publishableClientKey } : {}),
          tokenStore: this._tokenStoreInit,
          urls: this._urlOptions,
          oauthScopesOnSignIn: this._oauthScopesOnSignIn,
          uniqueIdentifier: this._getUniqueIdentifier(),
          redirectMethod: this._redirectMethod,
          extraRequestHeaders: this._options.extraRequestHeaders,
          devTool: this._options.devTool,
          analytics: analyticsOptionsToJson(this._analyticsOptions),
        };
      },
      setCurrentUser: (userJsonPromise: Promise<CurrentUserCrud['Client']['Read'] | null>) => {
        runAsynchronously(async () => {
          await this._currentUserCache.forceSetCachedValueAsync([await this._getSession()], Result.fromPromise(userJsonPromise));
        });
      },
      getConstructorOptions: () => this._options,
      sendSessionReplayBatch: async (body: string, options: { keepalive: boolean }) => {
        return await this._interface.sendSessionReplayBatch(body, await this._getSession(), options);
      },
      sendAnalyticsEventBatch: async (body: string, options: { keepalive: boolean }) => {
        return await this._interface.sendAnalyticsEventBatch(body, await this._getSession(), options);
      },
      addRequestListener: (listener: RequestListener) => {
        return this._interface.addRequestListener(listener);
      },
      sendRequest: async (
        path: string,
        requestOptions: RequestInit,
        requestType: "client" | "server" | "admin" = "client",
      ) => {
        return await this._interface.sendClientRequest(path, requestOptions, await this._getSession(), requestType);
      },
      getRedirectMethod: () => this._redirectMethod ?? throwErr("Redirect method should have been initialized in the Stack client app constructor"),
      redirectToUrl: async (url: string | URL, options?: { replace?: boolean }) => {
        await this._redirectTo({ url, ...options });
      },
      redirectToHandler: async (handlerName: keyof HandlerUrls, options?: RedirectToOptions) => {
        await this._redirectToHandler(handlerName, options);
      },
      refreshOwnedProjects: async () => {
        await this._refreshOwnedProjects(await this._getSession());
      },
      signInWithTokens: async (tokens: { accessToken: string, refreshToken: string }) => {
        await this._signInToAccountWithTokens(tokens);
      },
    };
  };

}
