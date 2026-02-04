import { globalPrismaClient } from "@/prisma-client";
import { Prisma } from "@/generated/prisma/client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import {
  adaptSchema,
  adminAuthTypeSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";
import { errorToNiceString, StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Client } from "pg";
import { KnownErrors } from "@stackframe/stack-shared";

const STALE_CLAIM_INTERVAL_MINUTES = 5;

const sequenceStatsSchema = yupObject({
  total: yupString().defined(),
  pending: yupString().defined(),
  null_sequence_id: yupString().defined(),
  min_sequence_id: yupString().nullable().defined(),
  max_sequence_id: yupString().nullable().defined(),
});

const deletedRowByTableSchema = yupObject({
  table_name: yupString().defined(),
  total: yupString().defined(),
  pending: yupString().defined(),
  null_sequence_id: yupString().defined(),
  min_sequence_id: yupString().nullable().defined(),
  max_sequence_id: yupString().nullable().defined(),
});

const externalDbMetadataSchema = yupObject({
  mapping_name: yupString().defined(),
  last_synced_sequence_id: yupString().defined(),
  updated_at_millis: yupNumber().nullable().defined(),
});

const externalDbMappingStatusSchema = yupObject({
  mapping_id: yupString().defined(),
  internal_max_sequence_id: yupString().nullable().defined(),
  last_synced_sequence_id: yupString().nullable().defined(),
  updated_at_millis: yupNumber().nullable().defined(),
  backlog: yupString().nullable().defined(),
});

const externalDbSchema = yupObject({
  id: yupString().defined(),
  type: yupString().defined(),
  connection: yupObject({
    redacted: yupString().nullable().defined(),
    host: yupString().nullable().defined(),
    port: yupNumber().nullable().defined(),
    database: yupString().nullable().defined(),
    user: yupString().nullable().defined(),
  }).defined(),
  status: yupString().oneOf(["ok", "error"]).defined(),
  error: yupString().nullable().defined(),
  metadata: yupArray(externalDbMetadataSchema).defined(),
  users_table: yupObject({
    exists: yupBoolean().defined(),
    total_rows: yupString().nullable().defined(),
    min_signed_up_at_millis: yupNumber().nullable().defined(),
    max_signed_up_at_millis: yupNumber().nullable().defined(),
  }).defined(),
  mapping_status: yupArray(externalDbMappingStatusSchema).defined(),
});

const mappingSchema = yupObject({
  mapping_id: yupString().defined(),
  internal_min_sequence_id: yupString().nullable().defined(),
  internal_max_sequence_id: yupString().nullable().defined(),
  internal_pending_count: yupString().defined(),
});

const globalSchema = yupObject({
  tenancies_total: yupString().defined(),
  tenancies_with_db_sync: yupString().defined(),
  sequencer: yupObject({
    project_users: sequenceStatsSchema.defined(),
    contact_channels: sequenceStatsSchema.defined(),
    deleted_rows: sequenceStatsSchema.shape({
      by_table: yupArray(deletedRowByTableSchema).defined(),
    }).defined(),
  }).defined(),
  poller: yupObject({
    total: yupString().defined(),
    pending: yupString().defined(),
    in_flight: yupString().defined(),
    stale: yupString().defined(),
    oldest_created_at_millis: yupNumber().nullable().defined(),
    newest_created_at_millis: yupNumber().nullable().defined(),
  }).defined(),
  sync_engine: yupObject({
    mappings: yupArray(mappingSchema).defined(),
  }).defined(),
});

