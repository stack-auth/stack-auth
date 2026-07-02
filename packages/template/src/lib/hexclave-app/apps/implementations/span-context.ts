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
// Sync-stack fallback frames (browsers / before ALS finishes loading).
const syncStack: SpanRef[] = [];

async function ensureAsyncContext(): Promise<void> {
  if (alsInitPromise) return await alsInitPromise;
  alsInitPromise = (async () => {
    try {
      // Opaque specifier: bundlers must leave this as a runtime dynamic import
      // (vite/webpack hints + non-literal string), which simply rejects in
      // browsers and resolves to the built-in module everywhere node-like.
      const specifier = "node:async_hooks";
      const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier) as { AsyncLocalStorage?: new () => AsyncLocalStorageLike };
      if (typeof mod.AsyncLocalStorage === "function") {
        als = new mod.AsyncLocalStorage();
      }
    } catch {
      // Browser: no async-context primitive; the sync stack is the fallback.
      als = null;
    }
  })();
  return await alsInitPromise;
}

/**
 * The SpanRefs of all enclosing withSpan() frames, outermost first. Consumed by
 * the parent-resolution logic as ambient parents (alongside global spans).
 */
export function getAmbientSpanRefs(): SpanRef[] {
  const store = als?.getStore();
  if (store) return [...store];
  return [...syncStack];
}

/**
 * Runs `fn` with `frame` appended to the ambient span context. Always async:
 * awaiting the ALS load first is what guarantees server code gets isolation
 * from the very first withSpan() call rather than racing the module load.
 */
export async function runWithSpanContext<T>(frame: SpanRef, fn: () => Promise<T>): Promise<T> {
  await ensureAsyncContext();
  if (als) {
    const enclosing = als.getStore() ?? [];
    return await als.run([...enclosing, frame], fn);
  }
  syncStack.push(frame);
  try {
    return await fn();
  } finally {
    // Remove OUR frame specifically — a concurrent flow may have pushed frames
    // above ours in the meantime (the documented sync-stack limitation).
    const index = syncStack.lastIndexOf(frame);
    if (index !== -1) syncStack.splice(index, 1);
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
  } else {
    als = null;
    alsInitPromise = null;
  }
  syncStack.length = 0;
}
