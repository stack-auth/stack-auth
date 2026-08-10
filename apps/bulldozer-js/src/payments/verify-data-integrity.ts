import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { deserializeDatabaseSeq, serializeDatabaseSeq } from "../databases/index.js";
import type {
  BulldozerDatabase,
  BulldozerDatabaseSnapshotSerialized,
  BulldozerTableImplementation,
  BulldozerTableImplementationInputTable,
  BulldozerTableVerificationResult,
} from "../databases/bulldozer/index.js";
import { canonicalGroupKeyString } from "../databases/bulldozer/index.js";
import { collectSerializedHeapReferences, isPiledriverHeapObjectSymbol, type PiledriverObject } from "../databases/piledriver/index.js";

const CURSOR_VERSION = 2;
const DEFAULT_STEP_COUNT = 100;
const MAX_STEP_COUNT = 1_000;
const MAX_ERRORS = 100;
const MAX_TRACKED_ROW_IDENTIFIERS = 256;
const HEAP_PAGE_SIZE = 100;
const textDecoder = new TextDecoder();

export type VerificationIssue = {
  phase: string,
  code: string,
  message: string,
  context?: Record<string, string | number | boolean | null>,
};

type VerificationPhase = "root" | "tables" | "heap-scan" | "done";
export type TablePosition = {
  tableId: string | null,
  groupKeyBase64: string | null,
  rowSortKeyBase64: string | null,
  rowIdentifiers: string[],
  rowIdentifierCheckSkipped: boolean,
  groupComplete: boolean,
  genericDone: boolean,
  hookPosition: string | null,
};
type VerificationCursor = {
  version: number,
  root: { bufferBase64: string, seq: string },
  phase: VerificationPhase,
  tablePosition: TablePosition,
  afterHeapKeyBase64: string | null,
  stepsTaken: number,
  errorCount: number,
  rootChecked: boolean,
};

export type VerifyDataIntegrityRequest = { continue?: string, step_count?: number };
export type VerifyDataIntegrityResponse = {
  success: boolean,
  done: boolean,
  next_cursor: string | null,
  steps_taken: number,
  errors: VerificationIssue[],
  errors_truncated: boolean,
  skipped_checks: VerificationIssue[],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && !(isPiledriverHeapObjectSymbol in value);
}

function isPiledriverValue(value: unknown): value is PiledriverObject {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value === "object" && isPiledriverHeapObjectSymbol in value) return true;
  if (Array.isArray(value)) return value.every(isPiledriverValue);
  if (isRecord(value)) return Object.values(value).every(isPiledriverValue);
  return false;
}

function parsePiledriverValue(buffer: ArrayBuffer): PiledriverObject {
  const value: unknown = JSON.parse(textDecoder.decode(buffer));
  if (!isPiledriverValue(value)) throw new Error("Invalid Piledriver value");
  return value;
}

function encodeCursor(cursor: VerificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function isVerificationPhase(value: unknown): value is VerificationPhase {
  return value === "root" || value === "tables" || value === "heap-scan" || value === "done";
}

function isTablePosition(value: unknown): value is TablePosition {
  return isRecord(value)
    && (value.tableId === null || typeof value.tableId === "string")
    && (value.groupKeyBase64 === null || typeof value.groupKeyBase64 === "string")
    && (value.rowSortKeyBase64 === null || typeof value.rowSortKeyBase64 === "string")
    && Array.isArray(value.rowIdentifiers)
    && value.rowIdentifiers.every(item => typeof item === "string")
    && typeof value.rowIdentifierCheckSkipped === "boolean"
    && typeof value.groupComplete === "boolean"
    && typeof value.genericDone === "boolean"
    && (value.hookPosition === null || typeof value.hookPosition === "string");
}

export function decodeVerificationCursor(value: string): VerificationCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid verification cursor");
  }
  if (!isRecord(parsed) || parsed.version !== CURSOR_VERSION) {
    throw new Error(`Invalid verification cursor version; expected ${CURSOR_VERSION}`);
  }
  if (
    !isRecord(parsed.root)
    || typeof parsed.root.bufferBase64 !== "string"
    || typeof parsed.root.seq !== "string"
    || !isVerificationPhase(parsed.phase)
    || !isTablePosition(parsed.tablePosition)
    || (parsed.afterHeapKeyBase64 !== null && typeof parsed.afterHeapKeyBase64 !== "string")
    || typeof parsed.stepsTaken !== "number"
    || !Number.isSafeInteger(parsed.stepsTaken)
    || parsed.stepsTaken < 0
    || typeof parsed.errorCount !== "number"
    || !Number.isSafeInteger(parsed.errorCount)
    || parsed.errorCount < 0
    || typeof parsed.rootChecked !== "boolean"
  ) throw new Error("Invalid verification cursor state");
  deserializeDatabaseSeq(parsed.root.seq);
  return {
    version: CURSOR_VERSION,
    root: { bufferBase64: parsed.root.bufferBase64, seq: parsed.root.seq },
    phase: parsed.phase,
    tablePosition: parsed.tablePosition,
    afterHeapKeyBase64: parsed.afterHeapKeyBase64,
    stepsTaken: parsed.stepsTaken,
    errorCount: parsed.errorCount,
    rootChecked: parsed.rootChecked,
  };
}

