import { AdapterServerApp, AdapterTelemetryOptions, AdapterUser, createRequestContext, HexclaveRequestContext, runRequestSpan } from "./adapter-core";

/**
 * Hexclave adapter for tRPC (v11). Zero runtime dependency on `@trpc/server`:
 * the factory is handed the consumer's `t` instance (from `initTRPC`) and only
 * calls `t.middleware`; the `required` rejection is shaped like a `TRPCError`
 * with code `UNAUTHORIZED` (tRPC's error normalization accepts Error objects
 * named "TRPCError"), overridable via `unauthorized`.
 *
 * ```ts
 * const t = initTRPC.context<HexclaveTRPCContext>().create();
 * const hexclave = createHexclaveTRPC(t, stackServerApp);
 *
 * export const createContext = hexclave.createContext; // pass to your adapter
 * export const publicProcedure = t.procedure.use(hexclave.middleware());
 * export const protectedProcedure = t.procedure.use(hexclave.middleware({ required: true }));
 * ```
 *
 * Every procedure then runs inside a `trpc.procedure` span linked to the
 * caller's client session ({ path, type } in the span data), with `ctx.user`
 * resolved (non-null under `required: true`) — no `{ request }` plumbing.
 */

/** Shape of the context `createContext` produces / the middleware consumes+extends. */
export type HexclaveTRPCContext = {
  hexclave?: HexclaveRequestContext,
  user?: AdapterUser | null,
};

type TRPCMiddlewareOpts = {
  ctx: HexclaveTRPCContext & Record<string, unknown>,
  path: string,
  type: string,
  next: (opts?: { ctx?: Record<string, unknown> }) => Promise<unknown>,
};

/** The slice of a `initTRPC...create()` instance the adapter needs. */
export type TRPCInstanceLike = {
  middleware: (fn: (opts: TRPCMiddlewareOpts) => Promise<unknown>) => unknown,
};

export type HexclaveTRPCMiddlewareOptions = {
  /** Reject unauthenticated calls (UNAUTHORIZED); `ctx.user` is then non-null. */
  required?: boolean,
  /** Disable or customize the per-procedure span. @default true */
  telemetry?: AdapterTelemetryOptions,
  /** Fallback request extraction when `createContext` was not used. */
  getRequest?: (ctx: Record<string, unknown>) => unknown,
  /** Error factory for `required` rejections (e.g. `() => new TRPCError({ code: "UNAUTHORIZED" })`). */
  unauthorized?: () => Error,
};

function defaultUnauthorized(): Error {
  // Structurally a TRPCError with code UNAUTHORIZED — accepted by tRPC's error
  // normalization without importing @trpc/server.
  const error = new Error("You must be signed in to call this procedure. (Hexclave: no valid session on the request.)");
  error.name = "TRPCError";
  (error as Error & { code: string }).code = "UNAUTHORIZED";
  return error;
}

export function createHexclaveTRPC<T extends TRPCInstanceLike>(t: T, app: AdapterServerApp, options?: {
  /** Override how the request is pulled out of the adapter's context options. */
  getRequest?: (contextOptions: Record<string, unknown>) => unknown,
  unauthorized?: () => Error,
}) {
  return {
    /**
     * Context builder to pass to the tRPC adapter (fetch adapter, Next.js, …).
     * Normalizes `opts.req` / `opts.request` (both the fetch adapter's Request
     * and Node's IncomingMessage are request-like) and stashes the lazy
     * per-request Hexclave context.
     */
    createContext: (contextOptions: Record<string, unknown>): HexclaveTRPCContext => {
      const requestInput = options?.getRequest
        ? options.getRequest(contextOptions)
        : contextOptions.req ?? contextOptions.request ?? null;
      return { hexclave: createRequestContext(app, requestInput) };
    },

    /** A `t.middleware(...)` wrapping the procedure in a request-linked span + resolving `ctx.user`. */
    middleware: (middlewareOptions?: HexclaveTRPCMiddlewareOptions): ReturnType<T["middleware"]> => {
      return t.middleware(async ({ ctx, path, type, next }: TRPCMiddlewareOpts) => {
        const hexclave = ctx.hexclave
          ?? createRequestContext(app, middlewareOptions?.getRequest?.(ctx) ?? null);
        return await runRequestSpan(app, hexclave, {
          defaultSpanType: "trpc.procedure",
          data: { path, type },
          telemetry: middlewareOptions?.telemetry,
        }, async () => {
          const user = await hexclave.getUser();
          if (middlewareOptions?.required && user === null) {
            throw (middlewareOptions.unauthorized ?? options?.unauthorized ?? defaultUnauthorized)();
          }
          return await next({ ctx: { ...ctx, hexclave, user } });
        });
      }) as ReturnType<T["middleware"]>;
    },
  };
}
