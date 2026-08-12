import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { isTracingSuppressed } from "@opentelemetry/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isTelemetryIngestionPath, runWithInternalRequestObservability } from "./internal-observability";

const state = vi.hoisted(() => {
  const setData = vi.fn(async () => {});
  const withSpan = vi.fn(async (_type: string, _options: unknown, fn: (span: { setData: typeof setData }) => Promise<Response>) => await fn({ setData }));
  const runWithTelemetrySuppressed = vi.fn(async (fn: () => Promise<Response>) => await fn());
  return { runWithTelemetrySuppressed, setData, withSpan };
});

vi.mock("@/hexclave", () => ({
  getHexclaveServerApp: () => ({ withSpan: state.withSpan }),
}));

vi.mock("./node-telemetry-suppression", () => ({
  runWithNodeTelemetrySuppressed: state.runWithTelemetrySuppressed,
}));

describe("internal backend observability", () => {
  beforeAll(() => {
    // Production gets this context manager from the SDK's hidden OTel bridge.
    // Install the standard equivalent here so the test exercises suppression
    // across the async callback instead of the OTel API's no-op default.
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    context.disable();
  });

  it.each([
    "/api/latest/analytics/events/batch",
    "/api/v1/analytics/events/batch",
    "/api/latest/session-replays/batch",
    "/api/v1/session-replays/batch",
  ])("recognizes the exact recursive ingestion path %s", (pathname) => {
    expect(isTelemetryIngestionPath(pathname)).toBe(true);
    expect(isTelemetryIngestionPath(`${pathname}/extra`)).toBe(false);
  });

  it("suppresses Prisma/OTel instrumentation while handling telemetry ingestion", async () => {
    const request = new Request("http://localhost:8102/api/v1/analytics/events/batch", { method: "POST" });
    let suppressed = false;
    const response = await runWithInternalRequestObservability(request, "request-1", async () => {
      suppressed = isTracingSuppressed(context.active());
      return new Response(null, { status: 202 });
    });

    expect(response.status).toBe(202);
    expect(suppressed).toBe(true);
    expect(state.runWithTelemetrySuppressed).toHaveBeenCalledOnce();
    expect(state.withSpan).not.toHaveBeenCalled();
  });

  it("joins an incoming W3C trace without attributing the customer session to the internal project", async () => {
    const request = new Request("http://localhost:8102/api/latest/users?secret=never-record-this", {
      method: "GET",
      headers: {
        traceparent: "00-0123456789abcdef0123456789abcdef-fedcba9876543210-01",
      },
    });
    const response = await runWithInternalRequestObservability(request, "request-2", async () => new Response(null, { status: 503 }));

    expect(response.status).toBe(503);
    expect(state.withSpan).toHaveBeenCalledWith("hexclave.api.request", {
      request,
      data: {
        request_id: "request-2",
        method: "GET",
        path: "/api/latest/users",
      },
    }, expect.any(Function));
    expect(state.setData).toHaveBeenCalledWith({ status_code: 503, error: "HTTP 503" });
  });
});
