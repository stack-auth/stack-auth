import type { GroupingHashProvenance } from "./types";

/**
 * JSON shape persisted outside the grouping implementation. The snake-case
 * keys are intentional: this is shared by the Postgres issue-hash ledger, the
 * ClickHouse occurrence read model, and the public occurrence projection.
 * Keeping one bounded shape at this boundary prevents each layer from inventing
 * a slightly different explanation for the same Sentry-style decision.
 */
export type DurableGroupingHashProvenance = {
  hash: string,
  role: "primary" | "secondary",
  config_id: string,
  variant: string,
  fingerprint: {
    type: string,
    source: string,
    tokens: string[],
    resolved_tokens: string[],
  },
};

/**
 * A transition currently has one primary and a small readable secondary set.
 * This bound is deliberately independent of the event payload cap: it protects
 * the durable issue/hash row if a future grouping implementation exposes more
 * variants than the current app/system pair.
 */
export const MAX_GROUPING_PROVENANCE_ENTRIES = 16;

export function toDurableGroupingProvenance(
  provenance: readonly GroupingHashProvenance[],
): DurableGroupingHashProvenance[] {
  if (provenance.length > MAX_GROUPING_PROVENANCE_ENTRIES) {
    throw new Error(`Grouping provenance exceeds the ${MAX_GROUPING_PROVENANCE_ENTRIES}-entry limit`);
  }

  return provenance.map((entry) => ({
    hash: entry.hash,
    role: entry.role,
    config_id: entry.configId,
    variant: entry.variant,
    fingerprint: {
      type: entry.fingerprint.type,
      source: entry.fingerprint.source,
      tokens: [...entry.fingerprint.tokens],
      resolved_tokens: [...entry.fingerprint.resolvedTokens],
    },
  }));
}

export function serializeGroupingProvenance(
  provenance: readonly GroupingHashProvenance[],
): string {
  return JSON.stringify(toDurableGroupingProvenance(provenance));
}
