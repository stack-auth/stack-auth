import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";
import { createWorkflowTestTenancy } from "../../20260720000000_add_workflows/test-helpers";

export const postMigration = async (sql: Sql) => {
  const { tenancyId } = await createWorkflowTestTenancy(sql, "Workflow Dead Letter Test");
  const eventId = randomUUID();

  await sql`
    INSERT INTO "WorkflowEvent" (
      "tenancyId", "id", "type", "payload", "deadLetteredAt", "lastProcessingError"
    )
    VALUES (
      ${tenancyId}::uuid,
      ${eventId}::uuid,
      'custom.dead-letter-test',
      '{}'::jsonb,
      NOW(),
      'bounded failure detail'
    )
  `;

  const [event] = await sql`
    SELECT "deadLetteredAt" IS NOT NULL AS "isDeadLettered", "lastProcessingError"
    FROM "WorkflowEvent"
    WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${eventId}::uuid
  `;
  expect(event).toEqual({
    isDeadLettered: true,
    lastProcessingError: "bounded failure detail",
  });
};
