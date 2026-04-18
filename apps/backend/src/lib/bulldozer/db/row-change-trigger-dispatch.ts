import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import type { SqlExpression, SqlStatement } from "./utilities";
import { quoteSqlIdentifier, quoteSqlStringLiteral, sqlQuery } from "./utilities";

/**
 * Column shape of every row-change changes-table flowing between tables
 * in the bulldozer graph. One canonical source of truth for both the
 * inline trigger dispatch (here), the queue-drain cascade (whose input
 * is seeded to this same shape in `declareTimeFoldTable.init()`), and
 * any downstream consumer that needs to describe a changes-table's
 * columns for `jsonb_to_record(...)` etc.
 */
export const CHANGE_OUTPUT_COLUMNS = '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb';
const ROW_CHANGE_DIAGNOSTIC_COLUMN_NAME = "__row_change_table_id";
export type ChangesTableExpression = SqlExpression<{ __brand: "$SQL_Table" }>;
export type RowChangeTriggerDiagnostics = {
  tableIdsWithIncomingChanges: string[],
};
export type CollectedRowChangeTriggerStatements = {
  statements: SqlStatement[],
  diagnostics: RowChangeTriggerDiagnostics,
};

export type RowChangeTriggerExecution = {
  statements: SqlStatement[],
  outputChangesTable: null | ChangesTableExpression,
  triggeredTables: RegisteredRowChangeTrigger[],
};
export type RegisteredRowChangeTrigger = {
  targetTableId: null | string,
  listTriggeredTables: () => RegisteredRowChangeTrigger[],
  execute: (
    changesTable: ChangesTableExpression,
    outputChangesTableName: string,
  ) => RowChangeTriggerExecution,
};
export type RowChangeTriggerInput =
  | RegisteredRowChangeTrigger
  | ((changesTable: ChangesTableExpression) => SqlStatement[]);

export function normalizeRowChangeTrigger(triggerInput: RowChangeTriggerInput): RegisteredRowChangeTrigger {
  if (typeof triggerInput === "function") {
    return {
      targetTableId: null,
      listTriggeredTables: () => [],
      execute: (changesTable) => ({
        statements: triggerInput(changesTable),
        outputChangesTable: null,
        triggeredTables: [],
      }),
    };
  }
  return triggerInput;
}

export function createTableRowChangeTrigger(options: {
  targetTableId: string,
  createStatements: (
    changesTable: ChangesTableExpression,
    outputChangesTableName: string,
  ) => SqlStatement[],
  getTriggeredTables: () => RegisteredRowChangeTrigger[],
}): RegisteredRowChangeTrigger {
  return {
    targetTableId: options.targetTableId,
    listTriggeredTables: () => options.getTriggeredTables(),
    execute: (changesTable, outputChangesTableName) => ({
      statements: options.createStatements(changesTable, outputChangesTableName),
      outputChangesTable: quoteSqlIdentifier(outputChangesTableName),
      triggeredTables: options.getTriggeredTables(),
    }),
  };
}

export function attachRowChangeTriggerMetadata(
  trigger: (changesTable: ChangesTableExpression) => SqlStatement[],
  metadata: {
    targetTableId: string,
    targetTableTriggers: ReadonlyMap<string, RowChangeTriggerInput>,
  },
): RegisteredRowChangeTrigger {
  const getTriggeredTables = () => [...metadata.targetTableTriggers.values()].map((rowChangeTrigger) =>
    normalizeRowChangeTrigger(rowChangeTrigger)
  );
  return {
    targetTableId: metadata.targetTableId,
    listTriggeredTables: getTriggeredTables,
    execute: (changesTable) => {
      const statements = trigger(changesTable);
      const outputName = [...statements]
        .reverse()
        .map((statement) => statement.outputName)
        .find((statementOutputName): statementOutputName is string => typeof statementOutputName === "string");
      if (outputName == null) {
        throw new StackAssertionError("Row change trigger did not produce an output changes table.", {
          targetTableId: metadata.targetTableId,
        });
      }
      return {
        statements,
        outputChangesTable: quoteSqlIdentifier(outputName),
        triggeredTables: getTriggeredTables(),
      };
    },
  };
}

function dedupeTriggers(triggers: RegisteredRowChangeTrigger[]): RegisteredRowChangeTrigger[] {
  const seen = new Set<RegisteredRowChangeTrigger>();
  const deduped: RegisteredRowChangeTrigger[] = [];
  for (const trigger of triggers) {
    if (seen.has(trigger)) continue;
    seen.add(trigger);
    deduped.push(trigger);
  }
  return deduped;
}

function createChangesUnionStatement(inputTables: ChangesTableExpression[]): { statement: SqlStatement, table: ChangesTableExpression } {
  const unionChangesTableName = `unioned_changes_${generateSecureRandomString()}`;
  const unionSql = inputTables
    .map((table) => `
      SELECT
        "groupKey"::jsonb AS "groupKey",
        "rowIdentifier"::text AS "rowIdentifier",
        "oldRowSortKey"::jsonb AS "oldRowSortKey",
        "newRowSortKey"::jsonb AS "newRowSortKey",
        "oldRowData"::jsonb AS "oldRowData",
        "newRowData"::jsonb AS "newRowData"
      FROM ${table.sql}
    `)
    .join("\nUNION ALL\n");
  return {
    statement: {
      type: "statement",
      outputName: unionChangesTableName,
      outputColumns: CHANGE_OUTPUT_COLUMNS,
      sql: unionSql,
    },
    table: quoteSqlIdentifier(unionChangesTableName),
  };
}

