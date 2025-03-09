import { WebAuthnError, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { KnownErrors, StackClientInterface } from "@stackframe/stack-shared";
import { ContactChannelsCrud } from "@stackframe/stack-shared/dist/interface/crud/contact-channels";
import { CurrentUserCrud } from "@stackframe/stack-shared/dist/interface/crud/current-user";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { TeamInvitationCrud } from "@stackframe/stack-shared/dist/interface/crud/team-invitation";
import { TeamMemberProfilesCrud } from "@stackframe/stack-shared/dist/interface/crud/team-member-profiles";
import { TeamPermissionsCrud } from "@stackframe/stack-shared/dist/interface/crud/team-permissions";
import { TeamsCrud } from "@stackframe/stack-shared/dist/interface/crud/teams";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { scrambleDuringCompileTime } from "@stackframe/stack-shared/dist/utils/compile-time";
import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { DependenciesMap } from "@stackframe/stack-shared/dist/utils/maps";
import { ProviderType } from "@stackframe/stack-shared/dist/utils/oauth";
import { deepPlainEquals, omit } from "@stackframe/stack-shared/dist/utils/objects";
import { neverResolve, runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { suspend, suspendIfSsr } from "@stackframe/stack-shared/dist/utils/react";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Store, storeLock } from "@stackframe/stack-shared/dist/utils/stores";
import { deindent, mergeScopeStrings } from "@stackframe/stack-shared/dist/utils/strings";
import { getRelativePart, isRelative } from "@stackframe/stack-shared/dist/utils/urls";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import * as cookie from "cookie";
// NEXT_LINE_PLATFORM next
import * as NextNavigationUnscrambled from "next/navigation"; // import the entire module to get around some static compiler warnings emitted by Next.js in some cases
// NEXT_LINE_PLATFORM react-like
import React, { useCallback, useMemo } from "react";
import { constructRedirectUrl } from "../../../../utils/url";
import { addNewOAuthProviderOrScope, callOAuthCallback, signInWithOAuth } from "../../../auth";
import { CookieHelper, createBrowserCookieHelper, createCookieHelper, createPlaceholderCookieHelper, deleteCookieClient, getCookieClient, setOrDeleteCookie, setOrDeleteCookieClient } from "../../../cookie";
import { GetUserOptions, HandlerUrls, OAuthScopesOnSignIn, RedirectMethod, RedirectToOptions, RequestLike, TokenStoreInit, stackAppInternalsSymbol } from "../../common";
import { OAuthConnection } from "../../connected-accounts";
import { ContactChannel, ContactChannelCreateOptions, ContactChannelUpdateOptions, contactChannelCreateOptionsToCrud, contactChannelUpdateOptionsToCrud } from "../../contact-channels";
import { TeamPermission } from "../../permissions";
import { AdminOwnedProject, AdminProjectUpdateOptions, Project, adminProjectCreateOptionsToCrud } from "../../projects";
import { EditableTeamMemberProfile, Team, TeamCreateOptions, TeamInvitation, TeamUpdateOptions, TeamUser, teamCreateOptionsToCrud, teamUpdateOptionsToCrud } from "../../teams";
import { Auth, BaseUser, CurrentUser, InternalUserExtra, ProjectCurrentUser, UserExtra, UserUpdateOptions, userUpdateOptionsToCrud } from "../../users";
import { StackClientApp, StackClientAppConstructorOptions, StackClientAppJson } from "../interfaces/client-app";
import { _StackAdminAppImplIncomplete } from "./admin-app-impl";
import { TokenObject, clientVersion, createCache, createCacheBySession, createEmptyTokenStore, getBaseUrl, getDefaultProjectId, getDefaultPublishableClientKey, getUrls } from "./common";
// NEXT_LINE_PLATFORM react-like
import { useAsyncCache } from "./common";

let isReactServer = false;
// IF_PLATFORM next
import * as sc from "@stackframe/stack-sc";
import { cookies } from '@stackframe/stack-sc';
isReactServer = sc.isReactServer;

// NextNavigation.useRouter does not exist in react-server environments and some bundlers try to be helpful and throw a warning. Ignore the warning.
const NextNavigation = scrambleDuringCompileTime(NextNavigationUnscrambled);
// END_PLATFORM

// hack to make sure process is defined in non-node environments
// NEXT_LINE_PLATFORM js react
const process = (globalThis as any).process ?? { env: {} };


const allClientApps = new Map<string, [checkString: string, app: StackClientApp<any, any>]>();

export class _StackClientAppImplIncomplete<HasTokenStore extends boolean, ProjectId extends string = string> {
  /**
   * There is a circular dependency between the admin app and the client app, as the former inherits from the latter and
   * the latter needs to use the former when creating a new instance of an internal project.
   *
   * To break it, we set the admin app here lazily instead of importing it directly. This variable is set by ./index.ts,
   * which imports both this file and ./admin-app-impl.ts.
   */
  static readonly LazyStackAdminAppImpl: { value: typeof import("./admin-app-impl")._StackAdminAppImplIncomplete | undefined } = { value: undefined };

  protected _uniqueIdentifier: string | undefined = undefined;
  protected _interface: StackClientInterface;
  protected readonly _tokenStoreInit: TokenStoreInit<HasTokenStore>;
  protected readonly _redirectMethod: RedirectMethod | undefined;
  protected readonly _urlOptions: Partial<HandlerUrls>;
  protected readonly _oauthScopesOnSignIn: Partial<OAuthScopesOnSignIn>;

  private __DEMO_ENABLE_SLIGHT_FETCH_DELAY = false;
  private readonly _ownedAdminApps = new DependenciesMap<[InternalSession, string], _StackAdminAppImplIncomplete<false, string>>();

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
  private readonly _currentUserTeamsCache = createCacheBySession(async (session) => {
    return await this._interface.listCurrentUserTeams(session);
  });
  private readonly _currentUserOAuthConnectionAccessTokensCache = createCacheBySession<[string, string], { accessToken: string } | null>(
    async (session, [providerId, scope]) => {
      try {
        const result = await this._interface.createProviderAccessToken(providerId, scope || "", session);
        return { accessToken: result.access_token };
      } catch (err) {
        if (!(err instanceof KnownErrors.OAuthConnectionDoesNotHaveRequiredScope || err instanceof KnownErrors.OAuthConnectionNotConnectedToUser)) {
          throw err;
        }
      }
      return null;
    }
  );
  private readonly _currentUserOAuthConnectionCache = createCacheBySession<[ProviderType, string, boolean], OAuthConnection | null>(
    async (session, [providerId, scope, redirect]) => {
      return await this._getUserOAuthConnectionCacheFn({
        getUser: async () => Result.orThrow(await this._currentUserCache.getOrWait([session], "write-only")),
        getOrWaitOAuthToken: async () => Result.orThrow(await this._currentUserOAuthConnectionAccessTokensCache.getOrWait([session, providerId, scope || ""] as const, "write-only")),
        // IF_PLATFORM react-like
        useOAuthToken: () => useAsyncCache(this._currentUserOAuthConnectionAccessTokensCache, [session, providerId, scope || ""] as const, "useOAuthToken"),
        // END_PLATFORM
        providerId,
        scope,
        redirect,
        session,
      });
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
  private readonly _clientContactChannelsCache = createCacheBySession<[], ContactChannelsCrud['Client']['Read'][]>(
    async (session) => {
      return await this._interface.listClientContactChannels(session);
    }
  );

  protected async _createCookieHelper(): Promise<CookieHelper> {
    if (this._tokenStoreInit === 'nextjs-cookie' || this._tokenStoreInit === 'cookie') {
      return await createCookieHelper();
    } else {
      return await createPlaceholderCookieHelper();
    }
  }

  protected async _getUserOAuthConnectionCacheFn(options: {
    getUser: () => Promise<CurrentUserCrud['Client']['Read'] | null>,
    getOrWaitOAuthToken: () => Promise<{ accessToken: string } | null>,
    // IF_PLATFORM react-like
    useOAuthToken: () => { accessToken: string } | null,
    // END_PLATFORM
    providerId: ProviderType,
    scope: string | null,
  } & ({ redirect: true, session: InternalSession | null } | { redirect: false }),) {
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
      await addNewOAuthProviderOrScope(
          this._interface,
          {
            provider: options.providerId,
            redirectUrl: this.urls.oauthCallback,
            errorRedirectUrl: this.urls.error,
            providerScope: mergeScopeStrings(options.scope || "", (this._oauthScopesOnSignIn[options.providerId] ?? []).join(" ")),
          },
          options.session,
        );
      return await neverResolve();
    } else if (!hasConnection) {
      return null;
    }

    return {
      id: options.providerId,
      async getAccessToken() {
        const result = await options.getOrWaitOAuthToken();
        if (!result) {
          throw new StackAssertionError("No access token available");
        }
        return result;
      },
      // IF_PLATFORM react-like
      useAccessToken() {
        const result = options.useOAuthToken();
        if (!result) {
          throw new StackAssertionError("No access token available");
        }
        return result;
      }
      // END_PLATFORM
    };
  }

  constructor(protected readonly _options:
    & {
      uniqueIdentifier?: string,
      checkString?: string,
    }
    & (
      | StackClientAppConstructorOptions<HasTokenStore, ProjectId>
      | Exclude<StackClientAppConstructorOptions<HasTokenStore, ProjectId>, "baseUrl" | "projectId" | "publishableClientKey"> & {
        interface: StackClientInterface,
      }
    )
  ) {
    if (!_StackClientAppImplIncomplete.LazyStackAdminAppImpl.value) {
      throw new StackAssertionError("Admin app implementation not initialized. Did you import the _StackClientApp from stack-app/apps/implementations/index.ts? You can't import it directly from ./apps/implementations/client-app-impl.ts as that causes a circular dependency (see the comment at _LazyStackAdminAppImpl for more details).");
    }

    if ("interface" in _options) {
      this._interface = _options.interface;
    } else {
      this._interface = new StackClientInterface({
        getBaseUrl: () => getBaseUrl(_options.baseUrl),
        projectId: _options.projectId ?? getDefaultProjectId(),
        clientVersion,
        publishableClientKey: _options.publishableClientKey ?? getDefaultPublishableClientKey(),
        prepareRequest: async () => {
          // NEXT_LINE_PLATFORM next
          await cookies?.();
        }
      });
    }

    this._tokenStoreInit = _options.tokenStore;
    this._redirectMethod = _options.redirectMethod || "none";
    // NEXT_LINE_PLATFORM next
    this._redirectMethod = _options.redirectMethod || "nextjs";
    this._urlOptions = _options.urls ?? {};
    this._oauthScopesOnSignIn = _options.oauthScopesOnSignIn ?? {};

    if (_options.uniqueIdentifier) {
      this._uniqueIdentifier = _options.uniqueIdentifier;
      this._initUniqueIdentifier();
    }
  }

  protected _initUniqueIdentifier() {
    if (!this._uniqueIdentifier) {
      throw new StackAssertionError("Unique identifier not initialized");
    }
    if (allClientApps.has(this._uniqueIdentifier)) {
      throw new StackAssertionError("A Stack client app with the same unique identifier already exists");
    }
    allClientApps.set(this._uniqueIdentifier, [this._options.checkString ?? "default check string", this]);
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
    throw new StackAssertionError(`${name} is not currently supported. Please reach out to Stack support for more information.`);
  }

  protected _memoryTokenStore = createEmptyTokenStore();
  protected _nextServerCookiesTokenStores = new WeakMap<object, Store<TokenObject>>();
  protected _requestTokenStores = new WeakMap<RequestLike, Store<TokenObject>>();
  protected _storedBrowserCookieTokenStore: Store<TokenObject> | null = null;
  protected get _refreshTokenCookieName() {
    return `stack-refresh-${this.projectId}`;
  }
  protected _getTokensFromCookies(cookies: { refreshTokenCookie: string | null, accessTokenCookie: string | null }): TokenObject {
    const refreshToken = cookies.refreshTokenCookie;
    const accessTokenObject = cookies.accessTokenCookie?.startsWith('[\"') ? JSON.parse(cookies.accessTokenCookie) : null;  // gotta check for validity first for backwards-compat, and also in case someone messes with the cookie value
    const accessToken = accessTokenObject && refreshToken === accessTokenObject[0] ? accessTokenObject[1] : null;  // if the refresh token has changed, the access token is invalid
    return {
      refreshToken,
      accessToken,
    };
  }
  protected get _accessTokenCookieName() {
    // The access token, unlike the refresh token, should not depend on the project ID. We never want to store the
    // access token in cookies more than once because of how big it is (there's a limit of 4096 bytes for all cookies
    // together). This means that, if you have multiple projects on the same domain, some of them will need to refetch
    // the access token on page reload.
    return `stack-access`;
  }
  protected _getBrowserCookieTokenStore(): Store<TokenObject> {
    if (!isBrowserLike()) {
      throw new Error("Cannot use cookie token store on the server!");
    }

    if (this._storedBrowserCookieTokenStore === null) {
      const getCurrentValue = (old: TokenObject | null) => {
        const tokens = this._getTokensFromCookies({
          refreshTokenCookie: getCookieClient(this._refreshTokenCookieName) ?? getCookieClient('stack-refresh'),  // keep old cookie name for backwards-compatibility
          accessTokenCookie: getCookieClient(this._accessTokenCookieName),
        });
        return {
          refreshToken: tokens.refreshToken,
          accessToken: tokens.accessToken ?? (old?.refreshToken === tokens.refreshToken ? old.accessToken : null),
        };
      };
      this._storedBrowserCookieTokenStore = new Store<TokenObject>(getCurrentValue(null));
      let hasSucceededInWriting = true;

      setInterval(() => {
        if (hasSucceededInWriting) {
          const oldValue = this._storedBrowserCookieTokenStore!.get();
          const currentValue = getCurrentValue(oldValue);
          if (!deepPlainEquals(currentValue, oldValue)) {
            this._storedBrowserCookieTokenStore!.set(currentValue);
          }
        }
      }, 100);
      this._storedBrowserCookieTokenStore.onChange((value) => {
        try {
          setOrDeleteCookieClient(this._refreshTokenCookieName, value.refreshToken, { maxAge: 60 * 60 * 24 * 365 });
          setOrDeleteCookieClient(this._accessTokenCookieName, value.accessToken ? JSON.stringify([value.refreshToken, value.accessToken]) : null, { maxAge: 60 * 60 * 24 });
          deleteCookieClient('stack-refresh');  // delete cookie name from previous versions (for backwards-compatibility)
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
    }

    return this._storedBrowserCookieTokenStore;
  };
  protected _getOrCreateTokenStore(cookieHelper: CookieHelper, overrideTokenStoreInit?: TokenStoreInit): Store<TokenObject> {
    const tokenStoreInit = overrideTokenStoreInit === undefined ? this._tokenStoreInit : overrideTokenStoreInit;

    switch (tokenStoreInit) {
      case "cookie": {
        return this._getBrowserCookieTokenStore();
      }
      case "nextjs-cookie": {
        if (isBrowserLike()) {
          return this._getBrowserCookieTokenStore();
        } else {
          const tokens = this._getTokensFromCookies({
            refreshTokenCookie: cookieHelper.get(this._refreshTokenCookieName) ?? cookieHelper.get('stack-refresh'),  // keep old cookie name for backwards-compatibility
            accessTokenCookie: cookieHelper.get(this._accessTokenCookieName),
          });
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
              await Promise.all([
                setOrDeleteCookie(this._refreshTokenCookieName, value.refreshToken, { maxAge: 60 * 60 * 24 * 365, noOpIfServerComponent: true }),
                setOrDeleteCookie(this._accessTokenCookieName, value.accessToken ? JSON.stringify([value.refreshToken, value.accessToken]) : null, { maxAge: 60 * 60 * 24, noOpIfServerComponent: true }),
              ]);
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

          // x-stack-auth header
          const stackAuthHeader = tokenStoreInit.headers.get("x-stack-auth");
          if (stackAuthHeader) {
            let parsed;
            try {
              parsed = JSON.parse(stackAuthHeader);
              if (typeof parsed !== "object") throw new Error("x-stack-auth header must be a JSON object");
              if (parsed === null) throw new Error("x-stack-auth header must not be null");
            } catch (e) {
              throw new Error(`Invalid x-stack-auth header: ${stackAuthHeader}`, { cause: e });
            }
            return this._getOrCreateTokenStore(cookieHelper, {
              accessToken: parsed.accessToken ?? null,
              refreshToken: parsed.refreshToken ?? null,
            });
          }

          // read from cookies
          const cookieHeader = tokenStoreInit.headers.get("cookie");
          const parsed = cookie.parse(cookieHeader || "");
          const res = new Store<TokenObject>({
            refreshToken: parsed[this._refreshTokenCookieName] || parsed['stack-refresh'] || null,  // keep old cookie name for backwards-compatibility
            accessToken: parsed[this._accessTokenCookieName] || null,
          });
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
      tokenStore.update((old) => ({
        ...old,
        accessToken: newAccessToken?.token ?? null
      }));
    });
    session.onInvalidate(() => {
      tokenStore.update((old) => ({
        ...old,
        accessToken: null,
        refreshToken: null,
      }));
    });

    let sessionsBySessionKey = this._sessionsByTokenStoreAndSessionKey.get(tokenStore) ?? new Map();
    this._sessionsByTokenStoreAndSessionKey.set(tokenStore, sessionsBySessionKey);
    sessionsBySessionKey.set(sessionKey, session);
    return session;
  }

  protected async _getSession(overrideTokenStoreInit?: TokenStoreInit): Promise<InternalSession> {
    const tokenStore = this._getOrCreateTokenStore(await this._createCookieHelper(), overrideTokenStoreInit);
    return this._getSessionFromTokenStore(tokenStore);
  }

  // IF_PLATFORM react-like
  protected _useSession(overrideTokenStoreInit?: TokenStoreInit): InternalSession {
    const tokenStore = this._useTokenStore(overrideTokenStoreInit);
    const subscribe = useCallback((cb: () => void) => {
      const { unsubscribe } = tokenStore.onChange(() => {
        cb();
      });
      return unsubscribe;
    }, [tokenStore]);
    const getSnapshot = useCallback(() => this._getSessionFromTokenStore(tokenStore), [tokenStore]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }
  // END_PLATFORM

  protected async _signInToAccountWithTokens(tokens: { accessToken: string | null, refreshToken: string }) {
    if (!("accessToken" in tokens) || !("refreshToken" in tokens)) {
      throw new StackAssertionError("Invalid tokens object; can't sign in with this", { tokens });
    }
    const tokenStore = this._getOrCreateTokenStore(await this._createCookieHelper());
    tokenStore.set(tokens);
  }

  protected _hasPersistentTokenStore(overrideTokenStoreInit?: TokenStoreInit): this is StackClientApp<true, ProjectId> {
    return (overrideTokenStoreInit !== undefined ? overrideTokenStoreInit : this._tokenStoreInit) !== null;
  }

  protected _ensurePersistentTokenStore(overrideTokenStoreInit?: TokenStoreInit): asserts this is StackClientApp<true, ProjectId>  {
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

  protected _clientProjectFromCrud(crud: ProjectsCrud['Client']['Read']): Project {
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
        oauthProviders: crud.config.enabled_oauth_providers.map((p) => ({
          id: p.id,
        })),
      }
    };
  }

  protected _clientTeamPermissionFromCrud(crud: TeamPermissionsCrud['Client']['Read']): TeamPermission {
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

  protected _clientTeamInvitationFromCrud(session: InternalSession, crud: TeamInvitationCrud['Client']['Read']): TeamInvitation {
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

  protected _clientTeamFromCrud(crud: TeamsCrud['Client']['Read'], session: InternalSession): Team {
    const app = this;
    return {
      id: crud.id,
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      clientMetadata: crud.client_metadata,
      clientReadOnlyMetadata: crud.client_read_only_metadata,
      async inviteUser(options: { email: string, callbackUrl?: string }) {
        if (!options.callbackUrl && !await app._getCurrentUrl()) {
          throw new Error("Cannot invite user without a callback URL from the server or without a redirect method. Make sure you pass the `callbackUrl` option: `inviteUser({ email, callbackUrl: ... })`");
        }
        await app._interface.sendTeamInvitation({
          teamId: crud.id,
          email: options.email,
          session,
          callbackUrl: options.callbackUrl ?? constructRedirectUrl(app.urls.teamInvitation),
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
        return result.map((crud) => app._clientTeamInvitationFromCrud(session, crud));
      },
      // IF_PLATFORM react-like
      useInvitations() {
        const result = useAsyncCache(app._teamInvitationsCache, [session, crud.id] as const, "team.useInvitations()");
        return result.map((crud) => app._clientTeamInvitationFromCrud(session, crud));
      },
      // END_PLATFORM
      async update(data: TeamUpdateOptions){
        await app._interface.updateTeam({ data: teamUpdateOptionsToCrud(data), teamId: crud.id }, session);
        await app._currentUserTeamsCache.refresh([session]);
      },
      async delete() {
        await app._interface.deleteTeam(crud.id, session);
        await app._currentUserTeamsCache.refresh([session]);
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

      async sendVerificationEmail() {
        await app._interface.sendCurrentUserContactChannelVerificationEmail(crud.id, constructRedirectUrl(app.urls.emailVerification), session);
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
  protected _createAuth(session: InternalSession): Auth {
    const app = this;
    return {
      _internalSession: session,
      currentSession: {
        async getTokens() {
          const tokens = await session.getOrFetchLikelyValidTokens(20_000);
          return {
            accessToken: tokens?.accessToken.token ?? null,
            refreshToken: tokens?.refreshToken?.token ?? null,
          };
        },
      },
      async getAuthHeaders(): Promise<{ "x-stack-auth": string }> {
        return {
          "x-stack-auth": JSON.stringify(await this.getAuthJson()),
        };
      },
      async getAuthJson(): Promise<{ accessToken: string | null, refreshToken: string | null }> {
        const tokens = await this.currentSession.getTokens();
        return tokens;
      },
      async registerPasskey(options?: { hostname?: string }): Promise<Result<undefined, KnownErrors["PasskeyRegistrationFailed"] | KnownErrors["PasskeyWebAuthnError"]>> {
        const hostname = (await app._getCurrentUrl())?.hostname;
        if (!hostname) {
          throw new StackAssertionError("hostname must be provided if the Stack App does not have a redirect method");
        }

        const initiationResult = await app._interface.initiatePasskeyRegistration({}, session);

        if (initiationResult.status !== "ok") {
          return Result.error(new KnownErrors.PasskeyRegistrationFailed("Failed to get initiation options for passkey registration"));
        }

        const { options_json, code } = initiationResult.data;

        // HACK: Override the rpID to be the actual domain
        if (options_json.rp.id !== "THIS_VALUE_WILL_BE_REPLACED.example.com") {
          throw new StackAssertionError(`Expected returned RP ID from server to equal sentinel, but found ${options_json.rp.id}`);
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
      toClientJson(): CurrentUserCrud['Client']['Read'] {
        return crud;
      }
    };
  }

  protected _createUserExtraFromCurrent(crud: NonNullable<CurrentUserCrud['Client']['Read']>, session: InternalSession): UserExtra {
    const app = this;
    async function getConnectedAccount(id: ProviderType, options?: { scopes?: string[] }): Promise<OAuthConnection | null>;
    async function getConnectedAccount(id: ProviderType, options: { or: 'redirect', scopes?: string[] }): Promise<OAuthConnection>;
    async function getConnectedAccount(id: ProviderType, options?: { or?: 'redirect', scopes?: string[] }): Promise<OAuthConnection | null> {
      const scopeString = options?.scopes?.join(" ");
      return Result.orThrow(await app._currentUserOAuthConnectionCache.getOrWait([session, id, scopeString || "", options?.or === 'redirect'], "write-only"));
    }

    // IF_PLATFORM react-like
    function useConnectedAccount(id: ProviderType, options?: { scopes?: string[] }): OAuthConnection | null;
    function useConnectedAccount(id: ProviderType, options: { or: 'redirect', scopes?: string[] }): OAuthConnection;
    function useConnectedAccount(id: ProviderType, options?: { or?: 'redirect', scopes?: string[] }): OAuthConnection | null {
      const scopeString = options?.scopes?.join(" ");
      return useAsyncCache(app._currentUserOAuthConnectionCache, [session, id, scopeString || "", options?.or === 'redirect'] as const, "user.useConnectedAccount()");
    }
    // END_PLATFORM
    return {
      setDisplayName(displayName: string) {
        return this.update({ displayName });
      },
      setClientMetadata(metadata: Record<string, any>) {
        return this.update({ clientMetadata: metadata });
      },
      async setSelectedTeam(team: Team | null) {
        await this.update({ selectedTeamId: team?.id ?? null });
      },
      getConnectedAccount,
      // NEXT_LINE_PLATFORM react-like
      useConnectedAccount,
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
        return app._clientTeamFromCrud(crud, session);
      },
      async leaveTeam(team: Team) {
        await app._interface.leaveTeam(team.id, session);
        // TODO: refresh cache
      },
      async listPermissions(scope: Team, options?: { recursive?: boolean }): Promise<TeamPermission[]> {
        const recursive = options?.recursive ?? true;
        const permissions = Result.orThrow(await app._currentUserPermissionsCache.getOrWait([session, scope.id, recursive], "write-only"));
        return permissions.map((crud) => app._clientTeamPermissionFromCrud(crud));
      },
      // IF_PLATFORM react-like
      usePermissions(scope: Team, options?: { recursive?: boolean }): TeamPermission[] {
        const recursive = options?.recursive ?? true;
        const permissions = useAsyncCache(app._currentUserPermissionsCache, [session, scope.id, recursive] as const, "user.usePermissions()");
        return useMemo(() => permissions.map((crud) => app._clientTeamPermissionFromCrud(crud)), [permissions]);
      },
      // END_PLATFORM
      // IF_PLATFORM react-like
      usePermission(scope: Team, permissionId: string): TeamPermission | null {
        const permissions = this.usePermissions(scope);
        return useMemo(() => permissions.find((p) => p.id === permissionId) ?? null, [permissions, permissionId]);
      },
      // END_PLATFORM
      async getPermission(scope: Team, permissionId: string): Promise<TeamPermission | null> {
        const permissions = await this.listPermissions(scope);
        return permissions.find((p) => p.id === permissionId) ?? null;
      },
      async hasPermission(scope: Team, permissionId: string): Promise<boolean> {
        return (await this.getPermission(scope, permissionId)) !== null;
      },
      async update(update) {
        return await app._updateClientUser(update, session);
      },
      async sendVerificationEmail(options?: { callbackUrl?: string }) {
        if (!crud.primary_email) {
          throw new StackAssertionError("User does not have a primary email");
        }
        if (!options?.callbackUrl && !await app._getCurrentUrl()) {
          throw new Error("Cannot send verification email without a callback URL from the server or without a redirect method. Make sure you pass the `callbackUrl` option: `sendVerificationEmail({ callbackUrl: ... })`");
        }
        return await app._interface.sendVerificationEmail(crud.primary_email, options?.callbackUrl ?? constructRedirectUrl(app.urls.emailVerification), session);
      },
      async updatePassword(options: { oldPassword: string, newPassword: string}) {
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
    };
  }

  protected _createInternalUserExtra(session: InternalSession): InternalUserExtra {
    const app = this;
    this._ensureInternalProject();
    return {
      createProject(newProject: AdminProjectUpdateOptions & { displayName: string }) {
        return app._createProject(session, newProject);
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

  protected _currentUserFromCrud(crud: NonNullable<CurrentUserCrud['Client']['Read']>, session: InternalSession): ProjectCurrentUser<ProjectId> {
    const currentUser = {
      ...this._createBaseUser(crud),
      ...this._createAuth(session),
      ...this._createUserExtraFromCurrent(crud, session),
      ...this._isInternalProject() ? this._createInternalUserExtra(session) : {},
    } satisfies CurrentUser;

    Object.freeze(currentUser);
    return currentUser as ProjectCurrentUser<ProjectId>;
  }

  protected _getOwnedAdminApp(forProjectId: string, session: InternalSession): _StackAdminAppImplIncomplete<false, string> {
    if (!this._ownedAdminApps.has([session, forProjectId])) {
      this._ownedAdminApps.set([session, forProjectId], new (_StackClientAppImplIncomplete.LazyStackAdminAppImpl.value!)({
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

  protected async _isTrusted(url: string): Promise<boolean> {
    return isRelative(url);
  }

  get urls(): Readonly<HandlerUrls> {
    return getUrls(this._urlOptions);
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
    } else {
      return (to: string) => {};
    }
  }
  // END_PLATFORM
  protected async _redirectIfTrusted(url: string, options?: RedirectToOptions) {
    if (!await this._isTrusted(url)) {
      throw new Error(`Redirect URL ${url} is not trusted; should be relative.`);
    }
    return await this._redirectTo({ url, ...options });
  }

  protected async _redirectToHandler(handlerName: keyof HandlerUrls, options?: RedirectToOptions) {
    let url = this.urls[handlerName];
    if (!url) {
      throw new Error(`No URL for handler name ${handlerName}`);
    }

    if (!options?.noRedirectBack) {
      if (handlerName === "afterSignIn" || handlerName === "afterSignUp") {
        if (isReactServer || typeof window === "undefined") {
          try {
            await this._checkFeatureSupport("rsc-handler-" + handlerName, {});
          } catch (e) {}
        } else {
          const queryParams = new URLSearchParams(window.location.search);
          url = queryParams.get("after_auth_return_to") || url;
        }
      } else if (handlerName === "signIn" || handlerName === "signUp") {
        if (isReactServer || typeof window === "undefined") {
          try {
            await this._checkFeatureSupport("rsc-handler-" + handlerName, {});
          } catch (e) {}
        } else {
          const currentUrl = new URL(window.location.href);
          const nextUrl = new URL(url, currentUrl);
          if (currentUrl.searchParams.has("after_auth_return_to")) {
            nextUrl.searchParams.set("after_auth_return_to", currentUrl.searchParams.get("after_auth_return_to")!);
          } else if (currentUrl.protocol === nextUrl.protocol && currentUrl.host === nextUrl.host) {
            nextUrl.searchParams.set("after_auth_return_to", getRelativePart(currentUrl));
          }
          url = getRelativePart(nextUrl);
        }
      }
    }

    await this._redirectIfTrusted(url, options);
  }

  async redirectToSignIn(options?: RedirectToOptions) { return await this._redirectToHandler("signIn", options); }
  async redirectToSignUp(options?: RedirectToOptions) { return await this._redirectToHandler("signUp", options); }
  async redirectToSignOut(options?: RedirectToOptions) { return await this._redirectToHandler("signOut", options); }
  async redirectToEmailVerification(options?: RedirectToOptions) { return await this._redirectToHandler("emailVerification", options); }
  async redirectToPasswordReset(options?: RedirectToOptions) { return await this._redirectToHandler("passwordReset", options); }
  async redirectToForgotPassword(options?: RedirectToOptions) { return await this._redirectToHandler("forgotPassword", options); }
  async redirectToHome(options?: RedirectToOptions) { return await this._redirectToHandler("home", options); }
  async redirectToOAuthCallback(options?: RedirectToOptions) { return await this._redirectToHandler("oauthCallback", options); }
  async redirectToMagicLinkCallback(options?: RedirectToOptions) { return await this._redirectToHandler("magicLinkCallback", options); }
  async redirectToAfterSignIn(options?: RedirectToOptions) { return await this._redirectToHandler("afterSignIn", options); }
  async redirectToAfterSignUp(options?: RedirectToOptions) { return await this._redirectToHandler("afterSignUp", options); }
  async redirectToAfterSignOut(options?: RedirectToOptions) { return await this._redirectToHandler("afterSignOut", options); }
  async redirectToAccountSettings(options?: RedirectToOptions) { return await this._redirectToHandler("accountSettings", options); }
  async redirectToError(options?: RedirectToOptions) { return await this._redirectToHandler("error", options); }
  async redirectToTeamInvitation(options?: RedirectToOptions) { return await this._redirectToHandler("teamInvitation", options); }

  async sendForgotPasswordEmail(email: string, options?: { callbackUrl?: string }): Promise<Result<undefined, KnownErrors["UserNotFound"]>> {
    if (!options?.callbackUrl && !await this._getCurrentUrl()) {
      throw new Error("Cannot send forgot password email without a callback URL from the server or without a redirect method. Make sure you pass the `callbackUrl` option: `sendForgotPasswordEmail({ email, callbackUrl: ... })`");
    }
    return await this._interface.sendForgotPasswordEmail(email, options?.callbackUrl ?? constructRedirectUrl(this.urls.passwordReset));
  }

  async sendMagicLinkEmail(email: string, options?: { callbackUrl?: string }): Promise<Result<{ nonce: string }, KnownErrors["RedirectUrlNotWhitelisted"]>> {
    if (!options?.callbackUrl && !await this._getCurrentUrl()) {
      throw new Error("Cannot send magic link email without a callback URL from the server or without a redirect method. Make sure you pass the `callbackUrl` option: `sendMagicLinkEmail({ email, callbackUrl: ... })`");
    }
    return await this._interface.sendMagicLinkEmail(email, options?.callbackUrl ?? constructRedirectUrl(this.urls.magicLinkCallback));
  }

  async resetPassword(options: { password: string, code: string }): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    return await this._interface.resetPassword(options);
  }

  async verifyPasswordResetCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    return await this._interface.verifyPasswordResetCode(code);
  }

  async verifyTeamInvitationCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    return await this._interface.acceptTeamInvitation({
      type: 'check',
      code,
      session: await this._getSession(),
    });
  }

  async acceptTeamInvitation(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
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

  async getTeamInvitationDetails(code: string): Promise<Result<{ teamDisplayName: string }, KnownErrors["VerificationCodeError"]>> {
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

  async getUser(options: GetUserOptions<HasTokenStore> & { or: 'redirect' }): Promise<ProjectCurrentUser<ProjectId>>;
  async getUser(options: GetUserOptions<HasTokenStore> & { or: 'throw' }): Promise<ProjectCurrentUser<ProjectId>>;
  async getUser(options?: GetUserOptions<HasTokenStore>): Promise<ProjectCurrentUser<ProjectId> | null>;
  async getUser(options?: GetUserOptions<HasTokenStore>): Promise<ProjectCurrentUser<ProjectId> | null> {
    this._ensurePersistentTokenStore(options?.tokenStore);
    const session = await this._getSession(options?.tokenStore);
    const crud = Result.orThrow(await this._currentUserCache.getOrWait([session], "write-only"));

    if (crud === null) {
      switch (options?.or) {
        case 'redirect': {
          await this.redirectToSignIn({ replace: true });
          break;
        }
        case 'throw': {
          throw new Error("User is not signed in but getUser was called with { or: 'throw' }");
        }
        default: {
          return null;
        }
      }
    }

    return crud && this._currentUserFromCrud(crud, session);
  }

  // IF_PLATFORM react-like
  useUser(options: GetUserOptions<HasTokenStore> & { or: 'redirect' }): ProjectCurrentUser<ProjectId>;
  useUser(options: GetUserOptions<HasTokenStore> & { or: 'throw' }): ProjectCurrentUser<ProjectId>;
  useUser(options?: GetUserOptions<HasTokenStore>): ProjectCurrentUser<ProjectId> | null;
  useUser(options?: GetUserOptions<HasTokenStore>): ProjectCurrentUser<ProjectId> | null {
    this._ensurePersistentTokenStore(options?.tokenStore);

    const session = this._useSession(options?.tokenStore);
    const crud = useAsyncCache(this._currentUserCache, [session], "useUser()");

    if (crud === null) {
      switch (options?.or) {
        case 'redirect': {
          runAsynchronously(this.redirectToSignIn({ replace: true }));
          suspend();
          throw new StackAssertionError("suspend should never return");
        }
        case 'throw': {
          throw new Error("User is not signed in but useUser was called with { or: 'throw' }");
        }
        case undefined:
        case "return-null": {
          // do nothing
        }
      }
    }

    return useMemo(() => {
      return crud && this._currentUserFromCrud(crud, session);
    }, [crud, session, options?.or]);
  }
  // END_PLATFORM

  protected async _updateClientUser(update: UserUpdateOptions, session: InternalSession) {
    const res = await this._interface.updateClientUser(userUpdateOptionsToCrud(update), session);
    await this._refreshUser(session);
    return res;
  }

  async signInWithOAuth(provider: ProviderType) {
    if (typeof window === "undefined") {
      throw new Error("signInWithOAuth can currently only be called in a browser environment");
    }

    this._ensurePersistentTokenStore();
    await signInWithOAuth(
      this._interface, {
        provider,
        redirectUrl: this.urls.oauthCallback,
        errorRedirectUrl: this.urls.error,
        providerScope: this._oauthScopesOnSignIn[provider]?.join(" "),
      }
    );
  }

  /**
   * @deprecated
   * TODO remove
   */
  protected async _experimentalMfa(error: KnownErrors['MultiFactorAuthenticationRequired'], session: InternalSession) {
    const otp = prompt('Please enter the six-digit TOTP code from your authenticator app.');
    if (!otp) {
      throw new KnownErrors.InvalidTotpCode();
    }

    return await this._interface.totpMfa(
      (error.details as any)?.attempt_code ?? throwErr("attempt code missing"),
      otp,
      session
    );
  }

  /**
   * @deprecated
   * TODO remove
   */
  protected async _catchMfaRequiredError<T, E>(callback: () => Promise<Result<T, E>>): Promise<Result<T | { accessToken: string, refreshToken: string, newUser: boolean }, E>> {
    try {
      return await callback();
    } catch (e) {
      if (e instanceof KnownErrors.MultiFactorAuthenticationRequired) {
        return Result.ok(await this._experimentalMfa(e, await this._getSession()));
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
      if (e instanceof KnownErrors.InvalidTotpCode) {
        return Result.error(e);
      }
      throw e;
    }

    if (result.status === 'ok') {
      await this._signInToAccountWithTokens(result.data);
      if (!options.noRedirect) {
        await this.redirectToAfterSignIn({ replace: true });
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
    verificationCallbackUrl?: string,
  }): Promise<Result<undefined, KnownErrors["UserEmailAlreadyExists"] | KnownErrors['PasswordRequirementsNotMet']>> {
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    const emailVerificationRedirectUrl = options.verificationCallbackUrl ?? constructRedirectUrl(this.urls.emailVerification);
    const result = await this._interface.signUpWithCredential(
      options.email,
      options.password,
      emailVerificationRedirectUrl,
      session
    );
    if (result.status === 'ok') {
      await this._signInToAccountWithTokens(result.data);
      if (!options.noRedirect) {
        await this.redirectToAfterSignUp({ replace: true });
      }
      return Result.ok(undefined);
    } else {
      return Result.error(result.error);
    }
  }

  async signInWithMagicLink(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["InvalidTotpCode"]>> {
    this._ensurePersistentTokenStore();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await this._interface.signInWithMagicLink(code);
      });
    } catch (e) {
      if (e instanceof KnownErrors.InvalidTotpCode) {
        return Result.error(e);
      }
      throw e;
    }

    if (result.status === 'ok') {
      await this._signInToAccountWithTokens(result.data);
      if (result.data.newUser) {
        await this.redirectToAfterSignUp({ replace: true });
      } else {
        await this.redirectToAfterSignIn({ replace: true });
      }
      return Result.ok(undefined);
    } else {
      return Result.error(result.error);
    }
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
          throw new StackAssertionError(`Expected returned RP ID from server to equal sentinel, but found ${options_json.rpId}`);
        }
        options_json.rpId = window.location.hostname;

        const authentication_response = await startAuthentication({ optionsJSON: options_json });
        return await this._interface.signInWithPasskey({ authentication_response, code });
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
      await this.redirectToAfterSignIn({ replace: true });
      return Result.ok(undefined);
    } else {
      return Result.error(result.error);
    }
  }


  async callOAuthCallback() {
    if (typeof window === "undefined") {
      throw new Error("callOAuthCallback can currently only be called in a browser environment");
    }
    this._ensurePersistentTokenStore();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await callOAuthCallback(this._interface, this.urls.oauthCallback);
      });
    } catch (e) {
      if (e instanceof KnownErrors.InvalidTotpCode) {
        alert("Invalid TOTP code. Please try signing in again.");
        return false;
      } else {
        throw e;
      }
    }
    if (result.status === 'ok' && result.data) {
      await this._signInToAccountWithTokens(result.data);
      // TODO fix afterCallbackRedirectUrl for MFA (currently not passed because /mfa/sign-in doesn't return it)
      // or just get rid of afterCallbackRedirectUrl entirely tbh
      if ("afterCallbackRedirectUrl" in result.data && result.data.afterCallbackRedirectUrl) {
        await this._redirectTo({ url: result.data.afterCallbackRedirectUrl, replace: true });
        return true;
      } else if (result.data.newUser) {
        await this.redirectToAfterSignUp({ replace: true });
        return true;
      } else {
        await this.redirectToAfterSignIn({ replace: true });
        return true;
      }
    }
    return false;
  }

  protected async _signOut(session: InternalSession, options?: { redirectUrl?: URL | string }): Promise<void> {
    await storeLock.withWriteLock(async () => {
      await this._interface.signOut(session);
      if (options?.redirectUrl) {
        await this._redirectTo({ url: options.redirectUrl, replace: true });
      } else {
        await this.redirectToAfterSignOut();
      }
    });
  }

  async signOut(options?: { redirectUrl?: URL | string }): Promise<void> {
    const user = await this.getUser();
    if (user) {
      await user.signOut(options);
    }
  }

  async getProject(): Promise<Project> {
    const crud = Result.orThrow(await this._currentProjectCache.getOrWait([], "write-only"));
    return this._clientProjectFromCrud(crud);
  }

  // IF_PLATFORM react-like
  useProject(): Project {
    const crud = useAsyncCache(this._currentProjectCache, [], "useProject()");
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
    const projects = useAsyncCache(this._ownedProjectsCache, [session], "useOwnedProjects()");
    return useMemo(() => projects.map((j) => this._getOwnedAdminApp(j.id, session)._adminOwnedProjectFromCrud(
      j,
      () => this._refreshOwnedProjects(session),
    )), [projects]);
  }
  // END_PLATFORM
  protected async _createProject(session: InternalSession, newProject: AdminProjectUpdateOptions & { displayName: string }): Promise<AdminOwnedProject> {
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
    await this._currentUserCache.refresh([session]);
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

  static get [stackAppInternalsSymbol]() {
    return {
      fromClientJson: <HasTokenStore extends boolean, ProjectId extends string>(
        json: StackClientAppJson<HasTokenStore, ProjectId>
      ): StackClientApp<HasTokenStore, ProjectId> => {
        const providedCheckString = JSON.stringify(omit(json, [/* none currently */]));
        const existing = allClientApps.get(json.uniqueIdentifier);
        if (existing) {
          const [existingCheckString, clientApp] = existing;
          if (existingCheckString !== providedCheckString) {
            throw new StackAssertionError("The provided app JSON does not match the configuration of the existing client app with the same unique identifier", { providedObj: json, existingString: existingCheckString });
          }
          return clientApp as any;
        }

        return new _StackClientAppImplIncomplete<HasTokenStore, ProjectId>({
          ...json,
          checkString: providedCheckString,
        });
      }
    };
  }

  get [stackAppInternalsSymbol]() {
    return {
      toClientJson: (): StackClientAppJson<HasTokenStore, ProjectId> => {
        if (!("publishableClientKey" in this._interface.options)) {
          // TODO find a way to do this
          throw new StackAssertionError("Cannot serialize to JSON from an application without a publishable client key");
        }

        if (typeof this._redirectMethod !== "string") {
          throw new StackAssertionError("Cannot serialize to JSON from an application with a non-string redirect method");
        }

        return {
          baseUrl: this._options.baseUrl,
          projectId: this.projectId,
          publishableClientKey: this._interface.options.publishableClientKey,
          tokenStore: this._tokenStoreInit,
          urls: this._urlOptions,
          oauthScopesOnSignIn: this._oauthScopesOnSignIn,
          uniqueIdentifier: this._getUniqueIdentifier(),
          redirectMethod: this._redirectMethod,
        };
      },
      setCurrentUser: (userJsonPromise: Promise<CurrentUserCrud['Client']['Read'] | null>) => {
        runAsynchronously(async () => {
          await this._currentUserCache.forceSetCachedValueAsync([await this._getSession()], Result.fromPromise(userJsonPromise));
        });
      },
      sendRequest: async (
        path: string,
        requestOptions: RequestInit,
        requestType: "client" | "server" | "admin" = "client",
      ) => {
        return await this._interface.sendClientRequest(path, requestOptions, await this._getSession(), requestType);
      },
    };
  };
}
