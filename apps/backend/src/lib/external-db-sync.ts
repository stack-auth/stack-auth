import { Tenancy } from "@/lib/tenancies";
import type { PrismaTransaction } from "@/lib/types";
import { getPrismaClientForTenancy, PrismaClientWithReplica } from "@/prisma-client";
import { Prisma } from "@/generated/prisma/client";
import { DEFAULT_DB_SYNC_MAPPINGS } from "@stackframe/stack-shared/dist/config/db-sync-mappings";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { captureError, StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { omit } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Client } from 'pg';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCHES_PER_MAPPING_ENV = "STACK_EXTERNAL_DB_SYNC_MAX_BATCHES_PER_MAPPING";

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StackAssertionError(`${label} must be a non-empty string.`);
  }
}

function assertUuid(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (!UUID_REGEX.test(value)) {
    throw new StackAssertionError(`${label} must be a valid UUID. Received: ${JSON.stringify(value)}`);
  }
}

type ExternalDbSyncClient = PrismaTransaction | PrismaClientWithReplica;

type ExternalDbSyncTarget =
  | {
    tableName: "ProjectUser",
    tenancyId: string,
    projectUserId: string,
  }
  | {
    tableName: "ContactChannel",
    tenancyId: string,
    projectUserId: string,
    contactChannelId: string,
  };

export function withExternalDbSyncUpdate<T extends object>(data: T): T & { shouldUpdateSequenceId: true } {
  return {
    ...data,
    shouldUpdateSequenceId: true,
  };
}

export async function markProjectUserForExternalDbSync(
  tx: ExternalDbSyncClient,
  options: {
    tenancyId: string,
    projectUserId: string,
  }
): Promise<void> {
  assertUuid(options.tenancyId, "tenancyId");
  assertUuid(options.projectUserId, "projectUserId");
  await tx.projectUser.update({
    where: {
      tenancyId_projectUserId: {
        tenancyId: options.tenancyId,
        projectUserId: options.projectUserId,
      },
    },
    data: {
      shouldUpdateSequenceId: true,
    },
  });
}

export async function recordExternalDbSyncDeletion(
  tx: ExternalDbSyncClient,
  target: ExternalDbSyncTarget,
): Promise<void> {
  assertUuid(target.tenancyId, "tenancyId");
  assertUuid(target.projectUserId, "projectUserId");

  if (target.tableName === "ProjectUser") {
    const insertedCount = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "DeletedRow" (
        "id",
        "tenancyId",
        "tableName",
        "primaryKey",
        "data",
        "deletedAt",
        "shouldUpdateSequenceId"
      )
      SELECT
        gen_random_uuid(),
        "tenancyId",
        'ProjectUser',
        jsonb_build_object('tenancyId', "tenancyId", 'projectUserId', "projectUserId"),
        to_jsonb("ProjectUser".*),
        NOW(),
        TRUE
      FROM "ProjectUser"
      WHERE "tenancyId" = ${target.tenancyId}::uuid
        AND "projectUserId" = ${target.projectUserId}::uuid
      FOR UPDATE
    `);

    if (insertedCount !== 1) {
      throw new StackAssertionError(
        `Expected to insert 1 DeletedRow entry for ProjectUser, got ${insertedCount}.`
      );
    }
    return;
  }

  assertUuid(target.contactChannelId, "contactChannelId");
  const insertedCount = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "DeletedRow" (
      "id",
      "tenancyId",
      "tableName",
      "primaryKey",
      "data",
      "deletedAt",
      "shouldUpdateSequenceId"
    )
    SELECT
      gen_random_uuid(),
      "tenancyId",
      'ContactChannel',
      jsonb_build_object(
        'tenancyId',
        "tenancyId",
        'projectUserId',
        "projectUserId",
        'id',
        "id"
      ),
      to_jsonb("ContactChannel".*),
      NOW(),
      TRUE
    FROM "ContactChannel"
    WHERE "tenancyId" = ${target.tenancyId}::uuid
      AND "projectUserId" = ${target.projectUserId}::uuid
      AND "id" = ${target.contactChannelId}::uuid
    FOR UPDATE
  `);

  if (insertedCount !== 1) {
    throw new StackAssertionError(
      `Expected to insert 1 DeletedRow entry for ContactChannel, got ${insertedCount}.`
    );
  }
}

