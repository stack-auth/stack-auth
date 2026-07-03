import { KnownErrors } from "@hexclave/shared";
import { CurrentUserCrud } from "@hexclave/shared/dist/interface/crud/current-user";
import { Result } from "@hexclave/shared/dist/utils/results";
import { AsyncStoreProperty, AuthLike, GetCurrentPartialUserOptions, GetCurrentUserOptions, HandlerUrlOptions, HandlerUrls, OAuthScopesOnSignIn, RedirectMethod, RedirectToOptions, ResolvedHandlerUrls, hexclaveAppInternalsSymbol, TokenStoreInit } from "../../common";
import type { RequestListener } from "@hexclave/shared/dist/interface/client-interface";
import { CustomerInvoicesList, CustomerInvoicesRequestOptions, CustomerProductsList, CustomerProductsRequestOptions, Item } from "../../customers";
import { Project } from "../../projects";
import { ProjectCurrentUser, SyncedPartialUser, TokenPartialUser } from "../../users";
import { _HexclaveClientAppImpl } from "../implementations";
import type { ParentRef, Span, StartSpanOptions, TrackOptions } from "../implementations/event-tracker";
import { AnalyticsOptions } from "../implementations/session-replay";

/** @deprecated Use `HexclaveClientAppConstructorOptions` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackClientAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = {
  baseUrl?: string | { browser: string, server: string },
  extraRequestHeaders?: Record<string, string>,
  projectId?: ProjectId,
  publishableClientKey?: string,
  urls?: HandlerUrlOptions,
  oauthScopesOnSignIn?: Partial<OAuthScopesOnSignIn>,
  tokenStore?: TokenStoreInit<HasTokenStore>,
  redirectMethod?: RedirectMethod,
  inheritsFrom?: StackClientApp<any, any>,

  /**
   * Whether to show the Hexclave dev tool indicator in browser-like environments.
   *
   * - `true`: always show
   * - `false`: never show
   * - `"auto"` (default): show based on NODE_ENV or origin heuristics
   */
  devTool?: boolean | "auto",

  /**
   * By default, the Stack app will automatically prefetch some data from Stack's server when this app is first
   * constructed. This improves the performance of your app, but will create network requests that are unnecessary if
   * the app is never used or disposed of immediately. To disable this behavior, set this option to true.
   */
  noAutomaticPrefetch?: boolean,

  /**
   * Options for analytics and session recording. Replays are enabled by default;
   * set `{ replays: { enabled: false } }` to opt out.
   */
  analytics?: AnalyticsOptions,
} & (
  { tokenStore: TokenStoreInit<HasTokenStore> } | { tokenStore?: undefined, inheritsFrom: StackClientApp<HasTokenStore, any> }
) & (
  string extends ProjectId ? unknown : ({ projectId: ProjectId } | { inheritsFrom: StackClientApp<any, ProjectId> })
);


