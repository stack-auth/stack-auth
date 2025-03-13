import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { AsyncCache } from "@stackframe/stack-shared/dist/utils/caches";
import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, concatStacktraces, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { ReactPromise } from "@stackframe/stack-shared/dist/utils/promises";
import { suspendIfSsr } from "@stackframe/stack-shared/dist/utils/react";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Store } from "@stackframe/stack-shared/dist/utils/stores";
import React, { useCallback } from "react"; // THIS_LINE_PLATFORM react-like
import { HandlerUrls } from "../../common";

// hack to make sure process is defined in non-node environments
const process = (globalThis as any).process ?? { env: {} }; // THIS_LINE_PLATFORM js react

export const clientVersion = "STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL";
if (clientVersion.startsWith("STACK_COMPILE_TIME")) {
  throw new StackAssertionError("Client version was not replaced. Something went wrong during build!");
}


export const createCache = <D extends any[], T>(fetcher: (dependencies: D) => Promise<T>) => {
  return new AsyncCache<D, Result<T>>(
    async (dependencies) => await Result.fromThrowingAsync(async () => await fetcher(dependencies)),
    {},
  );
};

export const createCacheBySession = <D extends any[], T>(fetcher: (session: InternalSession, extraDependencies: D) => Promise<T> ) => {
  return new AsyncCache<[InternalSession, ...D], Result<T>>(
    async ([session, ...extraDependencies]) => await Result.fromThrowingAsync(async () => await fetcher(session, extraDependencies)),
    {
      onSubscribe: ([session], refresh) => {
        const handler = session.onInvalidate(() => refresh());
        return () => handler.unsubscribe();
      },
    },
  );
};

export function getUrls(partial: Partial<HandlerUrls>): HandlerUrls {
  const handler = partial.handler ?? "/handler";
  const home = partial.home ?? "/";
  const afterSignIn = partial.afterSignIn ?? home;
  return {
    handler,
    signIn: `${handler}/sign-in`,
    afterSignIn: home,
    signUp: `${handler}/sign-up`,
    afterSignUp: afterSignIn,
    signOut: `${handler}/sign-out`,
    afterSignOut: home,
    emailVerification: `${handler}/email-verification`,
    passwordReset: `${handler}/password-reset`,
    forgotPassword: `${handler}/forgot-password`,
    oauthCallback: `${handler}/oauth-callback`,
    magicLinkCallback: `${handler}/magic-link-callback`,
    home: home,
    accountSettings: `${handler}/account-settings`,
    error: `${handler}/error`,
    teamInvitation: `${handler}/team-invitation`,
    ...filterUndefined(partial),
  };
}

export function getDefaultProjectId() {
  return process.env.NEXT_PUBLIC_STACK_PROJECT_ID || throwErr(new Error("Welcome to Stack Auth! It seems that you haven't provided a project ID. Please create a project on the Stack dashboard at https://app.stack-auth.com and put it in the NEXT_PUBLIC_STACK_PROJECT_ID environment variable."));
}

export function getDefaultPublishableClientKey() {
  return process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || throwErr(new Error("Welcome to Stack Auth! It seems that you haven't provided a publishable client key. Please create an API key for your project on the Stack dashboard at https://app.stack-auth.com and copy your publishable client key into the NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY environment variable."));
}

export function getDefaultSecretServerKey() {
  return process.env.STACK_SECRET_SERVER_KEY || throwErr(new Error("No secret server key provided. Please copy your key from the Stack dashboard and put it in the STACK_SECRET_SERVER_KEY environment variable."));
}

export function getDefaultSuperSecretAdminKey() {
  return process.env.STACK_SUPER_SECRET_ADMIN_KEY || throwErr(new Error("No super secret admin key provided. Please copy your key from the Stack dashboard and put it in the STACK_SUPER_SECRET_ADMIN_KEY environment variable."));
}

/**
 * Returns the base URL for the Stack API.
 *
 * The URL can be specified in several ways, in order of precedence:
 * 1. Directly through userSpecifiedBaseUrl parameter as string or browser/server object
 * 2. Through environment variables:
 *    - Browser: NEXT_PUBLIC_BROWSER_STACK_API_URL
 *    - Server: NEXT_PUBLIC_SERVER_STACK_API_URL
 *    - Fallback: NEXT_PUBLIC_STACK_API_URL or NEXT_PUBLIC_STACK_URL
 * 3. Default base URL if none of the above are specified
 *
 * The function also ensures the URL doesn't end with a trailing slash
 * by removing it if present.
 *
 * @param userSpecifiedBaseUrl - Optional URL override as string or {browser, server} object
 * @returns The configured base URL without trailing slash

 */
export function getBaseUrl(userSpecifiedBaseUrl: string | { browser: string, server: string } | undefined) {
  let url;
  if (userSpecifiedBaseUrl) {
    if (typeof userSpecifiedBaseUrl === "string") {
      url = userSpecifiedBaseUrl;
    } else {
      if (isBrowserLike()) {
        url = userSpecifiedBaseUrl.browser;
      } else {
        url = userSpecifiedBaseUrl.server;
      }
    }
  } else {
    if (isBrowserLike()) {
      url = process.env.NEXT_PUBLIC_BROWSER_STACK_API_URL;
    } else {
      url = process.env.NEXT_PUBLIC_SERVER_STACK_API_URL;
    }
    url = url || process.env.NEXT_PUBLIC_STACK_API_URL || process.env.NEXT_PUBLIC_STACK_URL || defaultBaseUrl;
  }

  return url.endsWith('/') ? url.slice(0, -1) : url;
}
const defaultBaseUrl = "https://api.stack-auth.com";

export type TokenObject = {
  accessToken: string | null,
  refreshToken: string | null,
};

export function createEmptyTokenStore() {
  return new Store<TokenObject>({
    refreshToken: null,
    accessToken: null,
  });
}


// IF_PLATFORM react-like
const cachePromiseByComponentId = new Map<string, ReactPromise<Result<unknown>>>();
export function useAsyncCache<D extends any[], T>(cache: AsyncCache<D, Result<T>>, dependencies: D, caller: string): T {
  // we explicitly don't want to run this hook in SSR
  suspendIfSsr(caller);

  const id = React.useId();

  const subscribe = useCallback((cb: () => void) => {
    const { unsubscribe } = cache.onStateChange(dependencies, () => {
      cachePromiseByComponentId.delete(id);
      cb();
    });
    return unsubscribe;
  }, [cache, ...dependencies]);
  const getSnapshot = useCallback(() => {
    // React checks whether a promise passed to `use` is still the same as the previous one by comparing the reference.
    // If we didn't cache here, this wouldn't work because the promise would be recreated every time the value changes.
    if (!cachePromiseByComponentId.has(id)) {
      cachePromiseByComponentId.set(id, cache.getOrWait(dependencies, "read-write"));
    }
    return cachePromiseByComponentId.get(id) as ReactPromise<Result<T>>;
  }, [cache, ...dependencies]);

  // note: we must use React.useSyncExternalStore instead of importing the function directly, as it will otherwise
  // throw an error ("can't import useSyncExternalStore from the server")
  const promise = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => throwErr(new Error("getServerSnapshot should never be called in useAsyncCache because we restrict to CSR earlier"))
  );

  const result = React.use(promise);
  if (result.status === "error") {
    const error = result.error;
    if (error instanceof Error && !(error as any).__stackHasConcatenatedStacktraces) {
      concatStacktraces(error, new Error());
      (error as any).__stackHasConcatenatedStacktraces = true;
    }
    throw error;
  }
  return result.data;
}
// END_PLATFORM
