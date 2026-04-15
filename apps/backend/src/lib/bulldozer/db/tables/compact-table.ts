import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
import { attachRowChangeTriggerMetadata, normalizeRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { RegisteredRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  quoteSqlIdentifier,
  quoteSqlStringLiteral,
  singleNullSortKeyRangePredicate,
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
 * Within each group, a per-partition accumulator map (keyed by `partitionKey`)
 * tracks running sums. For each toBeCompacted row, the `compactKey` value is
 * summed into the accumulator for that partition (all other fields preserved
 * from the first row seen). When a boundary row is encountered, ALL accumulated
 * partitions are flushed as compacted rows and the map resets. After the stream
 * ends, remaining entries are flushed.
 *
 * Output contains ONLY compacted rows (boundaries are NOT passed through).
 * Output is NOT guaranteed to be sorted. Output size <= toBeCompactedTable size.
 *
 * Example (orderingKey = "t", compactKey = "qty", partitionKey = "itemId"):
 *   toBeCompacted: [{t:1, itemId:"a", qty:10}, {t:2, itemId:"b", qty:5},
 *                   {t:3, itemId:"a", qty:3},  {t:4, itemId:"b", qty:7},
 *                   {t:6, itemId:"b", qty:2}]
 *   boundary:      [{t:5}]
 *   output:        [{t:1, itemId:"a", qty:13}, {t:2, itemId:"b", qty:12},
 *                   {t:6, itemId:"b", qty:2}]
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
  toBeCompactedTable: Table<GK, SK, ToBeCompactedRD>,
  boundaryTable: Table<GK, SK, BoundaryRD>,
  orderingKey: string,
  compactKey: string,
  partitionKey: string,
}): Table<GK, null, ToBeCompactedRD> {
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
  const groupsPath = getStorageEnginePath(options.tableId, ["groups"]);
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;

  const orderingKeyLiteral = quoteSqlStringLiteral(options.orderingKey);
  const compactKeyLiteral = quoteSqlStringLiteral(options.compactKey);
  const partitionKeyLiteral = quoteSqlStringLiteral(options.partitionKey);

  /**
   * SQL that computes compacted rows for a given group.
   * Expects "compactSourceRows" and "boundarySourceRows" CTEs to be available,
   * each with columns (rowidentifier, rowsortkey, rowdata).
   *
   * The algorithm:
   * 1. Interleave both streams by orderingKey, tagging each row as 'C' (compact) or 'B' (boundary)
   * 2. Assign a window_id that increments on each boundary
   * 3. Within each window, group by partitionKey and aggregate:
   *    sum compactKey, keep first row's data for everything else
   */
  const compactionAlgoSql = `,
    "interleaved" AS (
      SELECT
        'C' AS "rowKind",
        "r"."rowidentifier" AS "rowIdentifier",
        "r"."rowdata" AS "rowData",
        ("r"."rowdata"->>` + orderingKeyLiteral.sql + `)::numeric AS "orderVal"
      FROM "compactSourceRows" AS "r"
      UNION ALL
      SELECT
        'B' AS "rowKind",
        "r"."rowidentifier" AS "rowIdentifier",
        "r"."rowdata" AS "rowData",
        ("r"."rowdata"->>` + orderingKeyLiteral.sql + `)::numeric AS "orderVal"
      FROM "boundarySourceRows" AS "r"
    ),
    "ordered" AS (
      SELECT
        "rowKind",
        "rowIdentifier",
        "rowData",
        "orderVal",
        SUM(CASE WHEN "rowKind" = 'B' THEN 1 ELSE 0 END) OVER (
          ORDER BY "orderVal" ASC, "rowKind" ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS "windowId"
      FROM "interleaved"
    ),
    "compactRows" AS (
      SELECT * FROM "ordered" WHERE "rowKind" = 'C'
    ),
    "aggregated" AS (
      SELECT
        "windowId",
        "rowData"->>` + partitionKeyLiteral.sql + ` AS "partitionVal",
        SUM(("rowData"->>` + compactKeyLiteral.sql + `)::numeric) AS "totalCompactKey",
        MIN("rowIdentifier") AS "rowIdentifier"
      FROM "compactRows"
      GROUP BY "windowId", "rowData"->>` + partitionKeyLiteral.sql + `
    ),
    "firstRows" AS (
      SELECT DISTINCT ON ("windowId", "rowData"->>` + partitionKeyLiteral.sql + `)
        "windowId",
        "rowData"->>` + partitionKeyLiteral.sql + ` AS "partitionVal",
        "rowData" AS "firstRowData"
      FROM "compactRows"
      ORDER BY "windowId", "rowData"->>` + partitionKeyLiteral.sql + `, "orderVal" ASC
    ),
    "compacted" AS (
      SELECT
        "aggregated"."windowId",
        "aggregated"."partitionVal",
        "firstRows"."firstRowData" || jsonb_build_object(
          ` + compactKeyLiteral.sql + `,
          to_jsonb("aggregated"."totalCompactKey")
        ) AS "rowData",
        "aggregated"."rowIdentifier"
      FROM "aggregated"
      INNER JOIN "firstRows"
        ON "aggregated"."windowId" = "firstRows"."windowId"
        AND "aggregated"."partitionVal" = "firstRows"."partitionVal"
    )
    SELECT
      "compacted"."rowIdentifier" AS "rowIdentifier",
      'null'::jsonb AS "rowSortKey",
      "compacted"."rowData" AS "rowData"
    FROM "compacted"
  `;

  /**
   * SQL to compute new compacted rows for affected groups.
   * groupKeyExpr: SQL expression for the group key to filter by.
   */
  const computeCompactedRowsSql = (groupKeyExpr: SqlExpression<GK>): { sql: string } => ({ sql: `
    WITH "compactSourceRows" AS (
      SELECT
        "r"."rowidentifier" AS "rowidentifier",
        "r"."rowsortkey" AS "rowsortkey",
        "r"."rowdata" AS "rowdata"
      FROM (
        ${options.toBeCompactedTable.listRowsInGroup({
          groupKey: groupKeyExpr,
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).sql}
      ) AS "r"
    ),
    "boundarySourceRows" AS (
      SELECT
        "r"."rowidentifier" AS "rowidentifier",
        "r"."rowsortkey" AS "rowsortkey",
        "r"."rowdata" AS "rowdata"
      FROM (
        ${options.boundaryTable.listRowsInGroup({
          groupKey: groupKeyExpr,
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).sql}
      ) AS "r"
    )
    ${compactionAlgoSql}
  ` });

  const createTriggerStatements = (fromChangesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => {
    const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
    const affectedGroupsTableName = `affected_groups_${generateSecureRandomString()}`;
    const oldRowsTableName = `old_compacted_rows_${generateSecureRandomString()}`;
    const newRowsTableName = `new_compacted_rows_${generateSecureRandomString()}`;
    const compactChangesTableName = `compact_changes_${generateSecureRandomString()}`;
    return [
      {
        ...sqlQuery`
          SELECT
            "changes"."groupKey" AS "groupKey",
            ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
            ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow"
          FROM ${fromChangesTable} AS "changes"
          WHERE ${isInitializedExpression}
        `.toStatement(normalizedChangesTableName, '"groupKey" jsonb, "hasOldRow" boolean, "hasNewRow" boolean'),
        requiresSequentialExecution: true,
      },
      sqlQuery`
        SELECT DISTINCT "changes"."groupKey" AS "groupKey"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."hasOldRow" OR "changes"."hasNewRow"
      `.toStatement(affectedGroupsTableName, '"groupKey" jsonb'),
      // Read old materialized rows for affected groups
      sqlQuery`
        SELECT
          "groups"."groupKey" AS "groupKey",
          ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS "rowIdentifier",
          "rows"."value"->'rowSortKey' AS "rowSortKey",
          "rows"."value"->'rowData' AS "rowData"
        FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
          ON "groupRowsPath"."keyPath" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        INNER JOIN "BulldozerStorageEngine" AS "rows"
          ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
      `.toStatement(oldRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
      // Compute new compacted rows for affected groups
      sqlQuery`
        SELECT
          "groups"."groupKey" AS "groupKey",
          "rows"."rowIdentifier" AS "rowIdentifier",
          "rows"."rowSortKey" AS "rowSortKey",
          "rows"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        CROSS JOIN LATERAL (
          ${computeCompactedRowsSql(sqlExpression`"groups"."groupKey"`)}
        ) AS "rows"
      `.toStatement(newRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
      // Ensure group + rows paths exist for new groups
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          "insertRows"."keyPath",
          "insertRows"."value"
        FROM (
          SELECT DISTINCT
            ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newRowsTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newRowsTableName)}
        ) AS "insertRows"
        ON CONFLICT ("keyPath") DO NOTHING
      `,
      // Delete old rows for affected groups
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "target"
        USING ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        WHERE "target"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
      `,
      // Insert new compacted rows
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          ${getGroupRowPath(
            sqlExpression`"groupKey"`,
            sqlExpression`to_jsonb("rowIdentifier"::text)`,
          )}::jsonb[],
          jsonb_build_object(
            'rowSortKey', "rowSortKey",
            'rowData', "rowData"
          )
        FROM ${quoteSqlIdentifier(newRowsTableName)}
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      // Clean up empty groups
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "staleGroupPath"
        USING ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        WHERE "staleGroupPath"."keyPath" IN (
          ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[],
          ${getGroupKeyPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        )
          AND NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(newRowsTableName)} AS "newRows"
            WHERE "newRows"."groupKey" IS NOT DISTINCT FROM "groups"."groupKey"
          )
      `,
      // Diff old vs new and emit downstream triggers
      sqlQuery`
        SELECT
          COALESCE("newRows"."groupKey", "oldRows"."groupKey") AS "groupKey",
          COALESCE("newRows"."rowIdentifier", "oldRows"."rowIdentifier") AS "rowIdentifier",
          CASE WHEN "oldRows"."rowSortKey" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowSortKey" END AS "oldRowSortKey",
          CASE WHEN "newRows"."rowSortKey" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowSortKey" END AS "newRowSortKey",
          CASE WHEN "oldRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowData" END AS "oldRowData",
          CASE WHEN "newRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowData" END AS "newRowData"
        FROM ${quoteSqlIdentifier(oldRowsTableName)} AS "oldRows"
        FULL OUTER JOIN ${quoteSqlIdentifier(newRowsTableName)} AS "newRows"
          ON "oldRows"."groupKey" IS NOT DISTINCT FROM "newRows"."groupKey"
          AND "oldRows"."rowIdentifier" = "newRows"."rowIdentifier"
        WHERE "oldRows"."rowSortKey" IS DISTINCT FROM "newRows"."rowSortKey"
          OR "oldRows"."rowData" IS DISTINCT FROM "newRows"."rowData"
      `.toStatement(compactChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
    ];
  };

  const toBeCompactedTrigger = attachRowChangeTriggerMetadata(
    (changesTable) => createTriggerStatements(changesTable),
    {
      targetTableId: tableIdToDebugString(options.tableId),
      targetTableTriggers: triggers,
    },
  );
  options.toBeCompactedTable.registerRowChangeTrigger(toBeCompactedTrigger);
  const boundaryTrigger = attachRowChangeTriggerMetadata(
    (changesTable) => createTriggerStatements(changesTable),
    {
      targetTableId: tableIdToDebugString(options.tableId),
      targetTableTriggers: triggers,
    },
  );
  options.boundaryTable.registerRowChangeTrigger(boundaryTrigger);

  const table: ReturnType<typeof declareCompactTable<GK, SK, ToBeCompactedRD, BoundaryRD>> = {
    tableId: options.tableId,
    inputTables: [options.toBeCompactedTable, options.boundaryTable],
    debugArgs: {
      operator: "compact",
      tableId: tableIdToDebugString(options.tableId),
      toBeCompactedTableId: tableIdToDebugString(options.toBeCompactedTable.tableId),
      boundaryTableId: tableIdToDebugString(options.boundaryTable.tableId),
      orderingKey: options.orderingKey,
      compactKey: options.compactKey,
      partitionKey: options.partitionKey,
    },
    compareGroupKeys: options.toBeCompactedTable.compareGroupKeys,
    compareSortKeys: () => sqlExpression` 0 `,
    init: () => {
      const allGroupsTableName = `all_groups_${generateSecureRandomString()}`;
      const initRowsTableName = `init_compacted_rows_${generateSecureRandomString()}`;
      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${groupsPath}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        // Union groups from both inputs
        sqlQuery`
          SELECT "groupkey" AS "groupKey" FROM (
            ${options.toBeCompactedTable.listGroups({ start: "start", end: "end", startInclusive: true, endInclusive: true })}
          ) AS "g1"
          UNION
          SELECT "groupkey" AS "groupKey" FROM (
            ${options.boundaryTable.listGroups({ start: "start", end: "end", startInclusive: true, endInclusive: true })}
          ) AS "g2"
        `.toStatement(allGroupsTableName, '"groupKey" jsonb'),
        // Compute compacted rows for each group
        sqlQuery`
          SELECT
            "groups"."groupKey" AS "groupKey",
            "rows"."rowIdentifier" AS "rowIdentifier",
            "rows"."rowSortKey" AS "rowSortKey",
            "rows"."rowData" AS "rowData"
          FROM ${quoteSqlIdentifier(allGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${computeCompactedRowsSql(sqlExpression`"groups"."groupKey"`)}
          ) AS "rows"
        `.toStatement(initRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
        // Store results
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            "insertRows"."keyPath",
            "insertRows"."value"
          FROM (
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(initRowsTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(initRowsTableName)}
            UNION
            SELECT
              ${getGroupRowPath(
                sqlExpression`"groupKey"`,
                sqlExpression`to_jsonb("rowIdentifier"::text)`,
              )}::jsonb[] AS "keyPath",
              jsonb_build_object(
                'rowSortKey', "rowSortKey",
                'rowData', "rowData"
              ) AS "value"
            FROM ${quoteSqlIdentifier(initRowsTableName)}
          ) AS "insertRows"
        `,
      ];
    },
    delete: () => {
      return [sqlStatement`
        WITH RECURSIVE "pathsToDelete" AS (
          SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
          UNION ALL
          SELECT "BulldozerStorageEngine"."keyPath" AS "path"
          FROM "BulldozerStorageEngine"
          INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
        )
        DELETE FROM "BulldozerStorageEngine"
        WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
      `];
    },
    isInitialized: () => isInitializedExpression,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey
      FROM "BulldozerStorageEngine" AS "groupPath"
      WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
        AND EXISTS (
          SELECT 1
          FROM "BulldozerStorageEngine" AS "groupRowsPath"
          INNER JOIN "BulldozerStorageEngine" AS "groupRow"
            ON "groupRow"."keyPathParent" = "groupRowsPath"."keyPath"
          WHERE "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
            AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        )
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.toBeCompactedTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
              : sqlExpression`${options.toBeCompactedTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.toBeCompactedTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
              : sqlExpression`${options.toBeCompactedTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
        }
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey
      ? sqlQuery`
        SELECT
          ("row"."keyPath"[cardinality("row"."keyPath")] #>> '{}') AS rowIdentifier,
          'null'::jsonb AS rowSortKey,
          "row"."value"->'rowData' AS rowData
        FROM "BulldozerStorageEngine" AS "row"
        WHERE "row"."keyPathParent" = ${getGroupRowsPath(groupKey)}::jsonb[]
          AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
        ORDER BY rowIdentifier ASC
      `
      : sqlQuery`
        SELECT
          "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey,
          ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
          'null'::jsonb AS rowSortKey,
          "rows"."value"->'rowData' AS rowData
        FROM "BulldozerStorageEngine" AS "groupPath"
        INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
          ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
        INNER JOIN "BulldozerStorageEngine" AS "rows"
          ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
        WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
          AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
          AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
        ORDER BY groupKey ASC, rowIdentifier ASC
      `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, normalizeRowChangeTrigger(trigger));
      return { deregister: () => triggers.delete(id) };
    },
    verifyDataIntegrity: () => {
      const allCompactedGroups = options.toBeCompactedTable.listGroups({
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      const allBoundaryGroups = options.boundaryTable.listGroups({
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      const allActualRows = table.listRowsInGroup({
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      return sqlQuery`
        WITH "allGroups" AS (
          SELECT "g"."groupkey" AS "groupKey" FROM (${allCompactedGroups}) AS "g"
          UNION
          SELECT "g"."groupkey" AS "groupKey" FROM (${allBoundaryGroups}) AS "g"
        ),
        "expected" AS (
          SELECT
            "groups"."groupKey" AS "groupKey",
            "rows"."rowIdentifier" AS "rowIdentifier",
            "rows"."rowData" AS "rowData"
          FROM "allGroups" AS "groups"
          CROSS JOIN LATERAL (
            ${computeCompactedRowsSql(sqlExpression`"groups"."groupKey"`)}
          ) AS "rows"
        ),
        "actual" AS (
          SELECT "r"."groupkey" AS "groupKey", "r"."rowidentifier" AS "rowIdentifier", "r"."rowdata" AS "rowData"
          FROM (${allActualRows}) AS "r"
        )
        SELECT
          CASE
            WHEN "expected"."rowIdentifier" IS NULL THEN 'extra_row'
            WHEN "actual"."rowIdentifier" IS NULL THEN 'missing_row'
            ELSE 'data_mismatch'
          END AS errortype,
          COALESCE("expected"."groupKey", "actual"."groupKey") AS groupkey,
          COALESCE("expected"."rowIdentifier", "actual"."rowIdentifier") AS rowidentifier,
          "expected"."rowData" AS expected,
          "actual"."rowData" AS actual
        FROM "expected"
        FULL OUTER JOIN "actual"
          ON "expected"."groupKey" IS NOT DISTINCT FROM "actual"."groupKey"
          AND "expected"."rowIdentifier" = "actual"."rowIdentifier"
        WHERE ("expected"."rowIdentifier" IS NULL
          OR "actual"."rowIdentifier" IS NULL
          OR "expected"."rowData" IS DISTINCT FROM "actual"."rowData")
          AND ${isInitializedExpression}
      `;
    },
  };
  return table;
}
