import { headers as rscHeaders } from "@hexclave/sc/force-react-server";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import type { RequestLike } from "../lib/hexclave-app/common";
import { getServerAppInstrumentation } from "../lib/hexclave-app/apps/implementations/server-app-impl";
import { AdapterServerApp, AdapterTelemetryOptions, AdapterUser, HexclaveRequestContext, runGuardedCall, runGuardedRoute, UnauthorizedFactory } from "./adapter-core";

/**
 * Hexclave adapter for Next.js (App Router). Unlike the tRPC/oRPC/Elysia
 * adapters there is no framework instance to hand in: route handlers receive
 * the `Request` directly, and server actions read the ambient request headers
 * via `next/headers` (which is why this adapter only ships in `@hexclave/next`
 * — it is generated out of the other SDK packages).
 *
 * ```ts
 * const hexclave = createHexclaveNext(stackServerApp);
 *
 * // app/api/orders/route.ts
 * export const GET = hexclave.routeHandler(async ({ request, user }) => {
 *   // runs inside a `next.route` span linked to the caller's client session
 *   return Response.json({ orders: await listOrdersFor(user) });
 * }, { required: true });
 *
 * // app/actions.ts ("use server")
 * export const createOrder = hexclave.serverAction(async ({ user }, formData: FormData) => {
 *   // runs inside a `next.server-action` span linked to the caller's client session
 * }, { name: "createOrder", required: true });
 * ```
 */

/** What route handlers wrapped by the adapter receive (as a single object). */
export type HexclaveNextRouteHandlerContext<TRouteContext> = {
  request: Request,
  /** The second argument Next.js passes to the route handler (`{ params }`). */
  context: TRouteContext,
  user: AdapterUser | null,
  hexclave: HexclaveRequestContext,
};

export type HexclaveNextRouteHandlerOptions = {
  /** Reject unauthenticated calls with a 401 before the handler runs; `user` is then non-null. */
  required?: boolean,
  /** Disable or customize the per-route span. @default true */
  telemetry?: AdapterTelemetryOptions,
  /** Response factory for `required` rejections (wins over the factory-level default). @default a JSON 401 response */
  unauthorized?: () => Response | Promise<Response>,
};

export type HexclaveNextServerActionOptions = {
  /** Reject unauthenticated calls; the action's `user` is then non-null. */
  required?: boolean,
  /** The action's name, recorded in the span data (low-cardinality span type stays `next.server-action`). */
  name?: string,
  /** Disable or customize the per-action span. @default true */
  telemetry?: AdapterTelemetryOptions,
  /** Error factory for `required` rejections (wins over the factory-level default). */
  unauthorized?: () => Error,
};

export type HexclaveNextFactoryOptions = {
  /**
   * Default `unauthorized` for every wrapped surface (a per-handler
   * `unauthorized` always wins). One factory serves both surfaces, so it may
   * produce either: a returned `Response` is sent by route handlers, an `Error`
   * is thrown (server actions can only throw, so return an `Error` there).
   */
  unauthorized?: UnauthorizedFactory,
};

/**
 * Loosely matches Next.js's documented `onRequestError` arguments (structural
 * typing on purpose — no `next` type imports, and Next may add fields).
 */
export type HexclaveNextRequestErrorRequest = {
  path?: string,
  method?: string,
  headers?: unknown,
};

export type HexclaveNextRequestErrorContext = {
  routerKind?: string,
  routePath?: string,
  routeType?: string,
};

export type HexclaveNextInstrumentation = {
  // Async because claiming the OTel API global for the library-span bridge
  // must finish before app code starts spans; Next.js awaits an async
  // `register` export, so `export const register = instrumentation.register`
  // keeps working unchanged.
  register: () => Promise<void>,
  onRequestError: (error: unknown, request: HexclaveNextRequestErrorRequest, errorContext?: HexclaveNextRequestErrorContext) => Promise<void>,
  /**
   * Advanced collector/control-plane hook. Runs one callback with every
   * SDK-native telemetry source suppressed in the hidden OTel bridge's exact
   * async context, preventing self-ingestion feedback loops.
   */
  runWithTelemetrySuppressed: <T>(fn: () => Promise<T>) => Promise<T>,
};

