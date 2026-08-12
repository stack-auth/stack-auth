import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { isTracingSuppressed } from "@opentelemetry/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isTelemetryIngestionPath, runWithInternalRequestObservability } from "./internal-observability";
import { resolveCustomerRequestObservability } from "./customer-request-observability";
import { encodeSpanContextHeader, SPAN_CONTEXT_HEADER } from "@hexclave/shared/dist/utils/span-context-codec";

const state = vi.hoisted(() => {
  const setData = vi.fn(async () => {});
  const end = vi.fn(async () => {});
  const addTrustedBackendSpanLink = vi.fn(async () => {});
  const trustedWriter = Symbol.for("hexclave.analytics.trusted-span-link-writer.v1");
  const span = {
    setData,
    end,
    run: vi.fn(async (fn: () => Promise<Response>) => await fn()),
    [trustedWriter]: addTrustedBackendSpanLink,
  };
  const startSpan = vi.fn(() => span);
  const runWithTelemetrySuppressed = vi.fn(async (fn: () => Promise<Response>) => await fn());
  return { addTrustedBackendSpanLink, end, runWithTelemetrySuppressed, setData, span, startSpan };
});

vi.mock("@/hexclave", () => ({
  getHexclaveServerApp: () => ({ startSpan: state.startSpan }),
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
    expect(state.startSpan).not.toHaveBeenCalled();
  });

  it("roots the internal request trace instead of adopting the incoming W3C parent", async () => {
    const request = new Request("http://localhost:8102/api/latest/users?secret=never-record-this", {
      method: "GET",
      headers: {
        traceparent: "00-0123456789abcdef0123456789abcdef-fedcba9876543210-01",
      },
    });
    const response = await runWithInternalRequestObservability(request, "request-2", async () => new Response(null, { status: 503 }));

    expect(response.status).toBe(503);
    expect(state.startSpan).toHaveBeenCalledWith("hexclave.api.request", {
      root: true,
      data: {
        request_id: "request-2",
        method: "GET",
        path: "/api/latest/users",
      },
    });
    expect(state.setData).toHaveBeenCalledWith({ status_code: 503, error: "HTTP 503" });
    expect(state.end).toHaveBeenCalledOnce();
  });

  it("links the internal request span to the authenticated customer client span", async () => {
    const request = new Request("http://localhost:8102/api/latest/users", {
      method: "GET",
      headers: {
        traceparent: "00-0123456789abcdef0123456789abcdef-fedcba9876543210-01",
        [SPAN_CONTEXT_HEADER]: encodeSpanContextHeader({ projectId: "customer-project" }),
      },
    });
    await runWithInternalRequestObservability(request, "request-3", async () => {
      resolveCustomerRequestObservability({
        projectId: "customer-project",
        branchId: "main",
        userId: "user",
        refreshTokenId: "refresh",
        headers: request.headers,
      });
      return new Response(null, { status: 200 });
    });

    expect(state.addTrustedBackendSpanLink).toHaveBeenCalledWith({
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "fedcba9876543210",
      linkedProjectId: "customer-project",
      linkedBranchId: "main",
    });
  });

  it("links an internal-dashboard client span without relying on ambient parent resolution", async () => {
    const request = new Request("http://localhost:8102/api/latest/users", {
      method: "GET",
      headers: {
        traceparent: "00-cccccccccccccccccccccccccccccccc-dddddddddddddddd-01",
        [SPAN_CONTEXT_HEADER]: encodeSpanContextHeader({ projectId: "internal" }),
      },
    });
    await runWithInternalRequestObservability(request, "request-internal", async () => {
      resolveCustomerRequestObservability({
        projectId: "internal",
        branchId: "main",
        userId: "user",
        refreshTokenId: "refresh",
        headers: request.headers,
      });
      return new Response(null, { status: 200 });
    });

    expect(state.addTrustedBackendSpanLink).toHaveBeenCalledWith({
      traceId: "cccccccccccccccccccccccccccccccc",
      spanId: "dddddddddddddddd",
      linkedProjectId: "internal",
      linkedBranchId: "main",
    });
  });

  it("keeps the verified customer link when the request handler throws", async () => {
    const request = new Request("http://localhost:8102/api/latest/users", {
      method: "GET",
      headers: {
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        [SPAN_CONTEXT_HEADER]: encodeSpanContextHeader({ projectId: "customer-project" }),
      },
    });

    await expect(runWithInternalRequestObservability(request, "request-4", async () => {
      resolveCustomerRequestObservability({
        projectId: "customer-project",
        branchId: "main",
        userId: "user",
        refreshTokenId: "refresh",
        headers: request.headers,
      });
      throw new Error("handler failed after authentication");
    })).rejects.toThrow("handler failed after authentication");

    expect(state.addTrustedBackendSpanLink).toHaveBeenCalledWith({
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      linkedProjectId: "customer-project",
      linkedBranchId: "main",
    });
  });
});
