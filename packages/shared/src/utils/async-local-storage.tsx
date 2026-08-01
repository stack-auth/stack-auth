/**
 * One place that loads Node's `AsyncLocalStorage`, for the SDK's three ambient
 * contexts (the withSpan frame stack, the server request context, and the
 * library-span bridge's OTel context manager).
 *
 * Each of those grew its own copy of this bootstrap — same opaque specifier,
 * same bundler pragmas, same swallowed import failure, three subtly different
 * `AsyncLocalStorageLike` shapes. The comments in two of them literally said
 * they mirrored a third, which is the usual sign that the abstraction was
 * missing rather than unwanted.
 */

import { createGlobal } from "./globals";

/** The slice of `AsyncLocalStorage<T>` the SDK actually uses. */
export type AsyncLocalStorageLike<T> = {
  run: <R>(store: T, fn: () => R) => R,
  getStore: () => T | undefined,
};

type AsyncHooksModuleLike<T> = {
  AsyncLocalStorage?: new () => AsyncLocalStorageLike<T>,
};

// One storage instance per KEY, shared across every duplicated copy of this
// module in the process — hence globalThis rather than a module-level Map.
//
// Bundlers routinely emit the SDK into several server chunks (Next.js gives
// `instrumentation.ts` and each route their own), and a module-level cache then
// hands each chunk a DIFFERENT AsyncLocalStorage. `run()` in the route chunk and
// `getStore()` in the chunk that registered the OTel bridge would then be
// talking to two unrelated stores, so ambient context silently resolved to
// nothing across that seam: every Prisma query a request made became its own
// root trace instead of nesting under the request span. Same store for the same
// key is the entire contract of an ambient context — it cannot be per-copy.
const loadPromise = createGlobal("async-local-storage-load-promises", () => new Map<string, Promise<unknown>>());

/**
 * Resolves a fresh `AsyncLocalStorage` for `key`, or `null` on any runtime
 * without one (browsers, and edge runtimes without `nodejs_compat`). Never
 * throws: callers all degrade to a documented fallback rather than failing.
 *
 * Memoized per `key` so repeated calls hand back the SAME storage instance —
 * `run`/`getStore` must agree on one object to be an ambient context at all.
 */
export function loadAsyncLocalStorage<T>(key: string): Promise<AsyncLocalStorageLike<T> | null> {
  let existing = loadPromise.get(key);
  if (existing === undefined) {
    existing = (async (): Promise<AsyncLocalStorageLike<T> | null> => {
      try {
        // The specifier is deliberately opaque to bundlers (non-literal + the
        // ignore pragmas) so this stays a RUNTIME dynamic import: browser
        // builds must neither resolve nor error on a Node built-in, they must
        // simply reject here at runtime.
        const specifier = "node:async_hooks";
        const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier) as AsyncHooksModuleLike<T>;
        return typeof mod.AsyncLocalStorage === "function" ? new mod.AsyncLocalStorage() : null;
      } catch {
        return null;
      }
    })();
    loadPromise.set(key, existing);
  }
  return existing as Promise<AsyncLocalStorageLike<T> | null>;
}

/** Test-only: forget the cached storages so each test starts from a clean slate. */
export function resetAsyncLocalStorageCacheForTesting(): void {
  loadPromise.clear();
}
