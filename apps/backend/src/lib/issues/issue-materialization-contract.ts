import type { GroupingConfigId } from "./grouping-config";
import type { GroupingHashProvenance } from "./types";

/**
 * One coalesced error delta produced by telemetry ingestion and consumed by
 * issue materialization. This belongs to the issue boundary because it
 * describes how an issue changes, not how any one protocol stores its rows.
 */
export type IssueBatchDelta = {
  ownerHash: string,
  aliasHashes: string[],
  /** The first durable occurrence represented by this coalesced hash input. */
  occurrenceId?: string,
  groupingConfigId: GroupingConfigId,
  /**
   * Ordered primary/secondary decisions retained for issue-hash explainability.
   * Always present: ingest computes it inline with the hashes, and the
   * reconciler projects it back out of the occurrence's
   * `issue_grouping_provenance` column.
   */
  groupingProvenance: GroupingHashProvenance[],
  type: string,
  value: string,
  culprit: string,
  platform: string,
  count: number,
  firstEventAt: Date,
  lastEventAt: Date,
  serviceName: string | null,
  deploymentEnvironmentName: string | null,
  release: string | null,
  level: string,
  handled: boolean,
  synthetic: boolean,
};