export type HexclaveNextInstrumentationOptions = {
  /**
   * OpenTelemetry instrumentation instances to wire into Hexclave's hidden
   * library-span bridge, e.g. `[new PrismaInstrumentation()]`. Only needed
   * for libraries that ship an instrumentation CLASS; libraries that emit
   * spans through the global OTel API directly (Drizzle's OTel support, the
   * Vercel AI SDK's `experimental_telemetry`) are captured with zero config
   * once `register()` runs. Typed `unknown[]` on purpose: we duck-type the
   * entries rather than depend on `@opentelemetry/instrumentation`.
   */
  instrumentations?: unknown[],
  /**
   * Whether bare telemetry and `onRequestError` should resolve the current
   * Next.js request's session and correlation headers. Disable this when a
   * control plane records its own telemetry into a separate internal project:
   * the incoming request belongs to a customer project, not the telemetry app.
   *
   * @default true
   */
  requestAttribution?: boolean,
  /**
   * Returns true when automatic SDK telemetry must be suppressed in the
   * current async context. Advanced collector/control-plane hook: pass the
   * runtime's standard tracing-suppression predicate so SDK-native fetch,
   * library, log, and error capture follows the same recursion boundary.
   */
  isTelemetrySuppressed?: () => boolean,
};

/**
 * Duck-typed shape check for OTel instrumentation instances. Method-shorthand
 * members keep TypeScript's bivariant method checking, so real
 * instrumentations (whose setTracerProvider takes a TracerProvider) match.
 */
function isOtelInstrumentationLike(value: unknown): value is { setTracerProvider(provider: unknown): void, enable(): void } {
  if (typeof value !== "object" || value === null) return false;
  // Guarded property access; the cast mirrors readSpanContextHeader's pattern.
  const candidate = value as { setTracerProvider?: unknown, enable?: unknown };
  return typeof candidate.setTracerProvider === "function" && typeof candidate.enable === "function";
}

// Memoizes the RequestLike wrapper per Headers instance from `next/headers`.
// Next returns a stable Headers object per request scope, and the server app
// memoizes its token store (and therefore the session + its refresh
// round-trip) by request-OBJECT identity — so without this map, every bare
// telemetry call would mint a fresh wrapper and re-resolve the session.
const ambientRequestLikeByHeaders = new WeakMap<object, RequestLike>();

/**
 * The ambient request provider registered by `hexclaveInstrumentation`:
 * resolves the current request's headers via `next/headers`, so bare
 * `trackEvent` / `withSpan` / logger calls in route handlers, server actions,
 * and RSCs attribute to the caller's session without passing `{ request }`.
 * Outside a request scope `next/headers` throws — that simply means there is
 * no ambient request (build time, background work), never an error.
 */
async function resolveAmbientNextRequest(): Promise<RequestLike | null> {
  let headers: unknown;
  try {
    headers = await rscHeaders();
  } catch {
    return null;
  }
  if (typeof headers !== "object" || headers === null) return null;
  const existing = ambientRequestLikeByHeaders.get(headers);
  if (existing !== undefined) return existing;
  // ReadonlyHeaders matches RequestLike's `{ get }` headers variant directly.
  const requestLike: RequestLike = { headers: headers as { get: (name: string) => string | null } };
  ambientRequestLikeByHeaders.set(headers, requestLike);
  return requestLike;
}

/** Next's `request.headers` can be a `Headers` or a Node dict (values possibly
 * string arrays); normalize to the SDK's RequestLike or undefined. */
function nextRequestToRequestLike(request: HexclaveNextRequestErrorRequest): RequestLike | undefined {
  const headers = request.headers;
  if (typeof headers !== "object" || headers === null) return undefined;
  if (typeof (headers as { get?: unknown }).get === "function") {
    // Headers-shaped: matches RequestLike's `{ get }` variant directly. The
    // cast mirrors readSpanContextHeader's guarded access pattern.
    return { headers: headers as { get: (name: string) => string | null } };
  }
  const normalized: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[name] = value;
    } else if (Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")) {
      normalized[name] = value.join(", ");
    }
  }
  return { headers: normalized };
}