export async function recordExternalDbSyncContactChannelDeletionsForUser(
  tx: ExternalDbSyncClient,
  options: {
    tenancyId: string,
    projectUserId: string,
  },
): Promise<void> {
  assertUuid(options.tenancyId, "tenancyId");
  assertUuid(options.projectUserId, "projectUserId");

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "DeletedRow" (
      "id",
      "tenancyId",
      "tableName",
      "primaryKey",
      "data",
      "deletedAt",
      "shouldUpdateSequenceId"
    )
    SELECT
      gen_random_uuid(),
      "tenancyId",
      'ContactChannel',
      jsonb_build_object(
        'tenancyId',
        "tenancyId",
        'projectUserId',
        "projectUserId",
        'id',
        "id"
      ),
      to_jsonb("ContactChannel".*),
      NOW(),
      TRUE
    FROM "ContactChannel"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "projectUserId" = ${options.projectUserId}::uuid
    FOR UPDATE
  `);
}

type PgErrorLike = {
  code?: string,
  constraint?: string,
  message?: string,
};

function isDuplicateTypeError(error: unknown): error is PgErrorLike {
  if (!error || typeof error !== "object") return false;
  const pgError = error as PgErrorLike;
  return pgError.code === "23505" && pgError.constraint === "pg_type_typname_nsp_index";
}

function isConcurrentUpdateError(error: unknown): error is PgErrorLike {
  if (!error || typeof error !== "object") return false;
  const pgError = error as PgErrorLike;
  // "tuple concurrently updated" occurs when multiple transactions race to modify
  // the same system catalog row (e.g., during concurrent CREATE TABLE IF NOT EXISTS)
  return typeof pgError.message === "string" && pgError.message.includes("tuple concurrently updated");
}

function getMaxBatchesPerMapping(): number | null {
  const rawValue = getEnvVariable(MAX_BATCHES_PER_MAPPING_ENV, "");
  if (!rawValue) return null;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new StackAssertionError(
      `${MAX_BATCHES_PER_MAPPING_ENV} must be a positive integer. Received: ${JSON.stringify(rawValue)}`
    );
  }
  return parsed;
}

async function ensureExternalSchema(
  externalClient: Client,
  tableSchemaSql: string,
  tableName: string,
) {
  try {
    await externalClient.query(tableSchemaSql);
  } catch (error) {
    // Concurrent CREATE TABLE can race and cause various errors:
    // - duplicate type error (23505 on pg_type_typname_nsp_index)
    // - tuple concurrently updated (system catalog row modified by another transaction)
    // If the table now exists, we can safely continue.
    if (!isDuplicateTypeError(error) && !isConcurrentUpdateError(error)) {
      throw error;
    }

    const existsResult = await externalClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `, [tableName]);
    if (existsResult.rows[0]?.exists === true) {
      return;
    }

    throw new StackAssertionError(
      `Schema creation error while creating table ${JSON.stringify(tableName)}, but table does not exist.`
    );
  }
}

