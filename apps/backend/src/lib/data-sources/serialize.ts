import type { DataSource, DataSourceStream } from "@/generated/prisma/client";
import {
  DATA_SOURCE_SYNC_MODES,
  getDefaultCursorColumn,
  getModeAvailability,
  getRecommendedMode,
  type DataSourceCapabilities,
} from "@hexclave/shared/dist/data-sources/modes";
import { MODE_FROM_PRISMA, TYPE_FROM_PRISMA } from "./enums";
import type { DataSourceProbeResult } from "./types";

const STATUS_FROM_PRISMA = {
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  FAILED: "failed",
} as const;

const STREAM_STATUS_FROM_PRISMA = {
  PENDING: "pending",
  SNAPSHOTTING: "snapshotting",
  ACTIVE: "active",
  FAILED: "failed",
} as const;

export function serializeStream(stream: DataSourceStream) {
  return {
    id: stream.id,
    schema_name: stream.schemaName,
    table_name: stream.tableName,
    mode: MODE_FROM_PRISMA[stream.mode],
    cursor_column: stream.cursorColumn,
    primary_key_columns: stream.primaryKeyColumns,
    destination_table: stream.destinationTable,
    status: STREAM_STATUS_FROM_PRISMA[stream.status],
    error: stream.error,
    // BigInt does not survive JSON, and a row count is never precise enough for
    // the extra digits to matter.
    rows_synced: Number(stream.rowsSynced),
    last_synced_at_millis: stream.lastSyncedAt?.getTime() ?? null,
  };
}

/**
 * Capabilities keep their discriminator on the way out.
 *
 * The alternative — flattening `wal_level` and friends onto every source — would
 * make a Convex source carry seven fields that mean nothing to it, and would
 * have to be broken later rather than extended.
 */
function serializeCapabilities(capabilities: DataSourceCapabilities | null) {
  if (capabilities == null) return null;
  switch (capabilities.type) {
    case "postgres": {
      return {
        type: "postgres" as const,
        version: capabilities.version,
        wal_level: capabilities.walLevel,
        has_replication: capabilities.hasReplication,
        in_recovery: capabilities.inRecovery,
        slots_used: capabilities.slotsUsed,
        slots_max: capabilities.slotsMax,
        probed_at_millis: capabilities.probedAtMillis,
      };
    }
    case "convex": {
      return {
        type: "convex" as const,
        deployment_url: capabilities.deploymentUrl,
        probed_at_millis: capabilities.probedAtMillis,
      };
    }
  }
}

/**
 * The connection settings, minus the secret.
 *
 * `config` is an opaque JSON column, so it is rebuilt field by field per type
 * rather than passed through: a driver that ever stored something sensitive
 * there must not have it leak out by default.
 */
function serializeConfig(source: DataSource) {
  const config = (source.config ?? {}) as Record<string, unknown>;
  switch (TYPE_FROM_PRISMA[source.type]) {
    case "postgres": {
      return {
        host: String(config.host ?? ""),
        port: Number(config.port ?? 0),
        database: String(config.database ?? ""),
        username: String(config.username ?? ""),
        ssl_mode: String(config.sslMode ?? "require"),
      };
    }
    case "convex": {
      return { deployment_url: String(config.deploymentUrl ?? "") };
    }
  }
}

export function serializeDataSource(source: DataSource & { streams: DataSourceStream[] }) {
  return {
    id: source.id,
    type: TYPE_FROM_PRISMA[source.type],
    config: serializeConfig(source),
    status: STATUS_FROM_PRISMA[source.status],
    error: source.error,
    sync_interval_seconds: source.syncIntervalSeconds,
    capabilities: serializeCapabilities((source.capabilities ?? null) as DataSourceCapabilities | null),
    last_sync_started_at_millis: source.lastSyncStartedAt?.getTime() ?? null,
    last_sync_finished_at_millis: source.lastSyncFinishedAt?.getTime() ?? null,
    streams: source.streams.map(serializeStream),
  };
}

/**
 * The catalog the "choose tables" screen renders. Mode availability is resolved
 * here rather than in the dashboard so that what is offered and what the backend
 * will accept can never drift apart.
 */
export function serializeCatalog(probe: DataSourceProbeResult) {
  return {
    capabilities: serializeCapabilities(probe.capabilities),
    tables: probe.tables.map(table => {
      const availability = getModeAvailability(table, probe.capabilities);
      return {
        schema_name: table.schemaName,
        table_name: table.tableName,
        approx_rows: table.approxRows,
        primary_key_columns: table.primaryKeyColumns,
        cursor_candidates: table.cursorCandidates.map(candidate => ({
          column: candidate.column,
          data_type: candidate.dataType,
          indexed: candidate.indexed,
        })),
        available_modes: DATA_SOURCE_SYNC_MODES.map(mode => ({
          mode,
          available: availability[mode].available,
          reason: availability[mode].reason,
        })),
        recommended_mode: getRecommendedMode(table, probe.capabilities),
        default_cursor_column: getDefaultCursorColumn(table),
        // Postgres-only facts the picker shows next to a table. Absent for every
        // other source rather than faked.
        postgres: table.postgres == null ? null : {
          replica_identity: table.postgres.replicaIdentity,
          is_partitioned: table.postgres.isPartitioned,
        },
      };
    }),
  };
}
