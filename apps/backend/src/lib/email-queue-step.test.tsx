import { describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted((): {
  queryTexts: string[],
  queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ id: string }[]>,
} => {
  const queryTexts: string[] = [];
  return {
    queryTexts,
    queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      queryTexts.push(strings.join(""));
      return [{ id: "queued-email-id" }];
    }),
  };
});

vi.mock("@/prisma-client", () => ({
  getPrismaClientForTenancy: vi.fn(),
  globalPrismaClient: {
    $queryRaw: prismaMock.queryRaw,
  },
}));

import { queueReadyEmails } from "./email-queue-step";

describe("queueReadyEmails", () => {
  test("only queues rendered emails that have not started sending", async () => {
    prismaMock.queryTexts.length = 0;

    await expect(queueReadyEmails()).resolves.toEqual({ queuedCount: 2 });

    expect(prismaMock.queryTexts).toHaveLength(2);
    for (const queryText of prismaMock.queryTexts) {
      expect(queryText).toContain('"isQueued" = FALSE');
      expect(queryText).toContain('"startedSendingAt" IS NULL');
      expect(queryText).toContain('"finishedSendingAt" IS NULL');
      expect(queryText).toContain('"status" = \'QUEUED\'::"EmailOutboxStatus"');
    }
  });
});
