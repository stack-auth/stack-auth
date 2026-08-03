import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendBrainToolTrace,
  finishBrainToolTrace,
} from "./messages";
import { createBrainExecutionRunner, getBrainTools } from "./tools";

vi.mock("./messages", () => ({
  appendBrainToolTrace: vi.fn(),
  finishBrainToolTrace: vi.fn(),
}));

const context = {
  tenancyId: "00000000-0000-0000-0000-000000000001",
  projectId: "00000000-0000-0000-0000-000000000002",
  runLeaseToken: "00000000-0000-0000-0000-000000000004",
  claimedQueueItems: new Map<string, string>(),
  claimAttempted: false,
};

const runningTrace = {
  type: "tool-trace" as const,
  toolCallId: "call-1",
  toolName: "queryAnalytics",
  status: "running" as const,
  input: { query: "SELECT 1" },
  startedAt: "2026-07-31T00:00:00.000Z",
};

describe("createBrainExecutionRunner", () => {
  beforeEach(() => {
    vi.mocked(appendBrainToolTrace).mockReset();
    vi.mocked(finishBrainToolTrace).mockReset();
    vi.mocked(appendBrainToolTrace).mockResolvedValue({
      messageId: "00000000-0000-0000-0000-000000000003",
      trace: runningTrace,
    });
    vi.mocked(finishBrainToolTrace).mockResolvedValue();
  });

  it("persists running and completed states around tool execution", async () => {
    const runner = createBrainExecutionRunner(context);
    const result = await runner({
      toolCallId: "call-1",
      toolName: "queryAnalytics",
      input: { query: "SELECT 1" },
      execute: async () => ({ rows: 1 }),
    });

    expect(result).toEqual({ rows: 1 });
    expect(appendBrainToolTrace).toHaveBeenCalledWith({
      tenancyId: context.tenancyId,
      runLeaseToken: context.runLeaseToken,
      toolCallId: "call-1",
      toolName: "queryAnalytics",
      input: { query: "SELECT 1" },
    });
    expect(finishBrainToolTrace).toHaveBeenCalledWith(expect.objectContaining({
      tenancyId: context.tenancyId,
      runLeaseToken: context.runLeaseToken,
      messageId: "00000000-0000-0000-0000-000000000003",
      trace: runningTrace,
      result: { status: "completed", output: { rows: 1 } },
      durationMs: expect.any(Number),
    }));
  });

  it("persists a failed state and rethrows the tool error", async () => {
    const runner = createBrainExecutionRunner(context);
    const error = new Error("query failed");
    await expect(runner({
      toolCallId: "call-1",
      toolName: "queryAnalytics",
      input: { query: "SELECT broken" },
      execute: async () => {
        throw error;
      },
    })).rejects.toBe(error);

    expect(finishBrainToolTrace).toHaveBeenCalledWith(expect.objectContaining({
      result: { status: "failed" },
    }));
  });
});

describe("getBrainTools", () => {
  it("includes queue, analytics, and project config tools", async () => {
    const tools = await getBrainTools(context);
    expect(Object.keys(tools).sort()).toEqual([
      "acknowledgeBrainQueueItems",
      "claimBrainQueueItems",
      "listBrainQueueItems",
      "queryAnalytics",
      "readBranchConfig",
      "releaseBrainQueueItems",
    ]);
  });
});
