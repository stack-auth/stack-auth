import type { SpanRef } from "./event-tracker";

type AsyncHooksModule = typeof import("node:async_hooks");

export type AsyncLocalStorageLike = {
  run: <T>(store: SpanRef[], fn: () => T) => T,
  getStore: () => SpanRef[] | undefined,
};

let als: AsyncLocalStorageLike | null = null;
let alsInitPromise: Promise<void> | null = null;

// Sync-stack fallback frames (browsers / before ALS finishes loading).
export const syncStack: SpanRef[] = [];

export function getAsyncLocalStorage(): AsyncLocalStorageLike | null {
  return als;
}

export async function ensureAsyncContext(): Promise<void> {
  if (alsInitPromise) return await alsInitPromise;
  alsInitPromise = (async () => {
    try {
      // Opaque specifier: bundlers must leave this as a runtime dynamic import
      // (vite/webpack hints + non-literal string), which simply rejects in
      // browsers and resolves to the built-in module everywhere node-like.
      const specifier = "node:async_hooks";
      const mod: Partial<AsyncHooksModule> = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
      if (mod.AsyncLocalStorage !== undefined) {
        als = new mod.AsyncLocalStorage<SpanRef[]>();
      }
    } catch {
      // Browser: no async-context primitive; the sync stack is the fallback.
      als = null;
    }
  })();
  return await alsInitPromise;
}

export function setAsyncContextModeForTesting(mode: "sync-stack" | "auto"): void {
  if (mode === "sync-stack") {
    als = null;
    alsInitPromise = Promise.resolve();
  } else {
    als = null;
    alsInitPromise = null;
  }
  syncStack.length = 0;
}
