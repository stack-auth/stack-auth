import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";
import { createWorkflowTestTenancy } from "../../20260720000000_add_workflows/test-helpers";

export const postMigration = async (sql: Sql) => {
  const materializationColumns = await sql<{ column_name: string, data_type: string }[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'IssueMaterialization'
      AND column_name IN ('outcomes', 'webhooksDispatchedAt', 'alertsDispatchedAt')
    ORDER BY column_name
  `;
  expect(materializationColumns).toEqual([
    { column_name: "alertsDispatchedAt", data_type: "timestamp without time zone" },
    { column_name: "outcomes", data_type: "jsonb" },
    { column_name: "webhooksDispatchedAt", data_type: "timestamp without time zone" },
  ]);

  const deliveryColumns = await sql<{ column_name: string, data_type: string }[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'IssueAlertDelivery'
      AND column_name = 'workflowPayload'
  `;
  expect(deliveryColumns).toEqual([{ column_name: "workflowPayload", data_type: "jsonb" }]);

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