function keyBytes(value: string): ArrayBuffer {
  return decodeBase64(value).buffer;
}

function keyBase64(value: ArrayBuffer): string {
  return encodeBase64(new Uint8Array(value));
}

function encodePosition(value: PiledriverObject): string {
  return encodeBase64(new TextEncoder().encode(JSON.stringify(value)));
}

function decodePosition(value: string | null): PiledriverObject | null {
  return value === null ? null : parsePiledriverValue(keyBytes(value));
}

function addIssue(issues: VerificationIssue[], value: VerificationIssue): void {
  if (issues.length < MAX_ERRORS) issues.push(value);
}

function snapshotValue(rootObject: PiledriverObject): unknown {
  return isRecord(rootObject) ? Reflect.get(rootObject, "snapshot") : undefined;
}

function isHeapObjectValue(value: unknown): value is { get(): Promise<PiledriverObject> } {
  return typeof value === "object"
    && value !== null
    && isPiledriverHeapObjectSymbol in value
    && "get" in value
    && typeof Reflect.get(value, "get") === "function";
}

async function resolveRootSnapshot(rootObject: PiledriverObject): Promise<PiledriverObject> {
  const snapshot = snapshotValue(rootObject);
  if (isHeapObjectValue(snapshot)) return await snapshot.get();
  if (isPiledriverValue(snapshot)) return snapshot;
  throw new Error("Invalid Bulldozer root snapshot");
}

function validateRoot(
  rootObject: PiledriverObject,
  tableDescriptors: Array<{ tableId: string, inputTableIds: Record<string, string> }>,
  migrationIndex: number,
): VerificationIssue[] {
  const root = snapshotValue(rootObject);
  if (!isRecord(root)) return [{ phase: "root", code: "invalid_root_shape", message: "The pinned root is not a Bulldozer root object" }];
  if (!isRecord(root.serializedTables)) return [{ phase: "root", code: "invalid_snapshot_shape", message: "The pinned snapshot has no serializedTables object" }];
  const issues: VerificationIssue[] = [];
  if (root.mostRecentlyCompletedMigrationIndex !== migrationIndex) {
    issues.push({
      phase: "root",
      code: "migration_mismatch",
      message: "The pinned snapshot migration index does not match the running schema",
      context: { expected: migrationIndex, actual: typeof root.mostRecentlyCompletedMigrationIndex === "number" ? root.mostRecentlyCompletedMigrationIndex : null },
    });
  }
  const tableIds = new Set(tableDescriptors.map(table => table.tableId));
  if (JSON.stringify(Object.keys(root.serializedTables).sort()) !== JSON.stringify([...tableIds].sort())) {
    issues.push({ phase: "root", code: "table_set_mismatch", message: "The pinned snapshot table set does not match the running schema" });
  }
  for (const table of tableDescriptors) {
    for (const inputTableId of Object.values(table.inputTableIds)) {
      if (!tableIds.has(inputTableId)) {
        issues.push({
          phase: "root",
          code: "missing_input_table",
          message: "A declared input table does not exist",
          context: { tableId: table.tableId, inputTableId },
        });
      }
    }
  }
  return issues;
}

