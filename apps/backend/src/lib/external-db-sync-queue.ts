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
  await enqueueExternalDbSyncBatch([tenancyId]);
}

// Queues sync requests for multiple tenants in a single query.
// Only inserts for tenants that don't already have a pending request.
export async function enqueueExternalDbSyncBatch(tenancyIds: string[]): Promise<void> {
  if (tenancyIds.length === 0) return;

  for (const id of tenancyIds) {
    assertUuid(id, "tenancyId");
  }

  // Use unnest to pass array of UUIDs and insert all in one query
  await globalPrismaClient.$executeRaw`
    INSERT INTO "OutgoingRequest" ("id", "createdAt", "qstashOptions", "startedFulfillingAt", "deduplicationKey")
    SELECT
      gen_random_uuid(),
      NOW(),
      json_build_object(
        'url',  '/api/latest/internal/external-db-sync/sync-engine',
        'body', json_build_object('tenancyId', t.tenancy_id),
        'flowControl', json_build_object('key', 'sentinel-sync-key', 'parallelism', 20)
      ),
      NULL,
      'sentinel-sync-key-' || t.tenancy_id
    FROM unnest(${tenancyIds}::uuid[]) AS t(tenancy_id)
    ON CONFLICT ("deduplicationKey") DO NOTHING
  `;
}