async function pushRowsToExternalDb(
  externalClient: Client,
  tableName: string,
  newRows: any[],
  upsertQuery: string,
  expectedTenancyId: string,
  mappingId: string,
) {
  assertNonEmptyString(tableName, "tableName");
  assertNonEmptyString(mappingId, "mappingId");
  assertUuid(expectedTenancyId, "expectedTenancyId");
  if (!Array.isArray(newRows)) {
    throw new StackAssertionError(`newRows must be an array for table ${JSON.stringify(tableName)}.`);
  }
  if (newRows.length === 0) return;
  // Just for our own sanity, make sure that we have the right number of positional parameters
  // The last parameter is mapping_name for metadata tracking
  const placeholderMatches = upsertQuery.match(/\$\d+/g) ?? throwErr(`Could not find any positional parameters ($1, $2, ...) in the update SQL query.`);
  const expectedParamCount = Math.max(...placeholderMatches.map((m: string) => Number(m.slice(1))));
  const sampleRow = newRows[0];
  const orderedKeys = Object.keys(omit(sampleRow, ["tenancyId"]));
  // +1 for mapping_name parameter which is appended
  if (orderedKeys.length + 1 !== expectedParamCount) {
    throw new StackAssertionError(`
      Column count mismatch for table ${JSON.stringify(tableName)}
       → upsertQuery expects ${expectedParamCount} parameters (last one should be mapping_name).
       → internalDbFetchQuery returned ${orderedKeys.length} columns (excluding tenancyId) + 1 for mapping_name = ${orderedKeys.length + 1}.
      Fix your SELECT column order or your SQL parameter order.
    `);
  }

  for (const row of newRows) {
    const { tenancyId, ...rest } = row;

    // Validate that all rows belong to the expected tenant
    if (tenancyId !== expectedTenancyId) {
      throw new StackAssertionError(
        `Row has unexpected tenancyId. Expected ${expectedTenancyId}, got ${tenancyId}. ` +
        `This indicates a bug in the internalDbFetchQuery.`
      );
    }

    const rowKeys = Object.keys(rest);

    const validShape =
      rowKeys.length === orderedKeys.length &&
      rowKeys.every((k, i) => k === orderedKeys[i]);

    if (!validShape) {
      throw new StackAssertionError(
        `  Row shape mismatch for table "${tableName}".\n` +
          `Expected column order: [${orderedKeys.join(", ")}]\n` +
          `Received column order: [${rowKeys.join(", ")}]\n` +
          `Your SELECT must be explicit, ordered, and NEVER use SELECT *.\n` +
          `Fix the SELECT in internalDbFetchQuery immediately.`
      );
    }

    // Append mapping_name as the last parameter for metadata tracking
    await externalClient.query(upsertQuery, [...Object.values(rest), mappingId]);
  }
}


async function syncMapping(
  externalClient: Client,
  mappingId: string,
  mapping: typeof DEFAULT_DB_SYNC_MAPPINGS[keyof typeof DEFAULT_DB_SYNC_MAPPINGS],
  internalPrisma: PrismaClientWithReplica,
  dbId: string,
  tenancyId: string,
  dbType: 'postgres',
): Promise<boolean> {
  assertNonEmptyString(mappingId, "mappingId");
  assertNonEmptyString(mapping.targetTable, "mapping.targetTable");
  assertUuid(tenancyId, "tenancyId");
  const fetchQuery = mapping.internalDbFetchQuery;
  const updateQuery = mapping.externalDbUpdateQueries[dbType];
  const tableName = mapping.targetTable;
  assertNonEmptyString(fetchQuery, "internalDbFetchQuery");
  assertNonEmptyString(updateQuery, "externalDbUpdateQueries");
  if (!fetchQuery.includes("$1") || !fetchQuery.includes("$2")) {
    throw new StackAssertionError(
      `internalDbFetchQuery must reference $1 (tenancyId) and $2 (lastSequenceId). Mapping: ${mappingId}`
    );
  }

  const tableSchema = mapping.targetTableSchemas[dbType];
  await ensureExternalSchema(externalClient, tableSchema, tableName);

  let lastSequenceId = -1;
  const metadataResult = await externalClient.query(
    `SELECT "last_synced_sequence_id" FROM "_stack_sync_metadata" WHERE "mapping_name" = $1`,
    [mappingId]
  );
  if (metadataResult.rows.length > 0) {
    lastSequenceId = Number(metadataResult.rows[0].last_synced_sequence_id);
  }
  if (!Number.isFinite(lastSequenceId)) {
    throw new StackAssertionError(
      `Invalid last_synced_sequence_id for mapping ${mappingId}: ${JSON.stringify(metadataResult.rows[0]?.last_synced_sequence_id)}`
    );
  }

  const BATCH_LIMIT = 1000;
  const maxBatchesPerMapping = getMaxBatchesPerMapping();
  let batchesProcessed = 0;
  let throttled = false;

  while (true) {
    assertUuid(tenancyId, "tenancyId");
    if (!Number.isFinite(lastSequenceId)) {
      throw new StackAssertionError(`lastSequenceId must be a finite number for mapping ${mappingId}.`);
    }
    const rows = await internalPrisma.$replica().$queryRawUnsafe<any[]>(fetchQuery, tenancyId, lastSequenceId);

    if (rows.length === 0) {
      break;
    }

    await pushRowsToExternalDb(
      externalClient,
      tableName,
      rows,
      updateQuery,
      tenancyId,
      mappingId,
    );

    let maxSeqInBatch = lastSequenceId;
    for (const row of rows) {
      const seq = row.sequence_id;
      if (seq != null) {
        const seqNum = typeof seq === 'bigint' ? Number(seq) : Number(seq);
        if (seqNum > maxSeqInBatch) {
          maxSeqInBatch = seqNum;
        }
      }
    }
    lastSequenceId = maxSeqInBatch;

    if (rows.length < BATCH_LIMIT) {
      break;
    }

    batchesProcessed++;
    if (maxBatchesPerMapping !== null && batchesProcessed >= maxBatchesPerMapping) {
      throttled = true;
      break;
    }
  }

  return throttled;
}