/**
 * Glue for the customer's `instrumentation.ts`:
 *
 * ```ts
 * // instrumentation.ts
 * import { hexclaveInstrumentation } from "@hexclave/next/next";
 * import { stackServerApp } from "./stack";
 *
 * const instrumentation = hexclaveInstrumentation(stackServerApp);
 * export const register = instrumentation.register;
 * export const onRequestError = instrumentation.onRequestError;
 * ```
 *
 * `register()` installs the server-side outbound-fetch instrumentation
 * ($http-client spans + cross-tier header for allowlisted origins) and the
 * uncaught-exception monitor (`$error` events via
 * `process.on("uncaughtExceptionMonitor")` — observation-only, never changes
 * crash behavior) — both also self-install at app construction now, so
 * register() keeping them is redundancy, not a requirement — and, Next-only,
 * the AMBIENT REQUEST PROVIDER: bare `trackEvent` / `withSpan` / logger calls
 * inside a request scope attribute to the caller's session via `next/headers`
 * without passing `{ request }`. Safe under HMR: installs are idempotent per
 * app instance and replace-keyed per project on globalThis. `onRequestError`
 * records every uncaught server-side error as a `$error` event linked (via
 * the request's headers) to the caller's client session.
 *
 * `register()` also claims the process-global OpenTelemetry API for the
 * hidden library-span bridge (ONLY if no other OTel provider is registered —
 * a user's own OTel setup always wins): spans any library emits through the
 * OTel global become native operation-named rows nested under the ambient
 * Hexclave request span, with their tracer stored as the instrumentation scope
 * and zero exporter/endpoint/collector config.
 * Libraries using the global API directly (Drizzle's OTel support, the
 * Vercel AI SDK's `experimental_telemetry`) need nothing at all; libraries
 * that ship an instrumentation CLASS plug in via the options:
 *
 * ```ts
 * // instrumentation.ts
 * import { PrismaInstrumentation } from "@prisma/instrumentation";
 * const instrumentation = hexclaveInstrumentation(stackServerApp, {
 *   instrumentations: [new PrismaInstrumentation()],
 * });
 * export const register = instrumentation.register;
 * export const onRequestError = instrumentation.onRequestError;
 * ```
 *
 * Honest limit: this does NOT create per-route server spans — Next.js has no
 * hook that wraps a route's async extent. Per-route auto-spans still require
 * the adapter wrappers (`routeHandler` / `serverAction` above).
 */
export function hexclaveInstrumentation(app: AdapterServerApp, options?: HexclaveNextInstrumentationOptions): HexclaveNextInstrumentation {
  // Fail at setup time, not at error time: a structurally-wrong `app` (or a
  // mock) would otherwise silently drop every error report.
  const instrumentation = getServerAppInstrumentation(app);
  if (instrumentation === null) {
    throw new Error("hexclaveInstrumentation() requires a StackServerApp instance (created with `new StackServerApp(...)`)");
  }
  return {
    runWithTelemetrySuppressed: async (fn) => await instrumentation.runWithTelemetrySuppressed(fn),
    register: async () => {
      instrumentation.installServerFetchInstrumentation();
      instrumentation.installServerErrorMonitor();
      instrumentation.setTelemetrySuppressionPredicate(options?.isTelemetrySuppressed ?? null);
      // From here on, bare telemetry calls (no `{ request }`) inside a Next
      // request scope attribute to the caller's session via `next/headers`.
      instrumentation.setAmbientRequestProvider(options?.requestAttribution === false ? null : resolveAmbientNextRequest);
      // Claim the OTel API global (only if free) BEFORE wiring instrumentation
      // entries, so their spans resolve to our provider from the first call.
      const registration = await instrumentation.registerLibrarySpanBridge();
      for (const [index, entry] of (options?.instrumentations ?? []).entries()) {
        // This duck-typed pair of calls is exactly what
        // @opentelemetry/instrumentation's registerInstrumentations() does
        // with each entry; duck-typing keeps that package out of our
        // dependency tree.
        if (!isOtelInstrumentationLike(entry)) {
          console.warn(`Hexclave analytics: instrumentations[${index}] does not look like an OpenTelemetry instrumentation (missing setTracerProvider()/enable()); ignoring it`);
          continue;
        }
        if (registration !== null) {
          entry.setTracerProvider(registration.provider);
        }
        // When the bridge backed off (the user runs their own OTel setup), we
        // still enable the entry WITHOUT overriding its provider — it then
        // resolves the user's global provider, which is what they'd expect.
        entry.enable();
      }
    },
    onRequestError: async (error, request, errorContext) => {
      try {
        // Next stamps a stable `digest` on rendered errors; keep it so a
        // reported $error can be matched to Next's own error overlay/logs.
        const digest = typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string"
          ? error.digest
          : undefined;
        await instrumentation.captureServerRequestError(error, {
          mechanism: "next.onRequestError",
          ...options?.requestAttribution === false ? {} : { request: nextRequestToRequestLike(request) },
          data: {
            ...typeof request.path === "string" ? { path: request.path } : {},
            ...typeof request.method === "string" ? { method: request.method } : {},
            ...typeof errorContext?.routerKind === "string" ? { router_kind: errorContext.routerKind } : {},
            ...typeof errorContext?.routePath === "string" ? { route_path: errorContext.routePath } : {},
            ...typeof errorContext?.routeType === "string" ? { route_type: errorContext.routeType } : {},
            ...digest !== undefined ? { digest } : {},
          },
        });
      } catch (captureError) {
        // Telemetry must never make a crashing request worse; Next awaits this
        // callback, so a throw here would surface as a second error.
        console.warn("Hexclave analytics: failed to report a request error:", captureError);
      }
    },
  };
}

