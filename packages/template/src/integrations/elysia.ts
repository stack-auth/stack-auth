import { AdapterServerApp, AdapterTelemetryOptions, AdapterUser, createRequestContext, HexclaveRequestContext, runRequestSpan } from "./adapter-core";

/**
 * Hexclave adapter for ElysiaJS. Zero runtime dependency on `elysia` —
 * exported as composable pieces because Elysia has no around-middleware: a
 * `.resolve()` callback for the user, a `beforeHandle` guard, and a handler
 * wrapper for the request-linked span (wrapping the handler is the only honest
 * way to put it INSIDE the span's async extent).
 *
 * ```ts
 * const hexclave = createHexclaveElysia(stackServerApp);
 *
 * new Elysia()
 *   .resolve(hexclave.resolveUser)                            // ctx.user (+ ctx.hexclave)
 *   .get("/me", ({ user }) => user, { beforeHandle: hexclave.requireUser })
 *   .post("/checkout", hexclave.handler(async ({ user, hexclave }) => {
 *     // runs inside an `elysia.route` span linked to the caller's client session
 *   }), { beforeHandle: hexclave.requireUser });
 * ```
 */

/** What `resolveUser` adds to the Elysia context. */
export type HexclaveElysiaContext = {
  hexclave: HexclaveRequestContext,
  user: AdapterUser | null,
};

type ElysiaRequestContext = {
  request: Request,
  path?: string,
  set: { status?: number | string },
} & Partial<HexclaveElysiaContext> & Record<string, unknown>;

export type HexclaveElysiaHandlerOptions = {
  /** Disable or customize the per-route span. @default true */
  telemetry?: AdapterTelemetryOptions,
};

export function createHexclaveElysia(app: AdapterServerApp) {
  const ensureContext = (ctx: ElysiaRequestContext): HexclaveRequestContext =>
    ctx.hexclave ?? createRequestContext(app, ctx.request);

  return {
    /**
     * `.resolve()` callback: adds the lazy per-request context and the resolved
     * `user` (null when unauthenticated) to every route's context.
     */
    resolveUser: async (ctx: { request: Request }): Promise<HexclaveElysiaContext> => {
      const hexclave = createRequestContext(app, ctx.request);
      return { hexclave, user: await hexclave.getUser() };
    },

    /** `beforeHandle` guard: short-circuits unauthenticated calls with a 401. */
    requireUser: (ctx: ElysiaRequestContext) => {
      if (!ctx.user) {
        ctx.set.status = 401;
        return { error: "You must be signed in to call this route. (Hexclave: no valid session on the request.)" };
      }
    },

    /**
     * Wraps a route handler in an `elysia.route` span linked to the caller's
     * client session ({ path, method } in the span data). Everything created
     * inside the handler — trackEvent, child spans — nests under it.
     */
    handler: <TContext extends ElysiaRequestContext, TResult>(
      fn: (ctx: TContext) => TResult | Promise<TResult>,
      handlerOptions?: HexclaveElysiaHandlerOptions,
    ) => {
      return async (ctx: TContext): Promise<TResult> => {
        return await runRequestSpan(app, ensureContext(ctx), {
          defaultSpanType: "elysia.route",
          data: { path: ctx.path ?? new URL(ctx.request.url).pathname, method: ctx.request.method },
          telemetry: handlerOptions?.telemetry,
        }, async () => await fn(ctx));
      };
    },
  };
}