async function syncDatabase(
  dbId: string,
  dbConfig: CompleteConfig["dbSync"]["externalDatabases"][string],
  internalPrisma: PrismaClientWithReplica,
  tenancyId: string,
): Promise<boolean> {
  assertNonEmptyString(dbId, "dbId");
  assertUuid(tenancyId, "tenancyId");
  const dbType = dbConfig.type;
  if (dbType !== 'postgres') {
    throw new StackAssertionError(
      `Unsupported database type '${String(dbType)}' for external DB ${dbId}. Only 'postgres' is currently supported.`
    );
  }

  if (!dbConfig.connectionString) {
    throw new StackAssertionError(
      `Invalid configuration for external DB ${dbId}: 'connectionString' is missing.`
    );
  }
  assertNonEmptyString(dbConfig.connectionString, `external DB ${dbId} connectionString`);

  const externalClient = new Client({
    connectionString: dbConfig.connectionString,
  });

  let needsResync = false;
  const syncResult = await Result.fromPromise((async () => {
    await externalClient.connect();

    // Always use DEFAULT_DB_SYNC_MAPPINGS - users cannot customize mappings
    // because internalDbFetchQuery runs against Stack Auth's internal DB
    for (const [mappingId, mapping] of Object.entries(DEFAULT_DB_SYNC_MAPPINGS)) {
      const mappingThrottled = await syncMapping(
        externalClient,
        mappingId,
        mapping,
        internalPrisma,
        dbId,
        tenancyId,
        dbType,
      );
      if (mappingThrottled) {
        needsResync = true;
      }
    }
  })());

  const closeResult = await Result.fromPromise(externalClient.end());
  if (closeResult.status === "error") {
    captureError(`external-db-sync-${dbId}-close`, closeResult.error);
  }

  if (syncResult.status === "error") {
    captureError(`external-db-sync-${dbId}`, syncResult.error);
    return false;
  }

  return needsResync;
}


export async function syncExternalDatabases(tenancy: Tenancy): Promise<boolean> {
  assertUuid(tenancy.id, "tenancy.id");
  const externalDatabases = tenancy.config.dbSync.externalDatabases;
  const internalPrisma = await getPrismaClientForTenancy(tenancy);
  let needsResync = false;

  for (const [dbId, dbConfig] of Object.entries(externalDatabases)) {
    try {
      const databaseThrottled = await syncDatabase(dbId, dbConfig, internalPrisma, tenancy.id);
      if (databaseThrottled) {
        needsResync = true;
      }
    } catch (error) {
      // Log the error but continue syncing other databases
      // This ensures one bad database config doesn't block successful syncs to other databases
      captureError(`external-db-sync-${dbId}`, error);
    }
  }

  return needsResync;
}
