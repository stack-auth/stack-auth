/**
 * ClickHouse side of Data Warehouse: writing imported rows, counting them for the
 * storage entitlement, and the lazy per-source views.
 */
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import type { Tenancy } from "@/lib/tenancies";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import type { ImportedRecord } from "./runtime";

export const IMPORTED_ROWS_TABLE = "analytics_internal.imported_rows";

/**
 * A ClickHouse identifier we are about to interpolate into DDL.
 *
 * Lazy views are named after user-controlled values (the source's display name
 * and stream names), and `CREATE VIEW` takes no bound parameters, so the name
 * is restricted to a conservative character set rather than escaped.
 */
function assertSafeIdentifier(value: string, what: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    throw new HexclaveAssertionError(`Unsafe ClickHouse identifier for ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Appends a slice of imported records.
 *
 * `sync_sequence_id` is the ReplacingMergeTree version. It is the extraction
 * time in milliseconds, so a later sync of the same (source, stream, pk) always
 * wins over an earlier one regardless of which order the parts merge in.
 */
export async function writeImportedRows(options: {
  tenancy: Tenancy,
  sourceId: string,
  stream: string,
  records: ImportedRecord[],
}): Promise<void> {
  if (options.records.length === 0) return;
  const client = getClickhouseAdminClient();
  try {
    await client.insert({
      table: IMPORTED_ROWS_TABLE,
      values: options.records.map(record => ({
        project_id: options.tenancy.project.id,
        branch_id: options.tenancy.branchId,
        source_id: options.sourceId,
        stream: options.stream,
        pk: record.pk,
        extracted_at: record.extractedAt.toISOString(),
        // `data` is a ClickHouse JSON column, so under JSONEachRow it takes the
        // object itself. Stringifying it (as the String-typed columns in
        // external-db-sync do) makes ClickHouse reject the row with
        // "JSON object should start with '{'".
        data: record.data,
        sync_sequence_id: record.extractedAt.getTime(),
        sync_is_deleted: 0,
      })),
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
      },
    });
  } finally {
    await client.close();
  }
}

/**
 * Removes every row of a source (or of one of its streams).
 *
 * Uses a lightweight DELETE rather than writing `sync_is_deleted = 1`
 * tombstones. Tombstoning here would mean re-inserting every row's full JSON
 * payload just to flip one flag — the expensive way to delete — and an
 * INSERT ... SELECT over the same table does not reliably produce the
 * replacement rows anyway. A lightweight DELETE marks the rows deleted in place
 * and is applied on read, so the call returns immediately and cannot block on a
 * mutation.
 *
 * `sync_is_deleted` stays in the schema because the read view shares the
 * convention of every other synced table, and because the sync path may yet
 * need per-row soft deletes for connectors that report deletions.
 */
export async function markImportedRowsDeleted(options: {
  tenancy: Tenancy,
  sourceId: string,
  stream?: string,
}): Promise<void> {
  const client = getClickhouseAdminClient();
  try {
    await client.command({
      query: `
        DELETE FROM ${IMPORTED_ROWS_TABLE}
        WHERE project_id = {project_id:String}
          AND branch_id = {branch_id:String}
          AND source_id = {source_id:String}
          ${options.stream != null ? "AND stream = {stream:String}" : ""}
      `,
      query_params: {
        project_id: options.tenancy.project.id,
        branch_id: options.tenancy.branchId,
        source_id: options.sourceId,
        ...options.stream != null ? { stream: options.stream } : {},
      },
    });
  } finally {
    await client.close();
  }
}

/** Live row counts per stream, for the source detail page. */
export async function getImportedRowCounts(options: {
  tenancy: Tenancy,
  sourceId: string,
}): Promise<Record<string, number>> {
  const client = getClickhouseAdminClient();
  try {
    const resultSet = await client.query({
      query: `
        SELECT stream, count() AS row_count
        FROM ${IMPORTED_ROWS_TABLE} FINAL
        WHERE project_id = {project_id:String}
          AND branch_id = {branch_id:String}
          AND source_id = {source_id:String}
          AND sync_is_deleted = 0
        GROUP BY stream
      `,
      query_params: {
        project_id: options.tenancy.project.id,
        branch_id: options.tenancy.branchId,
        source_id: options.sourceId,
      },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ stream: string, row_count: string }>();
    return Object.fromEntries(rows.map(row => [row.stream, Number(row.row_count)]));
  } finally {
    await client.close();
  }
}

/** Total imported rows for a project, which is what the storage quota meters. */
export async function countImportedRowsForProject(tenancy: Tenancy): Promise<number> {
  const client = getClickhouseAdminClient();
  try {
    const resultSet = await client.query({
      query: `
        SELECT count() AS row_count
        FROM ${IMPORTED_ROWS_TABLE} FINAL
        WHERE project_id = {project_id:String}
          AND branch_id = {branch_id:String}
          AND sync_is_deleted = 0
      `,
      query_params: { project_id: tenancy.project.id, branch_id: tenancy.branchId },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ row_count: string }>();
    return Number(rows[0]?.row_count ?? 0);
  } finally {
    await client.close();
  }
}

/**
 * Name of the opt-in convenience view for one (source, stream).
 *
 * Views are LAZY and per-project on purpose. A global `default.stripe_customers`
 * would be visible to every project that shares `limited_user`, because
 * SHOW TABLES is not row-filtered — including the ~195 of 200 projects that
 * never connected Stripe. Scoping the name to the project keeps visibility
 * honest, and dropping it on disconnect keeps it from outliving its data.
 */
export function getLazyViewName(tenancy: Tenancy, sourceSlug: string, stream: string): string {
  const projectPart = tenancy.project.id.replace(/-/g, "").slice(0, 12);
  const raw = `ds_${projectPart}_${sourceSlug}_${stream}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return assertSafeIdentifier(raw.slice(0, 63), "lazy view name");
}

/**
 * Creates a typed convenience view over one stream, so a human can write
 * `SELECT * FROM ds_..._customers` instead of `data.email::String` paths.
 *
 * The projected columns come from the discovered schema rather than from the
 * data, so the view exists and is describable even before the first sync.
 */
export async function createLazyView(options: {
  tenancy: Tenancy,
  sourceId: string,
  sourceSlug: string,
  stream: string,
  fields: string[],
}): Promise<string> {
  const viewName = getLazyViewName(options.tenancy, options.sourceSlug, options.stream);
  const projections = options.fields
    .filter(field => /^[A-Za-z_][A-Za-z0-9_]*$/.test(field))
    .map(field => `data.${field}::Nullable(String) AS ${field}`);
  const client = getClickhouseAdminClient();
  try {
    await client.command({
      query: `
        CREATE OR REPLACE VIEW default.${viewName}
        SQL SECURITY DEFINER
        AS
        SELECT
          pk,
          extracted_at,
          ${projections.length > 0 ? `${projections.join(",\n          ")},` : ""}
          data
        FROM ${IMPORTED_ROWS_TABLE} FINAL
        WHERE project_id = '${options.tenancy.project.id}'
          AND branch_id = '${options.tenancy.branchId}'
          AND source_id = '${options.sourceId}'
          AND stream = '${options.stream.replace(/'/g, "''")}'
          AND sync_is_deleted = 0
      `,
    });
    await client.command({ query: `GRANT SELECT ON default.${viewName} TO limited_user;` });
  } finally {
    await client.close();
  }
  return viewName;
}

export async function dropLazyView(options: {
  tenancy: Tenancy,
  sourceSlug: string,
  stream: string,
}): Promise<void> {
  const viewName = getLazyViewName(options.tenancy, options.sourceSlug, options.stream);
  const client = getClickhouseAdminClient();
  try {
    await client.command({ query: `DROP VIEW IF EXISTS default.${viewName}` });
  } finally {
    await client.close();
  }
}

import.meta.vitest?.test("lazy view names are scoped to the project and safe to interpolate", ({ expect }) => {
  const tenancy = { project: { id: "6fbbf22e-f4b2-4c6e-95a1-beab6fa41063" }, branchId: "main" } as Tenancy;
  const name = getLazyViewName(tenancy, "stripe", "Customers");
  expect(name).toMatch(/^ds_6fbbf22ef4b2_stripe_customers$/);
  expect(() => assertSafeIdentifier("drop table; --", "test")).toThrow("Unsafe ClickHouse identifier");
});
