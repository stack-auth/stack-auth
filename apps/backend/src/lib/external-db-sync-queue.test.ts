import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { globalPrismaClient } from "@/prisma-client";
import { enqueueExternalDbSync, enqueueExternalDbSyncBatch } from "./external-db-sync-queue";

const DEDUP_PREFIX = "sentinel-sync-key-";

// Track every tenancy ID a test enqueues so we can delete the rows afterwards.
// These tests run against the shared dev database, and leftover pending rows
// would be picked up by the poller (which would then fail on the nonexistent
// tenancies and pollute logs).
const enqueuedTenancyIds: string[] = [];

function freshTenancyIds(count: number): string[] {
  const ids = Array.from({ length: count }, () => randomUUID());
  enqueuedTenancyIds.push(...ids);
  return ids;
}

async function findRowsForTenancies(tenancyIds: string[]) {
  return await globalPrismaClient.outgoingRequest.findMany({
    where: { deduplicationKey: { in: tenancyIds.map((id) => DEDUP_PREFIX + id) } },
    orderBy: { deduplicationKey: "asc" },
  });
}

afterEach(async () => {
  await globalPrismaClient.outgoingRequest.deleteMany({
    where: { deduplicationKey: { in: enqueuedTenancyIds.splice(0).map((id) => DEDUP_PREFIX + id) } },
  });
});

describe("enqueueExternalDbSyncBatch (real DB)", () => {
  it("inserts one pending row per tenancy with the expected qstash options", async ({ expect }) => {
    const [tenancyId] = freshTenancyIds(1);

    await enqueueExternalDbSync(tenancyId);

    const rows = await findRowsForTenancies([tenancyId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].startedFulfillingAt).toBeNull();
    expect(rows[0].qstashOptions).toMatchObject({
      url: "/api/latest/internal/external-db-sync/sync-engine",
      body: { tenancyId },
      flowControl: { key: "sentinel-sync-key", parallelism: 20 },
    });
  });

  it("produces the same rows regardless of input order and deduplicates within the batch", async ({ expect }) => {
    const ids = freshTenancyIds(5);
    const shuffled = [...ids].reverse();
    // Duplicates within one call must collapse to a single row per tenancy.
    const withDuplicates = [...shuffled, ...ids, ids[2]];

    await enqueueExternalDbSyncBatch(withDuplicates);

    const rows = await findRowsForTenancies(ids);
    expect(rows).toHaveLength(ids.length);
    expect(new Set(rows.map((r) => r.deduplicationKey))).toEqual(new Set(ids.map((id) => DEDUP_PREFIX + id)));
  });

  it("skips tenancies that already have a pending row, even when re-enqueued in a different order", async ({ expect }) => {
    const ids = freshTenancyIds(4);

    await enqueueExternalDbSyncBatch(ids);
    await enqueueExternalDbSyncBatch([...ids].reverse());

    const rows = await findRowsForTenancies(ids);
    expect(rows).toHaveLength(ids.length);
  });

  it("enqueues a new pending row once the previous one has been claimed", async ({ expect }) => {
    const [tenancyId] = freshTenancyIds(1);

    await enqueueExternalDbSync(tenancyId);
    // Simulate the poller claiming the row: the partial unique index only
    // covers rows WHERE startedFulfillingAt IS NULL, so a claimed row must not
    // block a fresh sync request for the same tenancy.
    await globalPrismaClient.outgoingRequest.updateMany({
      where: { deduplicationKey: DEDUP_PREFIX + tenancyId },
      data: { startedFulfillingAt: new Date() },
    });

    await enqueueExternalDbSync(tenancyId);

    const rows = await findRowsForTenancies([tenancyId]);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.startedFulfillingAt === null)).toHaveLength(1);
  });

  it("rejects non-UUID tenancy IDs", async ({ expect }) => {
    await expect(enqueueExternalDbSyncBatch(["not-a-uuid"])).rejects.toThrow("tenancyId must be a valid UUID");
    await expect(enqueueExternalDbSyncBatch([randomUUID(), "'; DROP TABLE \"OutgoingRequest\"; --"])).rejects.toThrow("tenancyId must be a valid UUID");
  });

  // Regression test for a production deadlock (SQLSTATE 40P01): two concurrent
  // batches inserting overlapping tenancies in different orders acquired the
  // partial unique index locks in opposite orders. The fix canonicalizes the
  // insert order (JS sort + SQL ORDER BY), so concurrent batches always lock
  // in the same order and can never deadlock against each other. This test
  // hammers exactly that scenario; without the sort it deadlocks flakily,
  // with it a deadlock is impossible, so the test cannot be flaky post-fix.
  it("does not deadlock when concurrent batches enqueue the same tenancies in opposite orders", async ({ expect }) => {
    const ITERATIONS = 10;
    const BATCH_SIZE = 50;

    for (let i = 0; i < ITERATIONS; i++) {
      const ids = freshTenancyIds(BATCH_SIZE);
      await Promise.all([
        enqueueExternalDbSyncBatch(ids),
        enqueueExternalDbSyncBatch([...ids].reverse()),
      ]);

      const rows = await findRowsForTenancies(ids);
      expect(rows).toHaveLength(BATCH_SIZE);
    }
  });
});
