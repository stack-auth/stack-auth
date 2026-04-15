import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
import { attachRowChangeTriggerMetadata, normalizeRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { RegisteredRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlMapper, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  getTablePathSegments,
  quoteSqlIdentifier,
  quoteSqlJsonbLiteral,
  sqlArray,
  sqlExpression,
  sqlMapper,
  sqlQuery,
  sqlStatement,
  tableIdToDebugString
} from "../utilities";
import { declareSortTable } from "./sort-table";

/**
 * Materialized left-fold table.
 *
 * For each group, this table folds source rows in sort order (ties are deterministically broken by source
 * `rowIdentifier`) and stores the reducer output as flattened rows.
 *
 * Reducer contract:
 * - Input: `{ oldState, oldRowData }`
 * - Output: `{ newState, newRowsData }`
 *   - `newState` is carried into the next row in the same group.
 *   - `newRowsData` is flattened into output rows for the current source row.
 *
 * Output details:
 * - Output row sort key is the source row sort key.
 * - Output row identifier is `${sourceRowIdentifier}:${index}` (1-based index in `newRowsData`).
 *
 * Incremental behavior and performance:
 * - An internal sort table (treap-backed via `declareSortTable`) maintains source ordering.
 * - On source changes, LFold recomputes only the affected suffix in each touched group.
 * - If the first row changes, the full group is recomputed; if the last row changes, only the tail is.
 * - Per touched group complexity is roughly `O(log n + affectedRows * reducerCost + affectedOutputRows)`.
 */
export function declareLFoldTable<
  GK extends Json,
  SK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
  S extends Json,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, SK, OldRD>,
  initialState: SqlExpression<S>,
  reducer: SqlMapper<{ oldState: S, oldRowData: OldRD }, { newState: S, newRowsData: NewRD[] }>,
}): Table<GK, SK, NewRD> {
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
  const fromTableOperator = (
    "operator" in options.fromTable.debugArgs
    && typeof options.fromTable.debugArgs.operator === "string"
  ) ? options.fromTable.debugArgs.operator : null;
  const reusesInputSortTable = fromTableOperator === "sort";
  const sourceSortTableId: TableId = reusesInputSortTable ? options.fromTable.tableId : {
    tableType: "internal",
    internalId: "lfold-source-sort",
    parent: options.tableId,
  };
  const sourceSortTable: Table<GK, SK, OldRD> = reusesInputSortTable ? options.fromTable : declareSortTable({
    tableId: sourceSortTableId,
    fromTable: options.fromTable,
    getSortKey: sqlMapper`
      "oldSortKey" AS "newSortKey"
    `,
    compareSortKeys: options.fromTable.compareSortKeys,
  });
  const groupsPath = getStorageEnginePath(options.tableId, ["groups"]);
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const getGroupStatesPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "states"]);
  const getGroupStatePath = (groupKey: SqlExpression<Json>, sourceRowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "states", sourceRowIdentifier]);
  const getSourceSortGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(sourceSortTableId, ["groups", groupKey, "rows"]);
  const getSourceSortGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(sourceSortTableId, ["groups", groupKey, "rows", rowIdentifier]);
  const createExpandedRowIdentifier = (sourceRowIdentifier: SqlExpression<RowIdentifier>, flatIndex: SqlExpression<number>): SqlExpression<RowIdentifier> =>
    sqlExpression`(${sourceRowIdentifier} || ':' || (${flatIndex}::text))`;
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;
  const sortRangePredicate = (rowSortKey: SqlExpression<SK>, optionsForRange: {
    start: SqlExpression<SK> | "start",
    end: SqlExpression<SK> | "end",
    startInclusive: boolean,
    endInclusive: boolean,
  }) => sqlExpression`
    ${
      optionsForRange.start === "start"
        ? sqlExpression`1 = 1`
        : optionsForRange.startInclusive
          ? sqlExpression`${options.fromTable.compareSortKeys(rowSortKey, optionsForRange.start)} >= 0`
          : sqlExpression`${options.fromTable.compareSortKeys(rowSortKey, optionsForRange.start)} > 0`
    }
    AND ${
      optionsForRange.end === "end"
        ? sqlExpression`1 = 1`
        : optionsForRange.endInclusive
          ? sqlExpression`${options.fromTable.compareSortKeys(rowSortKey, optionsForRange.end)} <= 0`
          : sqlExpression`${options.fromTable.compareSortKeys(rowSortKey, optionsForRange.end)} < 0`
    }
  `;

  const createSourceSortTriggerStatements = (fromChangesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => {
    const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
    const boundaryCandidatesTableName = `boundary_candidates_${generateSecureRandomString()}`;
    const earliestBoundaryCandidatesTableName = `earliest_boundary_candidates_${generateSecureRandomString()}`;
    const touchedGroupsTableName = `touched_groups_${generateSecureRandomString()}`;
    const currentSourceRowsTableName = `current_source_rows_${generateSecureRandomString()}`;
    const affectedSourceRowsTableName = `affected_source_rows_${generateSecureRandomString()}`;
    const firstAffectedRowsTableName = `first_affected_rows_${generateSecureRandomString()}`;
    const rowsToClearTableName = `rows_to_clear_${generateSecureRandomString()}`;
    const oldFoldRowsTableName = `old_fold_rows_${generateSecureRandomString()}`;
    const recomputedSourceStatesTableName = `recomputed_source_states_${generateSecureRandomString()}`;
    const newFoldRowsTableName = `new_fold_rows_${generateSecureRandomString()}`;
    const lfoldChangesTableName = `lfold_changes_${generateSecureRandomString()}`;

    return [
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."rowIdentifier" AS "rowIdentifier",
          "changes"."oldRowSortKey" AS "oldRowSortKey",
          "changes"."newRowSortKey" AS "newRowSortKey",
          "changes"."oldRowData" AS "oldRowData",
          "changes"."newRowData" AS "newRowData",
          "changes"."hasOldRow" AS "hasOldRow",
          "changes"."hasNewRow" AS "hasNewRow",
          (
            ("changes"."hasOldRow" OR "changes"."hasNewRow")
            AND (
              NOT ("changes"."hasOldRow" AND "changes"."hasNewRow")
              OR "changes"."oldRowSortKey" IS DISTINCT FROM "changes"."newRowSortKey"
              OR "changes"."oldRowData" IS DISTINCT FROM "changes"."newRowData"
            )
          ) AS "shouldRecompute"
        FROM (
          SELECT
            "changes"."groupKey" AS "groupKey",
            "changes"."rowIdentifier" AS "rowIdentifier",
            "changes"."oldRowSortKey" AS "oldRowSortKey",
            "changes"."newRowSortKey" AS "newRowSortKey",
            "changes"."oldRowData" AS "oldRowData",
            "changes"."newRowData" AS "newRowData",
            ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
            ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow"
          FROM ${fromChangesTable} AS "changes"
        ) AS "changes"
        WHERE ${isInitializedExpression}
      `.toStatement(normalizedChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb, "hasOldRow" boolean, "hasNewRow" boolean, "shouldRecompute" boolean'),
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."oldRowSortKey" AS "boundarySortKey",
          "changes"."rowIdentifier" AS "boundaryRowIdentifier"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."shouldRecompute" AND "changes"."hasOldRow"

        UNION ALL

        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."newRowSortKey" AS "boundarySortKey",
          "changes"."rowIdentifier" AS "boundaryRowIdentifier"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."shouldRecompute" AND "changes"."hasNewRow"
      `.toStatement(boundaryCandidatesTableName, '"groupKey" jsonb, "boundarySortKey" jsonb, "boundaryRowIdentifier" text'),
      sqlQuery`
        SELECT DISTINCT
          "candidate"."groupKey" AS "groupKey",
          "candidate"."boundarySortKey" AS "boundarySortKey",
          "candidate"."boundaryRowIdentifier" AS "boundaryRowIdentifier"
        FROM ${quoteSqlIdentifier(boundaryCandidatesTableName)} AS "candidate"
        WHERE NOT EXISTS (
          SELECT 1
          FROM ${quoteSqlIdentifier(boundaryCandidatesTableName)} AS "other"
          WHERE "other"."groupKey" IS NOT DISTINCT FROM "candidate"."groupKey"
            AND (
              ${options.fromTable.compareSortKeys(sqlExpression`"other"."boundarySortKey"`, sqlExpression`"candidate"."boundarySortKey"`)} < 0
              OR (
                ${options.fromTable.compareSortKeys(sqlExpression`"other"."boundarySortKey"`, sqlExpression`"candidate"."boundarySortKey"`)} = 0
                AND "other"."boundaryRowIdentifier" < "candidate"."boundaryRowIdentifier"
              )
            )
        )
      `.toStatement(earliestBoundaryCandidatesTableName, '"groupKey" jsonb, "boundarySortKey" jsonb, "boundaryRowIdentifier" text'),
      sqlQuery`
        SELECT DISTINCT "groupKey"
        FROM ${quoteSqlIdentifier(earliestBoundaryCandidatesTableName)}
      `.toStatement(touchedGroupsTableName, '"groupKey" jsonb'),
      sqlQuery`
        SELECT
          "groups"."groupKey" AS "groupKey",
          ("sourceRows"."keyPath"[cardinality("sourceRows"."keyPath")] #>> '{}') AS "rowIdentifier",
          "sourceRows"."value"->'rowSortKey' AS "rowSortKey",
          "sourceRows"."value"->'rowData' AS "rowData",
          "sourceRows"."value"->>'prevRowIdentifier' AS "prevRowIdentifier",
          "sourceRows"."value"->>'nextRowIdentifier' AS "nextRowIdentifier"
        FROM ${quoteSqlIdentifier(touchedGroupsTableName)} AS "groups"
        INNER JOIN "BulldozerStorageEngine" AS "sourceRows"
          ON "sourceRows"."keyPathParent" = ${getSourceSortGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
      `.toStatement(currentSourceRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb, "prevRowIdentifier" text, "nextRowIdentifier" text'),
      sqlQuery`
        SELECT
          "sourceRows"."groupKey" AS "groupKey",
          "sourceRows"."rowIdentifier" AS "rowIdentifier",
          "sourceRows"."rowSortKey" AS "rowSortKey",
          "sourceRows"."rowData" AS "rowData",
          "sourceRows"."prevRowIdentifier" AS "prevRowIdentifier",
          "sourceRows"."nextRowIdentifier" AS "nextRowIdentifier"
        FROM ${quoteSqlIdentifier(currentSourceRowsTableName)} AS "sourceRows"
        INNER JOIN ${quoteSqlIdentifier(earliestBoundaryCandidatesTableName)} AS "boundary"
          ON "boundary"."groupKey" IS NOT DISTINCT FROM "sourceRows"."groupKey"
        WHERE
          ${options.fromTable.compareSortKeys(sqlExpression`"sourceRows"."rowSortKey"`, sqlExpression`"boundary"."boundarySortKey"`)} > 0
          OR (
            ${options.fromTable.compareSortKeys(sqlExpression`"sourceRows"."rowSortKey"`, sqlExpression`"boundary"."boundarySortKey"`)} = 0
            AND "sourceRows"."rowIdentifier" >= "boundary"."boundaryRowIdentifier"
          )
      `.toStatement(affectedSourceRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb, "prevRowIdentifier" text, "nextRowIdentifier" text'),
      sqlQuery`
        SELECT
          "affectedRows"."groupKey" AS "groupKey",
          "affectedRows"."rowIdentifier" AS "rowIdentifier",
          "affectedRows"."rowSortKey" AS "rowSortKey",
          "affectedRows"."rowData" AS "rowData",
          "affectedRows"."prevRowIdentifier" AS "prevRowIdentifier",
          "affectedRows"."nextRowIdentifier" AS "nextRowIdentifier"
        FROM ${quoteSqlIdentifier(affectedSourceRowsTableName)} AS "affectedRows"
        LEFT JOIN ${quoteSqlIdentifier(affectedSourceRowsTableName)} AS "affectedPrevRows"
          ON "affectedPrevRows"."groupKey" IS NOT DISTINCT FROM "affectedRows"."groupKey"
          AND "affectedPrevRows"."rowIdentifier" = "affectedRows"."prevRowIdentifier"
        WHERE "affectedPrevRows"."rowIdentifier" IS NULL
      `.toStatement(firstAffectedRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb, "prevRowIdentifier" text, "nextRowIdentifier" text'),
      sqlQuery`
        SELECT DISTINCT
          "rows"."groupKey" AS "groupKey",
          "rows"."rowIdentifier" AS "rowIdentifier"
        FROM ${quoteSqlIdentifier(affectedSourceRowsTableName)} AS "rows"

        UNION

        SELECT DISTINCT
          "changes"."groupKey" AS "groupKey",
          "changes"."rowIdentifier" AS "rowIdentifier"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."shouldRecompute" AND "changes"."hasOldRow"
      `.toStatement(rowsToClearTableName, '"groupKey" jsonb, "rowIdentifier" text'),
      sqlQuery`
        SELECT
          "rowsToClear"."groupKey" AS "groupKey",
          ${createExpandedRowIdentifier(
            sqlExpression`"rowsToClear"."rowIdentifier"`,
            sqlExpression`"flatRow"."flatIndex"`,
          )} AS "rowIdentifier",
          "stateRows"."value"->'rowSortKey' AS "rowSortKey",
          "flatRow"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(rowsToClearTableName)} AS "rowsToClear"
        INNER JOIN "BulldozerStorageEngine" AS "stateRows"
          ON "stateRows"."keyPath" = ${getGroupStatePath(
            sqlExpression`"rowsToClear"."groupKey"`,
            sqlExpression`to_jsonb("rowsToClear"."rowIdentifier"::text)`,
          )}::jsonb[]
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("stateRows"."value"->'emittedRowsData') = 'array' THEN "stateRows"."value"->'emittedRowsData'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      `.toStatement(oldFoldRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
      sqlQuery`
        WITH RECURSIVE "recomputedRows" AS (
          SELECT
            "firstRows"."groupKey" AS "groupKey",
            "firstRows"."rowIdentifier" AS "rowIdentifier",
            "firstRows"."rowSortKey" AS "rowSortKey",
            "firstRows"."rowData" AS "rowData",
            "firstRows"."nextRowIdentifier" AS "nextRowIdentifier",
            "seed"."oldState" AS "oldState",
            "reduced"."newState" AS "newState",
            "reduced"."newRowsData" AS "newRowsData"
          FROM ${quoteSqlIdentifier(firstAffectedRowsTableName)} AS "firstRows"
          LEFT JOIN "BulldozerStorageEngine" AS "prevStateRows"
            ON "firstRows"."prevRowIdentifier" IS NOT NULL
            AND "prevStateRows"."keyPath" = ${getGroupStatePath(
              sqlExpression`"firstRows"."groupKey"`,
              sqlExpression`to_jsonb("firstRows"."prevRowIdentifier"::text)`,
            )}::jsonb[]
          CROSS JOIN LATERAL (
            SELECT
              CASE
                WHEN "firstRows"."prevRowIdentifier" IS NULL THEN to_jsonb(${options.initialState})
                ELSE COALESCE("prevStateRows"."value"->'stateAfter', to_jsonb(${options.initialState}))
              END AS "oldState"
          ) AS "seed"
          CROSS JOIN LATERAL (
            SELECT
              to_jsonb("reducerRows"."newState") AS "newState",
              CASE
                WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                ELSE '[]'::jsonb
              END AS "newRowsData"
            FROM (
              SELECT ${options.reducer}
              FROM (
                SELECT
                  "seed"."oldState" AS "oldState",
                  "firstRows"."rowData" AS "oldRowData"
              ) AS "reducerInput"
            ) AS "reducerRows"
          ) AS "reduced"

          UNION ALL

          SELECT
            "recomputedRows"."groupKey" AS "groupKey",
            ("nextSourceRows"."keyPath"[cardinality("nextSourceRows"."keyPath")] #>> '{}') AS "rowIdentifier",
            "nextSourceRows"."value"->'rowSortKey' AS "rowSortKey",
            "nextSourceRows"."value"->'rowData' AS "rowData",
            "nextSourceRows"."value"->>'nextRowIdentifier' AS "nextRowIdentifier",
            "recomputedRows"."newState" AS "oldState",
            "reduced"."newState" AS "newState",
            "reduced"."newRowsData" AS "newRowsData"
          FROM "recomputedRows"
          INNER JOIN "BulldozerStorageEngine" AS "nextSourceRows"
            ON "recomputedRows"."nextRowIdentifier" IS NOT NULL
            AND "nextSourceRows"."keyPath" = ${getSourceSortGroupRowPath(
              sqlExpression`"recomputedRows"."groupKey"`,
              sqlExpression`to_jsonb("recomputedRows"."nextRowIdentifier"::text)`,
            )}::jsonb[]
          CROSS JOIN LATERAL (
            SELECT
              to_jsonb("reducerRows"."newState") AS "newState",
              CASE
                WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                ELSE '[]'::jsonb
              END AS "newRowsData"
            FROM (
              SELECT ${options.reducer}
              FROM (
                SELECT
                  "recomputedRows"."newState" AS "oldState",
                  "nextSourceRows"."value"->'rowData' AS "oldRowData"
              ) AS "reducerInput"
            ) AS "reducerRows"
          ) AS "reduced"
        )
        SELECT
          "groupKey" AS "groupKey",
          "rowIdentifier" AS "rowIdentifier",
          "rowSortKey" AS "rowSortKey",
          "newState" AS "stateAfter",
          "newRowsData" AS "emittedRowsData"
        FROM "recomputedRows"
      `.toStatement(recomputedSourceStatesTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "stateAfter" jsonb, "emittedRowsData" jsonb'),
      sqlQuery`
        SELECT
          "states"."groupKey" AS "groupKey",
          ${createExpandedRowIdentifier(
            sqlExpression`"states"."rowIdentifier"`,
            sqlExpression`"flatRow"."flatIndex"`,
          )} AS "rowIdentifier",
          "states"."rowSortKey" AS "rowSortKey",
          "flatRow"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)} AS "states"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("states"."emittedRowsData") = 'array' THEN "states"."emittedRowsData"
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      `.toStatement(newFoldRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
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
          FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupStatesPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newFoldRowsTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newFoldRowsTableName)}
        ) AS "insertRows"
        ON CONFLICT ("keyPath") DO NOTHING
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "targetRows"
        USING ${quoteSqlIdentifier(oldFoldRowsTableName)} AS "oldRows"
        WHERE "targetRows"."keyPath" = ${getGroupRowPath(
          sqlExpression`"oldRows"."groupKey"`,
          sqlExpression`to_jsonb("oldRows"."rowIdentifier"::text)`,
        )}::jsonb[]
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "targetStates"
        USING ${quoteSqlIdentifier(rowsToClearTableName)} AS "rowsToClear"
        WHERE "targetStates"."keyPath" = ${getGroupStatePath(
          sqlExpression`"rowsToClear"."groupKey"`,
          sqlExpression`to_jsonb("rowsToClear"."rowIdentifier"::text)`,
        )}::jsonb[]
      `,
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          ${getGroupStatePath(
            sqlExpression`"states"."groupKey"`,
            sqlExpression`to_jsonb("states"."rowIdentifier"::text)`,
          )}::jsonb[],
          jsonb_build_object(
            'rowSortKey', "states"."rowSortKey",
            'stateAfter', "states"."stateAfter",
            'emittedRowsData', "states"."emittedRowsData"
          )
        FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)} AS "states"
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          ${getGroupRowPath(
            sqlExpression`"rows"."groupKey"`,
            sqlExpression`to_jsonb("rows"."rowIdentifier"::text)`,
          )}::jsonb[],
          jsonb_build_object(
            'rowSortKey', "rows"."rowSortKey",
            'rowData', "rows"."rowData"
          )
        FROM ${quoteSqlIdentifier(newFoldRowsTableName)} AS "rows"
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "staleGroupPaths"
        USING ${quoteSqlIdentifier(touchedGroupsTableName)} AS "groups"
        WHERE "staleGroupPaths"."keyPath" IN (
          ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[],
          ${getGroupStatesPath(sqlExpression`"groups"."groupKey"`)}::jsonb[],
          ${getGroupKeyPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        )
          AND NOT EXISTS (
            SELECT 1
            FROM "BulldozerStorageEngine" AS "stateRows"
            WHERE "stateRows"."keyPathParent" = ${getGroupStatesPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "BulldozerStorageEngine" AS "foldRows"
            WHERE "foldRows"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
          )
      `,
      sqlQuery`
        SELECT
          COALESCE("newRows"."groupKey", "oldRows"."groupKey") AS "groupKey",
          COALESCE("newRows"."rowIdentifier", "oldRows"."rowIdentifier") AS "rowIdentifier",
          CASE WHEN "oldRows"."rowSortKey" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowSortKey" END AS "oldRowSortKey",
          CASE WHEN "newRows"."rowSortKey" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowSortKey" END AS "newRowSortKey",
          CASE WHEN "oldRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowData" END AS "oldRowData",
          CASE WHEN "newRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowData" END AS "newRowData"
        FROM ${quoteSqlIdentifier(oldFoldRowsTableName)} AS "oldRows"
        FULL OUTER JOIN ${quoteSqlIdentifier(newFoldRowsTableName)} AS "newRows"
          ON "oldRows"."groupKey" IS NOT DISTINCT FROM "newRows"."groupKey"
          AND "oldRows"."rowIdentifier" = "newRows"."rowIdentifier"
        WHERE "oldRows"."rowSortKey" IS DISTINCT FROM "newRows"."rowSortKey"
          OR "oldRows"."rowData" IS DISTINCT FROM "newRows"."rowData"
      `.toStatement(lfoldChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
    ];
  };
  const sourceSortTrigger = attachRowChangeTriggerMetadata(
    (fromChangesTable) => createSourceSortTriggerStatements(fromChangesTable),
    {
      targetTableId: tableIdToDebugString(options.tableId),
      targetTableTriggers: triggers,
    },
  );
  sourceSortTable.registerRowChangeTrigger(sourceSortTrigger);

  const table: ReturnType<typeof declareLFoldTable<GK, SK, OldRD, NewRD, S>> = {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "lfold",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      initialStateSql: options.initialState.sql,
      reducerSql: options.reducer.sql,
    },
    compareGroupKeys: options.fromTable.compareGroupKeys,
    compareSortKeys: options.fromTable.compareSortKeys,
    init: () => {
      const firstSourceRowsTableName = `first_source_rows_${generateSecureRandomString()}`;
      const recomputedSourceStatesTableName = `recomputed_source_states_${generateSecureRandomString()}`;
      const newFoldRowsTableName = `new_fold_rows_${generateSecureRandomString()}`;
      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${sqlArray([...getTablePathSegments(options.tableId), quoteSqlJsonbLiteral("table")])}::jsonb[], 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${groupsPath}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        ...(reusesInputSortTable ? [] : sourceSortTable.init()),
        sqlQuery`
          SELECT
            "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS "groupKey",
            ("sourceRows"."keyPath"[cardinality("sourceRows"."keyPath")] #>> '{}') AS "rowIdentifier",
            "sourceRows"."value"->'rowSortKey' AS "rowSortKey",
            "sourceRows"."value"->'rowData' AS "rowData",
            "sourceRows"."value"->>'prevRowIdentifier' AS "prevRowIdentifier",
            "sourceRows"."value"->>'nextRowIdentifier' AS "nextRowIdentifier"
          FROM "BulldozerStorageEngine" AS "groupPath"
          INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
            ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
          INNER JOIN "BulldozerStorageEngine" AS "sourceRows"
            ON "sourceRows"."keyPathParent" = "groupRowsPath"."keyPath"
          WHERE "groupPath"."keyPathParent" = ${getStorageEnginePath(sourceSortTableId, ["groups"])}::jsonb[]
            AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
            AND "sourceRows"."value"->>'prevRowIdentifier' IS NULL
        `.toStatement(firstSourceRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb, "prevRowIdentifier" text, "nextRowIdentifier" text'),
        sqlQuery`
          WITH RECURSIVE "recomputedRows" AS (
            SELECT
              "firstRows"."groupKey" AS "groupKey",
              "firstRows"."rowIdentifier" AS "rowIdentifier",
              "firstRows"."rowSortKey" AS "rowSortKey",
              "firstRows"."rowData" AS "rowData",
              "firstRows"."nextRowIdentifier" AS "nextRowIdentifier",
              to_jsonb(${options.initialState}) AS "oldState",
              "reduced"."newState" AS "newState",
              "reduced"."newRowsData" AS "newRowsData"
            FROM ${quoteSqlIdentifier(firstSourceRowsTableName)} AS "firstRows"
            CROSS JOIN LATERAL (
              SELECT
                to_jsonb("reducerRows"."newState") AS "newState",
                CASE
                  WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                  ELSE '[]'::jsonb
                END AS "newRowsData"
              FROM (
                SELECT ${options.reducer}
                FROM (
                  SELECT
                    to_jsonb(${options.initialState}) AS "oldState",
                    "firstRows"."rowData" AS "oldRowData"
                ) AS "reducerInput"
              ) AS "reducerRows"
            ) AS "reduced"

            UNION ALL

            SELECT
              "recomputedRows"."groupKey" AS "groupKey",
              ("nextSourceRows"."keyPath"[cardinality("nextSourceRows"."keyPath")] #>> '{}') AS "rowIdentifier",
              "nextSourceRows"."value"->'rowSortKey' AS "rowSortKey",
              "nextSourceRows"."value"->'rowData' AS "rowData",
              "nextSourceRows"."value"->>'nextRowIdentifier' AS "nextRowIdentifier",
              "recomputedRows"."newState" AS "oldState",
              "reduced"."newState" AS "newState",
              "reduced"."newRowsData" AS "newRowsData"
            FROM "recomputedRows"
            INNER JOIN "BulldozerStorageEngine" AS "nextSourceRows"
              ON "recomputedRows"."nextRowIdentifier" IS NOT NULL
              AND "nextSourceRows"."keyPath" = ${getSourceSortGroupRowPath(
                sqlExpression`"recomputedRows"."groupKey"`,
                sqlExpression`to_jsonb("recomputedRows"."nextRowIdentifier"::text)`,
              )}::jsonb[]
            CROSS JOIN LATERAL (
              SELECT
                to_jsonb("reducerRows"."newState") AS "newState",
                CASE
                  WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                  ELSE '[]'::jsonb
                END AS "newRowsData"
              FROM (
                SELECT ${options.reducer}
                FROM (
                  SELECT
                    "recomputedRows"."newState" AS "oldState",
                    "nextSourceRows"."value"->'rowData' AS "oldRowData"
                ) AS "reducerInput"
              ) AS "reducerRows"
            ) AS "reduced"
          )
          SELECT
            "groupKey" AS "groupKey",
            "rowIdentifier" AS "rowIdentifier",
            "rowSortKey" AS "rowSortKey",
            "newState" AS "stateAfter",
            "newRowsData" AS "emittedRowsData"
          FROM "recomputedRows"
        `.toStatement(recomputedSourceStatesTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "stateAfter" jsonb, "emittedRowsData" jsonb'),
        sqlQuery`
          SELECT
            "states"."groupKey" AS "groupKey",
            ${createExpandedRowIdentifier(
              sqlExpression`"states"."rowIdentifier"`,
              sqlExpression`"flatRow"."flatIndex"`,
            )} AS "rowIdentifier",
            "states"."rowSortKey" AS "rowSortKey",
            "flatRow"."rowData" AS "rowData"
          FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)} AS "states"
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof("states"."emittedRowsData") = 'array' THEN "states"."emittedRowsData"
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
        `.toStatement(newFoldRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
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
            FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupStatesPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(newFoldRowsTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(newFoldRowsTableName)}
          ) AS "insertRows"
          ON CONFLICT ("keyPath") DO NOTHING
        `,
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            ${getGroupStatePath(
              sqlExpression`"states"."groupKey"`,
              sqlExpression`to_jsonb("states"."rowIdentifier"::text)`,
            )}::jsonb[],
            jsonb_build_object(
              'rowSortKey', "states"."rowSortKey",
              'stateAfter', "states"."stateAfter",
              'emittedRowsData', "states"."emittedRowsData"
            )
          FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)} AS "states"
          ON CONFLICT ("keyPath") DO UPDATE
          SET "value" = EXCLUDED."value"
        `,
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            ${getGroupRowPath(
              sqlExpression`"rows"."groupKey"`,
              sqlExpression`to_jsonb("rows"."rowIdentifier"::text)`,
            )}::jsonb[],
            jsonb_build_object(
              'rowSortKey', "rows"."rowSortKey",
              'rowData', "rows"."rowData"
            )
          FROM ${quoteSqlIdentifier(newFoldRowsTableName)} AS "rows"
          ON CONFLICT ("keyPath") DO UPDATE
          SET "value" = EXCLUDED."value"
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
      WITH "orderedSourceRows" AS (
        SELECT
          row_number() OVER () AS "rowOrder",
          "sourceRows"."rowidentifier" AS "rowIdentifier"
        FROM (
          ${sourceSortTable.listRowsInGroup({
            groupKey,
            start,
            end,
            startInclusive,
            endInclusive,
          })}
        ) AS "sourceRows"
      )
      SELECT
        ${createExpandedRowIdentifier(
          sqlExpression`"orderedSourceRows"."rowIdentifier"`,
          sqlExpression`"flatRow"."flatIndex"`,
        )} AS rowIdentifier,
        "stateRows"."value"->'rowSortKey' AS rowSortKey,
        "flatRow"."rowData" AS rowData
      FROM "orderedSourceRows"
      INNER JOIN "BulldozerStorageEngine" AS "stateRows"
        ON "stateRows"."keyPath" = ${getGroupStatePath(
          groupKey,
          sqlExpression`to_jsonb("orderedSourceRows"."rowIdentifier"::text)`,
        )}::jsonb[]
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof("stateRows"."value"->'emittedRowsData') = 'array' THEN "stateRows"."value"->'emittedRowsData'
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      ORDER BY "orderedSourceRows"."rowOrder" ASC, "flatRow"."flatIndex" ASC
    ` : sqlQuery`
      SELECT
        "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        "rows"."value"->'rowSortKey' AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupPath"
      INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
        ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
      INNER JOIN "BulldozerStorageEngine" AS "rows"
        ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
      WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
        AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        AND ${sortRangePredicate(sqlExpression`"rows"."value"->'rowSortKey'`, { start, end, startInclusive, endInclusive })}
      ORDER BY groupKey ASC, rowSortKey ASC, rowIdentifier ASC
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
      const allActualGroups = table.listGroups({
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      return sqlQuery`
        WITH "inputGroups" AS (
          SELECT "g"."groupkey" AS "groupKey" FROM (${allInputGroups}) AS "g"
        ),
        "actualGroups" AS (
          SELECT "g"."groupkey" AS "groupKey" FROM (${allActualGroups}) AS "g"
        ),
        "missingGroups" AS (
          SELECT 'missing_group' AS errortype,
            "inputGroups"."groupKey" AS groupkey, NULL::text AS rowidentifier,
            NULL::jsonb AS expected, NULL::jsonb AS actual
          FROM "inputGroups"
          LEFT JOIN "actualGroups" ON "actualGroups"."groupKey" IS NOT DISTINCT FROM "inputGroups"."groupKey"
          WHERE "actualGroups"."groupKey" IS NULL
        ),
        "extraGroups" AS (
          SELECT 'extra_group' AS errortype,
            "actualGroups"."groupKey" AS groupkey, NULL::text AS rowidentifier,
            NULL::jsonb AS expected, NULL::jsonb AS actual
          FROM "actualGroups"
          LEFT JOIN "inputGroups" ON "inputGroups"."groupKey" IS NOT DISTINCT FROM "actualGroups"."groupKey"
          WHERE "inputGroups"."groupKey" IS NULL
        )
        SELECT * FROM "missingGroups" WHERE ${isInitializedExpression}
        UNION ALL SELECT * FROM "extraGroups" WHERE ${isInitializedExpression}
      `;
    },
  };
  return table;
}
