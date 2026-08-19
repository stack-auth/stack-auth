import { describe, expect, test, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/prisma-client", () => ({
  globalPrismaClient: {
    workflowEvent: { findFirst },
  },
}));

import { hasPendingGrowthBoundaryEvent } from "./admin-recovery";
import { GROWTH_EVENT_TYPES } from "./workflows";

describe("hasPendingGrowthBoundaryEvent", () => {
  test("finds an unprocessed boundary event for the same tenancy, run, and leg", async () => {
    findFirst.mockResolvedValueOnce({ id: "event-1" });

    await expect(hasPendingGrowthBoundaryEvent({
      tenancyId: "tenancy-1",
      growthRunId: "run-1",
      type: GROWTH_EVENT_TYPES.analysisRunActivated,
    })).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        tenancyId: "tenancy-1",
        type: GROWTH_EVENT_TYPES.analysisRunActivated,
        processedAt: null,
        payload: { path: ["growth_run_id"], equals: "run-1" },
      },
      select: { id: true },
    });
  });

  test("allows recovery when no matching event remains in the outbox", async () => {
    findFirst.mockResolvedValueOnce(null);

    await expect(hasPendingGrowthBoundaryEvent({
      tenancyId: "tenancy-1",
      growthRunId: "run-1",
      type: GROWTH_EVENT_TYPES.interviewFinished,
    })).resolves.toBe(false);
  });
});