function snapshotFromRoot(rootObject: PiledriverObject): BulldozerDatabaseSnapshotSerialized | null {
  const root = snapshotValue(rootObject);
  if (!isRecord(root) || !isRecord(root.serializedTables)) return null;
  if (
    typeof root.mostRecentlyCompletedMigrationIndex !== "number"
    || !Number.isInteger(root.mostRecentlyCompletedMigrationIndex)
    || typeof root.uniqueSnapshotIdentifier !== "string"
  ) return null;
  const serializedTables: Record<string, PiledriverObject> = {};
  for (const [tableId, value] of Object.entries(root.serializedTables)) {
    if (!isPiledriverValue(value)) return null;
    serializedTables[tableId] = value;
  }
  return {
    serializedTables,
    mostRecentlyCompletedMigrationIndex: root.mostRecentlyCompletedMigrationIndex,
    uniqueSnapshotIdentifier: root.uniqueSnapshotIdentifier,
  };
}

function nextTablePosition(tableId: string | null): TablePosition {
  return {
    tableId,
    groupKeyBase64: null,
    rowSortKeyBase64: null,
    rowIdentifiers: [],
    rowIdentifierCheckSkipped: false,
    groupComplete: false,
    genericDone: false,
    hookPosition: null,
  };
}

function isHeapObject(value: PiledriverObject): boolean {
  return typeof value === "object" && value !== null && isPiledriverHeapObjectSymbol in value;
}

