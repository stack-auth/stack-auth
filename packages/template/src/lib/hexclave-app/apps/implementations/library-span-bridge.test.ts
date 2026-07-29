import { gunzipSync } from "node:zlib";
import { uuidToW3cSpanId, uuidToW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { context as contextApi, ROOT_CONTEXT, SpanStatusCode, trace as traceApi, type Context, type ContextManager, type Tracer, type TracerProvider } from "@hexclave/shared/dist/utils/otel-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackServerApp } from "../interfaces/server-app";
import { classifyLibrarySpanCategory, registerLibrarySpanBridge, resetLibrarySpanBridgeForTesting, type BeginLibrarySpanInfo, type LibrarySpanBridgeDeps } from "./library-span-bridge";
import { getServerAppInstrumentation } from "./server-app-impl";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const AMBIENT_SPAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type SeamCall = {
  info: BeginLibrarySpanInfo,
  nativeId: string,
  parentPath: string[],
  ends: { endedAtMs: number, data: Record<string, unknown> }[],
};

/**
 * Fake seam standing in for server-app-impl._beginLibrarySpan: records every
 * call, mints native ids, and reproduces the seam's parenting contract — an
 * OTel parent's path wins outright, otherwise a configurable "ambient" chain
 * (contract case (b)), otherwise the empty project root (case (c)).
 */
function makeFakeSeam(options?: { ambientPath?: string[], decline?: boolean }) {
  const calls: SeamCall[] = [];
  const deps: LibrarySpanBridgeDeps = {
    projectId: PROJECT_ID,
    beginLibrarySpan: (info) => {
      if (options?.decline) return null;
      const nativeId = crypto.randomUUID();
      const parentPath = info.otelParent !== null
        ? [...info.otelParent.parentPath, info.otelParent.nativeId]
        : [...options?.ambientPath ?? []];
      const call: SeamCall = { info, nativeId, parentPath, ends: [] };
      calls.push(call);
      return {
        nativeId,
        parentPath,
        end: (endedAtMs, data) => call.ends.push({ endedAtMs, data }),
      };
    },
  };
  return { calls, deps };
}

describe("library-span-bridge", () => {
  afterEach(() => {
    resetLibrarySpanBridgeForTesting();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("registration", () => {
    it("claims the OTel API globals so the GLOBAL trace api routes into the seam", async () => {
      const { calls, deps } = makeFakeSeam();
      const registration = await registerLibrarySpanBridge(deps);
      expect(registration).not.toBeNull();
      // Spans started through the GLOBAL api must reach our seam — that is
      // the whole point of the bridge (libraries call trace.getTracer
      // themselves). Note the api wraps the registered provider in a
      // ProxyTracer, so this is a behavior assertion, not an identity one.
      const span = traceApi.getTracer("prisma").startSpan("global-route");
      span.end();
      expect(calls).toHaveLength(1);
      expect(calls[0].info.name).toBe("global-route");
      expect(calls[0].ends).toHaveLength(1);
    });

    it("returns one tracer instance per name", async () => {
      const { deps } = makeFakeSeam();
      const registration = await registerLibrarySpanBridge(deps);
      expect(registration?.provider.getTracer("prisma")).toBe(registration?.provider.getTracer("prisma"));
      expect(registration?.provider.getTracer("prisma")).not.toBe(registration?.provider.getTracer("drizzle"));
    });

    it("backs off completely when a foreign tracer provider is already registered", async () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const noopTracer: Tracer = {
        startSpan: () => {
          throw new Error("test tracer must not be used");
        },
        startActiveSpan: () => {
          throw new Error("test tracer must not be used");
        },
      };
      const foreignProvider: TracerProvider = { getTracer: () => noopTracer };
      expect(traceApi.setGlobalTracerProvider(foreignProvider)).toBe(true);
      try {
        const { deps } = makeFakeSeam();
        expect(await registerLibrarySpanBridge(deps)).toBeNull();
        expect(debugSpy).toHaveBeenCalledTimes(1);
        // The context manager slot must NOT have been claimed either
        // (all-or-nothing back-off): claiming it now must succeed.
        const passthroughManager: ContextManager = {
          active: (): Context => ROOT_CONTEXT,
          with: (_context, fn, thisArg, ...args) => fn.call(thisArg, ...args),
          bind: (_context, target) => target,
          enable() {
            return this;
          },
          disable() {
            return this;
          },
        };
        expect(contextApi.setGlobalContextManager(passthroughManager)).toBe(true);
        // Sticky per process, with exactly ONE debug note total.
        expect(await registerLibrarySpanBridge(deps)).toBeNull();
        expect(debugSpy).toHaveBeenCalledTimes(1);
      } finally {
        traceApi.disable();
        contextApi.disable();
      }
    });

    it("re-registration is idempotent and swaps to the newest deps (HMR replace semantics)", async () => {
      const first = makeFakeSeam();
      const second = makeFakeSeam();
      const registrationA = await registerLibrarySpanBridge(first.deps);
      const registrationB = await registerLibrarySpanBridge(second.deps);
      expect(registrationB?.provider).toBe(registrationA?.provider);
      const span = traceApi.getTracer("prisma").startSpan("query");
      span.end();
      expect(first.calls).toHaveLength(0);
      expect(second.calls).toHaveLength(1);
    });
  });

  describe("span identity + registry mapping", () => {
    it("derives the W3C span/trace ids from the seam's native uuid", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const before = Date.now();
      const span = traceApi.getTracer("prisma").startSpan("client:operation");
      const spanContext = span.spanContext();
      expect(calls).toHaveLength(1);
      expect(calls[0].info).toMatchObject({ name: "client:operation", tracerName: "prisma", otelParent: null });
      expect(calls[0].info.startedAtMs).toBeGreaterThanOrEqual(before);
      expect(calls[0].info.startedAtMs).toBeLessThanOrEqual(Date.now());
      expect(spanContext.traceId).toBe(uuidToW3cTraceId(calls[0].nativeId));
      expect(spanContext.spanId).toBe(uuidToW3cSpanId(calls[0].nativeId));
      expect(spanContext.traceFlags).toBe(1);
      span.end();
    });

    it("becomes non-recording (but stays API-complete) when the seam declines", async () => {
      const { deps } = makeFakeSeam({ decline: true });
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("prisma").startSpan("query");
      expect(span.isRecording()).toBe(false);
      expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.spanContext().spanId).toMatch(/^[0-9a-f]{16}$/);
      // None of these may throw into library code.
      span.setAttribute("db.system", "postgresql");
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.addEvent("ignored");
      span.end();
    });
  });

  describe("ignored tracers", () => {
    it("never records spans from Hexclave's own internal tracer (telemetry feedback-loop guard)", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      // "stack-tracer" is @hexclave/shared's traceSpan tracer — its spans wrap
      // SDK internals like the telemetry sender's retry wait(); recording them
      // would let every failed batch send mint the row that fills the next
      // batch, so the buffer could never drain.
      const span = traceApi.getTracer("stack-tracer").startSpan("STACK: wait(...)");
      expect(span.isRecording()).toBe(false);
      span.end();
      expect(calls).toHaveLength(0);
    });

    it("never records framework runtime spans from the next.js tracer", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("next.js").startSpan("middleware GET");
      expect(span.isRecording()).toBe(false);
      span.end();
      expect(calls).toHaveLength(0);
    });

    it("a library span under an ignored active span falls back to ambient parenting", async () => {
      const { calls, deps } = makeFakeSeam({ ambientPath: [AMBIENT_SPAN] });
      await registerLibrarySpanBridge(deps);
      await traceApi.getTracer("next.js").startActiveSpan("render route (app) /", async (outer) => {
        traceApi.getTracer("prisma").startSpan("client:operation").end();
        outer.end();
      });
      // Only the Prisma span reached the seam; the ignored parent is not in
      // the registry, so the child resolved via the ambient chain (case (b)).
      expect(calls.map((call) => call.info.name)).toEqual(["client:operation"]);
      expect(calls[0].info.otelParent).toBeNull();
      expect(calls[0].parentPath).toEqual([AMBIENT_SPAN]);
    });
  });

  describe("parenting", () => {
    it("startActiveSpan nesting survives await boundaries and produces root-first parent paths", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      await tracer.startActiveSpan("client:operation", async (outer) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await tracer.startActiveSpan("engine:query", async (middle) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const inner = tracer.startSpan("engine:db_query");
          inner.end();
          middle.end();
        });
        outer.end();
      });
      expect(calls.map((call) => call.info.name)).toEqual(["client:operation", "engine:query", "engine:db_query"]);
      const [outer, middle, inner] = calls;
      expect(outer.info.otelParent).toBeNull();
      expect(middle.info.otelParent).toEqual({ nativeId: outer.nativeId, parentPath: [] });
      expect(inner.info.otelParent).toEqual({ nativeId: middle.nativeId, parentPath: [outer.nativeId] });
      // All three share the outer span's trace id (W3C trace coherence).
      expect(inner.parentPath).toEqual([outer.nativeId, middle.nativeId]);
    });

    it("concurrent active spans never cross-parent (ALS isolation)", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      const flow = async (name: string) => await tracer.startActiveSpan(`${name}:outer`, async (outer) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        tracer.startSpan(`${name}:inner`).end();
        outer.end();
      });
      await Promise.all([flow("a"), flow("b")]);
      const byName = new Map(calls.map((call) => [call.info.name, call]));
      expect(byName.get("a:inner")?.info.otelParent?.nativeId).toBe(byName.get("a:outer")?.nativeId);
      expect(byName.get("b:inner")?.info.otelParent?.nativeId).toBe(byName.get("b:outer")?.nativeId);
    });

    it("an explicit context argument wins over the active context", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      const parent = tracer.startSpan("parent");
      const explicitContext = traceApi.setSpan(ROOT_CONTEXT, parent);
      const child = tracer.startSpan("child", undefined, explicitContext);
      expect(calls[1].info.otelParent?.nativeId).toBe(calls[0].nativeId);
      child.end();
      parent.end();
    });

    it("options.root drops the OTel parent (falls through to ambient/seam resolution)", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      await tracer.startActiveSpan("outer", async (outer) => {
        tracer.startSpan("detached", { root: true }).end();
        outer.end();
      });
      expect(calls[1].info.name).toBe("detached");
      expect(calls[1].info.otelParent).toBeNull();
    });

    it("with no OTel parent, the seam's ambient chain roots the span (contract case b)", async () => {
      const { calls, deps } = makeFakeSeam({ ambientPath: [AMBIENT_SPAN] });
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      await tracer.startActiveSpan("outer", async (outer) => {
        tracer.startSpan("inner").end();
        outer.end();
      });
      // The outer span was handed otelParent null (seam resolves ambient); the
      // inner span extends the outer's resolved path, keeping the ambient root.
      expect(calls[0].info.otelParent).toBeNull();
      expect(calls[0].parentPath).toEqual([AMBIENT_SPAN]);
      expect(calls[1].parentPath).toEqual([AMBIENT_SPAN, calls[0].nativeId]);
    });

    it("a foreign (unmapped) span in context does not crash and falls back to ambient", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const foreign = traceApi.wrapSpanContext({
        traceId: "0123456789abcdef0123456789abcdef",
        spanId: "0123456789abcdef",
        traceFlags: 1,
        isRemote: true,
      });
      const ctx = traceApi.setSpan(ROOT_CONTEXT, foreign);
      traceApi.getTracer("prisma").startSpan("query", undefined, ctx).end();
      expect(calls[0].info.otelParent).toBeNull();
    });
  });

  describe("attributes, status, events", () => {
    it("always drops SQL statement/query-text attributes, keeps other primitives", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("prisma").startSpan("query", {
        attributes: {
          "db.system": "postgresql",
          "db.statement": "SELECT * FROM users WHERE email = 'leak@example.com'",
          "db.query.text": "SELECT 1",
          "custom.sql": "SELECT 2",
        },
      });
      span.setAttribute("db.operation", "SELECT");
      span.end();
      const data = calls[0].ends[0].data;
      expect(data["db.system"]).toBe("postgresql");
      expect(data["db.operation"]).toBe("SELECT");
      expect(data["db.statement"]).toBeUndefined();
      expect(data["db.query.text"]).toBeUndefined();
      expect(data["custom.sql"]).toBeUndefined();
    });

    it("caps attribute count at 64 and value size at 1KB; drops non-primitive shapes", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("lib").startSpan("op");
      for (let i = 0; i < 70; i++) {
        span.setAttribute(`attr_${String(i).padStart(2, "0")}`, i);
      }
      span.setAttribute("attr_00", "overwrite still allowed past the cap");
      span.setAttribute("huge", "x".repeat(5000));
      span.setAttribute("nan", NaN);
      span.setAttribute("list", ["a", "b"]);
      span.end();
      const data = calls[0].ends[0].data;
      const attributeKeys = Object.keys(data).filter((key) => key.startsWith("attr_"));
      // 64-attribute cap: attr_64..attr_69, huge, nan, and list all arrived
      // after the map was full, so only the first 64 attr_* keys survive.
      expect(attributeKeys).toHaveLength(64);
      expect(data.attr_00).toBe("overwrite still allowed past the cap");
      expect(data.attr_69).toBeUndefined();
      expect(data.huge).toBeUndefined();
      expect(data.nan).toBeUndefined();
      expect(data.list).toBeUndefined();
    });

    it("bounds oversized string values to 1KB", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("lib").startSpan("op");
      span.setAttribute("huge", "x".repeat(5000));
      span.setAttribute("list", ["a".repeat(2000), "b"]);
      span.end();
      const data = calls[0].ends[0].data;
      expect((data.huge as string).length).toBeLessThanOrEqual(1024);
      // Arrays are allowlisted-by-shape via bounded JSON stringification.
      expect(typeof data.list).toBe("string");
      expect((data.list as string).length).toBeLessThanOrEqual(1024);
    });

    it("folds recordException + setStatus into data; counts dropped events", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("lib").startSpan("op");
      span.recordException(new Error("kaboom"));
      span.setStatus({ code: SpanStatusCode.ERROR, message: "query failed" });
      span.addEvent("first");
      span.addEvent("second");
      span.updateName("renamed-op");
      span.end();
      const data = calls[0].ends[0].data;
      expect(data.name).toBe("renamed-op");
      expect(data.status_code).toBe("error");
      expect(data.status_message).toBe("query failed");
      expect(data["exception.type"]).toBe("Error");
      expect(data["exception.message"]).toBe("kaboom");
      expect(typeof data["exception.stacktrace"]).toBe("string");
      expect(data.dropped_event_count).toBe(2);
    });

    it("reserved data keys win over colliding library attributes", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("lib").startSpan("op", {
        attributes: { name: "spoofed", tracer_name: "spoofed", category: "spoofed" },
      });
      span.end();
      const data = calls[0].ends[0].data;
      expect(data.name).toBe("op");
      expect(data.tracer_name).toBe("lib");
      expect(data.category).toBe("lib");
    });
  });

  describe("end()", () => {
    it("emits exactly one row, with explicit timing respected and repeat end() ignored", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const startedAt = 1_800_000_000_000;
      const endedAt = new Date(1_800_000_000_250);
      const span = traceApi.getTracer("lib").startSpan("op", { startTime: startedAt });
      span.end(endedAt);
      span.end(new Date(1_800_000_999_999));
      expect(calls[0].info.startedAtMs).toBe(startedAt);
      expect(calls[0].ends).toHaveLength(1);
      expect(calls[0].ends[0].endedAtMs).toBe(1_800_000_000_250);
    });

    it("clamps an end time earlier than the start instead of throwing", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const startedAt = 1_800_000_000_000;
      const span = traceApi.getTracer("lib").startSpan("op", { startTime: startedAt });
      span.end(new Date(startedAt - 5000));
      expect(calls[0].ends[0].endedAtMs).toBe(startedAt);
    });

    it("attributes set after end() are ignored", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("lib").startSpan("op");
      span.end();
      span.setAttribute("late", "value");
      span.setStatus({ code: SpanStatusCode.ERROR });
      expect(calls[0].ends[0].data.late).toBeUndefined();
      expect(calls[0].ends[0].data.status_code).toBeUndefined();
    });
  });

  describe("category classification", () => {
    it("classifies db (tracer name or db.* attributes), db before ai", () => {
      expect(classifyLibrarySpanCategory("@prisma/instrumentation", [])).toBe("db");
      expect(classifyLibrarySpanCategory("drizzle-orm", [])).toBe("db");
      expect(classifyLibrarySpanCategory("pg", [])).toBe("db");
      expect(classifyLibrarySpanCategory("mysql2", [])).toBe("db");
      expect(classifyLibrarySpanCategory("something-else", ["db.system"])).toBe("db");
      // db wins even when ai-ish attributes coexist.
      expect(classifyLibrarySpanCategory("ai", ["db.system"])).toBe("db");
    });

    it("classifies ai (tracer name word or gen_ai./ai. attributes)", () => {
      expect(classifyLibrarySpanCategory("ai", [])).toBe("ai");
      expect(classifyLibrarySpanCategory("openai-sdk", [])).toBe("ai");
      expect(classifyLibrarySpanCategory("some-lib", ["gen_ai.usage.input_tokens"])).toBe("ai");
      expect(classifyLibrarySpanCategory("some-lib", ["ai.model.id"])).toBe("ai");
    });

    it("does not misfile 'ai'-substring tracers, defaults to lib", () => {
      expect(classifyLibrarySpanCategory("email-sender", [])).toBe("lib");
      expect(classifyLibrarySpanCategory("langchain-utils", [])).toBe("lib");
      expect(classifyLibrarySpanCategory("some-random-lib", ["http.method"])).toBe("lib");
    });
  });

  describe("end-to-end through the real server app seam", () => {
    function stubAnalyticsFetch() {
      const requests: { url: string, body: string }[] = [];
      vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        let body = "";
        const rawBody = init?.body;
        if (typeof rawBody === "string") {
          body = rawBody;
        } else if (rawBody instanceof Uint8Array) {
          body = rawBody.length >= 2 && rawBody[0] === 0x1f && rawBody[1] === 0x8b
            ? gunzipSync(rawBody).toString("utf8")
            : new TextDecoder().decode(rawBody);
        } else if (input instanceof Request) {
          body = await input.clone().text();
        }
        requests.push({ url, body });
        return new Response("{}", { status: 200 });
      }) as typeof fetch);
      return requests;
    }

    it("ships one $lib-span row nested under the ambient withSpan frame", async () => {
      const requests = stubAnalyticsFetch();
      const app = new StackServerApp({
        projectId: PROJECT_ID,
        publishableClientKey: "pck_test",
        secretServerKey: "ssk_test",
        baseUrl: "https://api.example.test",
        tokenStore: "memory",
        noAutomaticPrefetch: true,
        telemetry: { resource: { service: { name: "test-server" } } },
      });
      const instrumentation = getServerAppInstrumentation(app);
      expect(instrumentation).not.toBeNull();
      const registration = await instrumentation?.registerLibrarySpanBridge();
      expect(registration).not.toBeNull();

      let nativeParentId = "";
      await app.withSpan("db-stuff", async (span) => {
        nativeParentId = span.spanId;
        const otelSpan = traceApi.getTracer("prisma").startSpan("prisma:engine:db_query", {
          attributes: {
            "db.system": "postgresql",
            "db.statement": "SELECT * FROM secrets",
          },
        });
        otelSpan.end();
      });
      await app.flush();

      const batchBodies = requests.filter((request) => request.url.includes("analytics")).map((request) => request.body);
      const spans = batchBodies.flatMap((body) => {
        const payload = JSON.parse(body) as { spans?: { span_id: string, span_type: string, parent_span_ids: string[], started_at_ms: number, ended_at_ms: number | null, data: Record<string, unknown> }[] };
        return payload.spans ?? [];
      });
      const libSpan = spans.find((row) => row.span_type === "$lib-span");
      expect(libSpan).not.toBeUndefined();
      // Nested under the ambient withSpan frame via contract case (b).
      expect(libSpan?.parent_span_ids).toEqual([nativeParentId]);
      expect(libSpan?.ended_at_ms).not.toBeNull();
      expect(libSpan?.data["db.system"]).toBe("postgresql");
      expect(libSpan?.data["db.statement"]).toBeUndefined();
      expect(libSpan?.data.category).toBe("db");
      expect(libSpan?.data.name).toBe("prisma:engine:db_query");
      expect(libSpan?.data.tracer_name).toBe("prisma");
      // The withSpan frame itself shipped as a normal custom span.
      expect(spans.some((row) => row.span_type === "db-stuff" && row.span_id === nativeParentId)).toBe(true);
    });
  });
});