const responseSchema = yupObject({
  statusCode: yupNumber().oneOf([200]).defined(),
  bodyType: yupString().oneOf(["json"]).defined(),
  body: yupObject({
    ok: yupBoolean().defined(),
    generated_at_millis: yupNumber().defined(),
    global: globalSchema.nullable().defined(),
    tenancy: yupObject({
      id: yupString().defined(),
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
    }).defined(),
    sequencer: yupObject({
      project_users: sequenceStatsSchema.defined(),
      contact_channels: sequenceStatsSchema.defined(),
      deleted_rows: sequenceStatsSchema.shape({
        by_table: yupArray(deletedRowByTableSchema).defined(),
      }).defined(),
    }).defined(),
    poller: yupObject({
      total: yupString().defined(),
      pending: yupString().defined(),
      in_flight: yupString().defined(),
      stale: yupString().defined(),
      oldest_created_at_millis: yupNumber().nullable().defined(),
      newest_created_at_millis: yupNumber().nullable().defined(),
    }).defined(),
    sync_engine: yupObject({
      mappings: yupArray(mappingSchema).defined(),
      external_databases: yupArray(externalDbSchema).defined(),
    }).defined(),
  }).defined(),
});

type SequenceStatsRow = {
  total: unknown,
  pending: unknown,
  null_sequence_id: unknown,
  min_sequence_id: unknown,
  max_sequence_id: unknown,
};

type DeletedRowStatsRow = SequenceStatsRow & {
  table_name: string,
};

type OutgoingStatsRow = {
  total: unknown,
  pending: unknown,
  in_flight: unknown,
  stale: unknown,
  oldest_created_at: unknown,
  newest_created_at: unknown,
};

type ExternalDbMetadataRow = {
  mapping_name: string,
  last_synced_sequence_id: unknown,
  updated_at: unknown,
};

type UsersTableStatsRow = {
  total_rows: unknown,
  min_signed_up_at: unknown,
  max_signed_up_at: unknown,
};

type CountRow = {
  total: unknown,
};

type SequenceStats = ReturnType<typeof formatSequenceStats>;
type DeletedRowSummary = SequenceStats & { table_name: string };

function toBigIntString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string") return value;
  return null;
}

function toBigIntStringOrThrow(value: unknown, label: string): string {
  return toBigIntString(value) ?? throwErr(`Expected ${label} to be a bigint-compatible value.`, { value });
}

function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
}

function addBigIntStrings(a: string | null | undefined, b: string | null | undefined): string {
  const first = a ? BigInt(a) : 0n;
  const second = b ? BigInt(b) : 0n;
  return (first + second).toString();
}

function minBigIntString(values: Array<string | null | undefined>): string | null {
  let minValue: bigint | null = null;
  for (const value of values) {
    if (!value) continue;
    const parsed = BigInt(value);
    if (minValue === null || parsed < minValue) {
      minValue = parsed;
    }
  }
  return minValue === null ? null : minValue.toString();
}

function maxBigIntString(values: Array<string | null | undefined>): string | null {
  let maxValue: bigint | null = null;
  for (const value of values) {
    if (!value) continue;
    const parsed = BigInt(value);
    if (maxValue === null || parsed > maxValue) {
      maxValue = parsed;
    }
  }
  return maxValue === null ? null : maxValue.toString();
}

function buildMappingInternalStats(
  projectUsersStats: SequenceStats,
  deletedRowsByTable: DeletedRowSummary[],
) {
  const deletedProjectUserStats = deletedRowsByTable.find((row) => row.table_name === "ProjectUser") ?? null;

  const mappingInternalStats = new Map<string, {
    mapping_id: string,
    internal_min_sequence_id: string | null,
    internal_max_sequence_id: string | null,
    internal_pending_count: string,
  }>();

  const usersMappingMin = minBigIntString([
    projectUsersStats.min_sequence_id,
    deletedProjectUserStats?.min_sequence_id,
  ]);
  const usersMappingMax = maxBigIntString([
    projectUsersStats.max_sequence_id,
    deletedProjectUserStats?.max_sequence_id,
  ]);
  const usersMappingPending = addBigIntStrings(
    projectUsersStats.pending,
    deletedProjectUserStats?.pending,
  );

  mappingInternalStats.set("users", {
    mapping_id: "users",
    internal_min_sequence_id: usersMappingMin,
    internal_max_sequence_id: usersMappingMax,
    internal_pending_count: usersMappingPending,
  });

  const mappings = Array.from(mappingInternalStats.values());
  const mappingStatuses = mappings.map((mapping) => ({
    mapping_id: mapping.mapping_id,
    internal_max_sequence_id: mapping.internal_max_sequence_id,
  }));

  return { mappings, mappingStatuses };
}

