import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brainFindUnique: vi.fn(),
  brainMessageFindFirst: vi.fn(),
  brainMessageFindMany: vi.fn(),
}));

vi.mock("@/prisma-client", () => ({
  globalPrismaClient: {
    brain: {
      findUnique: mocks.brainFindUnique,
    },
    brainMessage: {
      findFirst: mocks.brainMessageFindFirst,
      findMany: mocks.brainMessageFindMany,
    },
  },
  retryTransaction: vi.fn(),
}));

vi.mock("./ensure", () => ({
  ensureBrainRow: vi.fn(),
}));

import {
  BRAIN_AUTOMATION_MEMORY_IDEMPOTENCY_KEY,
  loadBrainModelContext,
} from "./messages";

describe("loadBrainModelContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainFindUnique.mockResolvedValue({
      summaryText: null,
      summaryThroughPosition: null,
    });
    mocks.brainMessageFindFirst.mockResolvedValue(null);
    mocks.brainMessageFindMany.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000001",
        position: 0,
        role: "user",
        visibility: "visible",
        idempotencyKey: null,
        content: [{ type: "text", text: "hello" }],
      },
    ]);
  });

  it("includes ordinary messages whose idempotency key is null", async () => {
    const context = await loadBrainModelContext(
      "00000000-0000-4000-8000-000000000011",
      40,
    );

    expect(mocks.brainMessageFindMany).toHaveBeenCalledWith({
      where: {
        tenancyId: "00000000-0000-4000-8000-000000000011",
        position: { gt: -1 },
        role: { not: "tool" },
        OR: [
          { idempotencyKey: null },
          { idempotencyKey: { not: BRAIN_AUTOMATION_MEMORY_IDEMPOTENCY_KEY } },
        ],
      },
      orderBy: { position: "desc" },
      take: 40,
    });
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: "user",
      idempotencyKey: null,
    });
  });
});
