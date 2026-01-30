import { getPrismaClientForTenancy, globalPrismaClient, type PrismaClientTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupTuple,
} from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { getTenancy, type Tenancy } from "@/lib/tenancies";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || !UUID_REGEX.test(value)) {
    throw new StatusError(500, `${label} must be a valid UUID. Received: ${JSON.stringify(value)}`);
  }
}

// Assigns sequence IDs to rows that need them and queues sync requests for affected tenants.
// Processes up to 1000 rows at a time from each table.
async function backfillSequenceIds() {
  const projectUserTenants = await globalPrismaClient.$queryRaw<{ tenancyId: string }[]>`
    WITH rows_to_update AS (
      SELECT "tenancyId", "projectUserId"
      FROM "ProjectUser"
      WHERE "shouldUpdateSequenceId" = TRUE
      OR "sequenceId" IS NULL
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "ProjectUser" pu
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE pu."tenancyId"     = r."tenancyId"
        AND pu."projectUserId" = r."projectUserId"
      RETURNING pu."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  `;

  // Enqueue sync for each affected tenant
  for (const { tenancyId } of projectUserTenants) {
    assertUuid(tenancyId, "projectUserTenants.tenancyId");
    await enqueueTenantSync(tenancyId);
  }

  const contactChannelTenants = await globalPrismaClient.$queryRaw<{ tenancyId: string }[]>`
    WITH rows_to_update AS (
      SELECT "tenancyId", "projectUserId", "id"
      FROM "ContactChannel"
      WHERE "shouldUpdateSequenceId" = TRUE
      OR "sequenceId" IS NULL
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "ContactChannel" cc
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE cc."tenancyId"     = r."tenancyId"
        AND cc."projectUserId" = r."projectUserId"
        AND cc."id"            = r."id"
      RETURNING cc."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  `;

  for (const { tenancyId } of contactChannelTenants) {
    assertUuid(tenancyId, "contactChannelTenants.tenancyId");
    await enqueueTenantSync(tenancyId);
  }

  const deletedRowTenants = await globalPrismaClient.$queryRaw<{ tenancyId: string }[]>`
    WITH rows_to_update AS (
      SELECT "id", "tenancyId"
      FROM "DeletedRow"
      WHERE "shouldUpdateSequenceId" = TRUE
      OR "sequenceId" IS NULL
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "DeletedRow" dr
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE dr."id" = r."id"
      RETURNING dr."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  `;

  for (const { tenancyId } of deletedRowTenants) {
    assertUuid(tenancyId, "deletedRowTenants.tenancyId");
    await enqueueTenantSync(tenancyId);
  }
}

async function backfillSequenceIdsForTenancy(prisma: PrismaClientTransaction, tenancyId: string): Promise<boolean> {
  assertUuid(tenancyId, "tenancyId");
  let didUpdate = false;

  const projectUserRows = await prisma.$queryRaw<{ tenancyId: string }[]>`
    WITH rows_to_update AS (
      SELECT "tenancyId", "projectUserId"
      FROM "ProjectUser"
      WHERE ("shouldUpdateSequenceId" = TRUE OR "sequenceId" IS NULL)
      AND "tenancyId" = ${tenancyId}::uuid
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "ProjectUser" pu
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE pu."tenancyId"     = r."tenancyId"
        AND pu."projectUserId" = r."projectUserId"
      RETURNING pu."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  `;
  if (projectUserRows.length > 0) {
    didUpdate = true;
  }

  const contactChannelRows = await prisma.$queryRaw<{ tenancyId: string }[]>`
    WITH rows_to_update AS (
      SELECT "tenancyId", "projectUserId", "id"
      FROM "ContactChannel"
      WHERE ("shouldUpdateSequenceId" = TRUE OR "sequenceId" IS NULL)
      AND "tenancyId" = ${tenancyId}::uuid
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "ContactChannel" cc
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE cc."tenancyId"     = r."tenancyId"
        AND cc."projectUserId" = r."projectUserId"
        AND cc."id"            = r."id"
      RETURNING cc."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  `;
  if (contactChannelRows.length > 0) {
    didUpdate = true;
  }

  const deletedRowRows = await prisma.$queryRaw<{ tenancyId: string }[]>`
    WITH rows_to_update AS (
      SELECT "id", "tenancyId"
      FROM "DeletedRow"
      WHERE ("shouldUpdateSequenceId" = TRUE OR "sequenceId" IS NULL)
      AND "tenancyId" = ${tenancyId}::uuid
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    ),
    updated_rows AS (
      UPDATE "DeletedRow" dr
      SET "sequenceId" = nextval('global_seq_id'),
          "shouldUpdateSequenceId" = FALSE
      FROM rows_to_update r
      WHERE dr."id" = r."id"
      RETURNING dr."tenancyId"
    )
    SELECT DISTINCT "tenancyId" FROM updated_rows
  `;
  if (deletedRowRows.length > 0) {
    didUpdate = true;
  }

  return didUpdate;
}

async function getNonHostedTenancies(): Promise<Tenancy[]> {
  const tenancyIds = await globalPrismaClient.tenancy.findMany({
    select: { id: true },
  });

  const tenancies: Tenancy[] = [];
  for (const { id } of tenancyIds) {
    const tenancy = await getTenancy(id);
    if (!tenancy) continue;
    if (tenancy.config.sourceOfTruth.type !== "hosted") {
      tenancies.push(tenancy);
    }
  }

  return tenancies;
}

async function backfillSequenceIdsForNonHostedTenancies(tenancies: Tenancy[]): Promise<void> {
  for (const tenancy of tenancies) {
    const prisma = await getPrismaClientForTenancy(tenancy);
    const didUpdate = await backfillSequenceIdsForTenancy(prisma, tenancy.id);
    if (didUpdate) {
      await enqueueTenantSync(tenancy.id);
    }
  }
}

// Queues a sync request for a specific tenant if one isn't already pending.
// Prevents duplicate sync requests by checking for unfulfilled requests.
async function enqueueTenantSync(tenancyId: string) {
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

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Run sequence ID backfill",
    description:
      "Internal endpoint invoked by Vercel Cron to backfill null sequence IDs.",
    tags: ["External DB Sync"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      authorization: yupTuple([yupString()]).defined(),
    }).defined(),
    query: yupObject({}).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      iterations: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ headers }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    let nonHostedTenancies = await getNonHostedTenancies();
    let lastTenancyRefreshMs = performance.now();
    const tenancyRefreshIntervalMs = 5_000;

    const startTime = performance.now();
    const maxDurationMs = 3 * 60 * 1000;
    const pollIntervalMs = 50;

    let iterations = 0;

    while (performance.now() - startTime < maxDurationMs) {
      try {
        if (performance.now() - lastTenancyRefreshMs >= tenancyRefreshIntervalMs) {
          nonHostedTenancies = await getNonHostedTenancies();
          lastTenancyRefreshMs = performance.now();
        }
        await backfillSequenceIds();
        await backfillSequenceIdsForNonHostedTenancies(nonHostedTenancies);
      } catch (error) {
        captureError(
          `sequencer-iteration-error`,
          error,
        );
      }

      iterations++;
      await wait(pollIntervalMs);
    }

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: {
        ok: true,
        iterations,
      },
    };
  },
});
