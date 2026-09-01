import { describe, expect, it } from "vitest";
import { CRON_JOB_REGISTRY, getLocalCronJobPaths } from "./cron-job-registry";

describe("cron job registry", () => {
  it("keeps hosted schedules and local worker paths aligned", () => {
    expect(CRON_JOB_REGISTRY.map((job) => job.path)).toEqual([
      "/api/latest/internal/email-queue-step",
      "/api/latest/internal/external-db-sync/poller",
      "/api/latest/internal/external-db-sync/sequencer",
      "/api/latest/internal/workflow-engine-step",
      "/api/latest/internal/issues/reconciler",
    ]);
    expect(getLocalCronJobPaths()).toEqual([
      "/api/latest/internal/external-db-sync/poller",
      "/api/latest/internal/external-db-sync/sequencer",
      "/api/latest/internal/workflow-engine-step",
      "/api/latest/internal/issues/reconciler",
    ]);
  });

  it("does not treat QStash workers as cron jobs", () => {
    expect(CRON_JOB_REGISTRY.every((job) => !job.path.includes("/telemetry/materialize"))).toBe(true);
  });
});
