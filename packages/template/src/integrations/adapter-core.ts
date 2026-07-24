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
 * it as a RequestLike. A missing request is adapter misconfiguration, not an
 * unauthenticated caller: valid unauthenticated requests still have headers.
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
  request: RequestLike,
  getUser: () => Promise<AdapterUser | null>,
};

export function createRequestContext(app: AdapterServerApp, requestInput: unknown): HexclaveRequestContext {
  const request = normalizeRequestLike(requestInput);
  if (request === null) {
    throw new Error("Hexclave adapter could not find a request-like object with headers. Configure the adapter's request extractor.");
  }
  let userPromise: Promise<AdapterUser | null> | null = null;
  return {
    request,
    getUser: () => {
      userPromise ??= (app.getUser as (options: { tokenStore: RequestLike, or: "return-null" }) => Promise<AdapterUser | null>)({ tokenStore: request, or: "return-null" });
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

type AdapterSpanLink = Record<string, unknown>;

/**
 * Wraps `fn` in an adapter span (or calls it straight through when telemetry is
 * off). HTTP adapters pass `{ request }` so the span parents under the caller's
 * client session; non-HTTP adapters can pass another stable link such as
 * `{ userId }`.
 */
export async function runAdapterSpan<T>(
  app: AdapterServerApp,
  info: {
    defaultSpanType: string,
    data: Record<string, unknown>,
    link?: AdapterSpanLink,
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
    { ...info.link, data },
    (span) => fn(span),
  );
}

/**
 * Wraps `fn` in the adapter's request-linked span. The span — and everything
 * created inside `fn` — parents under the caller's client session via
 * `withSpan({ request })`.
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
  return await runAdapterSpan(app, {
    ...info,
    link: { request: context.request },
  }, fn);
}