/** @deprecated Use `HexclaveClientAppJson` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackClientAppJson<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppConstructorOptions<HasTokenStore, ProjectId> & { inheritsFrom?: undefined } & {
  uniqueIdentifier: string,
  // note: if you add more fields here, make sure to ensure the checkString in the constructor has/doesn't have them
};

/** @deprecated Use `HexclaveClientApp` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackClientApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = (
  & {
    readonly projectId: ProjectId,

    /**
     * The version of the Hexclave SDK.
     */
    readonly version: string,

    /**
     * @deprecated Do not use `app.urls` for navigation. It is static and does not include runtime redirect-back,
     * cross-domain auth, or sign-out state. Use the matching `redirectToXyz()` method instead, for example
     * `redirectToSignIn()`, `redirectToSignUp()`, `redirectToSignOut()`, or `redirectToAccountSettings()`.
     */
    readonly urls: Readonly<ResolvedHandlerUrls>,

    signInWithOAuth(provider: string, options?: { returnTo?: string }): Promise<void>,
    signInWithCredential(options: { email: string, password: string, noRedirect?: boolean }): Promise<Result<undefined, KnownErrors["EmailPasswordMismatch"] | KnownErrors["InvalidTotpCode"]>>,
    signUpWithCredential(options: {
      email: string,
      password: string,
      noRedirect?: boolean,
    } & ({ noVerificationCallback: true } | { noVerificationCallback?: false, verificationCallbackUrl?: string })): Promise<Result<undefined, KnownErrors["UserWithEmailAlreadyExists"] | KnownErrors["PasswordRequirementsNotMet"] | KnownErrors["BotChallengeFailed"]>>,
    signInWithPasskey(): Promise<Result<undefined, KnownErrors["PasskeyAuthenticationFailed"] | KnownErrors["InvalidTotpCode"] | KnownErrors["PasskeyWebAuthnError"]>>,
    callOAuthCallback(): Promise<boolean>,
    promptCliLogin(options: { appUrl: string, expiresInMillis?: number, anonRefreshToken?: string, promptLink?: (url: string, loginCode: string) => void }): Promise<Result<string, KnownErrors["CliAuthError"] | KnownErrors["CliAuthExpiredError"] | KnownErrors["CliAuthUsedError"]>>,
    sendForgotPasswordEmail(email: string, options?: { callbackUrl?: string }): Promise<Result<undefined, KnownErrors["UserNotFound"]>>,
    sendMagicLinkEmail(email: string, options?: { callbackUrl?: string }): Promise<Result<{ nonce: string }, KnownErrors["RedirectUrlNotWhitelisted"] | KnownErrors["BotChallengeFailed"]>>,
    resetPassword(options: { code: string, password: string }): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>,
    verifyPasswordResetCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>,
    verifyTeamInvitationCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["TeamInvitationEmailMismatch"]>>,
    acceptTeamInvitation(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["TeamInvitationEmailMismatch"]>>,
    getTeamInvitationDetails(code: string): Promise<Result<{ teamDisplayName: string }, KnownErrors["VerificationCodeError"] | KnownErrors["TeamInvitationEmailMismatch"]>>,
    verifyEmail(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>,
    signInWithMagicLink(code: string, options?: { noRedirect?: boolean }): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["InvalidTotpCode"]>>,
    signInWithMfa(otp: string, code: string, options?: { noRedirect?: boolean }): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["InvalidTotpCode"]>>,

    redirectToOAuthCallback(): Promise<void>,

    getConvexClientAuth(options: HasTokenStore extends false ? { tokenStore: TokenStoreInit } : { tokenStore?: TokenStoreInit }): (args: { forceRefreshToken: boolean }) => Promise<string | null>,
    getConvexHttpClientAuth(options: { tokenStore: TokenStoreInit }): Promise<string>,

    // IF_PLATFORM react-like
    useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'redirect' }): ProjectCurrentUser<ProjectId>,
    useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'throw' }): ProjectCurrentUser<ProjectId>,
    useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'anonymous' }): ProjectCurrentUser<ProjectId>,
    useUser(options?: GetCurrentUserOptions<HasTokenStore>): ProjectCurrentUser<ProjectId> | null,
    // END_PLATFORM

    getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'redirect' }): Promise<ProjectCurrentUser<ProjectId>>,
    getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'throw' }): Promise<ProjectCurrentUser<ProjectId>>,
    getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'anonymous' }): Promise<ProjectCurrentUser<ProjectId>>,
    getUser(options?: GetCurrentUserOptions<HasTokenStore>): Promise<ProjectCurrentUser<ProjectId> | null>,

    cancelSubscription(options: { productId: string, subscriptionId?: string } | { productId: string, subscriptionId?: string, teamId: string }): Promise<void>,

    /**
     * Tracks a custom analytics event. Buffered and sent in batches. The
     * returned promise resolves when the batch carrying the event is
     * acknowledged (up to one flush interval later — call `flush()` to send
     * immediately) and is safe to ignore. Never throws; invalid input yields a
     * rejected (pre-caught) promise. No-ops outside the browser or when
     * analytics is disabled.
     */
    trackEvent(eventType: string, data?: Record<string, unknown>, options?: TrackOptions): Promise<void>,

    /**
     * Starts a custom span (a time interval). The span is written immediately
     * as an open interval and re-written when data changes or it ends — a span
     * that is never ended (e.g. the tab closed) stays visible as an open
     * interval. Never throws; returns an inert no-op span outside the browser,
     * when analytics is disabled, or on invalid input.
     */
    startSpan(spanType: string, options?: StartSpanOptions): Span,

    /**
     * Registers a span as an ambient parent for all subsequently tracked
     * custom events and spans (additive with explicit `parentIds`). Ending the
     * span automatically unregisters it.
     */
    setGlobalSpan(span: Span): void,
    unsetGlobalSpan(span: Span): void,

    /**
     * Sends all buffered analytics immediately and settles in-flight sends.
     */
    flush(): Promise<void>,

    /**
     * Runs `fn` inside a span: the span starts on entry, is an ambient parent
     * for everything created inside the callback, and ends automatically when
     * `fn` settles. On throw, `data.error` is recorded and the error is
     * rethrown — telemetry failures never affect `fn`'s result.
     *
     * Ambient extent follows `analytics.ambientParenting`. Under the default
     * (`"exact"`), ambient parenting covers the callback's full async extent on
     * runtimes with an exact async-context primitive (servers/edge today,
     * browsers once TC39 AsyncContext ships) and the callback's synchronous
     * window in browsers; after an `await` in a browser, parent via the handle
     * you already have — `span.trackEvent` / `span.withSpan` / `span.fetch` /
     * `span.run` — which is exact everywhere. `"best-effort"` keeps frames
     * ambient across browser `await`s (zero-glue), accepting that concurrently
     * interleaved flows can observe each other's frames. Opt out of ambient
     * parents per item with `root: true` or `excludeParentIds`.
     */
    withSpan<T>(spanType: string, fn: (span: Span) => Promise<T> | T): Promise<T>,
    withSpan<T>(spanType: string, options: StartSpanOptions, fn: (span: Span) => Promise<T> | T): Promise<T>,

    /**
     * The cross-tier span-propagation headers (`x-hexclave-span-context`) for a
     * request the SDK cannot attach them to itself — `fetch` to same-origin (and
     * `analytics.spanPropagation.targets`) already gets them automatically, so
     * this is the escape hatch for other transports (XHR, sendBeacon, WebSocket
     * handshakes) or manually-built requests. Carries the same ambient context an
     * event tracked right now would get: the per-tab replay segment, global spans,
     * and enclosing `withSpan()` frames — plus any explicit `parentIds`. Returns
     * `{}` when there is nothing to propagate (analytics off, non-browser).
     *
     * Setting this header on a `fetch` also overrides the automatic one, and
     * `root: true` drops the ambient parents (only explicit `parentIds` apply) —
     * together the precise-control path when overlapping async flows could mix
     * ambient frames (the documented browser sync-stack fallback):
     * `fetch(url, { headers: app.getSpanPropagationHeaders({ parentIds: [span], root: true }) })`.
     */
    getSpanPropagationHeaders(options?: { parentIds?: ParentRef[], root?: boolean }): Record<string, string>,

    // note: we don't special-case 'anonymous' here to return non-null, see GetPartialUserOptions for more details
    getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'token' }): Promise<TokenPartialUser | null>,
    getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'convex' }): Promise<TokenPartialUser | null>,
    getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore>): Promise<SyncedPartialUser | TokenPartialUser | null>,
    // IF_PLATFORM react-like
    usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'token' }): TokenPartialUser | null,
    usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'convex' }): TokenPartialUser | null,
    usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore>): SyncedPartialUser | TokenPartialUser | null,
    // END_PLATFORM
    useNavigate(): (to: string) => void, // THIS_LINE_PLATFORM react-like

    [hexclaveAppInternalsSymbol]: {
      toClientJson(): StackClientAppJson<HasTokenStore, ProjectId>,
      setCurrentUser(userJsonPromise: Promise<CurrentUserCrud['Client']['Read'] | null>): void,
      getConstructorOptions(): StackClientAppConstructorOptions<HasTokenStore, ProjectId> & { inheritsFrom?: undefined },
      sendSessionReplayBatch(body: string, options: { keepalive: boolean }): Promise<Result<Response, Error>>,
      sendAnalyticsEventBatch(body: string, options: { keepalive: boolean }): Promise<Result<Response, Error>>,
      addRequestListener(listener: RequestListener): () => void,
      sendRequest(path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin"): Promise<Response>,
      getUrls(): Readonly<ResolvedHandlerUrls>,
      getRedirectMethod(): RedirectMethod,
      redirectToUrl(url: string | URL, options?: { replace?: boolean }): Promise<void>,
      getRedirectToHandlerUrl(handlerName: keyof HandlerUrls, options?: RedirectToOptions): Promise<string>,
      redirectToHandler(handlerName: keyof HandlerUrls, options?: RedirectToOptions): Promise<void>,
      signInWithTokens(tokens: { accessToken: string, refreshToken: string }): Promise<void>,
      awaitPendingAuthResolutions(): Promise<void>,
    },
  }
  & AsyncStoreProperty<"project", [], Project, false>
  & AsyncStoreProperty<
    "item",
    [{ itemId: string, userId: string } | { itemId: string, teamId: string } | { itemId: string, customCustomerId: string }],
    Item,
    false
  >
  & AsyncStoreProperty<
    "products",
    [options: CustomerProductsRequestOptions],
    CustomerProductsList,
    true
  >
  & AsyncStoreProperty<
    "invoices",
    [options: CustomerInvoicesRequestOptions],
    CustomerInvoicesList,
    true
  >
  & { [K in `redirectTo${Capitalize<keyof Omit<HandlerUrls, 'handler' | 'oauthCallback'>>}`]: (options?: RedirectToOptions) => Promise<void> }
  & AuthLike<HasTokenStore extends false ? { tokenStore: TokenStoreInit } : { tokenStore?: TokenStoreInit }>
);
/** @deprecated Use `HexclaveClientAppConstructor` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackClientAppConstructor = {
  new <
    TokenStoreType extends string,
    HasTokenStore extends (TokenStoreType extends {} ? true : boolean),
    ProjectId extends string
  >(options: StackClientAppConstructorOptions<HasTokenStore, ProjectId>): StackClientApp<HasTokenStore, ProjectId>,
  new(options: StackClientAppConstructorOptions<boolean, string>): StackClientApp<boolean, string>,

  [hexclaveAppInternalsSymbol]: {
    fromClientJson<HasTokenStore extends boolean, ProjectId extends string>(
      json: StackClientAppJson<HasTokenStore, ProjectId>
    ): StackClientApp<HasTokenStore, ProjectId>,
  },
};
export type HexclaveClientAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppConstructorOptions<HasTokenStore, ProjectId>;
export type HexclaveClientAppJson<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppJson<HasTokenStore, ProjectId>;
export type HexclaveClientApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = StackClientApp<HasTokenStore, ProjectId>;
export type HexclaveClientAppConstructor = StackClientAppConstructor;
export const HexclaveClientApp: HexclaveClientAppConstructor = _HexclaveClientAppImpl;
/** @deprecated Use `HexclaveClientApp` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export const StackClientApp: StackClientAppConstructor = HexclaveClientApp;