export async function verifyGenericTable(
  target: {
    tableId: string,
    table: Pick<BulldozerTableImplementation, "listGroups" | "listRowsInGroup" | "compareGroupKeys" | "compareSortKeys">,
    serializedTable: PiledriverObject,
    inputTables: Record<string, BulldozerTableImplementationInputTable>,
  },
  position: TablePosition,
  budget: number,
): Promise<{ issues: VerificationIssue[], skippedChecks: VerificationIssue[], position: TablePosition, stepsTaken: number, finished: boolean }> {
  const issues: VerificationIssue[] = [];
  const skippedChecks: VerificationIssue[] = [];
  let stepsTaken = 0;
  let groupKey = decodePosition(position.groupKeyBase64);
  let previousSortKey = decodePosition(position.rowSortKeyBase64);
  let seenRowIdentifiers = new Set(position.rowIdentifiers);
  let rowIdentifierCheckSkipped = position.rowIdentifierCheckSkipped;
  let groupComplete = position.groupComplete;
  let lastCompletedGroup = position.groupComplete ? decodePosition(position.groupKeyBase64) : null;
  let cursorGroupKeyBase64 = position.groupKeyBase64;
  let cursorGroupComplete = position.groupComplete;
  while (true) {
    const beforeSteps = stepsTaken;
    const beforePosition = JSON.stringify({
      groupKeyBase64: groupKey === null ? null : encodePosition(groupKey),
      groupComplete,
      genericDone: false,
    });
    if (groupComplete) {
      lastCompletedGroup = groupKey;
      groupKey = null;
      previousSortKey = null;
      seenRowIdentifiers = new Set();
      rowIdentifierCheckSkipped = false;
      groupComplete = false;
    }
    let group: { groupKey: PiledriverObject } | undefined;
    const range = groupKey === null
      ? (lastCompletedGroup === null ? {} : { gt: lastCompletedGroup })
      : { gte: groupKey };
    for await (const candidate of target.table.listGroups({
      serializedTable: target.serializedTable,
      inputTables: target.inputTables,
      range,
    })) {
      if (lastCompletedGroup !== null && target.table.compareGroupKeys({
        serializedTable: target.serializedTable,
        inputTables: target.inputTables,
        a: candidate.groupKey,
        b: lastCompletedGroup,
      }) <= 0) {
        issues.push({ phase: "tables", code: "group_order", message: "Groups are not strictly ordered", context: { tableId: target.tableId } });
        return {
          issues,
          skippedChecks,
          position: { ...nextTablePosition(null), tableId: target.tableId, genericDone: true },
          stepsTaken,
          finished: true,
        };
      }
      if (groupKey === null || target.table.compareGroupKeys({
        serializedTable: target.serializedTable,
        inputTables: target.inputTables,
        a: candidate.groupKey,
        b: groupKey,
      }) === 0) {
        group = candidate;
        break;
      }
    }
    if (group === undefined) return {
      issues,
      skippedChecks,
      position: { ...nextTablePosition(null), genericDone: true },
      stepsTaken,
      finished: true,
    };
    const groupKeyBase64 = encodePosition(group.groupKey);
    groupKey = group.groupKey;
    const newGroup = cursorGroupKeyBase64 !== groupKeyBase64 || cursorGroupComplete;
    cursorGroupKeyBase64 = groupKeyBase64;
    cursorGroupComplete = false;
    if (newGroup) {
      if (stepsTaken >= budget) return {
        issues,
        skippedChecks,
        position: { ...position, tableId: target.tableId, groupKeyBase64, rowSortKeyBase64: null, rowIdentifiers: [], rowIdentifierCheckSkipped: false, groupComplete: false },
        stepsTaken,
        finished: false,
      };
      stepsTaken++;
      try {
        canonicalGroupKeyString(group.groupKey);
      } catch (error) {
        if (error instanceof Error) {
          issues.push({ phase: "tables", code: isHeapObject(group.groupKey) ? "heap_group_key" : "invalid_group_key", message: "A group key is not a canonical structural value", context: { tableId: target.tableId } });
        } else {
          throw error;
        }
      }
      previousSortKey = null;
      seenRowIdentifiers = new Set();
      rowIdentifierCheckSkipped = false;
    }
    for await (const row of target.table.listRowsInGroup({
      serializedTable: target.serializedTable,
      inputTables: target.inputTables,
      groupKey: group.groupKey,
      range: previousSortKey === null ? {} : { gt: previousSortKey },
    })) {
      if (stepsTaken >= budget) return {
        issues,
        skippedChecks,
        position: { ...position, tableId: target.tableId, groupKeyBase64, rowSortKeyBase64: previousSortKey === null ? null : encodePosition(previousSortKey), rowIdentifiers: [...seenRowIdentifiers], rowIdentifierCheckSkipped, groupComplete: false },
        stepsTaken,
        finished: false,
      };
      stepsTaken++;
      if (target.table.compareGroupKeys({
        serializedTable: target.serializedTable,
        inputTables: target.inputTables,
        a: row.groupKey,
        b: group.groupKey,
      }) !== 0) issues.push({ phase: "tables", code: "row_group_mismatch", message: "A row group key differs from its enclosing group", context: { tableId: target.tableId } });
      if (previousSortKey !== null && target.table.compareSortKeys({
        serializedTable: target.serializedTable,
        inputTables: target.inputTables,
        groupKey: group.groupKey,
        a: previousSortKey,
        b: row.rowSortKey,
      }) >= 0) issues.push({ phase: "tables", code: "row_order", message: "Rows are not strictly ordered by sort key", context: { tableId: target.tableId } });
      if (!rowIdentifierCheckSkipped) {
        if (seenRowIdentifiers.has(row.rowIdentifier)) issues.push({ phase: "tables", code: "duplicate_row_identifier", message: "A row identifier appears more than once in a group", context: { tableId: target.tableId, rowIdentifier: row.rowIdentifier } });
        if (seenRowIdentifiers.size >= MAX_TRACKED_ROW_IDENTIFIERS) {
          rowIdentifierCheckSkipped = true;
          skippedChecks.push({
            phase: "tables",
            code: "duplicate_row_identifier_check_skipped",
            message: "Duplicate row identifier checking was skipped after the bounded identifier set filled",
            context: { tableId: target.tableId, maxTrackedIdentifiers: MAX_TRACKED_ROW_IDENTIFIERS },
          });
        } else {
          seenRowIdentifiers.add(row.rowIdentifier);
        }
      }
      previousSortKey = row.rowSortKey;
    }
    groupComplete = true;
    if (stepsTaken >= budget) return {
      issues,
      skippedChecks,
      position: { ...position, tableId: target.tableId, groupKeyBase64, rowSortKeyBase64: null, rowIdentifiers: [], rowIdentifierCheckSkipped: false, groupComplete: true },
      stepsTaken,
      finished: false,
    };
    const afterPosition = JSON.stringify({
      groupKeyBase64: encodePosition(groupKey),
      groupComplete,
      genericDone: false,
    });
    if (stepsTaken === beforeSteps && afterPosition === beforePosition) {
      throw new Error(`Generic table verifier made no progress for table ${target.tableId} at ${afterPosition}`);
    }
  }
}

