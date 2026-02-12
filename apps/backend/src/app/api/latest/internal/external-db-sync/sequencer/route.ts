import { getExternalDbSyncFusebox } from "@/lib/external-db-sync-metadata";
import { enqueueExternalDbSyncBatch } from "@/lib/external-db-sync-queue";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { traceSpan } from "@/utils/telemetry";
import {
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupTuple,
} from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";

const DEFAULT_MAX_DURATION_MS = 3 * 60 * 1000;
const SEQUENCER_BATCH_SIZE_ENV = "STACK_EXTERNAL_DB_SYNC_SEQUENCER_BATCH_SIZE";
const DEFAULT_BATCH_SIZE = 1000;

function parseMaxDurationMs(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_DURATION_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new StatusError(400, "maxDurationMs must be a positive integer");
  }
  return parsed;
}

function getSequencerBatchSize(): number {
  const rawValue = getEnvVariable(SEQUENCER_BATCH_SIZE_ENV, "");
  if (!rawValue) return DEFAULT_BATCH_SIZE;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new StackAssertionError(
      `${SEQUENCER_BATCH_SIZE_ENV} must be a positive integer. Received: ${JSON.stringify(rawValue)}`
    );
  }
  return parsed;
}


// Assigns sequence IDs to rows that need them and queues sync requests for affected tenants.
// Processes up to batchSize rows at a time from each table.
async function backfillSequenceIds(batchSize: number): Promise<boolean> {
  return await traceSpan({
    description: "external-db-sync.sequencer.backfill",
    attributes: {
      "stack.external-db-sync.batch-size": batchSize,
    },
  }, async (span) => {
    let didUpdate = false;

    const projectUserTenants = await globalPrismaClient.$queryRaw<{ tenancyId: string }[]>`
      WITH rows_to_update AS (
        SELECT "tenancyId", "projectUserId"
        FROM "ProjectUser"
        WHERE "shouldUpdateSequenceId" = TRUE
        ORDER BY "tenancyId"
        LIMIT ${batchSize}
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

    span.setAttribute("stack.external-db-sync.project-user-tenants", projectUserTenants.length);

    // Enqueue sync for all affected tenants in a single batch query
    if (projectUserTenants.length > 0) {
      await enqueueExternalDbSyncBatch(projectUserTenants.map(t => t.tenancyId));
      didUpdate = true;
    }

    const contactChannelTenants = await globalPrismaClient.$queryRaw<{ tenancyId: string }[]>`
      WITH rows_to_update AS (
        SELECT "tenancyId", "projectUserId", "id"
        FROM "ContactChannel"
        WHERE "shouldUpdateSequenceId" = TRUE
        ORDER BY "tenancyId"
        LIMIT ${batchSize}
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

    span.setAttribute("stack.external-db-sync.contact-channel-tenants", contactChannelTenants.length);

    if (contactChannelTenants.length > 0) {
      await enqueueExternalDbSyncBatch(contactChannelTenants.map(t => t.tenancyId));
      didUpdate = true;
    }

    const deletedRowTenants = await globalPrismaClient.$queryRaw<{ tenancyId: string }[]>`
      WITH rows_to_update AS (
        SELECT "id", "tenancyId"
        FROM "DeletedRow"
        WHERE "shouldUpdateSequenceId" = TRUE
        ORDER BY "tenancyId"
        LIMIT ${batchSize}
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

    span.setAttribute("stack.external-db-sync.deleted-row-tenants", deletedRowTenants.length);

    if (deletedRowTenants.length > 0) {
      await enqueueExternalDbSyncBatch(deletedRowTenants.map(t => t.tenancyId));
      didUpdate = true;
    }

    span.setAttribute("stack.external-db-sync.did-update", didUpdate);

    return didUpdate;
  });
}

// TODO: If we ever need to support non-hosted source-of-truth tenancies again,
// we'll need to implement a scalable way to iterate over them (pagination, etc.)
// instead of loading all tenancies into memory at once.

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
      authorization: yupTuple([yupString().defined()]).optional(),
    }).defined(),
    query: yupObject({
      maxDurationMs: yupString().optional(),
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
  handler: async ({ headers, query, auth }) => {
    const isAdmin = auth?.type === "admin" && auth.project.id === "internal";
    const authHeader = headers.authorization?.[0];
    if (!isAdmin && authHeader !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    return await traceSpan("external-db-sync.sequencer", async (span) => {
      const startTime = performance.now();
      const maxDurationMs = parseMaxDurationMs(query.maxDurationMs);
      const pollIntervalMs = 50;
      const batchSize = getSequencerBatchSize();

      span.setAttribute("stack.external-db-sync.max-duration-ms", maxDurationMs);
      span.setAttribute("stack.external-db-sync.poll-interval-ms", pollIntervalMs);
      span.setAttribute("stack.external-db-sync.batch-size", batchSize);

      let iterations = 0;

      type SequencerIterationResult = {
        stopReason: "disabled" | null,
      };

      while (performance.now() - startTime < maxDurationMs) {
        const iterationResult = await traceSpan<SequencerIterationResult>({
          description: "external-db-sync.sequencer.iteration",
          attributes: {
            "stack.external-db-sync.iteration": iterations + 1,
          },
        }, async (iterationSpan) => {
          const fusebox = await getExternalDbSyncFusebox();
          iterationSpan.setAttribute("stack.external-db-sync.sequencer-enabled", fusebox.sequencerEnabled);
          if (!fusebox.sequencerEnabled) {
            return { stopReason: "disabled" };
          }

          try {
            const didUpdate = await backfillSequenceIds(batchSize);
            iterationSpan.setAttribute("stack.external-db-sync.did-update", didUpdate);
          } catch (error) {
            iterationSpan.setAttribute("stack.external-db-sync.iteration-error", true);
            captureError(
              `sequencer-iteration-error`,
              error,
            );
          }

          return { stopReason: null };
        });

        iterations++;
        await wait(pollIntervalMs);
      }

      span.setAttribute("stack.external-db-sync.iterations", iterations);

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          ok: true,
          iterations,
        },
      };
    });
  },
});
