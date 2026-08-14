import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { EmailOutboxCreatedWith } from "@/generated/prisma/client";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { getExternalDbSyncFusebox, updateExternalDbSyncFusebox } from "./external-db-sync-metadata";
import { getSoleTenancyFromProjectBranch } from "./tenancies";
import { recordExternalDbSyncDeletion } from "./external-db-sync";

const databaseConnectionString = getEnvVariable("STACK_DATABASE_CONNECTION_STRING", "")
  || throwErr("Missing database connection string for sequence visibility tests");

type SequencedRow = {
  id: string,
  sequenceId: bigint,
};

type VisibleRow = {
  id: string,
  sequenceId: string,
};

async function allocateEmailOutboxSequence(client: Client, tenancyId: string, id: string): Promise<bigint> {
  const rows = await client.query<{ sequenceId: string }>(
    `
      WITH rows_to_update AS (
        SELECT "tenancyId", "id"
        FROM "EmailOutbox"
        WHERE "tenancyId" = $1::uuid
          AND "id" = $2::uuid
          AND "shouldUpdateSequenceId" = TRUE
        FOR UPDATE SKIP LOCKED
      ),
      updated_rows AS (
        UPDATE "EmailOutbox" eo
        SET "sequenceId" = nextval('global_seq_id'),
            "shouldUpdateSequenceId" = FALSE
        FROM rows_to_update r
        WHERE eo."tenancyId" = r."tenancyId"
          AND eo."id" = r."id"
        RETURNING eo."sequenceId"
      )
      SELECT "sequenceId" FROM updated_rows
    `,
    [tenancyId, id],
  );
  return BigInt(rows.rows[0]?.sequenceId ?? throwErr(`Sequencer did not update EmailOutbox ${id}`));
}

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
      shouldUpdateSequenceId: true,
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
    const transactionA = new Client({ connectionString: databaseConnectionString });
    const transactionB = new Client({ connectionString: databaseConnectionString });
    const reader = new Client({ connectionString: databaseConnectionString });
    let transactionAStarted = false;
    const originalFusebox = await getExternalDbSyncFusebox();
    await updateExternalDbSyncFusebox({ ...originalFusebox, sequencerEnabled: false });

    try {
      await createEmailOutbox(tenancyId, rowA.id);
      await createEmailOutbox(tenancyId, rowB.id);
      await transactionA.connect();
      await transactionB.connect();
      await reader.connect();

      await transactionA.query("BEGIN");
      transactionAStarted = true;
      rowA.sequenceId = await allocateEmailOutboxSequence(transactionA, tenancyId, rowA.id);

      await transactionB.query("BEGIN");
      rowB.sequenceId = await allocateEmailOutboxSequence(transactionB, tenancyId, rowB.id);
      await transactionB.query("COMMIT");

      const visibleRows = (await reader.query<VisibleRow>(
        `
          SELECT "id", "sequenceId"
          FROM "EmailOutbox"
          WHERE "tenancyId" = $1::uuid
            AND "id" = ANY($2::uuid[])
            AND "sequenceId" IS NOT NULL
          ORDER BY "sequenceId"
        `,
        [tenancyId, [rowA.id, rowB.id]],
      )).rows;

      expect(visibleRows).toEqual([{ id: rowB.id, sequenceId: rowB.sequenceId.toString() }]);

      const highestVisibleSequenceId = BigInt(visibleRows.at(-1)?.sequenceId ?? throwErr("No visible sequence ID"));
      const missingLowerRows = [rowA, rowB]
        .filter(row => row.sequenceId < highestVisibleSequenceId)
        .filter(row => !visibleRows.some(visibleRow => visibleRow.id === row.id));

      expect(
        missingLowerRows,
        `A visible sequence ID ${highestVisibleSequenceId} skipped lower assigned rows: ${JSON.stringify(missingLowerRows.map(row => ({ id: row.id, sequenceId: row.sequenceId.toString() })))}.`,
      ).toHaveLength(0);
    } finally {
      try {
        if (transactionAStarted) await transactionA.query("ROLLBACK");
        await transactionB.end();
        await reader.end();
        await transactionA.end();

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
