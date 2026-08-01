import { loadAsyncLocalStorage, type AsyncLocalStorageLike } from "@hexclave/shared/dist/utils/async-local-storage";
import type { SpanContext } from "./event-tracker";

export type { AsyncLocalStorageLike };

let als: AsyncLocalStorageLike<SpanContext[]> | null = null;
let alsInitPromise: Promise<void> | null = null;
let alsSettled = false;

// Sync-stack fallback frames (browsers / before ALS finishes loading). A frame's
// `prologueOpen` is true only while its callback's synchronous prologue is still
// executing, which is the only window where fallback context is exact.
export type SyncFrame = { context: SpanContext, prologueOpen: boolean };
export const syncStack: SyncFrame[] = [];

export function getAsyncLocalStorage(): AsyncLocalStorageLike<SpanContext[]> | null {
  return als;
}

export function isAsyncContextSettled(): boolean {
  return alsSettled;
}

export async function ensureAsyncContext(): Promise<void> {
  if (alsInitPromise) return await alsInitPromise;
  alsInitPromise = (async () => {
    // Null in browsers, where no async-context primitive exists; the sync stack
    // is the documented fallback there.
    als = await loadAsyncLocalStorage<SpanContext[]>("span-context");
    alsSettled = true;
  })();
  return await alsInitPromise;
}

export function setAsyncContextModeForTesting(mode: "sync-stack" | "auto"): void {
  if (mode === "sync-stack") {
    als = null;
    alsInitPromise = Promise.resolve();
    alsSettled = true;
  } else {
    als = null;
    alsInitPromise = null;
    alsSettled = false;
  }
  syncStack.length = 0;
}