export function createHexclaveNext(app: AdapterServerApp, factoryOptions?: HexclaveNextFactoryOptions) {
  return {
    /**
     * Wraps an App Router route handler (`GET`, `POST`, …) in a `next.route`
     * span linked to the caller's client session ({ path, method } in the span
     * data), with the caller resolved as `user`. The wrapped function keeps
     * Next.js's `(request, context)` signature, so export it directly.
     */
    routeHandler: <TRouteContext = unknown>(
      fn: (ctx: HexclaveNextRouteHandlerContext<TRouteContext>) => Response | Promise<Response>,
      options?: HexclaveNextRouteHandlerOptions,
    ) => {
      return async (request: Request, context: TRouteContext): Promise<Response> => {
        return await runGuardedRoute(app, {
          requestInput: request,
          defaultSpanType: "next.route",
          data: { path: new URL(request.url).pathname, method: request.method },
          telemetry: options?.telemetry,
          required: options?.required,
          unauthorized: options?.unauthorized,
          factoryUnauthorized: factoryOptions?.unauthorized,
          surface: "route",
        }, ({ user, hexclave }) => fn({ request, context, user, hexclave }));
      };
    },

    /**
     * Wraps a server action in a `next.server-action` span linked to the
     * caller's client session, prepending a `{ user, hexclave }` context to the
     * action's own arguments — the wrapped action keeps its outward signature,
     * so it works with `<form action={...}>` and direct calls alike.
     *
     * Server actions receive no `Request`; the ambient headers from
     * `next/headers` carry both the session cookies and the
     * `x-hexclave-span-context` header (the browser SDK's patched fetch
     * instruments React's action POSTs like any other same-origin request).
     */
    serverAction: <TArgs extends unknown[], TResult>(
      fn: (context: { user: AdapterUser | null, hexclave: HexclaveRequestContext }, ...args: TArgs) => TResult | Promise<TResult>,
      options?: HexclaveNextServerActionOptions,
    ) => {
      return async (...args: TArgs): Promise<TResult> => {
        // Goes through resolveAmbientNextRequest (not a fresh `{ headers }`
        // literal) so it hits the ambientRequestLikeByHeaders memo: the server
        // app keys its token store — and therefore the session plus its refresh
        // round-trip — by request-OBJECT identity, so a fresh wrapper here would
        // make a wrapped action and any bare `trackEvent` in the same request
        // resolve the session twice.
        const requestInput = await resolveAmbientNextRequest()
          ?? throwErr("Hexclave: `serverAction` must be called during a Next.js request (next/headers is unavailable here).");
        return await runGuardedCall(app, {
          requestInput,
          defaultSpanType: "next.server-action",
          data: { ...options?.name !== undefined ? { name: options.name } : {} },
          telemetry: options?.telemetry,
          required: options?.required,
          unauthorized: options?.unauthorized,
          factoryUnauthorized: factoryOptions?.unauthorized,
          surface: "server action",
        }, ({ user, hexclave }) => fn({ user, hexclave }, ...args));
      };
    },
  };
}
