import { encodeSpanContextHeader } from "@hexclave/shared/dist/utils/span-context-codec";
import { SpanKind } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AnalyticsSpanExporter, groupSpansByTenancy, type AnalyticsSpanExportGroup } from "./self-telemetry-span-exporter";
import {
  TenancyRecordingSpanProcessor,
  getRecordedTenancy,
  resolveTelemetryTenancy,
  runWithTelemetryTenancyHolder,
  scrubSpanForCustomer,
  type ResolvedTelemetryTenancy,
} from "./self-telemetry-tenancy";

function headersOf(record: Record<string, string>): { get: (name: string) => string | null } {
  return { get: (name) => record[name.toLowerCase()] ?? null };
}

function makeProvider(exporter: InMemorySpanExporter | AnalyticsSpanExporter) {
  const provider = new BasicTracerProvider({ resource: new Resource({ "service.name": "tenancy-test" }) });
  provider.addSpanProcessor(new TenancyRecordingSpanProcessor());
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  return provider;
}

describe("resolveTelemetryTenancy + TenancyRecordingSpanProcessor", () => {
  it("attributes spans started before AND after resolution to the request's project", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = makeProvider(exporter);
    const tracer = provider.getTracer("test");

    await runWithTelemetryTenancyHolder(async () => {
      // Mimics an auth-time span that ENDS before parseAuth resolves — the
      // holder cell is shared, so it still attributes correctly at read time.
      const early = tracer.startSpan("validating smart request", { kind: SpanKind.INTERNAL });
      early.end();

      resolveTelemetryTenancy({
        projectId: "proj-123",
        branchId: "main",
        userId: "11111111-1111-4111-8111-111111111111",
        refreshTokenId: "22222222-2222-4222-8222-222222222222",
        headers: headersOf({}),
      });

      const late = tracer.startSpan("handler", { kind: SpanKind.SERVER });
      late.end();
    });

    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      const tenancy = getRecordedTenancy(span);
      expect(tenancy?.projectId).toBe("proj-123");
      expect(tenancy?.userId).toBe("11111111-1111-4111-8111-111111111111");
    }
    await provider.shutdown();
  });

  it("accepts header labels only when the header's project matches the authenticated project", () => {
    const sessionReplayId = randomUUID();
    const httpClientSpanId = randomUUID();
    const matching = encodeSpanContextHeader({ projectId: "proj-123", sessionReplayId, httpClientSpanId });
    const foreign = encodeSpanContextHeader({ projectId: "someone-else", sessionReplayId });

    const resolveWithHeader = async (headerValue: string): Promise<ResolvedTelemetryTenancy | null> => {
      let recorded: ResolvedTelemetryTenancy | null = null;
      const exporter = new InMemorySpanExporter();
      const provider = makeProvider(exporter);
      return await runWithTelemetryTenancyHolder(async () => {
        resolveTelemetryTenancy({
          projectId: "proj-123",
          branchId: "main",
          userId: null,
          refreshTokenId: null,
          headers: headersOf({ "x-hexclave-span-context": headerValue }),
        });
        const span = provider.getTracer("test").startSpan("s");
        span.end();
        await provider.forceFlush();
        recorded = getRecordedTenancy(exporter.getFinishedSpans()[0]);
        await provider.shutdown();
        return recorded;
      });
    };

    return (async () => {
      const accepted = await resolveWithHeader(matching);
      expect(accepted?.sessionReplayId).toBe(sessionReplayId);
      expect(accepted?.httpClientSpanId).toBe(httpClientSpanId);

      const rejected = await resolveWithHeader(foreign);
      expect(rejected?.projectId).toBe("proj-123");
      expect(rejected?.sessionReplayId).toBeNull();
      expect(rejected?.httpClientSpanId).toBeNull();
    })();
  });

  it("throws on double-resolve with a different project and no-ops outside a holder", async () => {
    // Outside any holder: silently ignored (background loops, tests).
    expect(() => resolveTelemetryTenancy({
      projectId: "proj-a",
      branchId: "main",
      userId: null,
      refreshTokenId: null,
      headers: headersOf({}),
    })).not.toThrow();

    await runWithTelemetryTenancyHolder(async () => {
      const resolve = (projectId: string) => resolveTelemetryTenancy({
        projectId,
        branchId: "main",
        userId: null,
        refreshTokenId: null,
        headers: headersOf({}),
      });
      resolve("proj-a");
      expect(() => resolve("proj-a")).not.toThrow();
      expect(() => resolve("proj-b")).toThrow("already resolved to a different project");
    });
  });
});

