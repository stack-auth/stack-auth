import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

import { BULLDOZER_SORT_HELPERS_SQL } from "./bulldozer-sort-helpers-sql";
import type { RegisteredRowChangeTrigger, RowChangeTriggerInput } from "./row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlQuery, SqlStatement, TableId } from "./utilities";
import { quoteSqlIdentifier, quoteSqlStringLiteral } from "./utilities";

// ====== Table implementations ======
// IMPORTANT NOTE: For every new table implementation, we should also add tests (unit, fuzzing, & perf; including an entry in the "hundreds of thousands" perf test), an example in the example schema, and support in Bulldozer Studio.

export type Table<GK extends Json, SK extends Json, RD extends RowData> = {
  tableId: TableId,
  inputTables: Table<any, any, any>[],
  debugArgs: Record<string, unknown>,

  // Query groups and rows
  listGroups(options: { start: SqlExpression<GK> | "start", end: SqlExpression<GK> | "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery<Iterable<{ groupKey: GK }>>,
  /**
   * Rows queried across all groups may include `groupKey`; rows queried for a specific `groupKey`
   * may omit it.
   */
  listRowsInGroup(options: { groupKey?: SqlExpression<GK>, start: SqlExpression<SK> | "start", end: SqlExpression<SK> | "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery<Iterable<{ groupKey?: GK, rowIdentifier: RowIdentifier, rowSortKey: SK, rowData: RD }>>,

  // Sorting and grouping
  compareGroupKeys(a: SqlExpression<GK>, b: SqlExpression<GK>): SqlExpression<number>,
  compareSortKeys(a: SqlExpression<SK>, b: SqlExpression<SK>): SqlExpression<number>,

  // Lifecycle/migration methods
  /** Called when the table should be created on the storage engine. */
  init(): SqlStatement[],
  /** Called when the table should be deleted from the storage engine. */
  delete(): SqlStatement[],
  isInitialized(): SqlExpression<boolean>,

  // Internal methods, used only by table constructors to create relationships between them
  /**
   * @param trigger A SQL statement that can reference the changes table with columns `groupKey: GK`, `rowIdentifier: RowIdentifier`, `oldRowSortKey: SK | null`, `newRowSortKey: SK | null`, `oldRowData: RowData | null`, `newRowData: RowData | null`. Note that this trigger should be a no-op if the table that created this trigger is not initialized.
   */
  registerRowChangeTrigger(trigger: RowChangeTriggerInput): { deregister: () => void },

  /** Returns a query producing error rows if materialized data differs from re-derivation from inputs. Empty result = healthy. */
  verifyDataIntegrity(): SqlQuery<Iterable<{ errorType: string, groupKey: GK | null, rowIdentifier: RowIdentifier | null, expected: Json | null, actual: Json | null }>>,
};

export type { RegisteredRowChangeTrigger };

export { declareCompactTable } from "./tables/compact-table";
export { declareConcatTable } from "./tables/concat-table";
export { declareFilterTable } from "./tables/filter-table";
export { declareFlatMapTable } from "./tables/flat-map-table";
export { declareGroupByTable } from "./tables/group-by-table";
export { declareLFoldTable } from "./tables/l-fold-table";
export { declareLeftJoinTable } from "./tables/left-join-table";
export { declareLimitTable } from "./tables/limit-table";
export { declareMapTable } from "./tables/map-table";
export { declareReduceTable } from "./tables/reduce-table";
export { declareSortTable } from "./tables/sort-table";
export { declareStoredTable } from "./tables/stored-table";
export { declareTimeFoldTable } from "./tables/time-fold-table";

const BULLDOZER_LOCK_ID = 7857391;  // random number to avoid conflicts with other applications
const BULLDOZER_SEQ_TABLE_NAME = "__bulldozer_seq";
const BULLDOZER_SEQ_TABLE_SQL = `CREATE TEMP TABLE IF NOT EXISTS "${BULLDOZER_SEQ_TABLE_NAME}" ("__output_name" text NOT NULL, "__output_row" jsonb NOT NULL) ON COMMIT DROP;`;

export function toQueryableSqlQuery(query: SqlQuery): string {
  return query.sql;
}

export function toExecutableSqlTransaction(statements: SqlStatement[], options: { statementTimeout?: string } = {}): string {
  const requiresSortHelpers = statements.some((statement) => statement.sql.includes("pg_temp.bulldozer_sort_"));
  const seqOutputs = new Map<string, string>();
  const executableStatementsInDoBlock = statements.map((statement) => {
    let sql = statement.sql;
    for (const [outputName, outputColumns] of seqOutputs) {
      const quotedOutputName = `"${outputName}"`;
      if (!sql.includes(quotedOutputName)) continue;
      const outputColumnsSelectList = outputColumns.split(",").map((columnDefinition) => {
        const trimmedColumnDefinition = columnDefinition.trim();
        const parts = trimmedColumnDefinition.split(/\s+/);
        const columnName = parts[0];
        const columnType = parts.slice(1).join(" ");
        if (columnType === "jsonb") {
          return `COALESCE(r.${columnName}, 'null'::jsonb) AS ${columnName}`;
        }
        return `r.${columnName}`;
      }).join(", ");
      const outputNameLiteral = quoteSqlStringLiteral(outputName).sql;
      const outputLookupSubquery = `(SELECT ${outputColumnsSelectList} FROM "${BULLDOZER_SEQ_TABLE_NAME}" AS "__s", LATERAL jsonb_to_record("__s"."__output_row") AS r(${outputColumns}) WHERE "__s"."__output_name" = ${outputNameLiteral})`;
      sql = sql.replaceAll(`${quotedOutputName} AS `, `${outputLookupSubquery} AS `);
      sql = sql.replaceAll(quotedOutputName, `${outputLookupSubquery} AS ${quotedOutputName}`);
    }

    const executableSql = statement.outputName == null
      ? sql
      : statement.outputColumns == null
        ? deindent`
            CREATE TEMP TABLE ${quoteSqlIdentifier(statement.outputName).sql} ON COMMIT DROP AS
            WITH "__statement_output" AS (
              ${sql}
            )
            SELECT * FROM "__statement_output"
          `
        : (() => {
            seqOutputs.set(statement.outputName, statement.outputColumns);
            const outputNameLiteral = quoteSqlStringLiteral(statement.outputName).sql;
            return deindent`
              INSERT INTO "${BULLDOZER_SEQ_TABLE_NAME}" ("__output_name", "__output_row")
              SELECT ${outputNameLiteral}, to_jsonb("__statement_output")
              FROM (
                ${sql}
              ) AS "__statement_output"
            `;
        })();

    // Keep the outer DO block delimiter stable even when statements define $$ functions.
    const normalizedSql = executableSql.replaceAll("$$", "$__bulldozer_do_inline$").trimEnd();
    return normalizedSql.endsWith(";")
      ? normalizedSql
      : `${normalizedSql};`;
  }).join("\n\n");

  return deindent`
    BEGIN;

    SET LOCAL jit = off;
    ${options.statementTimeout ? `SET LOCAL statement_timeout = ${quoteSqlStringLiteral(options.statementTimeout).sql};` : ""}

    SELECT pg_advisory_xact_lock(${BULLDOZER_LOCK_ID});

    ${requiresSortHelpers ? BULLDOZER_SORT_HELPERS_SQL : ""}

    ${BULLDOZER_SEQ_TABLE_SQL}

    DO $$
    BEGIN
      ${executableStatementsInDoBlock}
    END;
    $$ LANGUAGE plpgsql;

    COMMIT;
  `;
}
