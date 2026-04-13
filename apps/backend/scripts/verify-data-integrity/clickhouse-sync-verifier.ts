import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { CLICKHOUSE_COLUMN_NORMALIZERS } from "@/lib/external-db-sync";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { DEFAULT_DB_SYNC_MAPPINGS } from "@stackframe/stack-shared/dist/config/db-sync-mappings";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

import type { RecurseFunction } from "./recurse";

// Sort key columns for each mapping (after project_id, branch_id), matching ClickHouse ORDER BY
const SORT_KEYS = {
  users: ["id"],
  contact_channels: ["id"],
  teams: ["id"],
  team_member_profiles: ["team_id", "user_id"],
  team_permissions: ["team_id", "user_id", "id"],
  team_invitations: ["id"],
  email_outboxes: ["id"],
  project_permissions: ["user_id", "permission_id"],
  notification_preferences: ["user_id", "notification_category_id"],
  refresh_tokens: ["id"],
  connected_accounts: ["user_id", "provider", "provider_account_id"],
} satisfies Record<keyof typeof DEFAULT_DB_SYNC_MAPPINGS, string[]>;

const SYNC_COLUMNS_TO_STRIP = ["sync_sequence_id", "sync_is_deleted", "sync_created_at", "tenancyId"];

function compareRows(a: Record<string, unknown>, b: Record<string, unknown>, sortKeys: string[]): number {
  for (const key of sortKeys) {
    const aVal = String(a[key] ?? "");
    const bVal = String(b[key] ?? "");
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
  }
  return 0;
}

function normalizePostgresValue(value: unknown, columnType: string | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (columnType === "json") {
    // Postgres returns parsed JS values for jsonb columns; always stringify for consistent comparison
    return JSON.stringify(value);
  }
  if (columnType === "boolean") {
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  }
  if (columnType === "nullable_boolean") {
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  }
  if (columnType === "bigint") {
    return Number(value);
  }
  // For dates, normalize to ms epoch
  if (value instanceof Date) {
    return value.getTime();
  }
  return value;
}

function normalizeClickhouseValue(value: unknown, columnType: string | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (columnType === "json") {
    // ClickHouse stores null JSON as the literal string "null"
    if (value === "null") return null;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  // For dates (ClickHouse returns as string like "2024-01-01 00:00:00.000" in UTC)
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value)) {
    // Append 'Z' to force UTC interpretation if no timezone indicator present
    const dateStr = value.includes("Z") || value.includes("+") ? value : value.replace(" ", "T") + "Z";
    return new Date(dateStr).getTime();
  }
  return value;
}

function normalizeRow(
  row: Record<string, unknown>,
  normalizers: Record<string, string>,
  side: "postgres" | "clickhouse",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const columnType = normalizers[key];
    result[key] = side === "postgres"
      ? normalizePostgresValue(value, columnType)
      : normalizeClickhouseValue(value, columnType);
  }
  return result;
}

// Strip null values and empty objects from nested structures.
// ClickHouse's native JSON type omits these, so we need to normalize before comparing.
function stripNullsAndEmpties(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripNullsAndEmpties);
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const stripped = stripNullsAndEmpties(v);
    if (stripped === undefined) continue;
    if (typeof stripped === "object" && stripped !== null && !Array.isArray(stripped) && Object.keys(stripped).length === 0) continue;
    result[k] = stripped;
  }
  return result;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object" && typeof b === "object") {
    // Normalize both sides to handle ClickHouse JSON stripping nulls/empties
    const aNorm = stripNullsAndEmpties(a) as Record<string, unknown>;
    const bNorm = stripNullsAndEmpties(b) as Record<string, unknown>;
    const aKeys = Object.keys(aNorm);
    const bKeys = Object.keys(bNorm);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => deepEqual(aNorm[key], bNorm[key]));
  }
  return false;
}

