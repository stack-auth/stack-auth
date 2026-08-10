import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { deserializeDatabaseSeq, serializeDatabaseSeq } from "../databases/index.js";
import type {
  BulldozerDatabase,
  BulldozerDatabaseSnapshotSerialized,
  BulldozerTableImplementation,
  BulldozerTableImplementationInputTable,
} from "../databases/bulldozer/index.js";
import { canonicalGroupKeyString } from "../databases/bulldozer/index.js";
import { isPiledriverHeapObjectSymbol, type PiledriverObject } from "../databases/piledriver/index.js";

const CURSOR_VERSION = 2;
const DEFAULT_STEP_COUNT = 100;
const MAX_STEP_COUNT = 1_000;
const MAX_ERRORS = 100;
const HEAP_PAGE_SIZE = 100;
const textDecoder = new TextDecoder();

export type VerificationIssue = {
  phase: string,
  code: string,
  message: string,
  context?: Record<string, string | number | boolean | null>,
};

type VerificationPhase = "root" | "tables" | "heap-scan" | "done";
type TablePosition = {
  tableId: string | null,
  groupKeyBase64: string | null,
  rowSortKeyBase64: string | null,
  rowIdentifiers: string[],
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
    && value.rowIdentifiers.every(item => typeof item === "string");
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

function heapReferences(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    if (value.length === 2 && value[0] === "heap-reference" && typeof value[1] === "string") refs.push(value[1]);
    else for (const item of value) heapReferences(item, refs);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) heapReferences(item, refs);
  }
  return refs;
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
  return { tableId, groupKeyBase64: null, rowSortKeyBase64: null, rowIdentifiers: [] };
}

function isHeapObject(value: PiledriverObject): boolean {
  return typeof value === "object" && value !== null && isPiledriverHeapObjectSymbol in value;
}

async function verifyGenericTable(
  target: {
    tableId: string,
    table: BulldozerTableImplementation,
    serializedTable: PiledriverObject,
    inputTables: Record<string, BulldozerTableImplementationInputTable>,
  },
  position: TablePosition,
  budget: number,
): Promise<{ issues: VerificationIssue[], position: TablePosition, stepsTaken: number, finished: boolean }> {
  const issues: VerificationIssue[] = [];
  let stepsTaken = 0;
  const previousGroup = decodePosition(position.groupKeyBase64);
  let group: { groupKey: PiledriverObject } | undefined;
  for await (const candidate of target.table.listGroups({
    serializedTable: target.serializedTable,
    inputTables: target.inputTables,
    range: previousGroup === null ? {} : { gt: previousGroup },
  })) {
    group = candidate;
    break;
  }
  if (group === undefined) return { issues, position: nextTablePosition(null), stepsTaken, finished: true };
  stepsTaken++;
  if (previousGroup !== null && target.table.compareGroupKeys({
    serializedTable: target.serializedTable,
    inputTables: target.inputTables,
    a: previousGroup,
    b: group.groupKey,
  }) >= 0) issues.push({ phase: "tables", code: "group_order", message: "Groups are not strictly increasing", context: { tableId: target.tableId } });
  try {
    canonicalGroupKeyString(group.groupKey);
  } catch (error) {
    if (error instanceof Error) {
      issues.push({ phase: "tables", code: isHeapObject(group.groupKey) ? "heap_group_key" : "invalid_group_key", message: "A group key is not a canonical structural value", context: { tableId: target.tableId } });
    } else {
      throw error;
    }
  }
  const groupKeyBase64 = encodePosition(group.groupKey);
  const sameGroup = position.groupKeyBase64 === groupKeyBase64;
  let previousSortKey = sameGroup ? decodePosition(position.rowSortKeyBase64) : null;
  const seenRowIdentifiers = new Set(sameGroup ? position.rowIdentifiers : []);
  if (stepsTaken < budget) {
    for await (const row of target.table.listRowsInGroup({
      serializedTable: target.serializedTable,
      inputTables: target.inputTables,
      groupKey: group.groupKey,
      range: previousSortKey === null ? {} : { gt: previousSortKey },
    })) {
      if (stepsTaken >= budget) break;
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
      if (seenRowIdentifiers.has(row.rowIdentifier)) issues.push({ phase: "tables", code: "duplicate_row_identifier", message: "A row identifier appears more than once in a group", context: { tableId: target.tableId, rowIdentifier: row.rowIdentifier } });
      seenRowIdentifiers.add(row.rowIdentifier);
      previousSortKey = row.rowSortKey;
    }
  }
  const finishedGroup = stepsTaken < budget;
  return {
    issues,
    stepsTaken,
    position: finishedGroup
      ? { tableId: target.tableId, groupKeyBase64, rowSortKeyBase64: null, rowIdentifiers: [] }
      : { tableId: target.tableId, groupKeyBase64, rowSortKeyBase64: previousSortKey === null ? null : encodePosition(previousSortKey), rowIdentifiers: [...seenRowIdentifiers] },
    finished: false,
  };
}

