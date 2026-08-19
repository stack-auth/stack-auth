import { describe, expect, it } from "vitest";
import { completeBatchRebuildOptions, groupingProvenanceForReconciliation } from "./issue-reconciler";

describe("issue reconciliation boundaries", () => {
  it("uses the discovery window only to select batches, then rebuilds the complete batch", () => {
    const options = completeBatchRebuildOptions({
      projectId: "project-1",
      branchId: "main",
      batchIds: ["batch-1"],
      from: new Date("2026-08-06T12:00:00Z"),
      to: new Date("2026-08-06T13:00:00Z"),
    });

    expect(options).toEqual({ projectId: "project-1", branchId: "main", batchIds: ["batch-1"] });
    expect(options).not.toHaveProperty("from");
    expect(options).not.toHaveProperty("to");
  });

  it("repairs legacy empty provenance from its durable owner hash and config", () => {
    expect(groupingProvenanceForReconciliation({
      issue_hash: "owner-hash",
      grouping_config: "hexclave-js:2026-08-01",
      grouping_provenance: "[]",
    })).toEqual([{
      hash: "owner-hash",
      role: "primary",
      config_id: "hexclave-js:2026-08-01",
      variant: "degraded",
      fingerprint: { type: "default", source: "degraded", tokens: [], resolved_tokens: [] },
    }]);
  });
});
