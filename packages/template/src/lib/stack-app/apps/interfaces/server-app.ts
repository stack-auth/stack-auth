import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import type { GenericQueryCtx } from "convex/server";
import { AsyncStoreProperty, GetCurrentPartialUserOptions, GetCurrentUserOptions } from "../../common";
import { ServerItem } from "../../customers";
import { DataVaultStore } from "../../data-vault";
import { SendEmailOptions } from "../../email";
import { ServerListUsersOptions, ServerTeam, ServerTeamCreateOptions } from "../../teams";
import { ProjectCurrentServerUser, ServerOAuthProvider, ServerUser, ServerUserCreateOptions, SyncedPartialServerUser, TokenPartialUser } from "../../users";
import { _StackServerAppImpl } from "../implementations";
import { StackClientApp, StackClientAppConstructorOptions } from "./client-app";


export type StackServerAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppConstructorOptions<HasTokenStore, ProjectId> & {
  secretServerKey?: string,
};

export type StackServerApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = (
  & {
    createTeam(data: ServerTeamCreateOptions): Promise<ServerTeam>,
    /**
     * @deprecated use `getUser()` instead
     */
    getServerUser(): Promise<ProjectCurrentServerUser<ProjectId> | null>,

    createUser(options: ServerUserCreateOptions): Promise<ServerUser>,

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

    createOAuthProvider(options: {
      userId: string,
      accountId: string,
      providerConfigId: string,
      email: string,
      allowSignIn: boolean,
      allowConnectedAccounts: boolean,
    }): Promise<Result<ServerOAuthProvider, InstanceType<typeof KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn>>>,

    sendEmail(options: SendEmailOptions): Promise<void>,
  }
  & AsyncStoreProperty<"user", [id: string], ServerUser | null, false>
  & Omit<AsyncStoreProperty<"users", [], ServerUser[], true>, "listUsers" | "useUsers">
  & AsyncStoreProperty<"teams", [], ServerTeam[], true>
  & AsyncStoreProperty<"dataVaultStore", [id: string], DataVaultStore, false>
  & AsyncStoreProperty<
    "item",
    [{ itemId: string, userId: string } | { itemId: string, teamId: string } | { itemId: string, customCustomerId: string }],
    ServerItem,
    false
  >
  & StackClientApp<HasTokenStore, ProjectId>
);
export type StackServerAppConstructor = {
  new <
    TokenStoreType extends string,
    HasTokenStore extends (TokenStoreType extends {} ? true : boolean),
    ProjectId extends string
  >(options: StackServerAppConstructorOptions<HasTokenStore, ProjectId>): StackServerApp<HasTokenStore, ProjectId>,
  new (options: StackServerAppConstructorOptions<boolean, string>): StackServerApp<boolean, string>,
};
export const StackServerApp: StackServerAppConstructor = _StackServerAppImpl;
