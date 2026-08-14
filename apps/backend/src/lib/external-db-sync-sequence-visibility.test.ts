import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { EmailOutboxCreatedWith, PrismaClient } from "@/generated/prisma/client";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import {
  allocateEmailOutboxSequence,
  runSequenceAllocationInTransaction,
} from "@/app/api/latest/internal/external-db-sync/sequencer/route";
import { getExternalDbSyncFusebox, updateExternalDbSyncFusebox } from "./external-db-sync-metadata";
import { getSoleTenancyFromProjectBranch } from "./tenancies";
import { recordExternalDbSyncDeletion } from "./external-db-sync";

const databaseConnectionString = getEnvVariable("STACK_DATABASE_CONNECTION_STRING", "")
  || throwErr("Missing database connection string for sequence visibility tests");

type SequencedRow = {
  id: string,
  sequenceId: bigint,
};

async function createEmailOutbox(tenancyId: string, id: string): Promise<void> {
  await globalPrismaClient.emailOutbox.create({
    data: {
      id,
      tenancyId,
      tsxSource: `/* sequence-visibility-test-${id} */`,
      themeId: null,
      isHighPriority: false,
      to: { type: "custom-emails", emails: [`sequence-visibility-${id}@example.com`] },
      extraRenderVariables: {},
      shouldSkipDeliverabilityCheck: true,
      createdWith: EmailOutboxCreatedWith.PROGRAMMATIC_CALL,
      scheduledAt: new Date(),
      isQueued: true,
      renderedByWorkerId: "00000000-0000-0000-0000-000000000000",
      startedRenderingAt: new Date(),
      finishedRenderingAt: new Date(),
      renderedHtml: "<p>sequence visibility test</p>",
      renderedText: "sequence visibility test",
      renderedSubject: "sequence visibility test",
      renderedIsTransactional: false,
      shouldUpdateSequenceId: false,
      startedSendingAt: null,
      finishedSendingAt: null,
      sendRetries: 0,
      nextSendRetryAt: null,
      isPaused: true,
    },
  });
}

describe("external DB sync sequence visibility", () => {
  it("requires visible higher sequence IDs to imply visibility of all lower assigned IDs", async () => {
    const tenancyId = (await getSoleTenancyFromProjectBranch("internal", "main")).id;
    const rowA: SequencedRow = { id: randomUUID(), sequenceId: 0n };
    const rowB: SequencedRow = { id: randomUUID(), sequenceId: 0n };
    const poolA = new Pool({ connectionString: databaseConnectionString });
    const poolB = new Pool({ connectionString: databaseConnectionString });
    const poolReader = new Pool({ connectionString: databaseConnectionString });
    const clientA = new PrismaClient({ adapter: new PrismaPg(poolA) });
    const clientB = new PrismaClient({ adapter: new PrismaPg(poolB) });
    const reader = new PrismaClient({ adapter: new PrismaPg(poolReader) });
    let releaseTransactionA: () => void = () => undefined;
    let resolveTransactionAAllocated: () => void = () => undefined;
    const transactionAReleased = new Promise<void>((resolve) => {
      releaseTransactionA = resolve;
    });
    const transactionAAllocated = new Promise<void>((resolve) => {
      resolveTransactionAAllocated = resolve;
    });
    let transactionA: Promise<void> | undefined;
    const originalFusebox = await getExternalDbSyncFusebox();
    await updateExternalDbSyncFusebox({ ...originalFusebox, sequencerEnabled: false });

    try {
      await createEmailOutbox(tenancyId, rowA.id);
      await createEmailOutbox(tenancyId, rowB.id);
      // eslint-disable-next-line no-restricted-syntax
      transactionA = clientA.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "EmailOutbox"
          SET "shouldUpdateSequenceId" = TRUE
          WHERE "tenancyId" = ${tenancyId}::uuid
            AND "id" = ${rowA.id}::uuid
        `;
        const allocation = await runSequenceAllocationInTransaction(tx, (lockedTx) =>
          allocateEmailOutboxSequence(lockedTx, 1, { tenancyId, id: rowA.id })
        );
        expect(allocation.locked).toBe(true);
        rowA.sequenceId = allocation.result?.[0]?.sequenceId ?? throwErr(`Sequencer did not update EmailOutbox ${rowA.id}`);
        resolveTransactionAAllocated();
        await transactionAReleased;
      });
      await transactionAAllocated;

      // eslint-disable-next-line no-restricted-syntax
      const transactionBAttempt = await clientB.$transaction((tx) =>
        runSequenceAllocationInTransaction(tx, (lockedTx) =>
          allocateEmailOutboxSequence(lockedTx, 1, { tenancyId, id: rowB.id })
        )
      );
      expect(
        transactionBAttempt.locked,
        "A second allocation must skip while the first allocation transaction is still open",
      ).toBe(false);

      releaseTransactionA();
      await transactionA;

      // eslint-disable-next-line no-restricted-syntax
      const transactionB = await clientB.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "EmailOutbox"
          SET "shouldUpdateSequenceId" = TRUE
          WHERE "tenancyId" = ${tenancyId}::uuid
            AND "id" = ${rowB.id}::uuid
        `;
        return await runSequenceAllocationInTransaction(tx, (lockedTx) =>
          allocateEmailOutboxSequence(lockedTx, 1, { tenancyId, id: rowB.id })
        );
      });
      expect(transactionB.locked).toBe(true);
      rowB.sequenceId = transactionB.result?.[0]?.sequenceId ?? throwErr(`Sequencer did not update EmailOutbox ${rowB.id}`);

      const visibleRows = await reader.emailOutbox.findMany({
        where: { tenancyId, id: { in: [rowA.id, rowB.id] }, sequenceId: { not: null } },
        select: { id: true, sequenceId: true },
        orderBy: { sequenceId: "asc" },
      });
      expect(visibleRows).toEqual([
        { id: rowA.id, sequenceId: rowA.sequenceId },
        { id: rowB.id, sequenceId: rowB.sequenceId },
      ]);
    } finally {
      releaseTransactionA();
      if (transactionA != null) await transactionA;
      await clientA.$disconnect();
      await clientB.$disconnect();
      await reader.$disconnect();
      await poolA.end();
      await poolB.end();
      await poolReader.end();

      try {
        await retryTransaction(globalPrismaClient, async (tx) => {
          await recordExternalDbSyncDeletion(tx, {
            tableName: "EmailOutbox",
            tenancyId,
            emailOutboxId: rowA.id,
          });
          await recordExternalDbSyncDeletion(tx, {
            tableName: "EmailOutbox",
            tenancyId,
            emailOutboxId: rowB.id,
          });
          await tx.emailOutbox.deleteMany({
            where: { tenancyId, id: { in: [rowA.id, rowB.id] } },
          });
        });
      } finally {
        await updateExternalDbSyncFusebox(originalFusebox);
      }
    }
  });
});
