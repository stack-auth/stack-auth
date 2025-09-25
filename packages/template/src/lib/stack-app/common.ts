import { ProviderType } from "@stackframe/stack-shared/dist/utils/oauth";
import type { GenericQueryCtx, UserIdentity } from "convex/server";

export type RedirectToOptions = {
  replace?: boolean,
  noRedirectBack?: boolean,
};

export type AsyncStoreProperty<Name extends string, Args extends any[], Value, IsMultiple extends boolean> =
  & { [key in `${IsMultiple extends true ? "list" : "get"}${Capitalize<Name>}`]: (...args: Args) => Promise<Value> }
  & { [key in `use${Capitalize<Name>}`]: (...args: Args) => Value } // THIS_LINE_PLATFORM react-like

export type EmailConfig = {
  host: string,
  port: number,
  username: string,
  password: string,
  senderEmail: string,
  senderName: string,
}

export type RedirectMethod = "window"
  | "nextjs" // THIS_LINE_PLATFORM next
  | "none"
  | {
    useNavigate: () => (to: string) => void,
    navigate?: (to: string) => void,
  }


export type GetCurrentUserOptions<HasTokenStore> =
  & {
    or?: 'redirect' | 'throw' | 'return-null' | 'anonymous' | /** @deprecated */ 'anonymous-if-exists[deprecated]',
    tokenStore?: TokenStoreInit,
  }
  & (HasTokenStore extends false ? {
    tokenStore: TokenStoreInit,
  } : {});

export type ConvexCtx =
| GenericQueryCtx<any>
| { auth: { getUserIdentity: () => Promise<UserIdentity | null> } };

export type GetCurrentPartialUserOptions<HasTokenStore> =
  & {
    or?: 'return-null' | 'anonymous',  // note: unlike normal getUser, 'anonymous' still returns null sometimes (eg. if no token is present)
    tokenStore?: TokenStoreInit,
  }
  & (
    | {
      from: 'token',
    }
    | {
      from: 'convex',
      ctx: ConvexCtx,
    }
  )
  & (HasTokenStore extends false ? {
    tokenStore: TokenStoreInit,
  } : {});

export type RequestLike = {
  headers: {
    get: (name: string) => string | null,
  },
};

export type TokenStoreInit<HasTokenStore extends boolean = boolean> =
  HasTokenStore extends true ? (
    | "cookie"
    | "nextjs-cookie"
    | "memory"
    | RequestLike
    | { accessToken: string, refreshToken: string }
  )
  : HasTokenStore extends false ? null
  : TokenStoreInit<true> | TokenStoreInit<false>;

export type HandlerUrls = {
  handler: string,
  signIn: string,
  signUp: string,
  afterSignIn: string,
  afterSignUp: string,
  signOut: string,
  afterSignOut: string,
  emailVerification: string,
  passwordReset: string,
  forgotPassword: string,
  home: string,
  oauthCallback: string,
  magicLinkCallback: string,
  accountSettings: string,
  teamInvitation: string,
  mfa: string,
  error: string,
}

export type OAuthScopesOnSignIn = {
  [key in ProviderType]: string[];
};

/** @internal */
export const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");