async function fetchInternalStats(tenancyId: string | null) {
  const tenancyWhere = tenancyId
    ? Prisma.sql`WHERE "tenancyId" = ${tenancyId}::uuid`
    : Prisma.sql``;

  const projectUserStatsRow = (await globalPrismaClient.$queryRaw<SequenceStatsRow[]>`
    SELECT
      COUNT(*)::bigint AS "total",
      COUNT(*) FILTER (WHERE "shouldUpdateSequenceId" = TRUE OR "sequenceId" IS NULL)::bigint AS "pending",
      COUNT(*) FILTER (WHERE "sequenceId" IS NULL)::bigint AS "null_sequence_id",
      MIN("sequenceId") AS "min_sequence_id",
      MAX("sequenceId") AS "max_sequence_id"
    FROM "ProjectUser"
    ${tenancyWhere}
  `).at(0) ?? throwErr("Project user stats query returned no rows.");

  const contactChannelStatsRow = (await globalPrismaClient.$queryRaw<SequenceStatsRow[]>`
    SELECT
      COUNT(*)::bigint AS "total",
      COUNT(*) FILTER (WHERE "shouldUpdateSequenceId" = TRUE OR "sequenceId" IS NULL)::bigint AS "pending",
      COUNT(*) FILTER (WHERE "sequenceId" IS NULL)::bigint AS "null_sequence_id",
      MIN("sequenceId") AS "min_sequence_id",
      MAX("sequenceId") AS "max_sequence_id"
    FROM "ContactChannel"
    ${tenancyWhere}
  `).at(0) ?? throwErr("Contact channel stats query returned no rows.");

  const deletedRowStatsRow = (await globalPrismaClient.$queryRaw<SequenceStatsRow[]>`
    SELECT
      COUNT(*)::bigint AS "total",
      COUNT(*) FILTER (WHERE "shouldUpdateSequenceId" = TRUE OR "sequenceId" IS NULL)::bigint AS "pending",
      COUNT(*) FILTER (WHERE "sequenceId" IS NULL)::bigint AS "null_sequence_id",
      MIN("sequenceId") AS "min_sequence_id",
      MAX("sequenceId") AS "max_sequence_id"
    FROM "DeletedRow"
    ${tenancyWhere}
  `).at(0) ?? throwErr("Deleted row stats query returned no rows.");

  const deletedRowsByTableRows = await globalPrismaClient.$queryRaw<DeletedRowStatsRow[]>`
    SELECT
      "tableName" AS "table_name",
      COUNT(*)::bigint AS "total",
      COUNT(*) FILTER (WHERE "shouldUpdateSequenceId" = TRUE OR "sequenceId" IS NULL)::bigint AS "pending",
      COUNT(*) FILTER (WHERE "sequenceId" IS NULL)::bigint AS "null_sequence_id",
      MIN("sequenceId") AS "min_sequence_id",
      MAX("sequenceId") AS "max_sequence_id"
    FROM "DeletedRow"
    ${tenancyWhere}
    GROUP BY "tableName"
    ORDER BY "tableName" ASC
  `;

  const outgoingTenancyFilter = tenancyId
    ? Prisma.sql`AND ("qstashOptions"->'body'->>'tenancyId') = ${tenancyId}`
    : Prisma.sql``;

  const outgoingStatsRow = (await globalPrismaClient.$queryRaw<OutgoingStatsRow[]>`
    SELECT
      COUNT(*)::bigint AS "total",
      COUNT(*) FILTER (WHERE "startedFulfillingAt" IS NULL)::bigint AS "pending",
      COUNT(*) FILTER (WHERE "startedFulfillingAt" IS NOT NULL)::bigint AS "in_flight",
      COUNT(*) FILTER (
        WHERE "startedFulfillingAt" < NOW() - (${STALE_CLAIM_INTERVAL_MINUTES} * INTERVAL '1 minute')
      )::bigint AS "stale",
      MIN("createdAt") AS "oldest_created_at",
      MAX("createdAt") AS "newest_created_at"
    FROM "OutgoingRequest"
    WHERE ("qstashOptions"->>'url') = '/api/latest/internal/external-db-sync/sync-engine'
    ${outgoingTenancyFilter}
  `).at(0) ?? throwErr("Outgoing request stats query returned no rows.");

  const projectUsersStats = formatSequenceStats(projectUserStatsRow);
  const contactChannelStats = formatSequenceStats(contactChannelStatsRow);
  const deletedRowStats = formatSequenceStats(deletedRowStatsRow);

  const deletedRowsByTable = deletedRowsByTableRows.map((row) => ({
    table_name: row.table_name,
    ...formatSequenceStats(row),
  }));

  const { mappings, mappingStatuses } = buildMappingInternalStats(projectUsersStats, deletedRowsByTable);

  return {
    projectUsersStats,
    contactChannelStats,
    deletedRowStats,
    deletedRowsByTable,
    outgoingStatsRow,
    mappings,
    mappingStatuses,
  };
}

