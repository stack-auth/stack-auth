import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { SpanRef } from "./event-tracker";
import { ensureAsyncContext, getAsyncLocalStorage, isAsyncContextSettled, syncStack, type SyncFrame } from "./span-context-state";

/**
 * Ambient span context for withSpan(): tracks the stack of enclosing withSpan
 * frames so telemetry created inside the callback automatically parents under
 * them (additive with global spans and explicit parentIds).
 *
 * Two implementations behind one interface:
 *
 * - **AsyncLocalStorage** (Node, Bun, Deno, Cloudflare Workers / Vercel Edge
 *   with nodejs_compat): correct across await boundaries and under concurrent
 *   requests — two parallel withSpan() flows can never cross-parent. Loaded via
 *   a runtime-guarded dynamic import of the BUILT-IN `node:async_hooks` module
 *   (not an npm dependency); the import specifier is deliberately opaque to
 *   bundlers so browser builds neither resolve nor error on it.
 *
 * - **Sync stack fallback** (browsers, where no async-context primitive
 *   exists): a module-level enter/exit stack. Correct for synchronous code and
 *   a single concurrent flow; interleaved parallel async flows can observe each
 *   other's frames (the same trade-off Sentry's browser SDK accepts). Server
 *   code never hits this path.
 */

/**
 * The SpanRefs of all enclosing withSpan() frames, outermost first. Consumed by
 * the parent-resolution logic as ambient parents (alongside global spans).
 *
 * With an exact primitive (ALS/AsyncContext) the store is per-flow and always
 * returned in full. On the sync-stack fallback, `includeSuspendedSyncFrames`
 * (default true — the historical behavior) decides whether frames whose
 * callback has already suspended are included: `false` is the "exact" policy
 * (only provably-same-flow prologue-open frames — never another flow's),
 * `true` is the "best-effort" policy (zero-glue across awaits, may mix
 * concurrently interleaved flows).
 */
export function getAmbientSpanRefs(opts?: { includeSuspendedSyncFrames?: boolean }): SpanRef[] {
  const als = getAsyncLocalStorage();
  const store = als?.getStore();
  if (store) return [...store];
  const includeSuspended = opts?.includeSuspendedSyncFrames ?? true;
  return syncStack.filter((frame) => includeSuspended || frame.prologueOpen).map((frame) => frame.ref);
}

/**
 * Runs `fn` with `frame` appended to the ambient span context. Awaits the ALS
 * probe on the very first call (so server code gets isolation from the first
 * withSpan() rather than racing the module load); once the probe has settled it
 * enters the context SYNCHRONOUSLY — `fn`'s synchronous prologue runs inside the
 * caller's own sync block, which is what makes prologue-open frames compose
 * across nested withSpan calls on the sync-stack fallback.
 */
export async function runWithSpanContext<T>(frame: SpanRef, fn: () => Promise<T>): Promise<T> {
  if (!isAsyncContextSettled()) await ensureAsyncContext();
  const als = getAsyncLocalStorage();
  if (als) {
    const enclosing = als.getStore() ?? [];
    return await als.run([...enclosing, frame], fn);
  }
  const syncFrame: SyncFrame = { ref: frame, prologueOpen: true };
  syncStack.push(syncFrame);
  try {
    const result = fn();
    // fn returned its promise — the synchronous prologue is over. The frame
    // stays on the stack (suspended) for best-effort readers until settle.
    syncFrame.prologueOpen = false;
    return await result;
  } finally {
    syncFrame.prologueOpen = false;
    // Remove OUR frame specifically — a concurrent flow may have pushed frames
    // above ours in the meantime (the documented sync-stack limitation).
    const index = syncStack.lastIndexOf(syncFrame);
    if (index !== -1) syncStack.splice(index, 1);
  }
}

/**
 * Re-enters `ref` as an ambient frame for `fn` — the manual-rebind primitive
 * behind `span.run()`, for post-await code, timers, and third-party callbacks.
 * Synchronous: under ALS/AsyncContext the context covers `fn`'s full async
 * extent; on the sync-stack fallback it is exact for `fn`'s synchronous window,
 * and if `fn` returns a promise the (suspended) frame additionally stays
 * visible to best-effort readers until it settles.
 */
export function runWithSpanFrame<T>(ref: SpanRef, fn: () => T): T {
  if (!isAsyncContextSettled()) {
    runAsynchronously(ensureAsyncContext(), { noErrorLogging: true });
  }
  const als = getAsyncLocalStorage();
  if (als) {
    const enclosing = als.getStore() ?? [];
    return als.run([...enclosing, ref], fn);
  }
  const syncFrame: SyncFrame = { ref, prologueOpen: true };
  syncStack.push(syncFrame);
  const pop = () => {
    const index = syncStack.lastIndexOf(syncFrame);
    if (index !== -1) syncStack.splice(index, 1);
  };
  try {
    const result = fn();
    syncFrame.prologueOpen = false;
    if (result !== null && result !== undefined && typeof (result as { then?: unknown }).then === "function") {
      runAsynchronously(Promise.resolve(result).finally(pop), { noErrorLogging: true });
    } else {
      pop();
    }
    return result;
  } catch (error) {
    syncFrame.prologueOpen = false;
    pop();
    throw error;
  }
}
