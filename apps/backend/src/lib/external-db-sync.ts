import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, PrismaClientTransaction } from "@/prisma-client";
import { DEFAULT_DB_SYNC_MAPPINGS } from "@stackframe/stack-shared/dist/config/db-sync-mappings";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { createClient as createClickhouseClient, type ClickHouseClient } from "@clickhouse/client";
import { captureError, StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { omit } from "@stackframe/stack-shared/dist/utils/objects";
import { Client as PostgresClient } from 'pg';

type ExternalDbType = 'postgres' | 'clickhouse';
type ExternalSyncRow = {
  tenancyId?: unknown,
  signed_up_at?: unknown,
  display_name?: unknown,
  profile_image_url?: unknown,
  primary_email?: unknown,
  primary_email_verified?: unknown,
  client_metadata?: unknown,
  client_read_only_metadata?: unknown,
  server_metadata?: unknown,
  sequence_id?: unknown,
  is_deleted?: unknown,
  project_id?: unknown,
  branch_id?: unknown,
  [key: string]: unknown,
};

function createClickhouseClientFromConnectionString(connectionString: string): ClickHouseClient {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch (error) {
    throw new StackAssertionError(
      `Invalid ClickHouse connection string '${connectionString}'. ` +
      `Expected a full URL like http://user:password@host:port/database.`
    );
  }

  if (!url.protocol.startsWith("http")) {
    throw new StackAssertionError(
      `Invalid ClickHouse connection string protocol '${url.protocol}'. Use http or https.`
    );
  }

  const database = url.pathname.replace(/^\//, "") || "default";

  return createClickhouseClient({
    url: url.origin,
    username: decodeURIComponent(url.username || "default"),
    password: decodeURIComponent(url.password || ""),
    database,
    request_timeout: 30000,
  });
}

async function pushRowsToPostgres(
  externalClient: PostgresClient,
  tableName: string,
  newRows: ExternalSyncRow[],
  upsertQuery: string,
  expectedTenancyId: string,
  mappingId: string,
) {
  if (newRows.length === 0) return;
  // Just for our own sanity, make sure that we have the right number of positional parameters
  // The last parameter is mapping_name for metadata tracking
  const placeholderMatches = upsertQuery.match(/\$\d+/g) ?? throwErr(`Could not find any positional parameters ($1, $2, ...) in the update SQL query.`);
  const expectedParamCount = Math.max(...placeholderMatches.map((m: string) => Number(m.slice(1))));
  const sampleRow = newRows[0];
  const orderedKeys = Object.keys(omit(sampleRow, ["tenancyId"]) as Record<string, unknown>);
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

function formatClickhouseTimestamp(value: unknown): string | null {
  const formatDate = (date: Date) =>
    date.toISOString().replace("T", " ").replace("Z", "");

  if (value instanceof Date) {
    return formatDate(value);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDate(parsed);
    }
  }
  return null;
}

async function pushRowsToClickhouse(
  externalClient: ClickHouseClient,
  tableName: string,
  newRows: ExternalSyncRow[],
  expectedTenancyId: string,
) {
  if (newRows.length === 0) return;

  const sampleRow = newRows[0];
  const orderedKeys = Object.keys(omit(sampleRow, ["tenancyId"]) as Record<string, unknown>);

  const rowsToInsert = newRows.map((row) => {
    const { tenancyId, ...rest } = row;

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

    const signedUpAt = formatClickhouseTimestamp(rest.signed_up_at);
    if (!signedUpAt) {
      throw new StackAssertionError(`Invalid signed_up_at value for table "${tableName}"`);
    }

    const projectId = rest.project_id;
    const branchId = rest.branch_id;
    if (typeof projectId !== "string" || typeof branchId !== "string") {
      throw new StackAssertionError(`Missing project_id or branch_id for table "${tableName}"`);
    }

    const toJsonString = (value: unknown) =>
      typeof value === "string" ? value : JSON.stringify(value ?? {});

    return {
      ...rest,
      display_name: typeof rest.display_name === "string" ? rest.display_name : null,
      profile_image_url: typeof rest.profile_image_url === "string" ? rest.profile_image_url : null,
      primary_email: typeof rest.primary_email === "string" ? rest.primary_email : null,
      primary_email_verified: Boolean(rest.primary_email_verified),
      signed_up_at: signedUpAt,
      client_metadata: toJsonString(rest.client_metadata),
      client_read_only_metadata: toJsonString(rest.client_read_only_metadata),
      server_metadata: toJsonString(rest.server_metadata),
      is_anonymous: Boolean(rest.is_anonymous),
      project_id: projectId,
      branch_id: branchId,
      sequence_id: Number(rest.sequence_id ?? 0),
      is_deleted: Boolean(rest.is_deleted),
    };
  });

  await externalClient.insert({
    table: tableName,
    values: rowsToInsert,
    format: "JSONEachRow",
    clickhouse_settings: {
      async_insert: 1,
    }
  });
}


async function syncMapping(
  externalClient: PostgresClient | ClickHouseClient,
  mappingId: string,
  mapping: typeof DEFAULT_DB_SYNC_MAPPINGS[keyof typeof DEFAULT_DB_SYNC_MAPPINGS],
  internalPrisma: PrismaClientTransaction,
  dbId: string,
  tenancyId: string,
  dbType: ExternalDbType,
) {
  const postgresClient = dbType === 'postgres' ? externalClient as PostgresClient : null;
  const clickhouseClient = dbType === 'clickhouse' ? externalClient as ClickHouseClient : null;

  const fetchQuery = mapping.internalDbFetchQuery;
  const updateQuery = mapping.externalDbUpdateQueries[dbType];
  const tableName = mapping.targetTable;

  const tableSchema = mapping.targetTableSchemas[dbType];
  if (!tableSchema) {
    throw new StackAssertionError(
      `No table schema found for mapping ${mappingId} and database type ${dbType}`
    );
  }

  if (dbType === 'postgres') {
    await postgresClient!.query(tableSchema);
  } else {
    const statements = tableSchema
      .split(";")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0);
    for (const stmt of statements) {
      await clickhouseClient!.exec({ query: `${stmt};` });
    }
  }

  let lastSequenceId = -1;
  if (dbType === 'postgres') {
    const metadataResult = await postgresClient!.query(
      `SELECT "last_synced_sequence_id" FROM "_stack_sync_metadata" WHERE "mapping_name" = $1`,
      [mappingId]
    );
    if (metadataResult.rows.length > 0) {
      lastSequenceId = Number(metadataResult.rows[0].last_synced_sequence_id);
    }
  } else {
    const metadataResult = await clickhouseClient!.query({
      query: `
        SELECT last_synced_sequence_id
        FROM _stack_sync_metadata FINAL
        WHERE mapping_name = {mapping_name:String}
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      query_params: { mapping_name: mappingId },
      format: "JSON",
    });
    const metadataJson = await metadataResult.json() as { data: { last_synced_sequence_id?: number }[] };
    const lastSynced = metadataJson.data[0]?.last_synced_sequence_id;
    if (lastSynced != null) {
      lastSequenceId = Number(lastSynced);
    }
  }

  const BATCH_LIMIT = 1000;

  while (true) {
    const rows = await internalPrisma.$queryRawUnsafe<ExternalSyncRow[]>(fetchQuery, tenancyId, lastSequenceId);

    if (rows.length === 0) {
      break;
    }

    if (dbType === 'postgres') {
      if (!updateQuery) {
        throw new StackAssertionError(`Missing update query for mapping ${mappingId} and database type ${dbType}`);
      }
      await pushRowsToPostgres(
        postgresClient!,
        tableName,
        rows,
        updateQuery,
        tenancyId,
        mappingId,
      );
    } else {
      await pushRowsToClickhouse(
        clickhouseClient!,
        tableName,
        rows,
        tenancyId,
      );
    }

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

    if (dbType === 'clickhouse' && lastSequenceId >= 0) {
      await clickhouseClient!.insert({
        table: "_stack_sync_metadata",
        values: [{ mapping_name: mappingId, last_synced_sequence_id: lastSequenceId }],
        format: "JSONEachRow",
      });
    }

    if (rows.length < BATCH_LIMIT) {
      break;
    }
  }
}


async function syncDatabase(
  dbId: string,
  dbConfig: CompleteConfig["dbSync"]["externalDatabases"][string],
  internalPrisma: PrismaClientTransaction,
  tenancyId: string,
) {
  if (dbConfig.type !== 'postgres' && dbConfig.type !== 'clickhouse') {
    throw new StackAssertionError(
      `Unsupported database type '${dbConfig.type}' for external DB ${dbId}. Only 'postgres' and 'clickhouse' are currently supported.`
    );
  }

  if (!dbConfig.connectionString) {
    throw new StackAssertionError(
      `Invalid configuration for external DB ${dbId}: 'connectionString' is missing.`
    );
  }

  const dbType = dbConfig.type as ExternalDbType;

  let externalClient: PostgresClient | ClickHouseClient | null = null;
  let closeExternalClient: (() => Promise<void>) = async () => {};

  try {
    if (dbType === "postgres") {
      const postgresClient = new PostgresClient({
        connectionString: dbConfig.connectionString,
      });
      await postgresClient.connect();
      externalClient = postgresClient;
      closeExternalClient = () => postgresClient.end();
    } else {
      const clickhouseClient = createClickhouseClientFromConnectionString(dbConfig.connectionString);
      await clickhouseClient.ping();
      externalClient = clickhouseClient;
      closeExternalClient = () => clickhouseClient.close();
    }

    // Always use DEFAULT_DB_SYNC_MAPPINGS - users cannot customize mappings
    // because internalDbFetchQuery runs against Stack Auth's internal DB
    for (const [mappingId, mapping] of Object.entries(DEFAULT_DB_SYNC_MAPPINGS)) {
      await syncMapping(
        externalClient,
        mappingId,
        mapping,
        internalPrisma,
        dbId,
        tenancyId,
        dbType,
      );
    }

  } catch (error) {
    try {
      await closeExternalClient();
    } catch {
      // ignore close errors
    }
    captureError(`external-db-sync-${dbId}`, error);
    return;
  }

  await closeExternalClient();
}


export async function syncExternalDatabases(tenancy: Tenancy) {
  const externalDatabases = tenancy.config.dbSync.externalDatabases;
  const internalPrisma = await getPrismaClientForTenancy(tenancy);

  for (const [dbId, dbConfig] of Object.entries(externalDatabases)) {
    try {
      await syncDatabase(dbId, dbConfig, internalPrisma, tenancy.id);
    } catch (error) {
      // Log the error but continue syncing other databases
      // This ensures one bad database config doesn't block successful syncs to other databases
      captureError(`external-db-sync-${dbId}`, error);
    }
  }
}
