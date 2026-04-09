import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  quoteSqlIdentifier,
  sqlExpression,
  sqlQuery,
  sqlStatement,
  tableIdToDebugString,
} from "../utilities";

/**
 * Materialized compaction table.
 *
 * Takes two input tables that share the same group key:
 *   - `toBeCompactedTable`: rows to compact (must be sorted ascending by `orderingKey`)
 *   - `boundaryTable`: rows that define compaction window edges (must be sorted ascending by `orderingKey`)
 *
 * Both inputs MUST be pre-sorted in ascending order by the field named
 * `orderingKey`. The CompactTable operates per-group (like LFold, Map, etc.),
 * processing each group from both inputs independently.
 *
 * Within each group, a JSONB map keyed by `partitionKey` tracks per-partition
 * accumulators. For each toBeCompacted row, the `compactKey` value is summed
 * into the accumulator for that partition (all other fields preserved from the
 * first row seen). When a boundary row is encountered, ALL accumulated partitions
 * are flushed as compacted rows and the map resets. After the stream ends,
 * remaining accumulated entries are flushed.
 *
 * This means entries for different partitions within the same window are
 * compacted independently and simultaneously -- a partition change does NOT
 * break the window, only a boundary does.
 *
 * The output contains ONLY compacted rows (boundary rows are NOT passed through).
 * Output size is always <= toBeCompactedTable size.
 *
 * Example (orderingKey = "t", compactKey = "qty", partitionKey = "itemId"):
 *   toBeCompacted: [{t:1, itemId:"a", qty:10}, {t:2, itemId:"b", qty:5},
 *                   {t:3, itemId:"a", qty:3},  {t:5, itemId:"a", qty:20}]
 *   boundary:      [{t:4}]
 *   output:        [{t:1, itemId:"a", qty:13}, {t:2, itemId:"b", qty:5},
 *                   {t:5, itemId:"a", qty:20}]
 *
 * Incremental: on any input change, recomputes affected groups fully.
 */
export function declareCompactTable<
  GK extends Json,
  SK extends Json,
  ToBeCompactedRD extends RowData,
  BoundaryRD extends RowData,
>(options: {
  tableId: TableId,
  /** Rows to compact. Must be sorted ascending by orderingKey. */
  toBeCompactedTable: Table<GK, SK, ToBeCompactedRD>,
  /** Boundary rows that define compaction window edges. Must share group key with toBeCompactedTable and be sorted ascending by orderingKey. */
  boundaryTable: Table<GK, SK, BoundaryRD>,
  /** Field name present on BOTH tables' rowData, used to interleave and order rows. Must be numeric. */
  orderingKey: string,
  /** Field name on toBeCompactedTable's rowData whose values are summed during compaction. Must be numeric. */
  compactKey: string,
  /** Field name on toBeCompactedTable's rowData used to key per-partition accumulators. */
  partitionKey: string,
}): Table<GK, null, ToBeCompactedRD> {
  // TODO: Implement. See LimitTable for a reference pattern using full-group recomputation.
  //
  // High-level approach:
  // 1. init():
  //    a. Create storage paths in BulldozerStorageEngine
  //    b. Scan all groups (union of groups from both inputs)
  //    c. For each group, compute compacted output (see algorithm below)
  //    d. Store results
  //    e. Register triggers on BOTH input tables
  //
  // 2. Trigger handler (on change to either input):
  //    a. Determine affected groups from the changes
  //    b. For each affected group, re-read rows from both inputs
  //    c. Recompute compacted output for that group
  //    d. Diff old vs new output, store new output, emit downstream triggers
  //
  // 3. Compaction algorithm (per group):
  //    a. Read all toBeCompacted rows and all boundary rows for the group
  //    b. Interleave them by orderingKey (ascending)
  //    c. Maintain state: a JSONB map keyed by partitionKey value.
  //       Each entry holds the first row's data with compactKey being
  //       the running sum.
  //    d. Walk through interleaved stream:
  //       - toBeCompacted row: look up state[partitionValue].
  //         If absent: store the full row as the accumulator.
  //         If present: add this row's compactKey to the accumulator's compactKey.
  //       - boundary row: flush all state entries as compacted output rows,
  //         reset state to empty map.
  //    e. After stream ends: flush remaining state entries as compacted output rows.
  //    f. Output is the list of emitted compacted rows.
  //
  // 4. Queries (listGroups, listRowsInGroup):
  //    Read from materialized storage in BulldozerStorageEngine
  //
  // 5. Group/sort key behavior:
  //    - compareGroupKeys: delegates to toBeCompactedTable.compareGroupKeys
  //    - compareSortKeys: always returns 0 (output has null sort keys)

  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;

  throw new Error(`declareCompactTable "${tableIdToDebugString(options.tableId)}" is not yet implemented. See the TODO above.`);
}
