import { globalPrismaClient } from "@/prisma-client";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || !UUID_REGEX.test(value)) {
    throw new StackAssertionError(`${label} must be a valid UUID. Received: ${JSON.stringify(value)}`);
  }
}

// Queues a sync request for a specific tenant if one isn't already pending.
export async function enqueueExternalDbSync(tenancyId: string): Promise<void> {
  assertUuid(tenancyId, "tenancyId");
  await globalPrismaClient.$executeRaw`
    INSERT INTO "OutgoingRequest" ("id", "createdAt", "qstashOptions", "startedFulfillingAt")
    SELECT
      gen_random_uuid(),
      NOW(),
      json_build_object(
        'url',  '/api/latest/internal/external-db-sync/sync-engine',
        'body', json_build_object('tenancyId', ${tenancyId}::uuid)
      ),
      NULL
    WHERE NOT EXISTS (
      SELECT 1
      FROM "OutgoingRequest"
      WHERE "startedFulfillingAt" IS NULL
        AND ("qstashOptions"->'body'->>'tenancyId')::uuid = ${tenancyId}::uuid
    )
  `;
}
