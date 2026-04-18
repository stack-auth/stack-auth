import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { toCascadeSqlBlock, type Table } from "..";
import {
  attachRowChangeTriggerMetadata,
  CHANGE_OUTPUT_COLUMNS,
  collectRowChangeTriggerStatements,
  normalizeRowChangeTrigger,
  type RegisteredRowChangeTrigger,
} from "../row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlMapper, TableId, Timestamp } from "../utilities";
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
 * Materialized time-aware fold with queue-backed future reprocessing.
 *
 * For each input row, the reducer runs once with `timestamp = null`, then can optionally
 * schedule follow-up runs by returning `nextTimestamp`. Due follow-ups rerun the reducer with
 * `timestamp = previousNextTimestamp` and the latest state.
 *
 * Output semantics:
 * - Timed reruns append newly emitted rows to previously emitted rows for that input row.
 * - Source-row updates/deletes still recompute/reset that input row's emitted output.
 *
 * Determinism guidance:
 * - Avoid non-deterministic SQL such as `now()` or random generators inside reducers when output
 *   correctness depends on those values. Re-initializing/replaying should produce the same results.
 * - If randomness is needed (for example correlation IDs or light debugging metadata), treat it as
 *   best-effort auxiliary data and do not build correctness-critical logic on top of it.
 * - Prefer deriving `nextTimestamp` from stable row fields (for example, an event timestamp on
 *   `oldRowData`) and from the reducer input `timestamp` itself.
 */