export function collectRowChangeTriggerStatements(options: {
  sourceTableId: string,
  sourceChangesTable: ChangesTableExpression,
  sourceTableTriggers: Map<string, RegisteredRowChangeTrigger>,
}): CollectedRowChangeTriggerStatements {
  const outgoingByTableId = new Map<string, RegisteredRowChangeTrigger[]>();
  const graphEdges = new Map<string, Set<string>>();
  const discoveredTableIds = new Set<string>([options.sourceTableId]);
  outgoingByTableId.set(options.sourceTableId, dedupeTriggers([...options.sourceTableTriggers.values()]));
  const visited = new Set<string>();
  const stack = [options.sourceTableId];
  while (stack.length > 0) {
    const sourceTableId = stack.pop();
    if (sourceTableId == null || visited.has(sourceTableId)) continue;
    visited.add(sourceTableId);
    const outgoingTriggers = outgoingByTableId.get(sourceTableId) ?? [];
    if (!graphEdges.has(sourceTableId)) {
      graphEdges.set(sourceTableId, new Set<string>());
    }
    for (const trigger of outgoingTriggers) {
      const targetTableId = trigger.targetTableId;
      if (targetTableId == null) continue;
      graphEdges.get(sourceTableId)?.add(targetTableId);
      discoveredTableIds.add(targetTableId);
      const existingOutgoing = outgoingByTableId.get(targetTableId) ?? [];
      const mergedOutgoing = dedupeTriggers([
        ...existingOutgoing,
        ...trigger.listTriggeredTables(),
      ]);
      outgoingByTableId.set(targetTableId, mergedOutgoing);
      stack.push(targetTableId);
    }
  }

  const inDegreeByTableId = new Map<string, number>();
  for (const tableId of discoveredTableIds) {
    inDegreeByTableId.set(tableId, 0);
  }
  for (const [sourceTableId, targetTableIds] of graphEdges) {
    if (!inDegreeByTableId.has(sourceTableId)) continue;
    for (const targetTableId of targetTableIds) {
      if (!inDegreeByTableId.has(targetTableId)) continue;
      inDegreeByTableId.set(
        targetTableId,
        (inDegreeByTableId.get(targetTableId) ?? 0) + 1,
      );
    }
  }

  const tableIdsReady = [...inDegreeByTableId.entries()]
    .filter((entry) => entry[1] === 0)
    .map((entry) => entry[0])
    .sort(stringCompare);
  const topologicalOrder: string[] = [];
  while (tableIdsReady.length > 0) {
    const sourceTableId = tableIdsReady.shift();
    if (sourceTableId == null) continue;
    topologicalOrder.push(sourceTableId);
    for (const targetTableId of graphEdges.get(sourceTableId) ?? []) {
      const currentInDegree = inDegreeByTableId.get(targetTableId);
      if (currentInDegree == null) continue;
      const nextInDegree = currentInDegree - 1;
      inDegreeByTableId.set(targetTableId, nextInDegree);
      if (nextInDegree === 0) {
        tableIdsReady.push(targetTableId);
        tableIdsReady.sort(stringCompare);
      }
    }
  }
  if (topologicalOrder.length < discoveredTableIds.size) {
    const missing = [...discoveredTableIds]
      .filter((tableId) => !topologicalOrder.includes(tableId))
      .sort(stringCompare);
    throw new StackAssertionError("Cycle detected in trigger dependency graph — topological sort could not order all tables", {
      sourceTableId: options.sourceTableId,
      cyclicTableIds: missing,
      orderedTableIds: topologicalOrder,
    });
  }

  const pendingChangesByTableId = new Map<string, ChangesTableExpression[]>();
  pendingChangesByTableId.set(options.sourceTableId, [options.sourceChangesTable]);
  const statements: SqlStatement[] = [];
  const tableIdsWithIncomingChanges: string[] = [];

  for (const sourceTableId of topologicalOrder) {
    const incomingChangesTables = pendingChangesByTableId.get(sourceTableId) ?? [];
    if (incomingChangesTables.length === 0) continue;
    tableIdsWithIncomingChanges.push(sourceTableId);
    const sourceChangesTable = incomingChangesTables.length === 1
      ? incomingChangesTables[0]
      : (() => {
        const unionedSourceChanges = createChangesUnionStatement(incomingChangesTables);
        statements.push(unionedSourceChanges.statement);
        return unionedSourceChanges.table;
      })();
    const sourceTableIdLiteral = quoteSqlStringLiteral(sourceTableId);
    statements.push(sqlQuery`
      SELECT ${sourceTableIdLiteral}::text AS "__row_change_table_id"
      FROM ${sourceChangesTable}
    `.toStatement(
      `row_change_diag_${generateSecureRandomString()}`,
      `"${ROW_CHANGE_DIAGNOSTIC_COLUMN_NAME}" text`,
    ));

    const outgoingTriggers = outgoingByTableId.get(sourceTableId) ?? [];
    for (const trigger of outgoingTriggers) {
      const outputChangesTableName = `trigger_changes_${generateSecureRandomString()}`;
      const execution = trigger.execute(sourceChangesTable, outputChangesTableName);
      statements.push(...execution.statements);
      if (trigger.targetTableId == null) continue;
      if (execution.outputChangesTable == null) {
        throw new StackAssertionError("Row change trigger did not emit output changes table.", {
          sourceTableId,
          targetTableId: trigger.targetTableId,
        });
      }
      const existing = pendingChangesByTableId.get(trigger.targetTableId) ?? [];
      pendingChangesByTableId.set(trigger.targetTableId, [
        ...existing,
        execution.outputChangesTable,
      ]);
    }
  }

  return {
    statements,
    diagnostics: {
      tableIdsWithIncomingChanges,
    },
  };
}
