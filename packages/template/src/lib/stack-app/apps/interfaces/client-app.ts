import { KnownErrors } from "@stackframe/stack-shared";
import { CurrentUserCrud } from "@stackframe/stack-shared/dist/interface/crud/current-user";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { AsyncStoreProperty, GetUserOptions, HandlerUrls, OAuthScopesOnSignIn, RedirectMethod, RedirectToOptions, TokenStoreInit, stackAppInternalsSymbol } from "../../common";
import { Project } from "../../projects";
import { ProjectCurrentUser } from "../../users";
import { _StackClientAppImpl } from "../implementations";


export type StackClientAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = {
  baseUrl?: string | { browser: string, server: string },
  extraRequestHeaders?: Record<string, string>,
  projectId?: ProjectId,
  publishableClientKey?: string,
  urls?: Partial<HandlerUrls>,
  oauthScopesOnSignIn?: Partial<OAuthScopesOnSignIn>,
  tokenStore: TokenStoreInit<HasTokenStore>,
  redirectMethod?: RedirectMethod,

  /**
   * By default, the Stack app will automatically prefetch some data from Stack's server when this app is first
   * constructed. This improves the performance of your app, but will create network requests that are unnecessary if
   * the app is never used or disposed of immediately. To disable this behavior, set this option to true.
   */
  noAutomaticPrefetch?: boolean,
};


export type StackClientAppJson<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppConstructorOptions<HasTokenStore, ProjectId> & {
  uniqueIdentifier: string,
  // note: if you add more fields here, make sure to ensure the checkString in the constructor has/doesn't have them
};

export type StackClientApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = (
  & {
    readonly projectId: ProjectId,

    readonly urls: Readonly<HandlerUrls>,

    signInWithOAuth(provider: string): Promise<void>,
    signInWithCredential(options: { email: string, password: string, noRedirect?: boolean }): Promise<Result<undefined, KnownErrors["EmailPasswordMismatch"] | KnownErrors["InvalidTotpCode"]>>,
    signUpWithCredential(options: { email: string, password: string, noRedirect?: boolean, verificationCallbackUrl?: string }): Promise<Result<undefined, KnownErrors["UserWithEmailAlreadyExists"] | KnownErrors["PasswordRequirementsNotMet"]>>,
    signInWithPasskey(): Promise<Result<undefined, KnownErrors["PasskeyAuthenticationFailed"]| KnownErrors["InvalidTotpCode"] | KnownErrors["PasskeyWebAuthnError"]>>,
    callOAuthCallback(): Promise<boolean>,
    promptCliLogin(options: { appUrl: string, expiresInMillis?: number }): Promise<Result<string, KnownErrors["CliAuthError"] | KnownErrors["CliAuthExpiredError"] | KnownErrors["CliAuthUsedError"]>>,
    sendForgotPasswordEmail(email: string, options?: { callbackUrl?: string }): Promise<Result<undefined, KnownErrors["UserNotFound"]>>,
    sendMagicLinkEmail(email: string, options?: { callbackUrl?: string }): Promise<Result<{ nonce: string }, KnownErrors["RedirectUrlNotWhitelisted"]>>,
    resetPassword(options: { code: string, password: string }): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>,
    verifyPasswordResetCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>,
    verifyTeamInvitationCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>,
    acceptTeamInvitation(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>,
    getTeamInvitationDetails(code: string): Promise<Result<{ teamDisplayName: string }, KnownErrors["VerificationCodeError"]>>,
    verifyEmail(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>,
    signInWithMagicLink(code: string, options?: { noRedirect?: boolean }): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["InvalidTotpCode"]>>,

    redirectToOAuthCallback(): Promise<void>,

    // IF_PLATFORM react-like
    useUser(options: GetUserOptions<HasTokenStore> & { or: 'redirect' }): ProjectCurrentUser<ProjectId>,
    useUser(options: GetUserOptions<HasTokenStore> & { or: 'throw' }): ProjectCurrentUser<ProjectId>,
    useUser(options: GetUserOptions<HasTokenStore> & { or: 'anonymous' }): ProjectCurrentUser<ProjectId>,
    useUser(options?: GetUserOptions<HasTokenStore>): ProjectCurrentUser<ProjectId> | null,
    // END_PLATFORM

    getUser(options: GetUserOptions<HasTokenStore> & { or: 'redirect' }): Promise<ProjectCurrentUser<ProjectId>>,
    getUser(options: GetUserOptions<HasTokenStore> & { or: 'throw' }): Promise<ProjectCurrentUser<ProjectId>>,
    getUser(options: GetUserOptions<HasTokenStore> & { or: 'anonymous' }): Promise<ProjectCurrentUser<ProjectId>>,
    getUser(options?: GetUserOptions<HasTokenStore>): Promise<ProjectCurrentUser<ProjectId> | null>,

    useNavigate(): (to: string) => void, // THIS_LINE_PLATFORM react-like

    [stackAppInternalsSymbol]: {
      toClientJson(): StackClientAppJson<HasTokenStore, ProjectId>,
      setCurrentUser(userJsonPromise: Promise<CurrentUserCrud['Client']['Read'] | null>): void,
    },
  }
  & AsyncStoreProperty<"project", [], Project, false>
  & { [K in `redirectTo${Capitalize<keyof Omit<HandlerUrls, 'handler' | 'oauthCallback'>>}`]: (options?: RedirectToOptions) => Promise<void> }
);
export type StackClientAppConstructor = {
  new <
    TokenStoreType extends string,
    HasTokenStore extends (TokenStoreType extends {} ? true : boolean),
    ProjectId extends string
  >(options: StackClientAppConstructorOptions<HasTokenStore, ProjectId>): StackClientApp<HasTokenStore, ProjectId>,
  new (options: StackClientAppConstructorOptions<boolean, string>): StackClientApp<boolean, string>,

  [stackAppInternalsSymbol]: {
    fromClientJson<HasTokenStore extends boolean, ProjectId extends string>(
      json: StackClientAppJson<HasTokenStore, ProjectId>
    ): StackClientApp<HasTokenStore, ProjectId>,
  },
};
export const StackClientApp: StackClientAppConstructor = _StackClientAppImpl;