export function declareTimeFoldTable<
  GK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
  S extends Json,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, OldRD>,
  initialState: SqlExpression<S>,
  reducer: SqlMapper<{ oldState: S, oldRowData: OldRD, timestamp: Timestamp | null }, { newState: S, newRowsData: NewRD[], nextTimestamp: Timestamp | null }>,
}): Table<GK, null, NewRD> {
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
  const reducerSqlLiteral = quoteSqlStringLiteral(options.reducer.sql);
  const tableStoragePath = getStorageEnginePath(options.tableId, []);
  const groupsPath = getStorageEnginePath(options.tableId, ["groups"]);
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const getGroupStatesPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "states"]);
  const getGroupStatePath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "states", rowIdentifier]);
  const createExpandedRowIdentifier = (sourceRowIdentifier: SqlExpression<RowIdentifier>, flatIndex: SqlExpression<number>): SqlExpression<RowIdentifier> =>
    sqlExpression`(${sourceRowIdentifier} || ':' || (${flatIndex}::text))`;
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;
  const lastProcessedTimestampExpression = sqlExpression`
    COALESCE(
      (
        SELECT "lastProcessedAt"
        FROM "BulldozerTimeFoldMetadata"
        WHERE "key" = 'singleton'
      ),
      '2000-01-01T00:00:00Z'::timestamptz
    )
  `;
  const createApplyChangesStatements = (normalizedChangesTable: SqlExpression<string>) => {
    const oldStateRowsTableName = `old_state_rows_${generateSecureRandomString()}`;
    const oldTimeFoldRowsTableName = `old_time_fold_rows_${generateSecureRandomString()}`;
    const recomputedStatesTableName = `recomputed_states_${generateSecureRandomString()}`;
    const newTimeFoldRowsTableName = `new_time_fold_rows_${generateSecureRandomString()}`;
    const timeFoldChangesTableName = `time_fold_changes_${generateSecureRandomString()}`;

    return [
      {
        ...sqlQuery`
          SELECT
            "changes"."groupKey" AS "groupKey",
            "changes"."rowIdentifier" AS "rowIdentifier",
            "stateRows"."value" AS "stateValue"
          FROM ${normalizedChangesTable} AS "changes"
          INNER JOIN "BulldozerStorageEngine" AS "stateRows"
            ON "changes"."hasOldRow"
            AND "stateRows"."keyPath" = ${getGroupStatePath(
              sqlExpression`"changes"."groupKey"`,
              sqlExpression`to_jsonb("changes"."rowIdentifier"::text)`,
            )}::jsonb[]
        `.toStatement(oldStateRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "stateValue" jsonb'),
        requiresSequentialExecution: true,
      },
      sqlQuery`
        SELECT
          "states"."groupKey" AS "groupKey",
          ${createExpandedRowIdentifier(
            sqlExpression`"states"."rowIdentifier"`,
            sqlExpression`"flatRow"."flatIndex"`,
          )} AS "rowIdentifier",
          "flatRow"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(oldStateRowsTableName)} AS "states"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("states"."stateValue"->'emittedRowsData') = 'array' THEN "states"."stateValue"->'emittedRowsData'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      `.toStatement(oldTimeFoldRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb'),
      sqlQuery`
        WITH RECURSIVE "stateChain" AS (
          SELECT
            "changes"."groupKey" AS "groupKey",
            "changes"."rowIdentifier" AS "rowIdentifier",
            "changes"."newRowData" AS "rowData",
            "lastProcessed"."lastProcessedAt" AS "lastProcessedAt",
            0 AS "depth",
            to_jsonb(${options.initialState}) AS "oldState",
            NULL::timestamptz AS "reducerTimestamp",
            "reduced"."newState" AS "newState",
            "reduced"."newRowsData" AS "newRowsData",
            "reduced"."nextTimestamp" AS "nextTimestamp"
          FROM ${normalizedChangesTable} AS "changes"
          CROSS JOIN LATERAL (
            SELECT ${lastProcessedTimestampExpression} AS "lastProcessedAt"
          ) AS "lastProcessed"
          CROSS JOIN LATERAL (
            SELECT
              to_jsonb("reducerRows"."newState") AS "newState",
              CASE
                WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                ELSE '[]'::jsonb
              END AS "newRowsData",
              CASE
                WHEN "reducerRows"."nextTimestamp" IS NULL THEN NULL::timestamptz
                ELSE ("reducerRows"."nextTimestamp")::timestamptz
              END AS "nextTimestamp"
            FROM (
              SELECT ${options.reducer}
              FROM (
                SELECT
                  to_jsonb(${options.initialState}) AS "oldState",
                  "changes"."newRowData" AS "oldRowData",
                  NULL::timestamptz AS "timestamp"
              ) AS "reducerInput"
            ) AS "reducerRows"
          ) AS "reduced"
          WHERE "changes"."hasNewRow"

          UNION ALL

          SELECT
            "stateChain"."groupKey" AS "groupKey",
            "stateChain"."rowIdentifier" AS "rowIdentifier",
            "stateChain"."rowData" AS "rowData",
            "stateChain"."lastProcessedAt" AS "lastProcessedAt",
            "stateChain"."depth" + 1 AS "depth",
            "stateChain"."newState" AS "oldState",
            "stateChain"."nextTimestamp" AS "reducerTimestamp",
            "reduced"."newState" AS "newState",
            "reduced"."newRowsData" AS "newRowsData",
            "reduced"."nextTimestamp" AS "nextTimestamp"
          FROM "stateChain"
          CROSS JOIN LATERAL (
            SELECT
              to_jsonb("reducerRows"."newState") AS "newState",
              CASE
                WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                ELSE '[]'::jsonb
              END AS "newRowsData",
              CASE
                WHEN "reducerRows"."nextTimestamp" IS NULL THEN NULL::timestamptz
                ELSE ("reducerRows"."nextTimestamp")::timestamptz
              END AS "nextTimestamp"
            FROM (
              SELECT ${options.reducer}
              FROM (
                SELECT
                  "stateChain"."newState" AS "oldState",
                  "stateChain"."rowData" AS "oldRowData",
                  "stateChain"."nextTimestamp" AS "timestamp"
              ) AS "reducerInput"
            ) AS "reducerRows"
          ) AS "reduced"
          WHERE "stateChain"."nextTimestamp" IS NOT NULL
            AND "stateChain"."nextTimestamp" <= "stateChain"."lastProcessedAt"
            AND "stateChain"."depth" < 10000
        ),
        "latestStateByRow" AS (
          SELECT DISTINCT ON ("groupKey", "rowIdentifier")
            "groupKey" AS "groupKey",
            "rowIdentifier" AS "rowIdentifier",
            "rowData" AS "rowData",
            "lastProcessedAt" AS "lastProcessedAt",
            "newState" AS "stateAfter",
            "nextTimestamp" AS "nextTimestamp"
          FROM "stateChain"
          ORDER BY "groupKey", "rowIdentifier", "depth" DESC
        ),
        "emittedRowsByRow" AS (
          SELECT
            "stateChain"."groupKey" AS "groupKey",
            "stateChain"."rowIdentifier" AS "rowIdentifier",
            COALESCE(
              jsonb_agg("emittedRows"."rowData" ORDER BY "stateChain"."depth", "emittedRows"."rowIndex")
                FILTER (WHERE "emittedRows"."rowData" IS NOT NULL),
              '[]'::jsonb
            ) AS "emittedRowsData"
          FROM "stateChain"
          LEFT JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof("stateChain"."newRowsData") = 'array' THEN "stateChain"."newRowsData"
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS "emittedRows"("rowData", "rowIndex") ON true
          GROUP BY
            "stateChain"."groupKey",
            "stateChain"."rowIdentifier"
        )
        SELECT
          "latestStateByRow"."groupKey" AS "groupKey",
          "latestStateByRow"."rowIdentifier" AS "rowIdentifier",
          "latestStateByRow"."rowData" AS "rowData",
          "latestStateByRow"."lastProcessedAt" AS "lastProcessedAt",
          "latestStateByRow"."stateAfter" AS "stateAfter",
          "emittedRowsByRow"."emittedRowsData" AS "emittedRowsData",
          "latestStateByRow"."nextTimestamp" AS "nextTimestamp"
        FROM "latestStateByRow"
        INNER JOIN "emittedRowsByRow"
          ON "emittedRowsByRow"."groupKey" IS NOT DISTINCT FROM "latestStateByRow"."groupKey"
          AND "emittedRowsByRow"."rowIdentifier" = "latestStateByRow"."rowIdentifier"
      `.toStatement(recomputedStatesTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb, "lastProcessedAt" timestamptz, "stateAfter" jsonb, "emittedRowsData" jsonb, "nextTimestamp" timestamptz'),
      sqlQuery`
        SELECT
          "states"."groupKey" AS "groupKey",
          ${createExpandedRowIdentifier(
            sqlExpression`"states"."rowIdentifier"`,
            sqlExpression`"flatRow"."flatIndex"`,
          )} AS "rowIdentifier",
          "flatRow"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(recomputedStatesTableName)} AS "states"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("states"."emittedRowsData") = 'array' THEN "states"."emittedRowsData"
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      `.toStatement(newTimeFoldRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb'),
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
          FROM ${quoteSqlIdentifier(recomputedStatesTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(recomputedStatesTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupStatesPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(recomputedStatesTableName)}
        ) AS "insertRows"
        ON CONFLICT ("keyPath") DO NOTHING
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "targetRows"
        USING ${quoteSqlIdentifier(oldTimeFoldRowsTableName)} AS "oldRows"
        WHERE "targetRows"."keyPath" = ${getGroupRowPath(
          sqlExpression`"oldRows"."groupKey"`,
          sqlExpression`to_jsonb("oldRows"."rowIdentifier"::text)`,
        )}::jsonb[]
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "targetStates"
        USING ${normalizedChangesTable} AS "changes"
        WHERE "changes"."hasOldRow"
          AND "targetStates"."keyPath" = ${getGroupStatePath(
            sqlExpression`"changes"."groupKey"`,
            sqlExpression`to_jsonb("changes"."rowIdentifier"::text)`,
          )}::jsonb[]
      `,
      sqlStatement`
        DELETE FROM "BulldozerTimeFoldQueue" AS "queue"
        USING ${normalizedChangesTable} AS "changes"
        WHERE ("changes"."hasOldRow" OR "changes"."hasNewRow")
          AND "queue"."tableStoragePath" = ${tableStoragePath}::jsonb[]
          AND "queue"."groupKey" IS NOT DISTINCT FROM "changes"."groupKey"
          AND "queue"."rowIdentifier" = "changes"."rowIdentifier"
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
            'rowData', "states"."rowData",
            'stateAfter', "states"."stateAfter",
            'emittedRowsData', "states"."emittedRowsData",
            'nextTimestamp',
            CASE
              WHEN "states"."nextTimestamp" IS NULL THEN 'null'::jsonb
              ELSE to_jsonb("states"."nextTimestamp")
            END
          )
        FROM ${quoteSqlIdentifier(recomputedStatesTableName)} AS "states"
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
          jsonb_build_object('rowData', "rows"."rowData")
        FROM ${quoteSqlIdentifier(newTimeFoldRowsTableName)} AS "rows"
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "staleGroupPaths"
        USING ${normalizedChangesTable} AS "changes"
        WHERE "changes"."hasOldRow"
          AND "staleGroupPaths"."keyPath" IN (
            ${getGroupRowsPath(sqlExpression`"changes"."groupKey"`)}::jsonb[],
            ${getGroupStatesPath(sqlExpression`"changes"."groupKey"`)}::jsonb[],
            ${getGroupKeyPath(sqlExpression`"changes"."groupKey"`)}::jsonb[]
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "BulldozerStorageEngine" AS "stateRows"
            WHERE "stateRows"."keyPathParent" = ${getGroupStatesPath(sqlExpression`"changes"."groupKey"`)}::jsonb[]
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "BulldozerStorageEngine" AS "timeFoldRows"
            WHERE "timeFoldRows"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"changes"."groupKey"`)}::jsonb[]
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(recomputedStatesTableName)} AS "newStates"
            WHERE "newStates"."groupKey" IS NOT DISTINCT FROM "changes"."groupKey"
          )
      `,
      sqlStatement`
        INSERT INTO "BulldozerTimeFoldQueue" (
          "id",
          "tableStoragePath",
          "groupKey",
          "rowIdentifier",
          "scheduledAt",
          "stateAfter",
          "rowData",
          "reducerSql"
        )
        SELECT
          gen_random_uuid(),
          ${tableStoragePath}::jsonb[],
          "states"."groupKey",
          "states"."rowIdentifier",
          "states"."nextTimestamp",
          "states"."stateAfter",
          "states"."rowData",
          ${reducerSqlLiteral}
        FROM ${quoteSqlIdentifier(recomputedStatesTableName)} AS "states"
        WHERE "states"."nextTimestamp" IS NOT NULL
          AND "states"."nextTimestamp" > "states"."lastProcessedAt"
        ON CONFLICT ("tableStoragePath", "groupKey", "rowIdentifier") DO UPDATE
        SET
          "scheduledAt" = EXCLUDED."scheduledAt",
          "stateAfter" = EXCLUDED."stateAfter",
          "rowData" = EXCLUDED."rowData",
          "reducerSql" = EXCLUDED."reducerSql",
          "updatedAt" = now()
      `,
      sqlQuery`
        SELECT
          COALESCE("newRows"."groupKey", "oldRows"."groupKey") AS "groupKey",
          COALESCE("newRows"."rowIdentifier", "oldRows"."rowIdentifier") AS "rowIdentifier",
          'null'::jsonb AS "oldRowSortKey",
          'null'::jsonb AS "newRowSortKey",
          CASE
            WHEN "oldRows"."rowData" IS NULL THEN 'null'::jsonb
            ELSE "oldRows"."rowData"
          END AS "oldRowData",
          CASE
            WHEN "newRows"."rowData" IS NULL THEN 'null'::jsonb
            ELSE "newRows"."rowData"
          END AS "newRowData"
        FROM ${quoteSqlIdentifier(oldTimeFoldRowsTableName)} AS "oldRows"
        FULL OUTER JOIN ${quoteSqlIdentifier(newTimeFoldRowsTableName)} AS "newRows"
          ON "oldRows"."groupKey" IS NOT DISTINCT FROM "newRows"."groupKey"
          AND "oldRows"."rowIdentifier" = "newRows"."rowIdentifier"
        WHERE "oldRows"."rowData" IS DISTINCT FROM "newRows"."rowData"
      `.toStatement(timeFoldChangesTableName, CHANGE_OUTPUT_COLUMNS),
    ];
  };
  const createFromTableTriggerStatements = (fromChangesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => {
    const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
    return [
      {
        ...sqlQuery`
          SELECT
            "changes"."groupKey" AS "groupKey",
            "changes"."rowIdentifier" AS "rowIdentifier",
            "changes"."oldRowData" AS "oldRowData",
            "changes"."newRowData" AS "newRowData",
            ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
            ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow"
          FROM ${fromChangesTable} AS "changes"
          WHERE ${isInitializedExpression}
            AND (
              NOT (
                "changes"."oldRowData" IS NOT NULL
                AND jsonb_typeof("changes"."oldRowData") = 'object'
                AND "changes"."newRowData" IS NOT NULL
                AND jsonb_typeof("changes"."newRowData") = 'object'
              )
              OR "changes"."oldRowData" IS DISTINCT FROM "changes"."newRowData"
            )
        `.toStatement(normalizedChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowData" jsonb, "newRowData" jsonb, "hasOldRow" boolean, "hasNewRow" boolean'),
        requiresSequentialExecution: true,
      },
      ...createApplyChangesStatements(quoteSqlIdentifier(normalizedChangesTableName)),
    ];
  };
  const fromTableTrigger = attachRowChangeTriggerMetadata(
    (fromChangesTable) => createFromTableTriggerStatements(fromChangesTable),
    {
      targetTableId: tableIdToDebugString(options.tableId),
      targetTableTriggers: triggers,
    },
  );
  options.fromTable.registerRowChangeTrigger(fromTableTrigger);

  const table: ReturnType<typeof declareTimeFoldTable<GK, OldRD, NewRD, S>> = {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "timefold",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      initialStateSql: options.initialState.sql,
      reducerSql: options.reducer.sql,
    },
    compareGroupKeys: options.fromTable.compareGroupKeys,
    compareSortKeys: (_a, _b) => sqlExpression`0`,
    init: () => {
      const fromGroupsTableName = `from_groups_${generateSecureRandomString()}`;
      const fromRowsTableName = `from_rows_${generateSecureRandomString()}`;
      const initChangesTableName = `init_changes_${generateSecureRandomString()}`;

      // Compile the downstream trigger cascade into a plpgsql DO block and
      // persist it in BulldozerTimeFoldDownstreamCascade, keyed by this
      // timefold's tableStoragePath. bulldozer_timefold_process_queue()
      // reads and EXECUTEs it after each batch of queue-drained emissions.
      //
      // This mirrors, on the queue-drain path, what collectRowChangeTriggerStatements
      // does on the inline setRow path (see row-change-trigger-dispatch.ts's
      // use by the outer runStatements pipeline). Without this, pg_cron-
      // drained emissions update the timefold's own rows but never propagate
      // to filters/maps/LFolds above — see apps/backend/src/lib/bulldozer/db/
      // timefold-queue-downstream.test.ts.
      const cascadeInputName = `tf_cascade_input_${generateSecureRandomString()}`;
      const cascadeCollected = collectRowChangeTriggerStatements({
        sourceTableId: tableIdToDebugString(options.tableId),
        sourceChangesTable: quoteSqlIdentifier(cascadeInputName),
        sourceTableTriggers: triggers,
      });
      const cascadeTemplate = toCascadeSqlBlock({
        cascadeInputName,
        cascadeInputColumns: CHANGE_OUTPUT_COLUMNS,
        statements: cascadeCollected.statements,
      });

      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
            (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
            (gen_random_uuid(), ${tableStoragePath}, 'null'::jsonb),
            (gen_random_uuid(), ${groupsPath}, 'null'::jsonb),
            (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
          ON CONFLICT ("keyPath") DO NOTHING
        `,
        // Upsert the cascade registry row. A null template means "no
        // downstream triggers registered" — process_queue will skip the
        // EXECUTE in that case, matching the no-op semantics of the inline
        // path when no triggers are attached.
        sqlStatement`
          INSERT INTO "BulldozerTimeFoldDownstreamCascade"
            ("tableStoragePath", "cascadeInputName", "cascadeTemplate")
          VALUES (
            ${tableStoragePath}::jsonb[],
            ${quoteSqlStringLiteral(cascadeInputName)},
            ${cascadeTemplate == null ? sqlExpression`NULL::text` : quoteSqlStringLiteral(cascadeTemplate)}
          )
          ON CONFLICT ("tableStoragePath") DO UPDATE
          SET
            "cascadeInputName" = EXCLUDED."cascadeInputName",
            "cascadeTemplate" = EXCLUDED."cascadeTemplate",
            "updatedAt" = now()
        `,
        options.fromTable.listGroups({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).toStatement(fromGroupsTableName, '"groupkey" jsonb'),
        sqlQuery`
          SELECT
            "groups"."groupkey" AS "groupKey",
            "rows"."rowidentifier" AS "rowIdentifier",
            "rows"."rowdata" AS "newRowData"
          FROM ${quoteSqlIdentifier(fromGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${options.fromTable.listRowsInGroup({
              groupKey: sqlExpression`"groups"."groupkey"`,
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            })}
          ) AS "rows"
        `.toStatement(fromRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "newRowData" jsonb'),
        sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rowIdentifier" AS "rowIdentifier",
            'null'::jsonb AS "oldRowData",
            "rows"."newRowData" AS "newRowData",
            false AS "hasOldRow",
            true AS "hasNewRow"
          FROM ${quoteSqlIdentifier(fromRowsTableName)} AS "rows"
        `.toStatement(initChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowData" jsonb, "newRowData" jsonb, "hasOldRow" boolean, "hasNewRow" boolean'),
        ...createApplyChangesStatements(quoteSqlIdentifier(initChangesTableName)),
      ];
    },
    delete: () => {
      return [
        sqlStatement`
          DELETE FROM "BulldozerTimeFoldQueue"
          WHERE "tableStoragePath" = ${tableStoragePath}::jsonb[]
        `,
        sqlStatement`
          DELETE FROM "BulldozerTimeFoldDownstreamCascade"
          WHERE "tableStoragePath" = ${tableStoragePath}::jsonb[]
        `,
        sqlStatement`
          WITH RECURSIVE "pathsToDelete" AS (
            SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
            UNION ALL
            SELECT "BulldozerStorageEngine"."keyPath" AS "path"
            FROM "BulldozerStorageEngine"
            INNER JOIN "pathsToDelete"
              ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
          )
          DELETE FROM "BulldozerStorageEngine"
          WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
        `,
      ];
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
      ORDER BY "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] ASC
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey != null ? sqlQuery`
      SELECT
        ("keyPath"[cardinality("keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine"
      WHERE "keyPathParent" = ${getGroupRowsPath(groupKey)}::jsonb[]
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
        "extraGroups" AS (
          SELECT 'extra_group' AS errortype,
            "actualGroups"."groupKey" AS groupkey, NULL::text AS rowidentifier,
            NULL::jsonb AS expected, NULL::jsonb AS actual
          FROM "actualGroups"
          LEFT JOIN "inputGroups" ON "inputGroups"."groupKey" IS NOT DISTINCT FROM "actualGroups"."groupKey"
          WHERE "inputGroups"."groupKey" IS NULL
        )
        SELECT * FROM "extraGroups" WHERE ${isInitializedExpression}
      `;
    },
  };
  return table;
}
