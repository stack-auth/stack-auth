import type { SpanRef } from "./event-tracker";

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

type AsyncLocalStorageLike = {
  run: <T>(store: SpanRef[], fn: () => T) => T,
  getStore: () => SpanRef[] | undefined,
};

let als: AsyncLocalStorageLike | null = null;
let alsInitPromise: Promise<void> | null = null;
// Whether the ALS probe has finished (either way). Once settled, context entry
// can run the callback SYNCHRONOUSLY (no await first), which is what makes the
// sync-window guarantee compose across nested withSpan calls.
let alsSettled = false;
// Sync-stack fallback frames (browsers / before ALS finishes loading). A frame's
// `prologueOpen` is true only while its callback's SYNCHRONOUS prologue is still
// executing — JS sync execution is single-threaded and uninterruptible, so a
// prologue-open frame provably belongs to the currently-running flow. Once the
// callback suspends (returns its promise), the frame stays for best-effort
// readers but is no longer provably ours.
type SyncFrame = { ref: SpanRef, prologueOpen: boolean };
const syncStack: SyncFrame[] = [];

async function ensureAsyncContext(): Promise<void> {
  if (alsInitPromise) return await alsInitPromise;
  alsInitPromise = (async () => {
    try {
      // Opaque specifier: bundlers must leave this as a runtime dynamic import
      // (vite/webpack hints + non-literal string), which simply rejects in
      // browsers and resolves to the built-in module everywhere node-like.
      // (When browsers ship TC39 AsyncContext, probe it here first — the whole
      // sync-window machinery below then never engages.)
      const specifier = "node:async_hooks";
      const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier) as { AsyncLocalStorage?: new () => AsyncLocalStorageLike };
      if (typeof mod.AsyncLocalStorage === "function") {
        als = new mod.AsyncLocalStorage();
      }
    } catch {
      // Browser: no async-context primitive; the sync stack is the fallback.
      als = null;
    } finally {
      alsSettled = true;
    }
  })();
  return await alsInitPromise;
}

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
  const store = als?.getStore();
  if (store) return [...store];
  const includeSuspended = opts?.includeSuspendedSyncFrames ?? true;
  return syncStack.filter((frame) => includeSuspended || frame.prologueOpen).map((frame) => frame.ref);
}

/**
 * Whether an EXACT async-context primitive backs the ambient frames right now
 * (AsyncLocalStorage today; TC39 AsyncContext when browsers ship it). When
 * false, getAmbientSpanRefs() serves the shared sync stack, which can mix
 * frames from concurrently interleaved async flows — readers use this to apply
 * the `ambientParenting` policy ("exact" drops the frames, "best-effort" keeps
 * them). Frames are always RECORDED either way; only reading is gated, so the
 * policy can differ per consumer without losing context.
 */
export function isExactAsyncContextActive(): boolean {
  return als !== null;
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
  if (!alsSettled) await ensureAsyncContext();
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
  if (!alsSettled) ensureAsyncContext().catch(() => {});
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
    if (result instanceof Promise) {
      result.finally(pop).catch(() => {});
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

/**
 * Test hook: forces the sync-stack fallback (as if ALS failed to load) or
 * resets to automatic detection. Never call outside tests.
 */
export function __setAsyncContextModeForTesting(mode: "sync-stack" | "auto"): void {
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