export async function verifyDataIntegrity(
  bulldozerDb: BulldozerDatabase,
  request: VerifyDataIntegrityRequest,
): Promise<VerifyDataIntegrityResponse> {
  const requestedStepCount = request.step_count ?? DEFAULT_STEP_COUNT;
  if (!Number.isInteger(requestedStepCount) || requestedStepCount <= 0) throw new Error("step_count must be a positive integer");
  const budget = Math.min(requestedStepCount, MAX_STEP_COUNT);
  const errors: VerificationIssue[] = [];
  const skippedChecks: VerificationIssue[] = [];
  const tables = bulldozerDb.listTables();
  const integrityState = bulldozerDb.getDataIntegrityState();
  let cursor: VerificationCursor;
  let rootObject: PiledriverObject;
  if (request.continue === undefined) {
    const root = await integrityState.getRoot();
    cursor = {
      version: CURSOR_VERSION,
      root: { bufferBase64: encodeBase64(new Uint8Array(root.buffer)), seq: serializeDatabaseSeq(root.seq) },
      phase: "root",
      tablePosition: nextTablePosition(null),
      afterHeapKeyBase64: null,
      stepsTaken: 0,
      errorCount: 0,
      rootChecked: false,
    };
    rootObject = (await integrityState.piledriverDatabase.deserializeSerializedObject(root.buffer, root.seq)).object;
  } else {
    cursor = decodeVerificationCursor(request.continue);
    const rootBuffer = keyBytes(cursor.root.bufferBase64);
    const rootSeq = deserializeDatabaseSeq(cursor.root.seq);
    rootObject = (await integrityState.piledriverDatabase.deserializeSerializedObject(rootBuffer, rootSeq)).object;
  }
  let resolvedRootObject: PiledriverObject;
  try {
    resolvedRootObject = { snapshot: await resolveRootSnapshot(rootObject) };
  } catch (error) {
    if (error instanceof Error) {
      addIssue(errors, { phase: "root", code: "invalid_root_shape", message: "The pinned root is not a valid Bulldozer snapshot" });
    } else {
      throw error;
    }
    resolvedRootObject = rootObject;
  }
  const snapshot = snapshotFromRoot(resolvedRootObject);
  if (snapshot === null) {
    addIssue(errors, { phase: "root", code: "invalid_root_shape", message: "The pinned root is not a valid Bulldozer snapshot" });
  } else {
    const context = integrityState.getContext(snapshot);
    if (!cursor.rootChecked) {
      for (const error of validateRoot(resolvedRootObject, tables, context.migrationIndex)) addIssue(errors, error);
      cursor.rootChecked = true;
    }
    let remaining = budget;
    while (remaining > 0 && cursor.phase !== "done") {
      const beforeRemaining = remaining;
      const beforePosition = JSON.stringify({
        phase: cursor.phase,
        tablePosition: cursor.tablePosition,
        afterHeapKeyBase64: cursor.afterHeapKeyBase64,
      });
      const assertProgress = () => {
        const afterPosition = JSON.stringify({
          phase: cursor.phase,
          tablePosition: cursor.tablePosition,
          afterHeapKeyBase64: cursor.afterHeapKeyBase64,
        });
        if (remaining === beforeRemaining && afterPosition === beforePosition) {
          throw new Error(`Integrity verifier made no progress in phase ${cursor.phase} at ${afterPosition}`);
        }
      };
      if (cursor.phase === "root") {
        const rootRefs = collectSerializedHeapReferences(parsePiledriverValue(keyBytes(cursor.root.bufferBase64)));
        for (const ref of rootRefs) {
          const result = await integrityState.piledriverDatabase.getSerializedHeapObject(keyBytes(ref));
          if (result.buffer === null) addIssue(errors, { phase: "root", code: "dangling_heap_reference", message: "A pinned root heap reference is missing", context: { referencedKey: ref } });
        }
        cursor.phase = "tables";
        cursor.tablePosition = nextTablePosition(context.tables[0]?.tableId ?? null);
        assertProgress();
        continue;
      }
      if (cursor.phase === "tables") {
        const target = context.tables.find(table => table.tableId === cursor.tablePosition.tableId);
        if (target === undefined) {
          cursor.phase = "heap-scan";
          continue;
        }
        let result: {
          issues: VerificationIssue[],
          skippedChecks: VerificationIssue[],
          stepsTaken: number,
          finished: boolean,
          position: TablePosition,
        };
        if (!cursor.tablePosition.genericDone) {
          result = await verifyGenericTable(target, cursor.tablePosition, remaining);
        } else if (target.table.verifyDataIntegrity !== undefined) {
          let hookResult: BulldozerTableVerificationResult;
          try {
            hookResult = await target.table.verifyDataIntegrity({
              serializedTable: target.serializedTable,
              inputTables: target.inputTables,
              stepCount: remaining,
              position: cursor.tablePosition.hookPosition,
            });
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            hookResult = {
              issues: [{ code: "invalid_table_structure", message: "A table-specific integrity checker could not read the persisted structure" }],
              stepsTaken: Math.min(remaining, 1),
              nextPosition: null,
            };
          }
          result = {
            issues: hookResult.issues.map(issue => ({ phase: "tables", ...issue })),
            skippedChecks: [],
            stepsTaken: hookResult.stepsTaken,
            finished: hookResult.nextPosition === null,
            position: { ...cursor.tablePosition, hookPosition: hookResult.nextPosition },
          };
        } else {
          result = {
            issues: [],
            skippedChecks: [],
            stepsTaken: 0,
            finished: true,
            position: cursor.tablePosition,
          };
        }
        for (const error of result.issues) addIssue(errors, error);
        skippedChecks.push(...result.skippedChecks);
        remaining -= result.stepsTaken;
        if (result.finished) {
          const index = context.tables.findIndex(table => table.tableId === cursor.tablePosition.tableId);
          cursor.tablePosition = nextTablePosition(context.tables[index + 1]?.tableId ?? null);
          if (cursor.tablePosition.tableId === null) cursor.phase = "heap-scan";
        } else cursor.tablePosition = result.position;
        assertProgress();
        continue;
      }
      const page = await integrityState.piledriverDatabase.iterateHeapEntries({
        afterKey: cursor.afterHeapKeyBase64 === null ? undefined : keyBytes(cursor.afterHeapKeyBase64),
        limit: Math.min(HEAP_PAGE_SIZE, remaining),
      });
      if (page.entries.length === 0) {
        cursor.phase = "done";
        break;
      }
      for (const entry of page.entries) {
        const entryKey = keyBase64(entry.key);
        cursor.afterHeapKeyBase64 = entryKey;
        remaining--;
        try {
          await integrityState.piledriverDatabase.deserializeSerializedObject(entry.value);
          for (const ref of collectSerializedHeapReferences(parsePiledriverValue(entry.value))) {
            const referenced = await integrityState.piledriverDatabase.getSerializedHeapObject(keyBytes(ref));
            if (referenced.buffer === null) addIssue(errors, { phase: "heap-scan", code: "dangling_heap_reference", message: "A heap reference points to a missing heap entry", context: { key: entryKey, referencedKey: ref } });
          }
        } catch (error) {
          // Piledriver's deserializer rejects malformed persisted tags; that is a finding, not a service crash.
          if (error instanceof Error) addIssue(errors, { phase: "heap-scan", code: "invalid_heap_entry", message: "A heap entry could not be deserialized", context: { key: entryKey } });
          else throw error;
        }
        if (remaining === 0) break;
      }
      assertProgress();
    }
    cursor.stepsTaken += budget - remaining;
    cursor.errorCount += errors.length;
    return {
      success: errors.length === 0,
      done: cursor.phase === "done",
      next_cursor: cursor.phase === "done" ? null : encodeCursor(cursor),
      steps_taken: budget - remaining,
      errors,
      errors_truncated: errors.length >= MAX_ERRORS,
      skipped_checks: skippedChecks,
    };
  }
  cursor.phase = "done";
  return {
    success: false,
    done: true,
    next_cursor: null,
    steps_taken: 0,
    errors,
    errors_truncated: errors.length >= MAX_ERRORS,
    skipped_checks: skippedChecks,
  };
}
