import { describe, expect, it, vi } from "vitest";
import { createRequestContext, normalizeRequestLike, type AdapterServerApp } from "./adapter-core";
import { hexclaveConvexFunction } from "./convex";
import { createHexclaveElysia } from "./elysia";
import { createHexclaveORPC } from "./orpc";
import { createHexclaveTRPC } from "./trpc";

const FAKE_USER = { id: "user-1", displayName: "Test" };

function makeApp(overrides?: { user?: unknown | null }) {
  const user = overrides && "user" in overrides ? overrides.user : FAKE_USER;
  const withSpan = vi.fn(async (_type: string, _options: unknown, fn: (span: unknown) => unknown) => await fn({ spanId: "span-1" }));
  const getUser = vi.fn(async () => user);
  return { app: { withSpan, getUser } as unknown as AdapterServerApp, withSpan, getUser };
}

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("https://api.example.com/x", { headers });
}

describe("adapter-core", () => {
  it("normalizeRequestLike accepts Request / header records, rejects garbage", () => {
    expect(normalizeRequestLike(makeRequest())).not.toBeNull();
    expect(normalizeRequestLike({ headers: { cookie: "a=b" } })).not.toBeNull();
    expect(normalizeRequestLike(null)).toBeNull();
    expect(normalizeRequestLike("nope")).toBeNull();
    expect(normalizeRequestLike({})).toBeNull();
  });

  it("createRequestContext resolves the user lazily and memoizes", async () => {
    const { app, getUser } = makeApp();
    const context = createRequestContext(app, makeRequest());
    expect(getUser).not.toHaveBeenCalled();
    await expect(context.getUser()).resolves.toEqual(FAKE_USER);
    await context.getUser();
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("createRequestContext with no usable request yields null user without an auth call", async () => {
    const { app, getUser } = makeApp();
    const context = createRequestContext(app, undefined);
    expect(context.request).toBeNull();
    await expect(context.getUser()).resolves.toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("tRPC adapter", () => {
  // Minimal `t` stand-in: t.middleware(fn) just returns fn.
  const t = { middleware: (fn: (opts: never) => Promise<unknown>) => fn };

  function callMiddleware(middleware: unknown, ctx: Record<string, unknown>) {
    const next = vi.fn(async (opts?: { ctx?: Record<string, unknown> }) => ({ nextCtx: opts?.ctx }));
    const result = (middleware as (opts: unknown) => Promise<unknown>)({ ctx, path: "checkout.create", type: "mutation", next });
    return { next, result };
  }

  it("createContext stashes a lazy context from opts.req", async () => {
    const { app, getUser } = makeApp();
    const hexclave = createHexclaveTRPC(t, app);
    const ctx = hexclave.createContext({ req: makeRequest() });
    expect(getUser).not.toHaveBeenCalled();
    await expect(ctx.hexclave!.getUser()).resolves.toEqual(FAKE_USER);
  });

  it("middleware wraps the procedure in a request-linked span and injects ctx.user", async () => {
    const { app, withSpan } = makeApp();
    const hexclave = createHexclaveTRPC(t, app);
    const ctx = { ...hexclave.createContext({ req: makeRequest() }), db: { name: "main" } } as Record<string, unknown>;
    const { next, result } = callMiddleware(hexclave.middleware(), ctx);
    await result;
    expect(withSpan).toHaveBeenCalledTimes(1);
    const [spanType, options] = withSpan.mock.calls[0];
    expect(spanType).toBe("trpc.procedure");
    expect((options as { data: unknown }).data).toEqual({ path: "checkout.create", type: "mutation" });
    expect((options as { request: unknown }).request).not.toBeUndefined();
    expect(next).toHaveBeenCalledWith({ ctx: expect.objectContaining({ user: FAKE_USER }) });
    expect(next).toHaveBeenCalledWith({ ctx: expect.objectContaining({ db: { name: "main" } }) });
  });

  it("required: true rejects unauthenticated calls with a TRPCError-shaped UNAUTHORIZED", async () => {
    const { app } = makeApp({ user: null });
    const hexclave = createHexclaveTRPC(t, app);
    const ctx = hexclave.createContext({ req: makeRequest() }) as Record<string, unknown>;
    const { next, result } = callMiddleware(hexclave.middleware({ required: true }), ctx);
    await expect(result).rejects.toMatchObject({ name: "TRPCError", code: "UNAUTHORIZED" });
    expect(next).not.toHaveBeenCalled();
  });

  it("telemetry: false skips the span but still resolves the user", async () => {
    const { app, withSpan } = makeApp();
    const hexclave = createHexclaveTRPC(t, app);
    const ctx = hexclave.createContext({ req: makeRequest() }) as Record<string, unknown>;
    const { next, result } = callMiddleware(hexclave.middleware({ telemetry: false }), ctx);
    await result;
    expect(withSpan).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith({ ctx: expect.objectContaining({ user: FAKE_USER }) });
  });
});

describe("oRPC adapter", () => {
  it("required: true without an unauthorized factory fails fast at creation", () => {
    const { app } = makeApp();
    const hexclave = createHexclaveORPC(app);
    expect(() => hexclave.middleware({ required: true })).toThrow(/unauthorized/);
  });

  it("wrapFetchHandler injects the per-request context; middleware resolves the user in a span", async () => {
    const { app, withSpan } = makeApp();
    const hexclave = createHexclaveORPC(app, { unauthorized: () => new Error("nope") });

    // Handler stand-in that captures its options and immediately runs the middleware.
    const captured: { context?: Record<string, unknown> }[] = [];
    const handler = {
      handle: (request: Request, options?: Record<string, unknown>) => {
        captured.push(options as { context?: Record<string, unknown> });
        return { matched: true, request };
      },
    };
    const handle = hexclave.wrapFetchHandler(handler, { prefix: "/rpc" });
    handle(makeRequest());
    expect(captured[0].context?.hexclave).toBeDefined();
    expect((captured[0] as { prefix?: string }).prefix).toBe("/rpc");

    const middleware = hexclave.middleware();
    const next = vi.fn(async (opts?: { context?: Record<string, unknown> }) => opts?.context);
    await middleware({ context: captured[0].context as never, path: ["checkout", "create"], next });
    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(withSpan.mock.calls[0][0]).toBe("orpc.procedure");
    expect((withSpan.mock.calls[0][1] as { data: unknown }).data).toEqual({ path: "checkout.create" });
    expect(next).toHaveBeenCalledWith({ context: expect.objectContaining({ user: FAKE_USER }) });
  });

  it("middleware preserves existing context values and avoids duplicate spans when composed", async () => {
    const { app, withSpan } = makeApp();
    const hexclave = createHexclaveORPC(app, { unauthorized: () => new Error("nope") });
    const publicMiddleware = hexclave.middleware();
    const protectedMiddleware = hexclave.middleware({ required: true });
    const finalNext = vi.fn(async (opts?: { context?: Record<string, unknown> }) => opts?.context);
    const result = await publicMiddleware({
      context: { service: { name: "orders" }, hexclave: createRequestContext(app, makeRequest()) } as never,
      path: ["orders", "create"],
      next: async (publicOptions?: { context?: Record<string, unknown> }) => {
        return await protectedMiddleware({
          context: publicOptions?.context as never,
          path: ["orders", "create"],
          next: finalNext,
        });
      },
    });

    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ service: { name: "orders" }, user: FAKE_USER });
    expect(finalNext).toHaveBeenCalledWith({ context: expect.objectContaining({ service: { name: "orders" }, user: FAKE_USER }) });
  });

  it("required: true throws the caller-provided error for unauthenticated calls", async () => {
    const { app } = makeApp({ user: null });
    const unauthorized = () => Object.assign(new Error("UNAUTHORIZED"), { fromFactory: true });
    const hexclave = createHexclaveORPC(app, { unauthorized });
    const middleware = hexclave.middleware({ required: true });
    const context = { hexclave: createRequestContext(app, makeRequest()) };
    await expect(middleware({ context: context as never, path: ["x"], next: vi.fn() })).rejects.toMatchObject({ fromFactory: true });
  });
});

describe("Elysia adapter", () => {
  it("resolveUser adds the context + user; requireUser guards with a 401", async () => {
    const { app } = makeApp();
    const hexclave = createHexclaveElysia(app);
    const resolved = await hexclave.resolveUser({ request: makeRequest() });
    expect(resolved.user).toEqual(FAKE_USER);

    const okSet: { status?: number | string } = {};
    expect(hexclave.requireUser({ request: makeRequest(), set: okSet, user: resolved.user } as never)).toBeUndefined();

    const failSet: { status?: number | string } = {};
    const body = hexclave.requireUser({ request: makeRequest(), set: failSet, user: null } as never);
    expect(failSet.status).toBe(401);
    expect(body).toMatchObject({ error: expect.stringContaining("signed in") });
  });

  it("handler wraps the route in an elysia.route span with path + method", async () => {
    const { app, withSpan } = makeApp();
    const hexclave = createHexclaveElysia(app);
    const wrapped = hexclave.handler(async (ctx) => `hello ${(ctx as { user?: { id: string } }).user?.id}`);
    const result = await wrapped({
      request: new Request("https://api.example.com/me", { method: "GET" }),
      path: "/me",
      set: {},
      user: FAKE_USER,
      hexclave: createRequestContext(app, makeRequest()),
    } as never);
    expect(result).toBe("hello user-1");
    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(withSpan.mock.calls[0][0]).toBe("elysia.route");
    expect((withSpan.mock.calls[0][1] as { data: unknown }).data).toEqual({ path: "/me", method: "GET" });
  });
});

describe("Convex adapter", () => {
  const convexCtx = { auth: { getUserIdentity: async () => ({ subject: "user-1" }) } };

  it("resolves the caller from convex identity and runs inside a convex.function span", async () => {
    const { app, withSpan, getUser } = makeApp();
    const wrapped = hexclaveConvexFunction(app, async ({ user, args }) => `${(user as { id: string }).id}:${(args as { n: number }).n}`, { kind: "query", name: "listItems" });
    const result = await wrapped(convexCtx as never, { n: 7 });
    expect(result).toBe("user-1:7");
    expect(getUser).toHaveBeenCalledWith({ from: "convex", ctx: convexCtx, or: "return-null" });
    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(withSpan.mock.calls[0][0]).toBe("convex.function");
    expect(withSpan.mock.calls[0][1]).toMatchObject({ userId: "user-1", data: { kind: "query", name: "listItems" } });
  });

  it("required: true rejects unauthenticated calls inside telemetry; telemetry: false skips the span", async () => {
    const { app, withSpan } = makeApp({ user: null });
    const guarded = hexclaveConvexFunction(app, async () => "never", { required: true });
    await expect(guarded(convexCtx as never, {})).rejects.toThrow(/signed in/);
    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(withSpan.mock.calls[0][0]).toBe("convex.function");
    expect(withSpan.mock.calls[0][1]).toMatchObject({ data: {} });

    const { app: app2, withSpan: withSpan2 } = makeApp();
    const bare = hexclaveConvexFunction(app2, async () => "ok", { telemetry: false });
    await expect(bare(convexCtx as never, {})).resolves.toBe("ok");
    expect(withSpan2).not.toHaveBeenCalled();
  });
});
