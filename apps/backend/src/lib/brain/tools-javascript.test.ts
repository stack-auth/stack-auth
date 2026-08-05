import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
  };
  return {
    tx,
    retryTransaction: vi.fn(),
    executeBrainJavascript: vi.fn(),
    loadBrainAutomationMemory: vi.fn(),
    saveBrainAutomationMemory: vi.fn(),
    claimBrainQueueItems: vi.fn(),
    acknowledgeBrainQueueItems: vi.fn(),
    releaseBrainQueueItems: vi.fn(),
    requeueBrainQueueItemsByClaimLease: vi.fn(),
    countPendingBrainQueueItems: vi.fn(),
  };
});

vi.mock("@/prisma-client", () => ({
  globalPrismaClient: {},
  retryTransaction: mocks.retryTransaction,
}));

vi.mock("@/lib/ai/tools", () => ({
  getTools: vi.fn().mockResolvedValue({}),
}));

vi.mock("./javascript", () => ({
  BRAIN_JAVASCRIPT_DEFAULT_BATCH_SIZE: 25,
  BRAIN_JAVASCRIPT_MAX_BATCH_SIZE: 200,
  BRAIN_JAVASCRIPT_MAX_BATCH_BYTES: 4 * 1024 * 1024,
  BRAIN_JAVASCRIPT_MAX_CODE_BYTES: 50_000,
  BRAIN_JAVASCRIPT_MAX_RESULT_BYTES: 1024 * 1024,
  executeBrainJavascript: mocks.executeBrainJavascript,
}));

vi.mock("./messages", () => ({
  appendBrainToolTrace: vi.fn(),
  finishBrainToolTrace: vi.fn(),
  loadBrainAutomationMemory: mocks.loadBrainAutomationMemory,
  saveBrainAutomationMemory: mocks.saveBrainAutomationMemory,
}));

vi.mock("./queue", () => ({
  claimBrainQueueItems: mocks.claimBrainQueueItems,
  acknowledgeBrainQueueItems: mocks.acknowledgeBrainQueueItems,
  releaseBrainQueueItems: mocks.releaseBrainQueueItems,
  requeueBrainQueueItemsByClaimLease: mocks.requeueBrainQueueItemsByClaimLease,
  countPendingBrainQueueItems: mocks.countPendingBrainQueueItems,
}));

import { executeBrainQueueJavascript, type BrainToolContext } from "./tools";

const context: BrainToolContext = {
  tenancyId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  runLeaseToken: "00000000-0000-4000-8000-000000000003",
  claimedQueueItems: new Map(),
};

const claimed = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    claimLeaseToken: "00000000-0000-4000-8000-000000000021",
    type: "user.signed_up",
    schemaVersion: 1,
    payload: { user_id: "user-1" },
    occurredAt: new Date("2026-08-04T00:00:00.000Z"),
    subjectType: "user",
    subjectId: "user-1",
    attempts: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    claimLeaseToken: "00000000-0000-4000-8000-000000000021",
    type: "email.sent",
    schemaVersion: 1,
    payload: { recipient_count: 1 },
    occurredAt: new Date("2026-08-04T00:01:00.000Z"),
    subjectType: "email_outbox",
    subjectId: "email-1",
    attempts: 1,
  },
];

