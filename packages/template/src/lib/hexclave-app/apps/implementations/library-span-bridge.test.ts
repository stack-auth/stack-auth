import { gunzipSync } from "node:zlib";
import { generateW3cSpanId, generateW3cTraceId, isW3cSpanId, isW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { context as contextApi, ROOT_CONTEXT, SpanStatusCode, trace as traceApi, type Context, type ContextManager, type Tracer, type TracerProvider } from "@hexclave/shared/dist/utils/otel-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackServerApp } from "../interfaces/server-app";
import { classifyLibrarySpanCategory, isLibrarySpanBridgeTelemetrySuppressed, librarySpanTypeFromName, registerLibrarySpanBridge, resetLibrarySpanBridgeForTesting, runWithLibrarySpanBridgeTelemetrySuppressed, runWithLibrarySpanBridgeTelemetrySuppressedIfRegistered, shouldIgnoreLibrarySpan, type BeginLibrarySpanInfo, type LibrarySpanBridgeDeps } from "./library-span-bridge";
import { getServerAppInstrumentation } from "./server-app-impl";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
// Stands in for a Hexclave withSpan frame the seam would resolve from ambient
// context (contract case (b)).
const AMBIENT_PARENT = { traceId: generateW3cTraceId(), spanId: generateW3cSpanId() };

type SeamCall = {
  info: BeginLibrarySpanInfo,
  traceId: string,
  spanId: string,
  /** The parent the seam decided on — exactly what would land in `parent_span_id`. */
  parentSpanId: string | null,
  ends: { endedAtMs: number, data: Record<string, unknown> }[],
};

/**
 * Fake seam standing in for server-app-impl._beginLibrarySpan: records every
 * call, mints W3C ids, and reproduces the seam's parenting contract — an OTel
 * parent wins outright (join its trace, parent under its `recordedSpanId`),
 * otherwise a configurable ambient parent (case (b)), otherwise a fresh trace
 * root (case (c)).
 */
function makeFakeSeam(options?: { ambientParent?: { traceId: string, spanId: string }, decline?: boolean }) {
  const calls: SeamCall[] = [];
  const deps: LibrarySpanBridgeDeps = {
    projectId: PROJECT_ID,
    beginLibrarySpan: (info) => {
      if (options?.decline) return null;
      const ambient = options?.ambientParent ?? null;
      // Mirrors _beginLibrarySpan: `recordedSpanId` may be null even when a
      // parent entry exists (nearest OTel ancestor wrote no row), in which case
      // this span roots its parent's trace rather than naming a phantom.
      const traceId = info.otelParent?.traceId ?? ambient?.traceId ?? generateW3cTraceId();
      const parentSpanId = info.otelParent !== null ? info.otelParent.recordedSpanId : ambient?.spanId ?? null;
      const call: SeamCall = { info, traceId, spanId: generateW3cSpanId(), parentSpanId, ends: [] };
      calls.push(call);
      return {
        traceId: call.traceId,
        spanId: call.spanId,
        sampled: true,
        ambientSpanId: ambient?.spanId ?? info.otelParent?.ambientSpanId ?? null,
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

    it("suppresses library spans for the full async collector scope using the bridge's own context manager", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      expect(isLibrarySpanBridgeTelemetrySuppressed()).toBe(false);

      await runWithLibrarySpanBridgeTelemetrySuppressed(async () => {
        expect(isLibrarySpanBridgeTelemetrySuppressed()).toBe(true);
        expect(traceApi.getTracer("prisma").startSpan("suppressed-before-await").isRecording()).toBe(false);
        await Promise.resolve();
        expect(isLibrarySpanBridgeTelemetrySuppressed()).toBe(true);
        expect(traceApi.getTracer("prisma").startSpan("suppressed-after-await").isRecording()).toBe(false);
      });

      expect(isLibrarySpanBridgeTelemetrySuppressed()).toBe(false);
      traceApi.getTracer("prisma").startSpan("recorded-outside-scope").end();
      expect(calls.map((call) => call.info.name)).toEqual(["recorded-outside-scope"]);
    });

    it("detaches internal delivery from the sampled trace being exported", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("next.js");

      await tracer.startActiveSpan("request-being-exported", async (requestSpan) => {
        expect(requestSpan.spanContext().traceFlags).toBe(1);

        await runWithLibrarySpanBridgeTelemetrySuppressedIfRegistered(async () => {
          expect(isLibrarySpanBridgeTelemetrySuppressed()).toBe(true);
          expect(traceApi.getSpan(contextApi.active())).toBeUndefined();

          // A framework may still open a non-recording span around the fetch.
          // It must not inherit sampled=1 and propagate that decision back to
          // the analytics endpoint, or the endpoint traces its own delivery
          // and bypasses the configured local trace sample rate forever.
          const deliverySpan = tracer.startSpan("analytics-batch-delivery");
          expect(deliverySpan.isRecording()).toBe(false);
          expect(deliverySpan.spanContext().traceFlags).toBe(0);
          deliverySpan.end();
        });

        requestSpan.end();
      });

      expect(calls.map((call) => call.info.name)).toEqual(["request-being-exported"]);
    });

    it("fails loud when collector suppression is entered before bridge registration", async () => {
      await expect(runWithLibrarySpanBridgeTelemetrySuppressed(async () => "never"))
        .rejects.toThrow(/requires the library-span bridge to be registered first/);
    });

    it("lets delivery run without suppression when the optional bridge was not registered", async () => {
      await expect(runWithLibrarySpanBridgeTelemetrySuppressedIfRegistered(async () => "sent"))
        .resolves.toBe("sent");
    });
  });

  describe("span identity + registry mapping", () => {
    it("adopts the identity the seam resolved, so the OTel context and the stored row agree", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const before = Date.now();
      const span = traceApi.getTracer("prisma").startSpan("client:operation");
      const spanContext = span.spanContext();
      expect(calls).toHaveLength(1);
      expect(calls[0].info).toMatchObject({ name: "client:operation", tracerName: "prisma", otelParent: null });
      expect(calls[0].info.startedAtMs).toBeGreaterThanOrEqual(before);
      expect(calls[0].info.startedAtMs).toBeLessThanOrEqual(Date.now());
      // The seam owns identity now (it mints the ids while resolving the parent),
      // so the bridge must echo them rather than derive its own — otherwise the
      // id a library reports and the id in ClickHouse would differ.
      expect(spanContext.traceId).toBe(calls[0].traceId);
      expect(spanContext.spanId).toBe(calls[0].spanId);
      expect(spanContext.traceFlags).toBe(1);
      span.end();
    });

    it("becomes non-recording (but stays API-complete) when the seam declines", async () => {
      const { deps } = makeFakeSeam({ decline: true });
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("prisma").startSpan("query");
      expect(span.isRecording()).toBe(false);
      // A non-recording span still needs a USABLE identity: library code may put
      // it in a traceparent, and an all-zero id would be rejected downstream.
      expect(isW3cTraceId(span.spanContext().traceId)).toBe(true);
      expect(isW3cSpanId(span.spanContext().spanId)).toBe(true);
      // None of these may throw into library code.
      span.setAttribute("db.system", "postgresql");
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.addEvent("ignored");
      span.end();
    });
  });

  describe("capture policy", () => {
    it("keeps the capture policy independently testable for the HMR-replaceable server seam", () => {
      expect(shouldIgnoreLibrarySpan("prisma", "prisma:client:compile")).toBe(false);
      expect(shouldIgnoreLibrarySpan("@prisma/instrumentation", "prisma:client:serialize")).toBe(false);
      expect(shouldIgnoreLibrarySpan("prisma", "prisma:client:db_query")).toBe(false);
      expect(shouldIgnoreLibrarySpan("next.js", "middleware GET")).toBe(false);
      expect(shouldIgnoreLibrarySpan("stack-tracer", "STACK: handling API request")).toBe(false);
      expect(shouldIgnoreLibrarySpan("stack-tracer", "STACK: validating smart request")).toBe(false);
      expect(shouldIgnoreLibrarySpan("stack-tracer", "STACK: wait(...)")).toBe(true);
    });

    it("records request work from Hexclave's internal tracer", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("stack-tracer");
      await tracer.startActiveSpan("STACK: handling API request", async (request) => {
        tracer.startSpan("STACK: validating smart request").end();
        request.end();
      });
      expect(calls.map((call) => call.info.name)).toEqual([
        "STACK: handling API request",
        "STACK: validating smart request",
      ]);
      expect(calls[1].parentSpanId).toBe(calls[0].spanId);
    });

    it("never records the retry timer from Hexclave's internal tracer (telemetry feedback-loop guard)", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      // wait() is used by delivery retries. Recording this one operation would
      // let every failed send mint the row that fills the next batch forever.
      const span = traceApi.getTracer("stack-tracer").startSpan("STACK: wait(...)");
      expect(span.isRecording()).toBe(false);
      span.end();
      expect(calls).toHaveLength(0);
    });

    it("records framework runtime spans from the next.js tracer", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const span = traceApi.getTracer("next.js").startSpan("middleware GET");
      expect(span.isRecording()).toBe(true);
      span.end();
      expect(calls.map((call) => call.info.name)).toEqual(["middleware GET"]);
    });

    it("keeps Prisma compile/serialize phases and their exact nesting", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      await tracer.startActiveSpan("prisma:client:operation", async (operation) => {
        await tracer.startActiveSpan("prisma:client:compile", async (compile) => {
          tracer.startSpan("prisma:client:db_query").end();
          compile.end();
        });
        tracer.startSpan("prisma:client:serialize").end();
        operation.end();
      });

      expect(calls.map((call) => call.info.name)).toEqual([
        "prisma:client:operation",
        "prisma:client:compile",
        "prisma:client:db_query",
        "prisma:client:serialize",
      ]);
      expect(calls[1].parentSpanId).toBe(calls[0].spanId);
      expect(calls[2].parentSpanId).toBe(calls[1].spanId);
      expect(calls[3].parentSpanId).toBe(calls[0].spanId);
    });

    it("does not drop similarly named phases from another library", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      traceApi.getTracer("custom-compiler").startSpan("prisma:client:compile").end();
      expect(calls.map((call) => call.info.name)).toEqual(["prisma:client:compile"]);
    });

    it("a recorded Next.js span carries Prisma into the same trace", async () => {
      const { calls, deps } = makeFakeSeam({ ambientParent: AMBIENT_PARENT });
      await registerLibrarySpanBridge(deps);
      await traceApi.getTracer("next.js").startActiveSpan("render route (app) /", async (outer) => {
        traceApi.getTracer("prisma").startSpan("client:operation").end();
        outer.end();
      });
      expect(calls.map((call) => call.info.name)).toEqual(["render route (app) /", "client:operation"]);
      expect(calls[0].parentSpanId).toBe(AMBIENT_PARENT.spanId);
      expect(calls[1].parentSpanId).toBe(calls[0].spanId);
      expect(calls[1].traceId).toBe(AMBIENT_PARENT.traceId);
    });

    it("an ignored internal span forwards its nearest recorded ancestor", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      await tracer.startActiveSpan("client:operation", async (recorded) => {
        await traceApi.getTracer("stack-tracer").startActiveSpan("STACK: wait(...) ", async (phantom) => {
          tracer.startSpan("engine:db_query").end();
          phantom.end();
        });
        recorded.end();
      });
      const [outer, inner] = calls;
      expect(calls.map((call) => call.info.name)).toEqual(["client:operation", "engine:db_query"]);
      // The registry re-registered the phantom's own nearest RECORDED ancestor
      // under the phantom's span id, so the grandchild names the Prisma span
      // rather than the unwritten Next.js one.
      expect(inner.info.otelParent).toEqual({ traceId: outer.traceId, recordedSpanId: outer.spanId, sampled: true, ambientSpanId: null });
      expect(inner.parentSpanId).toBe(outer.spanId);
      expect(inner.traceId).toBe(outer.traceId);
    });
  });

  describe("parenting", () => {
    it("startActiveSpan nesting survives await boundaries and keeps one coherent trace", async () => {
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
      // Arbitrary OTel nesting depth collapses to one scalar parent per level;
      // there is no ancestry array to compare any more, so trace coherence plus
      // the immediate parent IS the whole assertion.
      expect(middle.info.otelParent).toEqual({ traceId: outer.traceId, recordedSpanId: outer.spanId, sampled: true, ambientSpanId: null });
      expect(inner.info.otelParent).toEqual({ traceId: middle.traceId, recordedSpanId: middle.spanId, sampled: true, ambientSpanId: null });
      expect(new Set(calls.map((call) => call.traceId))).toEqual(new Set([outer.traceId]));
      expect(inner.parentSpanId).toBe(middle.spanId);
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
      expect(byName.get("a:inner")?.info.otelParent?.recordedSpanId).toBe(byName.get("a:outer")?.spanId);
      expect(byName.get("b:inner")?.info.otelParent?.recordedSpanId).toBe(byName.get("b:outer")?.spanId);
      // The two flows must also be two DISTINCT traces, not one merged blob.
      expect(byName.get("a:inner")?.traceId).not.toBe(byName.get("b:inner")?.traceId);
    });

    it("an explicit context argument wins over the active context", async () => {
      const { calls, deps } = makeFakeSeam();
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      const parent = tracer.startSpan("parent");
      const explicitContext = traceApi.setSpan(ROOT_CONTEXT, parent);
      const child = tracer.startSpan("child", undefined, explicitContext);
      expect(calls[1].info.otelParent?.recordedSpanId).toBe(calls[0].spanId);
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

    it("with no OTel parent, the seam's ambient context roots the span (contract case b)", async () => {
      const { calls, deps } = makeFakeSeam({ ambientParent: AMBIENT_PARENT });
      await registerLibrarySpanBridge(deps);
      const tracer = traceApi.getTracer("prisma");
      await tracer.startActiveSpan("outer", async (outer) => {
        tracer.startSpan("inner").end();
        outer.end();
      });
      // The outer span was handed otelParent null (the seam resolves ambient), so
      // it joins the ambient span's TRACE; the inner span then nests under the
      // outer one and inherits that same trace.
      expect(calls[0].info.otelParent).toBeNull();
      expect(calls[0].parentSpanId).toBe(AMBIENT_PARENT.spanId);
      expect(calls[0].traceId).toBe(AMBIENT_PARENT.traceId);
      expect(calls[1].parentSpanId).toBe(calls[0].spanId);
      expect(calls[1].traceId).toBe(AMBIENT_PARENT.traceId);
    });

    it("an extracted remote W3C span becomes the concrete cross-tier parent", async () => {
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
      expect(calls[0].info.otelParent).toEqual({
        traceId: "0123456789abcdef0123456789abcdef",
        recordedSpanId: "0123456789abcdef",
        sampled: true,
        ambientSpanId: null,
      });
      expect(calls[0].traceId).toBe("0123456789abcdef0123456789abcdef");
      expect(calls[0].parentSpanId).toBe("0123456789abcdef");
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

  describe("operation span type", () => {
    it("keeps valid library operation names and safely normalizes arbitrary OTel names", () => {
      expect(librarySpanTypeFromName("prisma:client:db_query")).toBe("prisma:client:db_query");
      expect(librarySpanTypeFromName("HTTP GET /users")).toBe("HTTP-GET-users");
      expect(librarySpanTypeFromName("123 query")).toBe("library.123-query");
      expect(librarySpanTypeFromName("☃")).toBe("library.operation");
      expect(librarySpanTypeFromName("a".repeat(100))).toBe("a".repeat(64));
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

    it("ships one operation-named library row with its instrumentation scope", async () => {
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

      let parentSpanId = "";
      let parentTraceId = "";
      await app.withSpan("db-stuff", async (span) => {
        parentSpanId = span.spanId;
        parentTraceId = span.traceId;
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
        const payload = JSON.parse(body) as { spans?: { trace_id: string, span_id: string, span_type: string, parent_span_id: string | null, started_at_ms: number, ended_at_ms: number | null, scope_name?: string, data: Record<string, unknown> }[] };
        return payload.spans ?? [];
      });
      const libSpan = spans.find((row) => row.span_type === "prisma:engine:db_query");
      expect(libSpan).not.toBeUndefined();
      // Nested under the ambient withSpan frame via contract case (b): same
      // trace, and the frame itself as the scalar parent.
      expect(libSpan?.trace_id).toBe(parentTraceId);
      expect(libSpan?.parent_span_id).toBe(parentSpanId);
      expect(libSpan?.ended_at_ms).not.toBeNull();
      expect(libSpan?.data["db.system"]).toBe("postgresql");
      expect(libSpan?.data["db.statement"]).toBeUndefined();
      expect(libSpan?.data.category).toBe("db");
      expect(libSpan?.data.name).toBe("prisma:engine:db_query");
      expect(libSpan?.data.tracer_name).toBe("prisma");
      expect(libSpan?.scope_name).toBe("prisma");
      // The withSpan frame itself shipped as a normal custom span, and — having
      // no enclosing context — is the ROOT of the trace, which is what puts it
      // in the trace inbox.
      const parentRow = spans.find((row) => row.span_type === "db-stuff" && row.span_id === parentSpanId);
      expect(parentRow).not.toBeUndefined();
      expect(parentRow?.parent_span_id).toBeNull();
      // Ids on the wire are W3C-shaped and never all-zero.
      for (const row of spans) {
        expect(isW3cTraceId(row.trace_id)).toBe(true);
        expect(isW3cSpanId(row.span_id)).toBe(true);
        if (row.parent_span_id !== null) expect(isW3cSpanId(row.parent_span_id)).toBe(true);
      }
    });

    it("preserves browser → Next.js → SDK → Prisma hierarchy in one W3C trace", async () => {
      const requests = stubAnalyticsFetch();
      const app = new StackServerApp({
        projectId: PROJECT_ID,
        publishableClientKey: "pck_test",
        secretServerKey: "ssk_test",
        baseUrl: "https://api.example.test",
        tokenStore: "memory",
        noAutomaticPrefetch: true,
        observability: { traceSampleRate: 0 },
        telemetry: { resource: { service: { name: "test-server" } } },
      });
      const instrumentation = getServerAppInstrumentation(app);
      expect(await instrumentation?.registerLibrarySpanBridge()).not.toBeNull();

      const traceId = "0123456789abcdef0123456789abcdef";
      const browserFetchSpanId = "1111111111111111";
      const remoteContext = traceApi.setSpanContext(ROOT_CONTEXT, {
        traceId,
        spanId: browserFetchSpanId,
        traceFlags: 1,
        isRemote: true,
      });
      const nextTracer = traceApi.getTracer("next.js");
      const prismaTracer = traceApi.getTracer("prisma");

      await contextApi.with(remoteContext, async () => {
        await nextTracer.startActiveSpan("GET", async (nextSpan) => {
          await app.withSpan("hexclave.api.request", async () => {
            await prismaTracer.startActiveSpan("prisma:client:operation", async (operation) => {
              prismaTracer.startSpan("prisma:client:compile").end();
              operation.end();
            });
          });
          nextSpan.end();
        });
      });
      await app.flush();

      const spans = requests
        .filter((request) => request.url.includes("analytics"))
        .flatMap((request) => {
          const payload = JSON.parse(request.body) as { spans?: { trace_id: string, span_id: string, span_type: string, parent_span_id: string | null }[] };
          return payload.spans ?? [];
        });
      const byType = new Map(spans.map((span) => [span.span_type, span]));
      const nextSpan = byType.get("GET");
      const sdkSpan = byType.get("hexclave.api.request");
      const operation = byType.get("prisma:client:operation");
      const compile = byType.get("prisma:client:compile");
      if (nextSpan === undefined || sdkSpan === undefined || operation === undefined || compile === undefined) {
        throw new Error(`Expected complete cross-tier tree, received: ${[...byType.keys()].join(", ")}`);
      }

      expect(nextSpan.parent_span_id).toBe(browserFetchSpanId);
      expect(sdkSpan.parent_span_id).toBe(nextSpan.span_id);
      expect(operation.parent_span_id).toBe(sdkSpan.span_id);
      expect(compile.parent_span_id).toBe(operation.span_id);
      expect(new Set(spans.map((span) => span.trace_id))).toEqual(new Set([traceId]));
    });
  });
});
