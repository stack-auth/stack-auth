import type { RequestLike } from "../lib/hexclave-app/common";
import type { Span } from "../lib/hexclave-app/apps/implementations/event-tracker";
import type { StackServerApp } from "../lib/hexclave-app/apps/interfaces/server-app";
import type { ServerUser } from "../lib/hexclave-app/users";

/**
 * Shared core for the framework adapters (tRPC / oRPC / Elysia / Convex).
 *
 * Each adapter does exactly two things with the incoming request: resolve the
 * caller (`ctx.user`, lazily, cached per request) and wrap the framework's
 * handler in a `withSpan(type, { request }, …)` span — which is what links the
 * backend span to the caller's client session (`$refresh-token` /
 * `$session-replay` / `$session-replay-segment`) via the session plus the
 * `x-hexclave-span-context` header the browser SDK attaches automatically.
 * Consumers of an adapter never pass `{ request }` themselves.
 */

/** The (non-generic) server-app surface the adapters program against. */
export type AdapterServerApp = StackServerApp<boolean, string>;

/** What adapters put on the framework context as the authenticated caller. */
export type AdapterUser = ServerUser;

/**
 * Accepts anything with request-like headers (a fetch `Request`, a Node
 * `IncomingMessage`, `{ headers: Record<string, string | null> }`) and returns
 * it as a RequestLike, or null when there is nothing usable — adapters treat
 * that as an unauthenticated, unlinked call rather than an error.
 */
export function normalizeRequestLike(input: unknown): RequestLike | null {
  if (typeof input !== "object" || input === null) return null;
  const headers = (input as { headers?: unknown }).headers;
  if (typeof headers !== "object" || headers === null) return null;
  return input as RequestLike;
}

/**
 * Per-request context every adapter builds once and threads through: the
 * normalized request plus a lazy, memoized user resolution (no auth work is
 * done until something actually asks for the user).
 */
export type HexclaveRequestContext = {
  request: RequestLike | null,
  getUser: () => Promise<AdapterUser | null>,
};

export function createRequestContext(app: AdapterServerApp, requestInput: unknown): HexclaveRequestContext {
  const request = normalizeRequestLike(requestInput);
  let userPromise: Promise<AdapterUser | null> | null = null;
  return {
    request,
    getUser: () => {
      userPromise ??= request === null
        ? Promise.resolve(null)
        : (app.getUser as (options: { tokenStore: RequestLike, or: "return-null" }) => Promise<AdapterUser | null>)({ tokenStore: request, or: "return-null" });
      return userPromise;
    },
  };
}

/**
 * Per-adapter telemetry knob: `false` disables the span, `true`/undefined uses
 * the adapter's low-cardinality default span type (`trpc.procedure`,
 * `orpc.procedure`, `elysia.route`, `convex.function` — the variable bits like
 * path/method belong in `data`, not the type).
 */
export type AdapterTelemetryOptions = boolean | {
  spanType?: string,
  data?: Record<string, unknown>,
};

/**
 * Wraps `fn` in the adapter's request-linked span (or calls it straight through
 * when telemetry is off). The span — and everything created inside `fn` —
 * parents under the caller's client session via `withSpan({ request })`.
 */
export async function runRequestSpan<T>(
  app: AdapterServerApp,
  context: HexclaveRequestContext,
  info: {
    defaultSpanType: string,
    data: Record<string, unknown>,
    telemetry: AdapterTelemetryOptions | undefined,
  },
  fn: (span: Span | null) => Promise<T>,
): Promise<T> {
  if (info.telemetry === false) {
    return await fn(null);
  }
  const custom = typeof info.telemetry === "object" ? info.telemetry : undefined;
  const spanType = custom?.spanType ?? info.defaultSpanType;
  const data = { ...info.data, ...custom?.data ?? {} };
  return await app.withSpan(
    spanType,
    { ...context.request !== null ? { request: context.request } : {}, data },
    (span) => fn(span),
  );
}
