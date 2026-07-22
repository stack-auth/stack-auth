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
 * concurrent requests sharing one app instance never cross-contaminate. If an
 * exact async-context primitive is unavailable, this fails closed and does not
 * expose ambient request context rather than risking cross-request attribution.
 */

/** The resolved, prefix-free context. Ids are raw uuids; the backend applies `rti-`/`sri-`/`srsi-`/`cs-`. */
export type ServerRequestSpanContext = {
  userId: string | null,
  refreshTokenId: string | null,
  sessionReplayId: string | null,
  sessionReplaySegmentId: string | null,
  customParentSpanIds: string[],
};

/**
 * Applies an explicit server-side user attribution to request context. Session
 * ancestry is only valid when the authenticated request user matches; if the
 * identity differs (including an anonymous request), detach every request-
 * derived id instead of creating mixed-user telemetry.
 */
export function withExplicitServerUser(
  context: ServerRequestSpanContext,
  explicitUserId: string | null,
): ServerRequestSpanContext {
  if (explicitUserId == null || explicitUserId === context.userId) {
    return { ...context, userId: explicitUserId ?? context.userId };
  }
  return {
    userId: explicitUserId,
    refreshTokenId: null,
    sessionReplayId: null,
    sessionReplaySegmentId: null,
    customParentSpanIds: [],
  };
}

type AsyncLocalStorageLike = {
  run: <T>(store: ServerRequestSpanContext, fn: () => T) => T,
  getStore: () => ServerRequestSpanContext | undefined,
};

let als: AsyncLocalStorageLike | null = null;
let alsInitPromise: Promise<void> | null = null;

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
  return als?.getStore() ?? null;
}

/** Runs `fn` with `context` ambient. Awaits the ALS load first so the very first
 * call gets per-request isolation rather than racing the module load. */
export async function runWithServerRequestContext<T>(context: ServerRequestSpanContext, fn: () => Promise<T>): Promise<T> {
  await ensureAsyncContext();
  if (als) {
    return await als.run(context, fn);
  }
  return await fn();
}
