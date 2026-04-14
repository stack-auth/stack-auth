import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { AsyncCache } from "@stackframe/stack-shared/dist/utils/caches";
import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError, concatStacktraces, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createGlobal, getGlobal } from "@stackframe/stack-shared/dist/utils/globals";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { filterUndefined, omit } from "@stackframe/stack-shared/dist/utils/objects";
import { ReactPromise } from "@stackframe/stack-shared/dist/utils/promises";
import { suspendIfSsr, use } from "@stackframe/stack-shared/dist/utils/react";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Store } from "@stackframe/stack-shared/dist/utils/stores";
import { getDefaultApiUrls } from "@stackframe/stack-shared/dist/utils/urls";
import React, { useCallback } from "react"; // THIS_LINE_PLATFORM react-like
import { envVars } from "../../../env";
import { HandlerUrlOptions, ResolvedHandlerUrls, stackAppInternalsSymbol } from "../../common";
import { resolveHandlerUrls } from "../../url-targets";

export const clientVersion = "STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL";
if (clientVersion.startsWith("STACK_COMPILE_TIME")) {
  throw new StackAssertionError("Client version was not replaced. Something went wrong during build!");
}

const replaceStackPortPrefix = <T extends string | undefined>(input: T): T => {
  if (!input) return input;
  const prefix = envVars.NEXT_PUBLIC_STACK_PORT_PREFIX;
  return prefix ? input.replace(/\$\{NEXT_PUBLIC_STACK_PORT_PREFIX:-81\}/g, prefix) as T : input;
};


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


type AppLike = { [stackAppInternalsSymbol]: { getConstructorOptions: () => any } };
export function resolveConstructorOptions<T extends { inheritsFrom?: AppLike }>(options: T): T & { inheritsFrom?: undefined } {
  return {
    ...options.inheritsFrom?.[stackAppInternalsSymbol].getConstructorOptions() ?? {},
    ...filterUndefined(omit(options, ["inheritsFrom"])),
  };
}

export function getUrls(partial: HandlerUrlOptions, options: { projectId: string }): ResolvedHandlerUrls {
  return resolveHandlerUrls({
    urls: partial,
    projectId: options.projectId,
  });
}

export function getDefaultProjectId() {
  return envVars.NEXT_PUBLIC_STACK_PROJECT_ID || envVars.STACK_PROJECT_ID || throwErr(new Error("Welcome to Stack Auth! It seems that you haven't provided a project ID. Please create a project on the Stack dashboard at https://app.stack-auth.com and put it in the NEXT_PUBLIC_STACK_PROJECT_ID environment variable."));
}

export function getDefaultPublishableClientKey() {
  return envVars.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || envVars.STACK_PUBLISHABLE_CLIENT_KEY;
}

export function getDefaultSecretServerKey() {
  return envVars.STACK_SECRET_SERVER_KEY || throwErr(new Error("No secret server key provided. Please copy your key from the Stack dashboard and put it in the STACK_SECRET_SERVER_KEY environment variable."));
}

export function getDefaultSuperSecretAdminKey() {
  return envVars.STACK_SUPER_SECRET_ADMIN_KEY || throwErr(new Error("No super secret admin key provided. Please copy your key from the Stack dashboard and put it in the STACK_SUPER_SECRET_ADMIN_KEY environment variable."));
}

export function getDefaultExtraRequestHeaders() {
  return JSON.parse(envVars.NEXT_PUBLIC_STACK_EXTRA_REQUEST_HEADERS || envVars.STACK_EXTRA_REQUEST_HEADERS || '{}');
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
    // note: NEXT_PUBLIC_BROWSER_STACK_API_URL was renamed to NEXT_PUBLIC_STACK_API_URL_BROWSER, and NEXT_PUBLIC_STACK_URL to NEXT_PUBLIC_STACK_API_URL
    if (isBrowserLike()) {
      url = envVars.NEXT_PUBLIC_BROWSER_STACK_API_URL || envVars.NEXT_PUBLIC_STACK_API_URL_BROWSER || envVars.STACK_API_URL_BROWSER;
    } else {
      url = envVars.NEXT_PUBLIC_SERVER_STACK_API_URL || envVars.NEXT_PUBLIC_STACK_API_URL_SERVER || envVars.STACK_API_URL_SERVER;
    }
    url = url || envVars.NEXT_PUBLIC_STACK_API_URL || envVars.STACK_API_URL || envVars.NEXT_PUBLIC_STACK_URL || defaultBaseUrl;
  }

  return replaceStackPortPrefix(url.endsWith('/') ? url.slice(0, -1) : url);
}
export const defaultBaseUrl = "https://api.stack-auth.com";
export const defaultAnalyticsBaseUrl = "https://r.stack-auth.com";

