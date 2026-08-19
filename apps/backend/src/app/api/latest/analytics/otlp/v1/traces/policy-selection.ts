import type { ErrorIngestPolicyDecision } from "@/lib/error-ingest/error-ingest-policy";
import type { CanonicalOtlpSpan } from "@/lib/otlp/traces";

/**
 * Policy decisions are occurrence-scoped, not W3C-identity-scoped. Exporters
 * may repeat the same trace/span identity in one request, and one occurrence
 * must not inherit another occurrence's acceptance or scrubbed payload.
 */
export function otlpSpanPolicyItemId(span: CanonicalOtlpSpan, index: number): string {
  return `span:${index}:${span.traceId}:${span.spanId}`;
}

export function selectOtlpSpansAcceptedByPolicy(
  spans: readonly CanonicalOtlpSpan[],
  policy: ErrorIngestPolicyDecision,
): CanonicalOtlpSpan[] {
  const acceptedItemIds = new Set(policy.acceptedItemIds);
  return spans.flatMap((span, index) => {
    const itemId = otlpSpanPolicyItemId(span, index);
    if (!acceptedItemIds.has(itemId)) return [];
    const scrubbedData = policy.scrubbedData.get(itemId);
    return [scrubbedData === undefined ? span : { ...span, policyScrubbedData: scrubbedData }];
  });
}
