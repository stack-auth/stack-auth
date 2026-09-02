import { ensureDestinationTable, quoteClickhouseIdentifier } from "./clickhouse-destination";
import type { ProbedTable, StreamSyncPlan, SyncContext } from "./types";

/**
 * How a table is keyed wherever one is looked up by name.
 *
 * Shared rather than reimplemented per driver because `data-sources.tsx` builds
 * `SyncContext.tablesByName` with it: a driver whose own copy drifted would
 * simply find nothing and report every table as missing.
 */
export function tableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

/**
 * Creates the destination table, or replaces it outright.
 *
 * Rebuilding is not an optimisation to avoid — it is how a stream whose
 * configuration changed avoids inheriting rows versioned on a scale its new mode
 * cannot beat (see `StreamSyncPlan.isPending`), and how a source-side truncate is
 * represented at all.
 */
export async function rebuildDestinationTable(
  context: SyncContext,
  plan: StreamSyncPlan,
  table: ProbedTable,
): Promise<void> {
  await context.clickhouse.command({
    query: `DROP TABLE IF EXISTS ${quoteClickhouseIdentifier(context.databaseName)}.${quoteClickhouseIdentifier(plan.destinationTable)}`,
  });
  await ensureDestinationTable(context.clickhouse, {
    databaseName: context.databaseName,
    tableName: plan.destinationTable,
    columns: table.columns,
    primaryKeyColumns: plan.primaryKeyColumns,
  });
}

/**
 * Readies a stream's destination before rows are written to it: rebuilt from
 * scratch when the stream is pending, and otherwise reconciled so a column the
 * source grew since setup exists before anything tries to write it.
 */
export async function prepareDestination(
  context: SyncContext,
  plan: StreamSyncPlan,
  table: ProbedTable,
): Promise<void> {
  if (plan.isPending) {
    await rebuildDestinationTable(context, plan, table);
    return;
  }
  await ensureDestinationTable(context.clickhouse, {
    databaseName: context.databaseName,
    tableName: plan.destinationTable,
    columns: table.columns,
    primaryKeyColumns: plan.primaryKeyColumns,
  });
}
