import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { AsyncStoreProperty, GetUserOptions } from "../../common";
import { ServerItem } from "../../customers";
import { DataVaultStore } from "../../data-vault";
import { SendEmailOptions } from "../../email";
import { ServerListUsersOptions, ServerTeam, ServerTeamCreateOptions } from "../../teams";
import { ProjectCurrentServerUser, ServerOAuthProvider, ServerUser, ServerUserCreateOptions } from "../../users";
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
    useUser(options: GetUserOptions<HasTokenStore> & { or: 'redirect' }): ProjectCurrentServerUser<ProjectId>,
    useUser(options: GetUserOptions<HasTokenStore> & { or: 'throw' }): ProjectCurrentServerUser<ProjectId>,
    useUser(options: GetUserOptions<HasTokenStore> & { or: 'anonymous' }): ProjectCurrentServerUser<ProjectId>,
    useUser(options?: GetUserOptions<HasTokenStore>): ProjectCurrentServerUser<ProjectId> | null,
    useUser(id: string): ServerUser | null,
    useUser(options: { apiKey: string }): ServerUser | null,
    // END_PLATFORM

    getUser(options: GetUserOptions<HasTokenStore> & { or: 'redirect' }): Promise<ProjectCurrentServerUser<ProjectId>>,
    getUser(options: GetUserOptions<HasTokenStore> & { or: 'throw' }): Promise<ProjectCurrentServerUser<ProjectId>>,
    getUser(options: GetUserOptions<HasTokenStore> & { or: 'anonymous' }): Promise<ProjectCurrentServerUser<ProjectId>>,
    getUser(options?: GetUserOptions<HasTokenStore>): Promise<ProjectCurrentServerUser<ProjectId> | null>,
    getUser(id: string): Promise<ServerUser | null>,
    getUser(options: { apiKey: string }): Promise<ServerUser | null>,

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