describe("tenant fan-out grouping", () => {
  it("splits an export batch into per-tenant groups plus the unresolved group", async () => {
    const groupsSeen: AnalyticsSpanExportGroup[][] = [];
    const exporter = new AnalyticsSpanExporter(async (groups) => {
      groupsSeen.push(groups);
    });
    const provider = makeProvider(exporter);
    const tracer = provider.getTracer("test");

    // One span with no tenancy at all...
    const orphan = tracer.startSpan("background-loop");
    orphan.end();
    // ...and two spans inside a resolved request.
    await runWithTelemetryTenancyHolder(async () => {
      resolveTelemetryTenancy({
        projectId: "proj-xyz",
        branchId: "main",
        userId: null,
        refreshTokenId: null,
        headers: headersOf({}),
      });
      tracer.startSpan("request").end();
      tracer.startSpan("db").end();
    });

    await provider.forceFlush();
    // SimpleSpanProcessor exports each span as its own batch, so aggregate the
    // per-call groups by tenancy before asserting.
    const namesByProject = new Map<string | null, string[]>();
    for (const group of groupsSeen.flat()) {
      const key = group.tenancy?.projectId ?? null;
      namesByProject.set(key, [...namesByProject.get(key) ?? [], ...group.spans.map((span) => span.span_type)]);
    }
    expect(namesByProject.get(null)).toEqual(["background-loop"]);
    expect(namesByProject.get("proj-xyz")?.sort()).toEqual(["db", "request"]);
    await provider.shutdown();
  });

  it("groupSpansByTenancy handles an empty export batch", () => {
    expect(groupSpansByTenancy([])).toEqual([]);
  });
});

describe("scrubSpanForCustomer", () => {
  it("keeps only allowlisted data keys and empties resource/event blobs", () => {
    const scrubbed = scrubSpanForCustomer({
      trace_id: "1".repeat(32),
      span_id: "2".repeat(16),
      span_type: "prisma:engine:db_query",
      started_at: new Date(0),
      ended_at: new Date(1),
      parent_span_ids: [],
      kind: "client",
      status_code: "ok",
      status_message: null,
      service_namespace: null,
      service_name: "stack-backend",
      service_version: null,
      service_instance_id: null,
      deployment_environment_name: null,
      resource_attributes: JSON.stringify({ "host.name": "secret-host", "process.pid": 42 }),
      scope_name: null,
      scope_version: null,
      data: JSON.stringify({
        "db.statement": "SELECT * FROM users WHERE secret = 'hunter2'",
        "db.system": "postgresql",
        "http.request.method": "POST",
        "stack.request.request-id": "abc",
      }),
      producer: "hexclave-backend",
      events: [{ name: "exception", at: new Date(0), data: { "exception.stacktrace": "at internalSecretFn (...)" } }],
      links: [],
      version: 1,
    });

    expect(JSON.parse(scrubbed.data)).toEqual({ "db.system": "postgresql", "http.request.method": "POST" });
    expect(scrubbed.resource_attributes).toBe("{}");
    expect(scrubbed.events).toEqual([{ name: "exception", at: new Date(0), data: {} }]);
    // Service identity survives via its dedicated column.
    expect(scrubbed.service_name).toBe("stack-backend");
  });
});