function findDifferences(
  pgRow: Record<string, unknown>,
  chRow: Record<string, unknown>,
): string[] {
  const diffs: string[] = [];
  const allKeys = new Set([...Object.keys(pgRow), ...Object.keys(chRow)]);
  for (const key of allKeys) {
    if (!deepEqual(pgRow[key], chRow[key])) {
      diffs.push(`${key}: pg=${JSON.stringify(pgRow[key])} ch=${JSON.stringify(chRow[key])}`);
    }
  }
  return diffs;
}

export async function verifyClickhouseSync(options: {
  tenancy: Tenancy,
  projectId: string,
  branchId: string,
  recurse: RecurseFunction,
}) {
  const { tenancy, projectId, branchId, recurse } = options;
  const clickhouseClient = getClickhouseAdminClient();
  const prisma = await getPrismaClientForTenancy(tenancy);

  for (const [mappingName, mapping] of Object.entries(DEFAULT_DB_SYNC_MAPPINGS)) {
    await recurse(`[${mappingName}]`, async () => {
      const fetchQuery = mapping.internalDbFetchQueries.clickhouse;
      if (!fetchQuery) return;

      if (!(mappingName in SORT_KEYS)) {
        throw new StackAssertionError(`No sort keys defined for mapping ${mappingName}`);
      }
      const sortKeys = SORT_KEYS[mappingName as keyof typeof SORT_KEYS];

      const normalizers = CLICKHOUSE_COLUMN_NORMALIZERS[mappingName] ?? {};

      // Fetch all non-deleted rows from Postgres using the same query the sync uses
      const pgRows: Record<string, unknown>[] = [];
      let lastSequenceId = -1;
      const BATCH_LIMIT = 1000;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
          fetchQuery,
          tenancy.id,
          lastSequenceId,
        );

        if (batch.length === 0) break;

        for (const row of batch) {
          const syncIsDeleted = row.sync_is_deleted;
          if (syncIsDeleted === true || syncIsDeleted === "true") continue;

          const stripped: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            if (!SYNC_COLUMNS_TO_STRIP.includes(key)) {
              stripped[key] = value;
            }
          }
          pgRows.push(stripped);
        }

        // Find max sequence ID in batch for cursor
        let maxSeq = lastSequenceId;
        for (const row of batch) {
          const seq = Number(row.sync_sequence_id);
          if (Number.isFinite(seq) && seq > maxSeq) {
            maxSeq = seq;
          }
        }
        lastSequenceId = maxSeq;

        if (batch.length < BATCH_LIMIT) break;
      }

      // Fetch all rows from ClickHouse view (already FINAL + sync_is_deleted = 0)
      const chResult = await clickhouseClient.query({
        query: `SELECT * FROM default.${mapping.targetTable} WHERE project_id = {project_id:String} AND branch_id = {branch_id:String}`,
        query_params: { project_id: projectId, branch_id: branchId },
        format: "JSONEachRow",
      });
      const chRows = await chResult.json<Record<string, unknown>>();

      // Compare row counts
      if (pgRows.length !== chRows.length) {
        throw new StackAssertionError(deindent`
          ClickHouse sync row count mismatch for ${mappingName}.
          Postgres: ${pgRows.length} rows, ClickHouse: ${chRows.length} rows.
        `);
      }

      if (pgRows.length === 0) return;

      // Sort both by primary key columns
      const fullSortKeys = ["project_id", "branch_id", ...sortKeys];
      pgRows.sort((a, b) => compareRows(a, b, fullSortKeys));
      chRows.sort((a, b) => compareRows(a, b, fullSortKeys));

      // Compare row by row
      for (let i = 0; i < pgRows.length; i++) {
        const normalizedPg = normalizeRow(pgRows[i], normalizers, "postgres");
        const normalizedCh = normalizeRow(chRows[i], normalizers, "clickhouse");

        if (!deepEqual(normalizedPg, normalizedCh)) {
          const diffs = findDifferences(normalizedPg, normalizedCh);
          const keyValues = fullSortKeys.map(k => `${k}=${pgRows[i][k]}`).join(", ");
          throw new StackAssertionError(deindent`
            ClickHouse sync data mismatch for ${mappingName} at row ${keyValues}.
            Differences: ${diffs.join("; ")}
          `);
        }
      }
    });
  }
}
