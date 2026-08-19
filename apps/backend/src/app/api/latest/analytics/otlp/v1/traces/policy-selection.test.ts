import { createErrorIngestPolicyStateStore, evaluateErrorIngestPolicy } from "@/lib/error-ingest";
import { getOtlpSpanPolicyData } from "@/lib/otlp/trace-writer";
import type { CanonicalOtlpSpan } from "@/lib/otlp/traces";
import { describe, expect, it } from "vitest";
import { otlpSpanPolicyItemId, selectOtlpSpansAcceptedByPolicy } from "./policy-selection";

function span(name: string): CanonicalOtlpSpan {
  return {
    traceId: "11111111111111111111111111111111",
    spanId: "2222222222222222",
    traceState: "",
    parentSpanId: null,
    flags: 0,
    name,
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
    resource: { attributes: new Map(), droppedAttributesCount: 0, schemaUrl: "" },
    scope: { name: "test", version: "1", attributes: new Map(), droppedAttributesCount: 0, schemaUrl: "" },
  };
}

describe("OTLP trace policy selection", () => {
  it("does not grant one accepted duplicate identity to a rejected occurrence", () => {
    const spans = [span("first"), span("second")];
    const policy = evaluateErrorIngestPolicy({
      config: { observability: { errorIngest: { rateLimit: { maxItemsPerWindow: 1, windowSeconds: 60 } } } },
      scope: { tenancyId: "tenancy-1", projectId: "project-1", branchId: "branch-1" },
      items: spans.map((item, index) => ({
        itemId: otlpSpanPolicyItemId(item, index),
        itemType: "span",
        data: getOtlpSpanPolicyData(item),
      })),
      nowMs: 60_000,
      stateStore: createErrorIngestPolicyStateStore(),
    });

    expect(policy.outcomes.map((outcome) => outcome.status)).toEqual(["accepted", "rate_limited"]);
    expect(selectOtlpSpansAcceptedByPolicy(spans, policy).map((item) => item.name)).toEqual(["first"]);
  });
});
