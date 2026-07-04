import type { SpanRef } from "./event-tracker";
import { ensureAsyncContext, getAsyncLocalStorage, syncStack } from "./span-context-state";

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
 */
export function getAmbientSpanRefs(): SpanRef[] {
  const als = getAsyncLocalStorage();
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
  const als = getAsyncLocalStorage();
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
