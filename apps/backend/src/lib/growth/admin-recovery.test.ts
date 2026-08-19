import { GrowthRunStatus } from "@/generated/prisma/enums";
import type { Tenancy } from "@/lib/tenancies";
import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  enqueueWorkflowEvent,
  ensureGrowthWorkflows,
  getGrowthAnalysisLegRunKeys,
  getGrowthAnalysisSnapshot,
  growthAnalysisRunFindFirst,
  runWorkflowEngineStep,
  tickGrowthAnalysisRun,
  workflowEventFindFirst,
  workflowRunFindFirst,
} = vi.hoisted(() => ({
  enqueueWorkflowEvent: vi.fn(),
  ensureGrowthWorkflows: vi.fn(),
  getGrowthAnalysisLegRunKeys: vi.fn(),
  getGrowthAnalysisSnapshot: vi.fn(),
  growthAnalysisRunFindFirst: vi.fn(),
  runWorkflowEngineStep: vi.fn(),
  tickGrowthAnalysisRun: vi.fn(),
  workflowEventFindFirst: vi.fn(),
  workflowRunFindFirst: vi.fn(),
}));

vi.mock("@/prisma-client", () => ({
  globalPrismaClient: {
    growthAnalysisRun: { findFirst: growthAnalysisRunFindFirst },
    workflowEvent: { findFirst: workflowEventFindFirst },
    workflowRun: { findFirst: workflowRunFindFirst },
  },
}));
vi.mock("@/lib/workflows/engine", () => ({ runWorkflowEngineStep }));
vi.mock("@/lib/workflows/events", () => ({ enqueueWorkflowEvent }));
vi.mock("./orchestration", () => ({ getGrowthAnalysisSnapshot, tickGrowthAnalysisRun }));
vi.mock("./workflows", () => ({
  GROWTH_EVENT_TYPES: {
    analysisRunActivated: "custom.growth.analysis-run-activated",
    interviewFinished: "custom.growth.interview-finished",
  },
  ensureGrowthWorkflows,
  getGrowthAnalysisLegRunKeys,
}));

import { hasPendingGrowthBoundaryEvent, repairGrowthProject } from "./admin-recovery";
import { GROWTH_EVENT_TYPES } from "./workflows";

const tenancy = {
  id: "tenancy-1",
  branchId: "main",
  project: { id: "project-1" },
} as Tenancy;

function activeRun(status: GrowthRunStatus = GrowthRunStatus.PENDING) {
  return {
    id: "run-1",
    status,
    trigger: "manual",
    interview: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureGrowthWorkflows.mockResolvedValue(new Map());
  getGrowthAnalysisLegRunKeys.mockReturnValue(["activation:run-1", "interview:run-1"]);
  getGrowthAnalysisSnapshot.mockResolvedValue({ fingerprint: "before" });
  tickGrowthAnalysisRun.mockResolvedValue({ fingerprint: "after" });
  runWorkflowEngineStep.mockResolvedValue({ didWork: true });
  enqueueWorkflowEvent.mockResolvedValue({ eventId: "event-1" });
  growthAnalysisRunFindFirst.mockResolvedValue(activeRun());
});

describe("hasPendingGrowthBoundaryEvent", () => {
  test("finds an unprocessed boundary event for the same tenancy, run, and leg", async () => {
    workflowEventFindFirst.mockResolvedValueOnce({ id: "event-1" });

    await expect(hasPendingGrowthBoundaryEvent({
      tenancyId: "tenancy-1",
      growthRunId: "run-1",
      type: GROWTH_EVENT_TYPES.analysisRunActivated,
    })).resolves.toBe(true);
    expect(workflowEventFindFirst).toHaveBeenCalledWith({
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
    workflowEventFindFirst.mockResolvedValueOnce(null);

    await expect(hasPendingGrowthBoundaryEvent({
      tenancyId: "tenancy-1",
      growthRunId: "run-1",
      type: GROWTH_EVENT_TYPES.interviewFinished,
    })).resolves.toBe(false);
  });
});

describe("repairGrowthProject", () => {
  test("does not run the engine when there is no active Growth run", async () => {
    growthAnalysisRunFindFirst.mockResolvedValueOnce(null);

    await expect(repairGrowthProject(tenancy)).resolves.toEqual({ didWork: false });
    expect(runWorkflowEngineStep).not.toHaveBeenCalled();
  });

  test("runs the scoped engine for an active leg", async () => {
    workflowRunFindFirst.mockResolvedValueOnce({ id: "workflow-run-1" });

    await expect(repairGrowthProject(tenancy)).resolves.toEqual({ didWork: true });
    expect(runWorkflowEngineStep).toHaveBeenCalledWith({
      deadlineMs: expect.any(Number),
      scope: { tenancyId: tenancy.id },
    });
    expect(workflowEventFindFirst).not.toHaveBeenCalled();
    expect(enqueueWorkflowEvent).not.toHaveBeenCalled();
    expect(runWorkflowEngineStep.mock.invocationCallOrder[0]).toBeLessThan(tickGrowthAnalysisRun.mock.invocationCallOrder[0]);
  });

  test("runs the scoped engine when the boundary event is pending", async () => {
    workflowRunFindFirst.mockResolvedValueOnce(null);
    workflowEventFindFirst.mockResolvedValueOnce({ id: "event-1" });

    await expect(repairGrowthProject(tenancy)).resolves.toEqual({ didWork: true });
    expect(runWorkflowEngineStep).toHaveBeenCalledWith({
      deadlineMs: expect.any(Number),
      scope: { tenancyId: tenancy.id },
    });
    expect(enqueueWorkflowEvent).not.toHaveBeenCalled();
  });

  test("enqueues a missing boundary event before running the scoped engine", async () => {
    workflowRunFindFirst.mockResolvedValueOnce(null);
    workflowEventFindFirst.mockResolvedValueOnce(null);

    await expect(repairGrowthProject(tenancy)).resolves.toEqual({ didWork: true });
    expect(enqueueWorkflowEvent).toHaveBeenCalledWith(expect.anything(), {
      tenancy,
      type: GROWTH_EVENT_TYPES.analysisRunActivated,
      payload: { growth_run_id: "run-1", trigger: "manual" },
    });
    expect(runWorkflowEngineStep).toHaveBeenCalledWith({
      deadlineMs: expect.any(Number),
      scope: { tenancyId: tenancy.id },
    });
  });

  test("runs the scoped engine even when the active run has no workflow leg", async () => {
    growthAnalysisRunFindFirst.mockResolvedValueOnce(activeRun(GrowthRunStatus.AWAITING_INTERVIEW));

    await expect(repairGrowthProject(tenancy)).resolves.toEqual({ didWork: true });
    expect(workflowRunFindFirst).not.toHaveBeenCalled();
    expect(runWorkflowEngineStep).toHaveBeenCalledWith({
      deadlineMs: expect.any(Number),
      scope: { tenancyId: tenancy.id },
    });
  });
});
