import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  // All workflow tables are new in this migration, so nothing to seed.
  return {};
};

const insertRun = async (sql: Sql, options: { tenancyId: string, workflowId: string, runKey: string | null, state: string }) => {
  const id = randomUUID();
  await sql`
    INSERT INTO "WorkflowRun" ("tenancyId", "id", "workflowId", "version", "runKey", "state", "triggerType", "triggerPayload", "updatedAt")
    VALUES (${options.tenancyId}::uuid, ${id}::uuid, ${options.workflowId}, 1, ${options.runKey}, ${options.state}::"WorkflowRunState", 'user.created', '{}'::jsonb, NOW())
  `;
  return id;
};

export const postMigration = async (sql: Sql) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'Workflow%'
    ORDER BY table_name
  `;
  expect(Array.from(tables)).toMatchInlineSnapshot(`
    [
      {
        "table_name": "WorkflowDefinition",
      },
      {
        "table_name": "WorkflowEvent",
      },
      {
        "table_name": "WorkflowRun",
      },
      {
        "table_name": "WorkflowScheduleCursor",
      },
      {
        "table_name": "WorkflowStepAttempt",
      },
      {
        "table_name": "WorkflowStepResult",
      },
      {
        "table_name": "WorkflowVersion",
      },
    ]
  `);

  const tenancyId = randomUUID();

  // isActive is a stored generated column: TRUE for active states, NULL for
  // terminal states. It cannot be written directly.
  const activeRunId = await insertRun(sql, { tenancyId, workflowId: "welcome-drip", runKey: "user:1", state: "QUEUED" });
  const activeRow = await sql`
    SELECT "isActive" FROM "WorkflowRun" WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${activeRunId}::uuid
  `;
  expect(Array.from(activeRow)).toMatchInlineSnapshot(`
    [
      {
        "isActive": true,
      },
    ]
  `);
  await expect(sql`
    UPDATE "WorkflowRun" SET "isActive" = NULL WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${activeRunId}::uuid
  `).rejects.toThrow(/can only be updated to DEFAULT/);

  // A second ACTIVE run with the same (workflow, runKey) violates the
  // active-run uniqueness (this is what backs runKey/onConflict semantics).
  await expect(
    insertRun(sql, { tenancyId, workflowId: "welcome-drip", runKey: "user:1", state: "SLEEPING" }),
  ).rejects.toThrow(/WorkflowRun_active_run_key/);

  // The same runKey on a DIFFERENT workflow is fine.
  await insertRun(sql, { tenancyId, workflowId: "trial-expiry", runKey: "user:1", state: "QUEUED" });

  // A TERMINAL run with the same key does not conflict (isActive is NULL).
  await insertRun(sql, { tenancyId, workflowId: "welcome-drip", runKey: "user:1", state: "COMPLETED" });

  // Multiple keyless active runs never conflict (runKey NULL).
  await insertRun(sql, { tenancyId, workflowId: "welcome-drip", runKey: null, state: "QUEUED" });
  await insertRun(sql, { tenancyId, workflowId: "welcome-drip", runKey: null, state: "QUEUED" });

  // Transitioning the active run to a terminal state flips isActive to NULL
  // via the generated column, which frees the key for a new run — keys recur
  // over time, UUIDs never.
  await sql`
    UPDATE "WorkflowRun" SET "state" = 'CANCELED' WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${activeRunId}::uuid
  `;
  const canceledRow = await sql`
    SELECT "isActive" FROM "WorkflowRun" WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${activeRunId}::uuid
  `;
  expect(Array.from(canceledRow)).toMatchInlineSnapshot(`
    [
      {
        "isActive": null,
      },
    ]
  `);
  await insertRun(sql, { tenancyId, workflowId: "welcome-drip", runKey: "user:1", state: "QUEUED" });
};
