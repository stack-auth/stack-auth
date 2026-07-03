import { KnownErrors } from "@hexclave/shared";
import { Result } from "@hexclave/shared/dist/utils/results";
import type { GenericQueryCtx } from "convex/server";
import { AsyncStoreProperty, GetCurrentPartialUserOptions, GetCurrentUserOptions, RequestLike } from "../../common";
import { CustomerProductsList, CustomerProductsRequestOptions, InlineProduct, ServerItem } from "../../customers";
import { DataVaultStore } from "../../data-vault";
import { EmailDeliveryInfo, SendEmailOptions } from "../../email";
import { ServerListTeamsOptions, ServerListUsersOptions, ServerTeam, ServerTeamCreateOptions } from "../../teams";
import { ProjectCurrentServerUser, ServerOAuthProvider, ServerUser, ServerUserCreateOptions, SyncedPartialServerUser, TokenPartialUser } from "../../users";
import { _HexclaveServerAppImpl } from "../implementations";
import type { Span, StartSpanOptions, TrackOptions } from "../implementations/event-tracker";
import { StackClientApp, StackClientAppConstructorOptions } from "./client-app";


/** @deprecated Use `HexclaveServerAppConstructorOptions` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackServerAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppConstructorOptions<HasTokenStore, ProjectId> & {
  secretServerKey?: string,
};

/** @deprecated Use `HexclaveServerApp` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackServerApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = (
  & {
    createTeam(data: ServerTeamCreateOptions): Promise<ServerTeam>,
    /**
     * @deprecated use `getUser()` instead
     */
    getServerUser(): Promise<ProjectCurrentServerUser<ProjectId> | null>,

    createUser(options: ServerUserCreateOptions): Promise<ServerUser>,
    grantProduct(options: (
      ({ userId: string } | { teamId: string } | { customCustomerId: string }) &
      ({ productId: string } | { product: InlineProduct }) &
      { quantity?: number }
    )): Promise<void>,
    createCheckoutUrl(options: (
      ({ userId: string } | { teamId: string } | { customCustomerId: string }) &
      ({ productId: string } | { product: InlineProduct }) &
      { returnUrl?: string }
    )): Promise<string>,

    /**
     * Server-side variant of `trackEvent`: attribution is explicit via `userId`
     * (there is no session to derive it from). Items coalesce per userId and
     * send on the next microtask; `await` the promise (or call `flush()`) as the
     * delivery guarantee — the server has no page-lifetime flush cadence.
     *
     * Pass `request` (the incoming Request) to auto-attribute to the caller AND
     * parent the event under their client session — the `$refresh-token` /
     * `$session-replay` / `$session-replay-segment` chain — resolved from the
     * session + the `x-hexclave-span-context` header the browser SDK attaches
     * automatically. With `request`, `userId` is derived from the session unless
     * explicitly overridden.
     */
    trackEvent(eventType: string, data?: Record<string, unknown>, options?: TrackOptions & { userId?: string, request?: RequestLike }): Promise<void>,

    /**
     * Server-side variant of `startSpan`: attribution is explicit via `userId`.
     * Child spans and span-attached events inherit the span's userId. To link a
     * span to the caller's client session, use `withSpan(type, { request }, fn)` —
     * `startSpan` is synchronous and cannot resolve a request.
     */
    startSpan(spanType: string, options?: StartSpanOptions & { userId?: string }): Span,

    /**
     * Server-side variant of `withSpan`: accepts `userId` in options; ambient
     * parenting is AsyncLocalStorage-backed, so concurrent requests sharing one
     * app instance never cross-parent.
     *
     * Pass `request` to auto-parent the span (and everything created inside the
     * callback) under the caller's client session, resolved from the session + the
     * `x-hexclave-span-context` header. This is the primitive the framework
     * adapters build on — with an adapter you never pass `request` yourself.
     */
    withSpan<T>(spanType: string, fn: (span: Span) => Promise<T> | T): Promise<T>,
    withSpan<T>(spanType: string, options: StartSpanOptions & { userId?: string, request?: RequestLike }, fn: (span: Span) => Promise<T> | T): Promise<T>,

    // IF_PLATFORM react-like
    useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'redirect' }): ProjectCurrentServerUser<ProjectId>,
    useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'throw' }): ProjectCurrentServerUser<ProjectId>,
    useUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'anonymous' }): ProjectCurrentServerUser<ProjectId>,
    useUser(options?: GetCurrentUserOptions<HasTokenStore>): ProjectCurrentServerUser<ProjectId> | null,
    useUser(id: string): ServerUser | null,
    useUser(options: { apiKey: string, or?: "return-null" | "anonymous" }): ServerUser | null,
    useUser(options: { from: "convex", ctx: GenericQueryCtx<any>, or?: "return-null" | "anonymous" }): ServerUser | null,
    // END_PLATFORM

    getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'redirect' }): Promise<ProjectCurrentServerUser<ProjectId>>,
    getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'throw' }): Promise<ProjectCurrentServerUser<ProjectId>>,
    getUser(options: GetCurrentUserOptions<HasTokenStore> & { or: 'anonymous' }): Promise<ProjectCurrentServerUser<ProjectId>>,
    getUser(options?: GetCurrentUserOptions<HasTokenStore>): Promise<ProjectCurrentServerUser<ProjectId> | null>,
    getUser(id: string): Promise<ServerUser | null>,
    getUser(options: { apiKey: string, or?: "return-null" | "anonymous" }): Promise<ServerUser | null>,
    getUser(options: { from: "convex", ctx: GenericQueryCtx<any>, or?: "return-null" | "anonymous" }): Promise<ServerUser | null>,

    // note: we don't special-case 'anonymous' here to return non-null, see GetPartialUserOptions for more details
    getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'token' }): Promise<TokenPartialUser | null>,
    getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'convex' }): Promise<TokenPartialUser | null>,
    getPartialUser(options: GetCurrentPartialUserOptions<HasTokenStore>): Promise<SyncedPartialServerUser | TokenPartialUser | null>,
    // IF_PLATFORM react-like
    usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'token' }): TokenPartialUser | null,
    usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore> & { from: 'convex' }): TokenPartialUser | null,
    usePartialUser(options: GetCurrentPartialUserOptions<HasTokenStore>): SyncedPartialServerUser | TokenPartialUser | null,
    // END_PLATFORM
    // IF_PLATFORM react-like
    useTeam(id: string): ServerTeam | null,
    useTeam(options: { apiKey: string }): ServerTeam | null,
    // END_PLATFORM
    getTeam(id: string): Promise<ServerTeam | null>,
    getTeam(options: { apiKey: string }): Promise<ServerTeam | null>,


    useUsers(options?: ServerListUsersOptions): ServerUser[] & { nextCursor: string | null }, // THIS_LINE_PLATFORM react-like
    listUsers(options?: ServerListUsersOptions): Promise<ServerUser[] & { nextCursor: string | null }>,

    /**
     * Returns every direct (or recursive) team permission grant for every
     * member of the given team in one request. Use this instead of calling
     * `user.listPermissions(team)` per row when rendering a roster — that
     * pattern produces an N+1 over the team-member endpoint.
     */
    listTeamMemberPermissions(teamId: string, options?: { recursive?: boolean }): Promise<{ userId: string, permissionId: string }[]>,
    // IF_PLATFORM react-like
    useTeamMemberPermissions(teamId: string, options?: { recursive?: boolean }): { userId: string, permissionId: string }[],
    // END_PLATFORM

    // TODO this should actually be on ServerUser
    createOAuthProvider(options: {
      userId: string,
      accountId: string,
      providerConfigId: string,
      email: string,
      allowSignIn: boolean,
      allowConnectedAccounts: boolean,
    }): Promise<Result<ServerOAuthProvider, InstanceType<typeof KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn>>>,

    sendEmail(options: SendEmailOptions): Promise<void>,

    getEmailDeliveryStats(): Promise<EmailDeliveryInfo>,
    // IF_PLATFORM react-like
    useEmailDeliveryStats(): EmailDeliveryInfo,
    // END_PLATFORM

    activateEmailCapacityBoost(): Promise<void>,
  }
  & AsyncStoreProperty<"user", [id: string], ServerUser | null, false>
  & Omit<AsyncStoreProperty<"users", [], ServerUser[], true>, "listUsers" | "useUsers">
  & AsyncStoreProperty<"teams", [options?: ServerListTeamsOptions], ServerTeam[] & { nextCursor: string | null }, true>
  & AsyncStoreProperty<"dataVaultStore", [id: string], DataVaultStore, false>
  & AsyncStoreProperty<
    "item",
    [{ itemId: string, userId: string } | { itemId: string, teamId: string } | { itemId: string, customCustomerId: string }],
    ServerItem,
    false
  >
  & AsyncStoreProperty<
    "products",
    [options: CustomerProductsRequestOptions],
    CustomerProductsList,
    true
  >
  & StackClientApp<HasTokenStore, ProjectId>
);
/** @deprecated Use `HexclaveServerAppConstructor` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackServerAppConstructor = {
  new <
    TokenStoreType extends string,
    HasTokenStore extends (TokenStoreType extends {} ? true : boolean),
    ProjectId extends string
  >(options: StackServerAppConstructorOptions<HasTokenStore, ProjectId>): StackServerApp<HasTokenStore, ProjectId>,
  new (options: StackServerAppConstructorOptions<boolean, string>): StackServerApp<boolean, string>,
};
export type HexclaveServerAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = StackServerAppConstructorOptions<HasTokenStore, ProjectId>;
export type HexclaveServerApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = StackServerApp<HasTokenStore, ProjectId>;
export type HexclaveServerAppConstructor = StackServerAppConstructor;
export const HexclaveServerApp: HexclaveServerAppConstructor = _HexclaveServerAppImpl;
/** @deprecated Use `HexclaveServerApp` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export const StackServerApp: StackServerAppConstructor = HexclaveServerApp;
