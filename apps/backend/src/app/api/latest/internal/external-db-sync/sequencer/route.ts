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
import { enqueueExternalDbSync } from "@/lib/external-db-sync-queue";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_DURATION_MS = 3 * 60 * 1000;

function parseMaxDurationMs(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_DURATION_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new StatusError(400, "maxDurationMs must be a positive integer");
  }
  return parsed;
}

function parseStopWhenIdle(value: string | undefined): boolean {
  if (!value) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new StatusError(400, "stopWhenIdle must be 'true' or 'false'");
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || !UUID_REGEX.test(value)) {
    throw new StatusError(500, `${label} must be a valid UUID. Received: ${JSON.stringify(value)}`);
  }
}

// Assigns sequence IDs to rows that need them and queues sync requests for affected tenants.
// Processes up to 1000 rows at a time from each table.
async function backfillSequenceIds(): Promise<boolean> {
  let didUpdate = false;
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
    await enqueueExternalDbSync(tenancyId);
  }
  if (projectUserTenants.length > 0) {
    didUpdate = true;
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
    await enqueueExternalDbSync(tenancyId);
  }
  if (contactChannelTenants.length > 0) {
    didUpdate = true;
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
    await enqueueExternalDbSync(tenancyId);
  }
  if (deletedRowTenants.length > 0) {
    didUpdate = true;
  }

  return didUpdate;
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

async function backfillSequenceIdsForNonHostedTenancies(tenancies: Tenancy[]): Promise<boolean> {
  let didUpdate = false;
  for (const tenancy of tenancies) {
    const prisma = await getPrismaClientForTenancy(tenancy);
    const tenancyDidUpdate = await backfillSequenceIdsForTenancy(prisma, tenancy.id);
    if (tenancyDidUpdate) {
      await enqueueExternalDbSync(tenancy.id);
      didUpdate = true;
    }
  }
  return didUpdate;
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
      authorization: yupTuple([yupString().defined()]).defined(),
    }).defined(),
    query: yupObject({
      maxDurationMs: yupString().optional(),
      stopWhenIdle: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      iterations: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ headers, query }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    let nonHostedTenancies = await getNonHostedTenancies();
    let lastTenancyRefreshMs = performance.now();
    const tenancyRefreshIntervalMs = 5_000;

    const startTime = performance.now();
    const maxDurationMs = parseMaxDurationMs(query.maxDurationMs);
    const stopWhenIdle = parseStopWhenIdle(query.stopWhenIdle);
    const pollIntervalMs = 50;

    let iterations = 0;

    while (performance.now() - startTime < maxDurationMs) {
      try {
        if (performance.now() - lastTenancyRefreshMs >= tenancyRefreshIntervalMs) {
          nonHostedTenancies = await getNonHostedTenancies();
          lastTenancyRefreshMs = performance.now();
        }
        const didUpdateHosted = await backfillSequenceIds();
        const didUpdateNonHosted = await backfillSequenceIdsForNonHostedTenancies(nonHostedTenancies);
        if (stopWhenIdle && !didUpdateHosted && !didUpdateNonHosted) {
          break;
        }
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