function formatPollerStats(outgoingStats: OutgoingStatsRow) {
  return {
    total: toBigIntStringOrThrow(outgoingStats.total, "outgoing total"),
    pending: toBigIntStringOrThrow(outgoingStats.pending, "outgoing pending"),
    in_flight: toBigIntStringOrThrow(outgoingStats.in_flight, "outgoing in_flight"),
    stale: toBigIntStringOrThrow(outgoingStats.stale, "outgoing stale"),
    oldest_created_at_millis: toMillis(outgoingStats.oldest_created_at),
    newest_created_at_millis: toMillis(outgoingStats.newest_created_at),
  };
}

function formatSequenceStats(row: SequenceStatsRow) {
  return {
    total: toBigIntStringOrThrow(row.total, "sequence stats total"),
    pending: toBigIntStringOrThrow(row.pending, "sequence stats pending"),
    null_sequence_id: toBigIntStringOrThrow(row.null_sequence_id, "sequence stats null_sequence_id"),
    min_sequence_id: toBigIntString(row.min_sequence_id),
    max_sequence_id: toBigIntString(row.max_sequence_id),
  };
}

function formatError(error: unknown): string {
  return errorToNiceString(error);
}

function parseConnectionString(connectionString: string | null | undefined) {
  if (!connectionString) {
    return {
      redacted: null,
      host: null,
      port: null,
      database: null,
      user: null,
    };
  }

  const parsed = Result.fromThrowing(() => new URL(connectionString));
  if (parsed.status === "error") {
    return {
      redacted: null,
      host: null,
      port: null,
      database: null,
      user: null,
    };
  }

  const url = parsed.data;
  const user = url.username ? decodeURIComponent(url.username) : null;
  const host = url.hostname || null;
  const port = url.port ? Number.parseInt(url.port, 10) : null;
  const database = url.pathname ? url.pathname.replace(/^\//, "") : null;
  const redacted = `${url.protocol}//${url.username ? encodeURIComponent(url.username) : ""}${url.username ? ":" : ""}${url.password ? "***" : ""}${url.username ? "@" : ""}${url.hostname}${url.port ? ":" + url.port : ""}${url.pathname}${url.search}`;

  return {
    redacted,
    host,
    port: Number.isFinite(port ?? NaN) ? port : null,
    database,
    user,
  };
}

async function fetchExternalDatabaseStatus(
  dbId: string,
  dbConfig: CompleteConfig["dbSync"]["externalDatabases"][string],
  mappingStatuses: Array<{
    mapping_id: string,
    internal_max_sequence_id: string | null,
  }>,
) {
  const connection = parseConnectionString(dbConfig.connectionString ?? null);

  if (dbConfig.type !== "postgres") {
    return {
      id: dbId,
      type: String(dbConfig.type),
      connection,
      status: "error" as const,
      error: `Unsupported database type: ${String(dbConfig.type)}`,
      metadata: [],
      users_table: {
        exists: false,
        total_rows: null,
        min_signed_up_at_millis: null,
        max_signed_up_at_millis: null,
      },
      mapping_status: mappingStatuses.map((mapping) => ({
        mapping_id: mapping.mapping_id,
        internal_max_sequence_id: mapping.internal_max_sequence_id,
        last_synced_sequence_id: null,
        updated_at_millis: null,
        backlog: null,
      })),
    };
  }

  if (!dbConfig.connectionString) {
    return {
      id: dbId,
      type: dbConfig.type,
      connection,
      status: "error" as const,
      error: "Missing connection string",
      metadata: [],
      users_table: {
        exists: false,
        total_rows: null,
        min_signed_up_at_millis: null,
        max_signed_up_at_millis: null,
      },
      mapping_status: mappingStatuses.map((mapping) => ({
        mapping_id: mapping.mapping_id,
        internal_max_sequence_id: mapping.internal_max_sequence_id,
        last_synced_sequence_id: null,
        updated_at_millis: null,
        backlog: null,
      })),
    };
  }

  const client = new Client({ connectionString: dbConfig.connectionString });
  const connectResult = await Result.fromPromise(client.connect());
  if (connectResult.status === "error") {
    return {
      id: dbId,
      type: dbConfig.type,
      connection,
      status: "error" as const,
      error: formatError(connectResult.error),
      metadata: [],
      users_table: {
        exists: false,
        total_rows: null,
        min_signed_up_at_millis: null,
        max_signed_up_at_millis: null,
      },
      mapping_status: mappingStatuses.map((mapping) => ({
        mapping_id: mapping.mapping_id,
        internal_max_sequence_id: mapping.internal_max_sequence_id,
        last_synced_sequence_id: null,
        updated_at_millis: null,
        backlog: null,
      })),
    };
  }

  let metadata: ExternalDbMetadataRow[] = [];
  let metadataExists = false;
  let usersExists = false;
  let usersStats: UsersTableStatsRow | null = null;

  try {
    const metadataExistsResult = await Result.fromPromise(client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '_stack_sync_metadata'
      ) AS "exists";
    `));
    if (metadataExistsResult.status === "error") {
      return {
        id: dbId,
        type: dbConfig.type,
        connection,
        status: "error" as const,
        error: formatError(metadataExistsResult.error),
        metadata: [],
        users_table: {
          exists: false,
          total_rows: null,
          min_signed_up_at_millis: null,
          max_signed_up_at_millis: null,
        },
        mapping_status: mappingStatuses.map((mapping) => ({
          mapping_id: mapping.mapping_id,
          internal_max_sequence_id: mapping.internal_max_sequence_id,
          last_synced_sequence_id: null,
          updated_at_millis: null,
          backlog: null,
        })),
      };
    }
    metadataExists = metadataExistsResult.data.rows[0]?.exists === true;

    const usersExistsResult = await Result.fromPromise(client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'users'
      ) AS "exists";
    `));
    if (usersExistsResult.status === "error") {
      return {
        id: dbId,
        type: dbConfig.type,
        connection,
        status: "error" as const,
        error: formatError(usersExistsResult.error),
        metadata: [],
        users_table: {
          exists: false,
          total_rows: null,
          min_signed_up_at_millis: null,
          max_signed_up_at_millis: null,
        },
        mapping_status: mappingStatuses.map((mapping) => ({
          mapping_id: mapping.mapping_id,
          internal_max_sequence_id: mapping.internal_max_sequence_id,
          last_synced_sequence_id: null,
          updated_at_millis: null,
          backlog: null,
        })),
      };
    }
    usersExists = usersExistsResult.data.rows[0]?.exists === true;

    if (metadataExists) {
      const metadataResult = await Result.fromPromise(client.query<ExternalDbMetadataRow>(`
        SELECT "mapping_name", "last_synced_sequence_id", "updated_at"
        FROM "_stack_sync_metadata"
        ORDER BY "mapping_name" ASC;
      `));
      if (metadataResult.status === "error") {
        return {
          id: dbId,
          type: dbConfig.type,
          connection,
          status: "error" as const,
          error: formatError(metadataResult.error),
          metadata: [],
          users_table: {
            exists: usersExists,
            total_rows: null,
            min_signed_up_at_millis: null,
            max_signed_up_at_millis: null,
          },
          mapping_status: mappingStatuses.map((mapping) => ({
            mapping_id: mapping.mapping_id,
            internal_max_sequence_id: mapping.internal_max_sequence_id,
            last_synced_sequence_id: null,
            updated_at_millis: null,
            backlog: null,
          })),
        };
      }
      metadata = metadataResult.data.rows;
    }

    if (usersExists) {
      const usersStatsResult = await Result.fromPromise(client.query<UsersTableStatsRow>(`
        SELECT
          COUNT(*)::bigint AS "total_rows",
          MIN("signed_up_at") AS "min_signed_up_at",
          MAX("signed_up_at") AS "max_signed_up_at"
        FROM "users";
      `));
      if (usersStatsResult.status === "error") {
        return {
          id: dbId,
          type: dbConfig.type,
          connection,
          status: "error" as const,
          error: formatError(usersStatsResult.error),
          metadata: metadata.map((row) => ({
            mapping_name: row.mapping_name,
            last_synced_sequence_id: toBigIntString(row.last_synced_sequence_id) ?? "-1",
            updated_at_millis: toMillis(row.updated_at),
          })),
          users_table: {
            exists: usersExists,
            total_rows: null,
            min_signed_up_at_millis: null,
            max_signed_up_at_millis: null,
          },
          mapping_status: mappingStatuses.map((mapping) => ({
            mapping_id: mapping.mapping_id,
            internal_max_sequence_id: mapping.internal_max_sequence_id,
            last_synced_sequence_id: null,
            updated_at_millis: null,
            backlog: null,
          })),
        };
      }
      usersStats = usersStatsResult.data.rows[0] ?? null;
    }
  } finally {
    await Result.fromPromise(client.end());
  }

  const metadataMap = new Map<string, { last_synced_sequence_id: string | null, updated_at_millis: number | null }>();
  const formattedMetadata = metadata.map((row) => {
    const lastSynced = toBigIntString(row.last_synced_sequence_id) ?? "-1";
    const updatedAt = toMillis(row.updated_at);
    metadataMap.set(row.mapping_name, { last_synced_sequence_id: lastSynced, updated_at_millis: updatedAt });
    return {
      mapping_name: row.mapping_name,
      last_synced_sequence_id: lastSynced,
      updated_at_millis: updatedAt,
    };
  });

  const mappingStatus = mappingStatuses.map((mapping) => {
    const external = metadataMap.get(mapping.mapping_id);
    const lastSynced = external?.last_synced_sequence_id ?? null;
    const updatedAt = external?.updated_at_millis ?? null;
    let backlog: string | null = null;
    if (mapping.internal_max_sequence_id && lastSynced) {
      backlog = (BigInt(mapping.internal_max_sequence_id) - BigInt(lastSynced)).toString();
    }
    return {
      mapping_id: mapping.mapping_id,
      internal_max_sequence_id: mapping.internal_max_sequence_id,
      last_synced_sequence_id: lastSynced,
      updated_at_millis: updatedAt,
      backlog,
    };
  });

  return {
    id: dbId,
    type: dbConfig.type,
    connection,
    status: "ok" as const,
    error: null,
    metadata: formattedMetadata,
    users_table: {
      exists: usersExists,
      total_rows: toBigIntString(usersStats?.total_rows ?? null),
      min_signed_up_at_millis: toMillis(usersStats?.min_signed_up_at ?? null),
      max_signed_up_at_millis: toMillis(usersStats?.max_signed_up_at ?? null),
    },
    mapping_status: mappingStatus,
  };
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "External DB sync status",
    description: "Returns sequencing, queue, and external sync progress for the current tenancy. Optional global aggregate when scope=all.",
    tags: ["External DB Sync"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    query: yupObject({
      scope: yupString().oneOf(["tenancy", "all"]).default("tenancy"),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: responseSchema,
  handler: async ({ auth, query }) => {
    if (auth.tenancy.project.id !== "internal") {
      throw new KnownErrors.ExpectedInternalProject();
    }
    const tenancyId = auth.tenancy.id;

    const shouldIncludeGlobal = query.scope === "all";
    const currentStats = shouldIncludeGlobal ? await fetchInternalStats(null) : await fetchInternalStats(tenancyId);
    const globalStats = shouldIncludeGlobal ? currentStats : null;
    const globalTenanciesCount = shouldIncludeGlobal
      ? (await globalPrismaClient.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS "total"
          FROM "Tenancy"
        `).at(0) ?? throwErr("Tenancy count query returned no rows.")
      : null;
    const globalDbSyncCount = shouldIncludeGlobal
      ? (await globalPrismaClient.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS "total"
          FROM "EnvironmentConfigOverride"
          WHERE ("config"->'dbSync'->'externalDatabases') IS NOT NULL
        `).at(0) ?? throwErr("DB sync config count query returned no rows.")
      : null;

    const externalDbStatuses = shouldIncludeGlobal
      ? []
      : await Promise.all(
          Object.entries(
            auth.tenancy.config.dbSync.externalDatabases as CompleteConfig["dbSync"]["externalDatabases"],
          ).map(([dbId, dbConfig]) => fetchExternalDatabaseStatus(dbId, dbConfig, currentStats.mappingStatuses)),
        );

    const outgoingStats = currentStats.outgoingStatsRow;

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        ok: true,
        generated_at_millis: Date.now(),
        global: shouldIncludeGlobal && globalStats && globalTenanciesCount && globalDbSyncCount ? {
          tenancies_total: toBigIntStringOrThrow(globalTenanciesCount.total, "tenancies total"),
          tenancies_with_db_sync: toBigIntStringOrThrow(globalDbSyncCount.total, "tenancies with db sync"),
          sequencer: {
            project_users: globalStats.projectUsersStats,
            contact_channels: globalStats.contactChannelStats,
            deleted_rows: {
              ...globalStats.deletedRowStats,
              by_table: globalStats.deletedRowsByTable,
            },
          },
          poller: formatPollerStats(globalStats.outgoingStatsRow),
          sync_engine: {
            mappings: globalStats.mappings,
          },
        } : null,
        tenancy: {
          id: tenancyId,
          project_id: auth.tenancy.project.id,
          branch_id: auth.tenancy.branchId,
        },
        sequencer: {
          project_users: currentStats.projectUsersStats,
          contact_channels: currentStats.contactChannelStats,
          deleted_rows: {
            ...currentStats.deletedRowStats,
            by_table: currentStats.deletedRowsByTable,
          },
        },
        poller: formatPollerStats(outgoingStats),
        sync_engine: {
          mappings: currentStats.mappings,
          external_databases: externalDbStatuses,
        },
      },
    };
  },
});
