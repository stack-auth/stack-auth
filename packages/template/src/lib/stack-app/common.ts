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

/**
 * Contains the authentication methods without session-related fields.
 * Used for apps that have token storage capabilities.
 */
export type AuthLike<ExtraOptions = {}> = {
  signOut(options?: { redirectUrl?: URL | string } & ExtraOptions): Promise<void>,
  signOut(options?: { redirectUrl?: URL | string }): Promise<void>,

  /**
   * Returns the current access token, or null if the user is not signed in.
   *
   * The access token is a short-lived JWT that can be used to authenticate requests to external servers.
   * It will be automatically refreshed when it expires.
   */
  getAccessToken(options?: {} & ExtraOptions): Promise<string | null>,
  useAccessToken(options?: {} & ExtraOptions): string | null, // THIS_LINE_PLATFORM react-like

  /**
   * Returns the current refresh token, or null if the user is not signed in.
   *
   * The refresh token is a long-lived token that can be used to obtain new access tokens.
   * It should be kept secret and never exposed to the client.
   */
  getRefreshToken(options?: {} & ExtraOptions): Promise<string | null>,
  useRefreshToken(options?: {} & ExtraOptions): string | null, // THIS_LINE_PLATFORM react-like

  /**
   * Returns headers for sending authenticated HTTP requests to external servers. Most commonly used in cross-origin
   * requests. Similar to `getAuthJson`, but specifically for HTTP requests.
   *
   * If you are using `tokenStore: "cookie"`, you don't need this for same-origin requests. However, most
   * browsers now disable third-party cookies by default, so we must pass authentication tokens by header instead
   * if the client and server are on different origins.
   *
   * This function returns a header object that can be used with `fetch` or other HTTP request libraries to send
   * authenticated requests.
   *
   * On the server, you can then pass in the `Request` object to the `tokenStore` option
   * of your Stack app. Please note that CORS does not allow most headers by default, so you
   * must include `x-stack-auth` in the [`Access-Control-Allow-Headers` header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Headers)
   * of the CORS preflight response.
   *
   * If you are not using HTTP (and hence cannot set headers), you will need to use the `getAccessToken()` and
   * `getRefreshToken()` functions instead.
   *
   * Example:
   *
   * ```ts
   * // client
   * const res = await fetch("https://api.example.com", {
   *   headers: {
   *     ...await stackApp.getAuthHeaders()
   *     // you can also add your own headers here
   *   },
   * });
   *
   * // server
   * function handleRequest(req: Request) {
   *   const user = await stackServerApp.getUser({ tokenStore: req });
   *   return new Response("Welcome, " + user.displayName);
   * }
   * ```
   */
  getAuthHeaders(options?: {} & ExtraOptions): Promise<{ "x-stack-auth": string }>,
  useAuthHeaders(options?: {} & ExtraOptions): { "x-stack-auth": string }, // THIS_LINE_PLATFORM react-like

  /**
   * @deprecated Use `getAccessToken()` and `getRefreshToken()` instead.
   *
   * Creates a JSON-serializable object containing the information to authenticate a user on an external server.
   * Similar to `getAuthHeaders`, but returns an object that can be sent over any protocol instead of just
   * HTTP headers.
   *
   * While `getAuthHeaders` is the recommended way to send authentication tokens over HTTP, your app may use
   * a different protocol, for example WebSockets or gRPC. This function returns a token object that can be JSON-serialized and sent to the server in any way you like.
   *
   * On the server, you can pass in this token object into the `tokenStore` option to fetch user details.
   *
   * Example:
   *
   * ```ts
   * // client
   * const res = await rpcCall(rpcEndpoint, {
   *   data: {
   *     auth: await stackApp.getAuthJson(),
   *   },
   * });
   *
   * // server
   * function handleRequest(data) {
   *   const user = await stackServerApp.getUser({ tokenStore: data.auth });
   *   return new Response("Welcome, " + user.displayName);
   * }
   * ```
   */
  getAuthJson(options?: {} & ExtraOptions): Promise<{ accessToken: string | null, refreshToken: string | null }>,
  /** @deprecated Use `useAccessToken()` and `useRefreshToken()` instead. */
  useAuthJson(options?: {} & ExtraOptions): { accessToken: string | null, refreshToken: string | null }, // THIS_LINE_PLATFORM react-like
};

/** @internal */
export const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");
