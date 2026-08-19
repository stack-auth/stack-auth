import {
  createErrorIngestItemOutcome,
  createErrorIngestProtocolProjection,
  type ErrorIngestItemDescriptor,
  type ErrorIngestItemOutcomeDetails,
  type ErrorIngestProtocolProjection,
} from "@/lib/error-ingest";
import { getOtlpIssueBatchId } from "@/lib/otlp/log-writer";
import type { CanonicalOtlpLogRecord } from "@/lib/otlp/logs";
import { getOtlpTraceDeduplicationToken, type OtlpTenantContext } from "@/lib/otlp/trace-writer";
import type { CanonicalOtlpSpan } from "@/lib/otlp/traces";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import type { ErrorIngestPolicyItemOutcome } from "./error-ingest-policy";

/**
 * Policy decisions are occurrence-scoped, not W3C-identity-scoped. Exporters
 * may repeat the same trace/span identity in one request, and one occurrence
 * must not inherit another occurrence's acceptance or scrubbed payload.
 */
export function otlpSpanPolicyItemId(span: Pick<CanonicalOtlpSpan, "traceId" | "spanId">, index: number): string {
  return `span:${index}:${span.traceId}:${span.spanId}`;
}

function policyDetails(outcome: ErrorIngestPolicyItemOutcome): ErrorIngestItemOutcomeDetails {
  switch (outcome.status) {
    case "accepted": { return { status: "accepted" }; }
    case "rate_limited": { return { status: "rate_limited", reason: outcome.reason, retryAfterMs: outcome.retryAfterMs }; }
    case "rejected": { return { status: "rejected", reason: outcome.reason }; }
    case "filtered": { return { status: "filtered", reason: outcome.reason }; }
    case "deduplicated": { return { status: "deduplicated", canonicalItemId: outcome.canonicalItemId }; }
    case "dropped": { return { status: "dropped", reason: outcome.reason }; }
    case "queued": { return { status: "queued", reason: outcome.reason, retryAfterMs: outcome.retryAfterMs }; }
  }
}

/**
 * OTLP has no standard response field for Relay client reports or item
 * descriptors. Keep those projections at the protocol-neutral seam and use
 * only its standard partial-success view in the HTTP response.
 */
export function createOtlpLogProtocolProjection(
  logRecords: CanonicalOtlpLogRecord[],
  acceptedIndexes: ReadonlySet<number>,
  tenant: OtlpTenantContext,
  policyOutcomes?: readonly ErrorIngestPolicyItemOutcome[],
): ErrorIngestProtocolProjection {
  const policyByItemId = new Map(policyOutcomes?.map((outcome) => [outcome.itemId, outcome]));
  const outcomes = logRecords.map((logRecord, itemIndex) => {
    const item: ErrorIngestItemDescriptor = {
      itemId: `log:${itemIndex}`,
      itemType: "log",
    };
    if (logRecord.errorEnvelope?.eventId != null) item.eventId = logRecord.errorEnvelope.eventId;

    const policyOutcome = policyByItemId.get(item.itemId);
    if (policyOutcome !== undefined) {
      return createErrorIngestItemOutcome(item, policyDetails(policyOutcome));
    }
    if (acceptedIndexes.has(itemIndex)) {
      return createErrorIngestItemOutcome(item, { status: "accepted" });
    }
    return createErrorIngestItemOutcome(item, { status: "rejected", reason: "invalid" });
  });

  return createErrorIngestProtocolProjection(getOtlpIssueBatchId(logRecords, tenant), outcomes);
}

/**
 * OTLP trace normalization is currently request-shaped: a malformed span
 * aborts normalization before the writer receives any rows. The accepted
 * projection still records the stable span identities and writer dedup token
 * without pretending that a storage-level retry was observable as a separate
 * per-span outcome.
 */
export function createOtlpTraceProtocolProjection(
  spans: CanonicalOtlpSpan[],
  tenant: OtlpTenantContext,
  policyOutcomes?: readonly ErrorIngestPolicyItemOutcome[],
): ErrorIngestProtocolProjection {
  // Match policy outcomes by position. An ID-keyed map would collapse
  // duplicate W3C identities onto the last outcome and misreport
  // partial-success and client-report counts.
  if (policyOutcomes !== undefined && policyOutcomes.length !== spans.length) {
    throw new HexclaveAssertionError("OTLP trace policy outcomes must be one-per-span in span order");
  }
  const outcomes = spans.map((span, spanIndex) => {
    const item: ErrorIngestItemDescriptor = {
      itemId: otlpSpanPolicyItemId(span, spanIndex),
      itemType: "span",
    };
    const policyOutcome = policyOutcomes?.[spanIndex];
    if (policyOutcome === undefined) return createErrorIngestItemOutcome(item, { status: "accepted" });
    if (policyOutcome.itemId !== item.itemId) {
      throw new HexclaveAssertionError("OTLP trace policy outcome order does not match the span order");
    }
    return createErrorIngestItemOutcome(item, policyDetails(policyOutcome));
  });
  return createErrorIngestProtocolProjection(getOtlpTraceDeduplicationToken(spans, tenant), outcomes);
}