describe("executeBrainQueueJavascript", () => {
  beforeEach(() => {
    context.claimedQueueItems.clear();
    vi.clearAllMocks();
    mocks.tx.$queryRaw.mockResolvedValue([{ tenancyId: context.tenancyId }]);
    mocks.retryTransaction.mockImplementation(async (_client, callback) => await callback(mocks.tx));
    mocks.claimBrainQueueItems.mockResolvedValue(claimed);
    mocks.loadBrainAutomationMemory.mockResolvedValue({ strategy: "manual" });
    mocks.acknowledgeBrainQueueItems.mockResolvedValue(1);
    mocks.releaseBrainQueueItems.mockResolvedValue(1);
    mocks.requeueBrainQueueItemsByClaimLease.mockResolvedValue(0);
    mocks.countPendingBrainQueueItems.mockResolvedValue(7);
    mocks.saveBrainAutomationMemory.mockResolvedValue(undefined);
  });

  it("atomically applies sandbox actions, saves memory, and releases untouched claims", async () => {
    mocks.executeBrainJavascript.mockResolvedValue({
      result: { summary: "processed two events" },
      actions: [
        { type: "acknowledge", ids: [claimed[0].id] },
        { type: "release", ids: [claimed[1].id], error: "later", fail: false },
      ],
      memory: { strategy: "batch", accessToken: "must-not-persist" },
    });

    const result = await executeBrainQueueJavascript(context, {
      code: "return { ok: true };",
      batchSize: 100,
    });

    expect(mocks.claimBrainQueueItems).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      limit: 100,
    });
    expect(mocks.acknowledgeBrainQueueItems).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      claims: [{
        id: claimed[0].id,
        claimLeaseToken: claimed[0].claimLeaseToken,
      }],
    });
    expect(mocks.releaseBrainQueueItems).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      claims: [{
        id: claimed[1].id,
        claimLeaseToken: claimed[1].claimLeaseToken,
      }],
      error: "later",
      fail: false,
      retryDelayMs: 30_000,
    });
    expect(mocks.saveBrainAutomationMemory).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      runLeaseToken: context.runLeaseToken,
      memory: { strategy: "batch", accessToken: "[redacted]" },
    });
    expect(mocks.requeueBrainQueueItemsByClaimLease).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      claimLeaseTokens: [claimed[0].claimLeaseToken],
      error: "Brain JavaScript left the item untouched",
      retryDelayMs: 0,
      undoClaimAttempt: true,
    });
    expect(context.claimedQueueItems.size).toBe(0);
    expect(result).toEqual({
      result: { summary: "processed two events" },
      stats: { supplied: 2, acknowledged: 1, released: 1, failed: 0, untouched: 0 },
      memoryUpdated: true,
      remainingQueueItems: 7,
    });
  });

  it("requeues the whole claimed batch when the sandbox fails", async () => {
    mocks.executeBrainJavascript.mockRejectedValue(new Error("sandbox unavailable"));

    await expect(executeBrainQueueJavascript(context, {
      code: "return null;",
    })).rejects.toThrow("sandbox unavailable");

    expect(mocks.requeueBrainQueueItemsByClaimLease).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      claimLeaseTokens: [claimed[0].claimLeaseToken],
      error: "Brain JavaScript failed before finalizing the batch",
      retryDelayMs: 0,
    });
    expect(context.claimedQueueItems.size).toBe(0);
  });

  it("registers and requeues claims when loading automation memory fails", async () => {
    mocks.loadBrainAutomationMemory.mockRejectedValue(new Error("memory unavailable"));

    await expect(executeBrainQueueJavascript(context, {
      code: "return null;",
    })).rejects.toThrow("memory unavailable");

    expect(mocks.executeBrainJavascript).not.toHaveBeenCalled();
    expect(mocks.requeueBrainQueueItemsByClaimLease).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      claimLeaseTokens: [claimed[0].claimLeaseToken],
      error: "Brain JavaScript failed before finalizing the batch",
      retryDelayMs: 0,
    });
    expect(context.claimedQueueItems.size).toBe(0);
  });

  it("rejects actions outside the claimed batch and requeues every claim", async () => {
    mocks.executeBrainJavascript.mockResolvedValue({
      result: null,
      actions: [{
        type: "acknowledge",
        ids: ["00000000-0000-4000-8000-000000000099"],
      }],
      memory: { strategy: "manual" },
    });

    await expect(executeBrainQueueJavascript(context, {
      code: "return null;",
    })).rejects.toThrow("escaped its claimed batch");

    expect(mocks.acknowledgeBrainQueueItems).not.toHaveBeenCalled();
    expect(mocks.requeueBrainQueueItemsByClaimLease).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      claimLeaseTokens: [claimed[0].claimLeaseToken],
      error: "Brain JavaScript failed before finalizing the batch",
      retryDelayMs: 0,
    });
    expect(context.claimedQueueItems.size).toBe(0);
  });

  it("requeues claims when the transactional action count is fenced", async () => {
    mocks.executeBrainJavascript.mockResolvedValue({
      result: null,
      actions: [{ type: "acknowledge", ids: [claimed[0].id] }],
      memory: { strategy: "manual" },
    });
    mocks.acknowledgeBrainQueueItems.mockResolvedValue(0);

    await expect(executeBrainQueueJavascript(context, {
      code: "return null;",
    })).rejects.toThrow("could not acknowledge every claimed item");

    expect(mocks.requeueBrainQueueItemsByClaimLease).toHaveBeenLastCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      claimLeaseTokens: [claimed[0].claimLeaseToken],
      error: "Brain JavaScript failed before finalizing the batch",
      retryDelayMs: 0,
    });
    expect(context.claimedQueueItems.size).toBe(0);
  });

  it("coalesces per-item acknowledgements into one database mutation", async () => {
    mocks.executeBrainJavascript.mockResolvedValue({
      result: null,
      actions: claimed.map((item) => ({
        type: "acknowledge",
        ids: [item.id],
      })),
      memory: { strategy: "manual" },
    });
    mocks.acknowledgeBrainQueueItems.mockResolvedValue(2);

    await executeBrainQueueJavascript(context, {
      code: "return null;",
    });

    expect(mocks.acknowledgeBrainQueueItems).toHaveBeenCalledTimes(1);
    expect(mocks.acknowledgeBrainQueueItems).toHaveBeenCalledWith(mocks.tx, {
      tenancyId: context.tenancyId,
      claims: claimed.map((item) => ({
        id: item.id,
        claimLeaseToken: item.claimLeaseToken,
      })),
    });
  });

  it("serializes concurrent calls so automation memory updates cannot overwrite each other", async () => {
    let persistedMemory: Record<string, unknown> = {};
    let executionIndex = 0;
    mocks.loadBrainAutomationMemory.mockImplementation(async () => structuredClone(persistedMemory));
    mocks.executeBrainJavascript.mockImplementation(async (options: unknown) => {
      if (options == null || typeof options !== "object") {
        throw new Error("Expected JavaScript execution options");
      }
      const memory = Reflect.get(options, "memory");
      if (memory == null || typeof memory !== "object" || Array.isArray(memory)) {
        throw new Error("Expected JavaScript execution memory");
      }
      executionIndex += 1;
      return {
        result: null,
        actions: [],
        memory: {
          ...memory,
          [`call-${executionIndex}`]: true,
        },
      };
    });
    mocks.saveBrainAutomationMemory.mockImplementation(async (_tx: unknown, options: unknown) => {
      if (options == null || typeof options !== "object") {
        throw new Error("Expected memory save options");
      }
      const memory = Reflect.get(options, "memory");
      if (memory == null || typeof memory !== "object" || Array.isArray(memory)) {
        throw new Error("Expected saved automation memory");
      }
      persistedMemory = Object.fromEntries(Object.entries(memory));
    });

    await Promise.all([
      executeBrainQueueJavascript(context, { code: "return null;" }),
      executeBrainQueueJavascript(context, { code: "return null;" }),
    ]);

    expect(persistedMemory).toEqual({
      "call-1": true,
      "call-2": true,
    });
    expect(mocks.loadBrainAutomationMemory).toHaveBeenCalledTimes(2);
  });
});