export function getAnalyticsBaseUrl(regularBaseUrl: string): string {
  return regularBaseUrl === defaultBaseUrl ? defaultAnalyticsBaseUrl : regularBaseUrl;
}


function fetchBackendUrlsInBackground(primaryBaseUrl: string): void {
  createGlobal('__stack-fetch-backend-urls-started', () => {
    runAsynchronously(async () => {
      try {
        const res = await fetch(`${primaryBaseUrl}/api/v1/internal/backend-urls`);
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        if (!Array.isArray(data.urls) || !data.urls.every((u: unknown) => typeof u === 'string')) {
          return;
        }
        createGlobal('__stack-fetched-backend-urls', () => data.urls as string[]);
      } catch (e) {
        captureError('fetch-backend-urls-in-background', e);
      }
    });
    return true;
  });
}

export function resolveApiUrls(userExplicitBaseUrl: string | { browser: string, server: string } | undefined): () => string[] {
  return () => {
    if (userExplicitBaseUrl != null) {
      return [getBaseUrl(userExplicitBaseUrl)];
    }
    const primary = getBaseUrl(undefined);
    // Always try to fetch server-configured URLs (supports custom domains via
    // STACK_BACKEND_URLS_CONFIG). Hardcoded fallbacks are used as a default
    // until the background fetch completes.
    fetchBackendUrlsInBackground(primary);
    return getGlobal('__stack-fetched-backend-urls') ?? getDefaultApiUrls(primary);
  };
}

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
const cachePromiseByHookId = new Map<string, ReactPromise<Result<unknown>>>();
export function useAsyncCache<D extends any[], T>(cache: AsyncCache<D, Result<T>>, dependencies: D, caller: string): T {
  // we explicitly don't want to run this hook in SSR
  suspendIfSsr(caller);

  // on the dashboard, we do some perf monitoring for pre-fetching which should hook right in here
  const asyncCacheHooks: any[] = getGlobal("use-async-cache-execution-hooks") ?? [];
  for (const hook of asyncCacheHooks) {
    hook({ cache, caller, dependencies });
  }

  const id = React.useId();

  // whenever the dependencies change, we need to refresh the promise cache
  React.useEffect(() => {
    cachePromiseByHookId.delete(id);
  }, [...dependencies, id]);

  const subscribe = useCallback((cb: () => void) => {
    const { unsubscribe } = cache.onStateChange(dependencies, () => {
      cachePromiseByHookId.delete(id);
      cb();
    });
    return unsubscribe;
  }, [cache, ...dependencies]);
  const getSnapshot = useCallback(() => {
    // React checks whether a promise passed to `use` is still the same as the previous one by comparing the reference.
    // If we didn't cache here, this wouldn't work because the promise would be recreated every time the value changes.
    if (!cachePromiseByHookId.has(id)) {
      cachePromiseByHookId.set(id, cache.getOrWait(dependencies, "read-write"));
    }
    return cachePromiseByHookId.get(id) as ReactPromise<Result<T>>;
  }, [cache, ...dependencies]);

  // note: we must use React.useSyncExternalStore instead of importing the function directly, as it will otherwise
  // throw an error on Next.js ("can't import useSyncExternalStore from the server")
  const promise = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => throwErr(new Error("getServerSnapshot should never be called in useAsyncCache because we restrict to CSR earlier"))
  );

  const result = use(promise);
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