export async function verifyDataIntegrity(
  bulldozerDb: BulldozerDatabase,
  request: VerifyDataIntegrityRequest,
): Promise<VerifyDataIntegrityResponse> {
  const requestedStepCount = request.step_count ?? DEFAULT_STEP_COUNT;
  if (!Number.isInteger(requestedStepCount) || requestedStepCount <= 0) throw new Error("step_count must be a positive integer");
  const budget = Math.min(requestedStepCount, MAX_STEP_COUNT);
  const errors: VerificationIssue[] = [];
  const tables = bulldozerDb.listTables();
  let cursor: VerificationCursor;
  let rootObject: PiledriverObject;
  if (request.continue === undefined) {
    const root = await bulldozerDb.getDataIntegrityRoot();
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
    rootObject = (await bulldozerDb.getDataIntegrityPiledriver().deserializeSerializedObject(root.buffer, root.seq)).object;
  } else {
    cursor = decodeVerificationCursor(request.continue);
    const rootBuffer = keyBytes(cursor.root.bufferBase64);
    const rootSeq = deserializeDatabaseSeq(cursor.root.seq);
    rootObject = (await bulldozerDb.getDataIntegrityPiledriver().deserializeSerializedObject(rootBuffer, rootSeq)).object;
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
    const context = bulldozerDb.getDataIntegrityContext(snapshot);
    if (!cursor.rootChecked) {
      for (const error of validateRoot(resolvedRootObject, tables, context.migrationIndex)) addIssue(errors, error);
      cursor.rootChecked = true;
    }
    let remaining = budget;
    while (remaining > 0 && cursor.phase !== "done") {
      if (cursor.phase === "root") {
        const rootRefs = heapReferences(parsePiledriverValue(keyBytes(cursor.root.bufferBase64)));
        for (const ref of rootRefs) {
          const result = await context.piledriverDatabase.getSerializedHeapObject(keyBytes(ref));
          if (result.buffer === null) addIssue(errors, { phase: "root", code: "dangling_heap_reference", message: "A pinned root heap reference is missing", context: { referencedKey: ref } });
        }
        cursor.phase = "tables";
        cursor.tablePosition = nextTablePosition(context.tables[0]?.tableId ?? null);
        continue;
      }
      if (cursor.phase === "tables") {
        const target = context.tables.find(table => table.tableId === cursor.tablePosition.tableId);
        if (target === undefined) {
          cursor.phase = "heap-scan";
          continue;
        }
        const result = target.table.verifyDataIntegrity === undefined
          ? await verifyGenericTable(target, cursor.tablePosition, remaining)
          : await target.table.verifyDataIntegrity({
            serializedTable: target.serializedTable,
            inputTables: target.inputTables,
            stepCount: remaining,
            position: cursor.tablePosition.rowSortKeyBase64,
          }).then(value => ({
            issues: value.issues,
            stepsTaken: value.stepsTaken,
            finished: value.nextPosition === null,
            position: { ...cursor.tablePosition, rowSortKeyBase64: value.nextPosition },
          }));
        for (const error of result.issues) addIssue(errors, { phase: "tables", ...error });
        remaining -= result.stepsTaken;
        if (result.finished) {
          const index = context.tables.findIndex(table => table.tableId === cursor.tablePosition.tableId);
          cursor.tablePosition = nextTablePosition(context.tables[index + 1]?.tableId ?? null);
          if (cursor.tablePosition.tableId === null) cursor.phase = "heap-scan";
        } else cursor.tablePosition = result.position;
        continue;
      }
      const page = await context.piledriverDatabase.iterateHeapEntries({
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
          await context.piledriverDatabase.deserializeSerializedObject(entry.value);
          for (const ref of heapReferences(parsePiledriverValue(entry.value))) {
            const referenced = await context.piledriverDatabase.getSerializedHeapObject(keyBytes(ref));
            if (referenced.buffer === null) addIssue(errors, { phase: "heap-scan", code: "dangling_heap_reference", message: "A heap reference points to a missing heap entry", context: { key: entryKey, referencedKey: ref } });
          }
        } catch (error) {
          // Piledriver's deserializer rejects malformed persisted tags; that is a finding, not a service crash.
          if (error instanceof Error) addIssue(errors, { phase: "heap-scan", code: "invalid_heap_entry", message: "A heap entry could not be deserialized", context: { key: entryKey } });
          else throw error;
        }
        if (remaining === 0) break;
      }
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
  };
}
