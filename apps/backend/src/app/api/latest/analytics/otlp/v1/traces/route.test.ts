import type { OtlpTenantContext } from "@/lib/otlp/trace-writer";
import type { CanonicalOtlpSpan } from "@/lib/otlp/traces";
import { describe, expect, it } from "vitest";
import { createErrorIngestPolicyStateStore, evaluateErrorIngestPolicy } from "@/lib/error-ingest";
import { createOtlpTraceProtocolProjection } from "@/lib/error-ingest/error-ingest-protocol-projections";

const tenant: OtlpTenantContext = {
  projectId: "project-1",
  branchId: "branch-1",
  userId: null,
  refreshTokenId: null,
};

function span(traceId: string, spanId: string): CanonicalOtlpSpan {
  return {
    traceId,
    spanId,
    traceState: "",
    parentSpanId: null,
    flags: 0,
    name: "Authorization: Bearer secret-value",
    kind: 0,
    startTimeUnixNano: "1720000000000000000",
    endTimeUnixNano: "1720000001000000000",
    attributes: new Map(),
    droppedAttributesCount: 0,
    events: [],
    droppedEventsCount: 0,
    links: [],
    droppedLinksCount: 0,
    status: { code: 0, message: "" },
    resource: {
      attributes: new Map(),
      droppedAttributesCount: 0,
      schemaUrl: "",
    },
    scope: {
      name: "test",
      version: "1",
      attributes: new Map(),
      droppedAttributesCount: 0,
      schemaUrl: "",
    },
  };
}

describe("OTLP traces protocol boundary", () => {
  it("uses the writer identity as the retry-stable accepted projection", () => {
    const spans = [span("11111111111111111111111111111111", "2222222222222222")];
    const first = createOtlpTraceProtocolProjection(spans, tenant);
    const retry = createOtlpTraceProtocolProjection(spans, tenant);

    expect(first.status).toBe("accepted");
    expect(first.items).toEqual([
      expect.objectContaining({
        itemId: "span:11111111111111111111111111111111:2222222222222222",
        itemType: "span",
        status: "accepted",
        rejectedByOtlp: false,
      }),
    ]);
    expect(first.otlpPartialSuccess.traces).toEqual({ rejectedItems: 0, body: {} });
    expect(first.clientReport).toEqual({
      discarded_events: [],
      rate_limited_events: [],
      filtered_events: [],
      filtered_sampling_events: [],
    });
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(JSON.stringify(first)).not.toContain("secret-value");
  });

  it("projects deterministic quota rejection through OTLP partial success and client reports", () => {
    const spans = [span("11111111111111111111111111111111", "2222222222222222")];
    const policy = evaluateErrorIngestPolicy({
      config: { observability: { errorIngest: { quota: { maxBytesPerWindow: 1, windowSeconds: 60 } } } },
      scope: { tenancyId: "tenancy-1", projectId: tenant.projectId, branchId: tenant.branchId },
      items: [{ itemId: "span:11111111111111111111111111111111:2222222222222222", itemType: "span", data: { message: "span" } }],
      nowMs: 60_000,
      stateStore: createErrorIngestPolicyStateStore(),
    });
    const projection = createOtlpTraceProtocolProjection(spans, tenant, policy.outcomes);

    expect(policy.outcomes[0]).toMatchObject({ status: "rate_limited", reason: "quota" });
    expect(projection.otlpPartialSuccess.traces).toEqual({
      rejectedItems: 1,
      body: { partialSuccess: { rejectedSpans: "1", errorMessage: "error ingest rejected 1 item(s): rate_limited=1" } },
    });
    expect(projection.clientReport.rate_limited_events).toEqual([{ category: "span", reason: "quota", quantity: 1 }]);
  });
});
