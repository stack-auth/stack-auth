import { formatTraceparent, isW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { encodeSpanContextHeader, SPAN_CONTEXT_HEADER } from "@hexclave/shared/dist/utils/span-context-codec";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { getVerifiedCustomerRequestLinkTarget, resolveCustomerRequestObservability, runWithCustomerRequestObservability } from "./customer-request-observability";
import type { SpanInsertRow } from "./spans";

function request(options: {
  path?: string,
  traceparent?: string,
  spanContextProjectId?: string,
} = {}): NextRequest {
  const headers = new Headers();
  if (options.traceparent !== undefined) headers.set("traceparent", options.traceparent);
  if (options.spanContextProjectId !== undefined) {
    headers.set(SPAN_CONTEXT_HEADER, encodeSpanContextHeader({ projectId: options.spanContextProjectId }));
  }
  return new NextRequest(`http://localhost${options.path ?? "/api/v1/auth/oauth/token"}`, {
    method: "POST",
    headers,
  });
}

describe("customer request observability", () => {
  it("writes a scrubbed customer span under the incoming W3C parent and supports late refresh-token enrichment", async () => {
    const traceId = "11111111111111111111111111111111";
    const parentSpanId = "2222222222222222";
    const rows: SpanInsertRow[] = [];
    const writer = vi.fn(async (row: SpanInsertRow) => {
      rows.push(row);
    });

    const response = await runWithCustomerRequestObservability(
      request({
        traceparent: formatTraceparent({ traceId, spanId: parentSpanId, sampled: true }),
        spanContextProjectId: "project",
      }),
      async () => {
        resolveCustomerRequestObservability({
          projectId: "project",
          branchId: "main",
          userId: null,
          refreshTokenId: null,
          headers: { get: (name) => name.toLowerCase() === SPAN_CONTEXT_HEADER ? encodeSpanContextHeader({ projectId: "project" }) : null },
        });
        expect(getVerifiedCustomerRequestLinkTarget()).toEqual({
          traceId,
          spanId: parentSpanId,
          projectId: "project",
          branchId: "main",
        });
        // OAuth refresh grant identity is verified only after the route has
        // validated the refresh token, later than ordinary request auth.
        resolveCustomerRequestObservability({
          projectId: "project",
          branchId: "main",
          userId: "user",
          refreshTokenId: "refresh",
        });
        return new Response(null, { status: 201 });
      },
      writer,
    );

    expect(response.status).toBe(201);
    expect(writer).toHaveBeenCalledOnce();
    expect(rows[0]).toMatchObject({
      trace_id: traceId,
      parent_span_id: parentSpanId,
      span_type: "hexclave.api.request",
      kind: "server",
      producer: "hexclave-backend",
      project_id: "project",
      branch_id: "main",
      user_id: "user",
      refresh_token_id: "refresh",
      data: JSON.stringify({ method: "POST", status_code: 201 }),
    });
    expect(rows[0]?.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(rows[0]?.resource_attributes).toBe("{}");
  });

  // A parent span id is only meaningful to a project that can actually see that
  // span. Inheriting either half of a foreign edge would make the row an orphan
  // or one of many disconnected roots in the caller's trace, so both the parent
  // and trace id are replaced together.
  it.each([
    { name: "another project's caller", spanContextProjectId: "other-project", sampled: true },
    { name: "a caller that sent no span-context header", spanContextProjectId: undefined, sampled: true },
    { name: "an unsampled caller", spanContextProjectId: "project", sampled: false },
  ])("starts a fresh rooted trace for $name", async ({ sampled, spanContextProjectId }) => {
    const traceId = "33333333333333333333333333333333";
    const rows: SpanInsertRow[] = [];
    const writer = vi.fn(async (row: SpanInsertRow) => {
      rows.push(row);
    });

    const incoming = request({
      traceparent: formatTraceparent({ traceId, spanId: "4444444444444444", sampled }),
      ...spanContextProjectId === undefined ? {} : { spanContextProjectId },
    });
    await runWithCustomerRequestObservability(
      incoming,
      async () => {
        resolveCustomerRequestObservability({
          projectId: "project",
          branchId: "main",
          userId: null,
          refreshTokenId: null,
          headers: incoming.headers,
        });
        return new Response(null, { status: 200 });
      },
      writer,
    );

    expect(rows[0]?.parent_span_id).toBeNull();
    expect(rows[0]?.trace_id).not.toBe(traceId);
    expect(isW3cTraceId(rows[0]?.trace_id)).toBe(true);
  });

  // internal-observability already writes a richer span with the same name into
  // the same trace for this tenancy; two of them rendered as duplicate siblings
  // under every fetch in our own dashboard.
  it("does not duplicate the internal project's own detailed request span", async () => {
    const writer = vi.fn(async (_row: SpanInsertRow) => {});

    await runWithCustomerRequestObservability(
      request(),
      async () => {
        resolveCustomerRequestObservability({
          projectId: "internal",
          branchId: "main",
          userId: "user",
          refreshTokenId: "refresh",
        });
        return new Response(null, { status: 200 });
      },
      writer,
    );

    expect(writer).not.toHaveBeenCalled();
  });

  it("does not write an unauthenticated or telemetry-ingestion request", async () => {
    const writer = vi.fn(async (_row: SpanInsertRow) => {});

    await runWithCustomerRequestObservability(
      request(),
      async () => new Response(null, { status: 401 }),
      writer,
    );
    await runWithCustomerRequestObservability(
      request({ path: "/api/v1/analytics/events/batch" }),
      async () => {
        resolveCustomerRequestObservability({
          projectId: "project",
          branchId: "main",
          userId: "user",
          refreshTokenId: "refresh",
        });
        return new Response(null, { status: 200 });
      },
      writer,
    );

    expect(writer).not.toHaveBeenCalled();
  });

  it("rejects cross-project mutation of one request holder", async () => {
    await expect(runWithCustomerRequestObservability(
      request(),
      async () => {
        resolveCustomerRequestObservability({
          projectId: "project-a",
          branchId: "main",
          userId: null,
          refreshTokenId: null,
        });
        resolveCustomerRequestObservability({
          projectId: "project-b",
          branchId: "main",
          userId: null,
          refreshTokenId: null,
        });
        return new Response();
      },
    )).rejects.toThrow("tenancy changed");
  });
});
