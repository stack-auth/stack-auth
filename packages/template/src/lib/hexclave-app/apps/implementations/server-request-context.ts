/**
 * Ambient server request context for `withSpan({ request })` / `trackEvent({ request })`.
 *
 * Resolved ONCE from an incoming request — the caller's refresh token + user
 * (server-trusted, from the session) and the client-propagated session-replay
 * context (untrusted labels, from the `x-hexclave-span-context` header) — then made
 * ambient for the duration of the callback so every span/event created inside,
 * including bare `serverApp.trackEvent(...)` calls, links to the same client
 * session without threading the context by hand.
 *
 * AsyncLocalStorage-backed (see span-context.ts for the same rationale) so
 * concurrent requests sharing one app instance never cross-contaminate; a
 * single-value sync fallback covers environments without `node:async_hooks`
 * (which server-key telemetry never actually runs in).
 */

/** The resolved, prefix-free context. Ids are raw uuids; the backend applies `rti-`/`sri-`/`srsi-`/`cs-`. */
export type ServerRequestSpanContext = {
  userId: string | null,
  refreshTokenId: string | null,
  sessionReplayId: string | null,
  sessionReplaySegmentId: string | null,
  customParentSpanIds: string[],
};

type AsyncLocalStorageLike = {
  run: <T>(store: ServerRequestSpanContext, fn: () => T) => T,
  getStore: () => ServerRequestSpanContext | undefined,
};

let als: AsyncLocalStorageLike | null = null;
let alsInitPromise: Promise<void> | null = null;
// Single-value fallback (before ALS finishes loading / where it is unavailable).
let syncCurrent: ServerRequestSpanContext | null = null;

async function ensureAsyncContext(): Promise<void> {
  if (alsInitPromise) return await alsInitPromise;
  alsInitPromise = (async () => {
    try {
      // Opaque specifier so bundlers leave this as a runtime dynamic import — it
      // simply rejects in the browser and resolves to the built-in everywhere
      // node-like. Mirrors span-context.ts.
      const specifier = "node:async_hooks";
      const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier) as { AsyncLocalStorage?: new () => AsyncLocalStorageLike };
      if (typeof mod.AsyncLocalStorage === "function") {
        als = new mod.AsyncLocalStorage();
      }
    } catch {
      als = null;
    }
  })();
  return await alsInitPromise;
}

/** The ambient request context, or null when not inside a `{ request }` scope. */
export function getServerRequestContext(): ServerRequestSpanContext | null {
  return als?.getStore() ?? syncCurrent;
}

/** Runs `fn` with `context` ambient. Awaits the ALS load first so the very first
 * call gets per-request isolation rather than racing the module load. */
export async function runWithServerRequestContext<T>(context: ServerRequestSpanContext, fn: () => Promise<T>): Promise<T> {
  await ensureAsyncContext();
  if (als) {
    return await als.run(context, fn);
  }
  const previous = syncCurrent;
  syncCurrent = context;
  try {
    return await fn();
  } finally {
    syncCurrent = previous;
  }
}
