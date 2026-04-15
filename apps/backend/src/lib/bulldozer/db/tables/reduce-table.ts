import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
import { attachRowChangeTriggerMetadata, normalizeRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { RegisteredRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlMapper, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  quoteSqlIdentifier,
  singleNullSortKeyRangePredicate,
  sqlExpression,
  sqlQuery,
  sqlStatement,
  tableIdToDebugString,
} from "../utilities";

/**
 * Materialized reduce table.
 *
 * Collapses each group in the input into a single output row by folding
 * all rows in the group with a reducer, then extracting the final output
 * via a finalize mapper. The output preserves the input's group key (GK)
 * — each output group contains exactly one row (the reduced result).
 *
 * One output row per input group. Groups that become empty produce no output.
 * If the input is ungrouped (GK = null), all rows fold into one output row.
 *
 * The input table MUST be sorted if the reducer is order-dependent.
 *
 * Internally uses a PostgreSQL custom aggregate for fast sequential folding
 * (no WITH RECURSIVE overhead). Inspired by LFold's approach but uses
 * full-group recomputation on changes.
 *
 * Example:
 *   Input (grouped by team, sorted by t):
 *     group "alpha": [{t:1, val:10}, {t:2, val:5}, {t:3, val:3}]
 *     group "beta":  [{t:1, val:7}]
 *   Reducer: sum val into state
 *   Finalize: emit {team: groupKey, total: state}
 *   Output (grouped by team, one row per group):
 *     group "alpha": [{team: "alpha", total: 18}]
 *     group "beta":  [{team: "beta", total: 7}]
 */
export function declareReduceTable<
  GK extends Json,
  SK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
  S extends Json,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, SK, OldRD>,
  initialState: SqlExpression<S>,
  /**
   * Reducer SQL. Available columns: "oldState" (accumulator), "oldRowData" (current input row).
   * Must produce: "newState" (updated accumulator).
   */
  reducer: SqlMapper<{ oldState: S, oldRowData: OldRD }, { newState: S }>,
  /**
   * Finalize SQL. Available columns: "state" (final accumulated state), "groupKey" (the input group key).
   * Must produce the output row's named columns (becomes the output rowData).
   */
  finalize: SqlMapper<{ state: S, groupKey: GK }, NewRD>,
}): Table<GK, null, NewRD> {
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

  const funcSuffix = generateSecureRandomString().replace(/[^a-z0-9]/g, "");
  const sfuncName = `pg_temp.bulldozer_reduce_sfunc_${funcSuffix}`;
  const aggName = `pg_temp.bulldozer_reduce_agg_${funcSuffix}`;

  const createAggSql = `
    CREATE OR REPLACE FUNCTION ${sfuncName}("rawState" jsonb, "oldRowData" jsonb)
    RETURNS jsonb AS $$
      SELECT (
        SELECT "reduced"."newState"
        FROM (
          SELECT ${options.reducer.sql}
          FROM (SELECT COALESCE("rawState", ${options.initialState.sql}) AS "oldState", "oldRowData" AS "oldRowData") AS "stateInput"
        ) AS "reduced"
      )
    $$ LANGUAGE sql IMMUTABLE;

    DROP AGGREGATE IF EXISTS ${aggName}(jsonb);
    CREATE AGGREGATE ${aggName}(jsonb) (
      sfunc = ${sfuncName},
      stype = jsonb
    );
  `;

  /**
   * SQL that computes reduced output rows for a set of groups.
   * Expects a "targetGroups" CTE with column "groupKey".
   * Uses the custom aggregate for fast folding.
   */
  const computeReducedRowsSql: { sql: string } = { sql: `
    "groupRows" AS (
      SELECT
        "r"."groupkey" AS "groupKey",
        "r"."rowidentifier" AS "rowIdentifier",
        "r"."rowdata" AS "rowData"
      FROM (
        ${options.fromTable.listRowsInGroup({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).sql}
      ) AS "r"
      WHERE EXISTS (
        SELECT 1 FROM "targetGroups" AS "g"
        WHERE "g"."groupKey"::text = "r"."groupkey"::text
      )
    ),
    "aggregated" AS (
      SELECT
        "groupKey",
        ${aggName}("rowData" ORDER BY "rowIdentifier" ASC) AS "state"
      FROM "groupRows"
      GROUP BY "groupKey"
    ),
    "reducedRows" AS (
      SELECT
        "aggregated"."groupKey" AS "groupKey",
        ("aggregated"."groupKey" #>> '{}') AS "rowIdentifier",
        'null'::jsonb AS "rowSortKey",
        (
          SELECT to_jsonb("finalized")
          FROM (
            SELECT ${options.finalize.sql}
            FROM (
              SELECT
                COALESCE("aggregated"."state", ${options.initialState.sql}) AS "state",
                "aggregated"."groupKey" AS "groupKey"
            ) AS "finalizeInput"
          ) AS "finalized"
        ) AS "rowData"
      FROM "aggregated"
    )
  ` };

  const createTriggerStatements = (fromChangesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => {
    const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
    const affectedGroupsTableName = `affected_groups_${generateSecureRandomString()}`;
    const oldRowsTableName = `old_reduced_rows_${generateSecureRandomString()}`;
    const newRowsTableName = `new_reduced_rows_${generateSecureRandomString()}`;
    const reduceChangesTableName = `reduce_changes_${generateSecureRandomString()}`;
    return [
      {
        type: "statement" as const,
        sql: createAggSql,
        requiresSequentialExecution: true,
      },
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
      // Compute new reduced rows for affected groups
      sqlQuery`
        WITH "targetGroups" AS (
          SELECT "groupKey" FROM ${quoteSqlIdentifier(affectedGroupsTableName)}
        ),
        ${computeReducedRowsSql}
        SELECT * FROM "reducedRows"
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
        USING ${quoteSqlIdentifier(oldRowsTableName)} AS "oldRows"
        WHERE "target"."keyPath" = ${getGroupRowPath(
          sqlExpression`"oldRows"."groupKey"`,
          sqlExpression`to_jsonb("oldRows"."rowIdentifier"::text)`,
        )}::jsonb[]
      `,
      // Insert new reduced rows
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
          'null'::jsonb AS "oldRowSortKey",
          'null'::jsonb AS "newRowSortKey",
          CASE WHEN "oldRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowData" END AS "oldRowData",
          CASE WHEN "newRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowData" END AS "newRowData"
        FROM ${quoteSqlIdentifier(oldRowsTableName)} AS "oldRows"
        FULL OUTER JOIN ${quoteSqlIdentifier(newRowsTableName)} AS "newRows"
          ON "oldRows"."groupKey" IS NOT DISTINCT FROM "newRows"."groupKey"
          AND "oldRows"."rowIdentifier" = "newRows"."rowIdentifier"
        WHERE "oldRows"."rowData" IS DISTINCT FROM "newRows"."rowData"
      `.toStatement(reduceChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
    ];
  };

  const fromTableTrigger = attachRowChangeTriggerMetadata(
    (changesTable) => createTriggerStatements(changesTable),
    {
      targetTableId: tableIdToDebugString(options.tableId),
      targetTableTriggers: triggers,
    },
  );
  options.fromTable.registerRowChangeTrigger(fromTableTrigger);

  const table: ReturnType<typeof declareReduceTable<GK, SK, OldRD, NewRD, S>> = {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "reduce",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
    },
    compareGroupKeys: options.fromTable.compareGroupKeys,
    compareSortKeys: () => sqlExpression` 0 `,
    init: () => {
      const allGroupsTableName = `all_groups_${generateSecureRandomString()}`;
      const initRowsTableName = `init_reduced_rows_${generateSecureRandomString()}`;
      return [
        {
          type: "statement" as const,
          sql: createAggSql,
          requiresSequentialExecution: true,
        },
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${groupsPath}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        sqlQuery`
          SELECT "groupkey" AS "groupKey" FROM (
            ${options.fromTable.listGroups({ start: "start", end: "end", startInclusive: true, endInclusive: true })}
          ) AS "g"
        `.toStatement(allGroupsTableName, '"groupKey" jsonb'),
        sqlQuery`
          WITH "targetGroups" AS (
            SELECT "groupKey" FROM ${quoteSqlIdentifier(allGroupsTableName)}
          ),
          ${computeReducedRowsSql}
          SELECT * FROM "reducedRows"
        `.toStatement(initRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
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
        AND ${isInitializedExpression}
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
        }
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey ? sqlQuery`
      SELECT
        ("row"."keyPath"[cardinality("row"."keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "row"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "row"
      WHERE "row"."keyPathParent" = ${getGroupRowsPath(groupKey)}::jsonb[]
        AND ${isInitializedExpression}
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
      ORDER BY rowIdentifier ASC
    ` : sqlQuery`
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
        AND ${isInitializedExpression}
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
      ORDER BY groupKey ASC, rowIdentifier ASC
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, normalizeRowChangeTrigger(trigger));
      return { deregister: () => triggers.delete(id) };
    },
    verifyDataIntegrity: () => {
      const allInputGroups = options.fromTable.listGroups({
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      const allActualRows = table.listRowsInGroup({
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      return sqlQuery`
        WITH "inputGroups" AS (
          SELECT "g"."groupkey" AS "groupKey" FROM (${allInputGroups}) AS "g"
        ),
        "actual" AS (
          SELECT "r"."groupkey" AS "groupKey", "r"."rowidentifier" AS "rowIdentifier", "r"."rowdata" AS "rowData"
          FROM (${allActualRows}) AS "r"
        ),
        "actualGroupCounts" AS (
          SELECT "groupKey", COUNT(*)::int AS "cnt" FROM "actual" GROUP BY "groupKey"
        ),
        "missingGroups" AS (
          SELECT 'missing_group' AS errortype,
            "inputGroups"."groupKey" AS groupkey, NULL::text AS rowidentifier,
            NULL::jsonb AS expected, NULL::jsonb AS actual
          FROM "inputGroups"
          LEFT JOIN "actualGroupCounts" ON "actualGroupCounts"."groupKey" IS NOT DISTINCT FROM "inputGroups"."groupKey"
          WHERE "actualGroupCounts"."groupKey" IS NULL
        ),
        "extraGroups" AS (
          SELECT 'extra_group' AS errortype,
            "actualGroupCounts"."groupKey" AS groupkey, NULL::text AS rowidentifier,
            NULL::jsonb AS expected, NULL::jsonb AS actual
          FROM "actualGroupCounts"
          LEFT JOIN "inputGroups" ON "inputGroups"."groupKey" IS NOT DISTINCT FROM "actualGroupCounts"."groupKey"
          WHERE "inputGroups"."groupKey" IS NULL
        ),
        "wrongRowCount" AS (
          SELECT 'wrong_row_count' AS errortype,
            "actualGroupCounts"."groupKey" AS groupkey, NULL::text AS rowidentifier,
            '1'::jsonb AS expected, to_jsonb("actualGroupCounts"."cnt") AS actual
          FROM "actualGroupCounts"
          WHERE "actualGroupCounts"."cnt" <> 1
        )
        SELECT * FROM "missingGroups" WHERE ${isInitializedExpression}
        UNION ALL SELECT * FROM "extraGroups" WHERE ${isInitializedExpression}
        UNION ALL SELECT * FROM "wrongRowCount" WHERE ${isInitializedExpression}
      `;
    },
  };
  return table;
}
