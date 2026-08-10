import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import type { DatabaseSeq } from "../databases/index.js";
import type {
  BulldozerDatabase,
  BulldozerDatabaseTableDescriptor,
} from "../databases/bulldozer/index.js";
import type {
  PiledriverDatabase,
  PiledriverObject,
} from "../databases/piledriver/index.js";
import { isPiledriverHeapObjectSymbol } from "../databases/piledriver/index.js";

const CURSOR_VERSION = 1;
const DEFAULT_STEP_COUNT = 100;
const MAX_STEP_COUNT = 1_000;
const MAX_ERRORS = 100;
const MAX_WARNINGS = 100;
const HEAP_PAGE_SIZE = 100;
const ROOT_KEY = new TextEncoder().encode("bulldozer-database-root").buffer;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export type VerificationIssue = {
  phase: string,
  code: string,
  message: string,
  context?: Record<string, string | number | boolean | null>,
};

type VerificationPhase = "root" | "tables" | "heap-scan" | "root-reachability" | "done";
type ReachabilityFrame = {
  key: string | null,
  refs: string[],
  index: number,
};

type VerificationCursor = {
  version: number,
  root: {
    bufferBase64: string,
    seq: Array<string | number>,
  },
  phase: VerificationPhase,
  phasePosition: {
    tableIndex?: number,
    afterKeyBase64?: string | null,
    stack?: ReachabilityFrame[],
    visitedKeys?: string[],
  },
  stepsTaken: number,
  errorCount: number,
  warningCount: number,
  rootChecked: boolean,
};

export type VerifyDataIntegrityRequest = {
  continue?: string,
  step_count?: number,
};

export type VerifyDataIntegrityResponse = {
  success: boolean,
  done: boolean,
  next_cursor: string | null,
  steps_taken: number,
  errors: VerificationIssue[],
  warnings: VerificationIssue[],
  errors_truncated: boolean,
  warnings_truncated: boolean,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && !(isPiledriverHeapObjectSymbol in value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function encodeCursor(cursor: VerificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
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
  if (!isRecord(parsed.root) || typeof parsed.root.bufferBase64 !== "string" || !Array.isArray(parsed.root.seq)) {
    throw new Error("Invalid verification cursor root");
  }
  if (
    !["root", "tables", "heap-scan", "root-reachability"].includes(String(parsed.phase))
    || !isRecord(parsed.phasePosition)
    || typeof parsed.stepsTaken !== "number"
    || !Number.isInteger(parsed.stepsTaken)
    || parsed.stepsTaken < 0
    || typeof parsed.errorCount !== "number"
    || !Number.isInteger(parsed.errorCount)
    || parsed.errorCount < 0
    || typeof parsed.warningCount !== "number"
    || !Number.isInteger(parsed.warningCount)
    || parsed.warningCount < 0
  ) {
    throw new Error("Invalid verification cursor state");
  }
  if (!parsed.root.seq.every(item => typeof item === "string" || typeof item === "number")) {
    throw new Error("Invalid verification cursor sequence");
  }
  const phasePosition = parsed.phasePosition;
  if (phasePosition.tableIndex !== undefined && (typeof phasePosition.tableIndex !== "number" || !Number.isInteger(phasePosition.tableIndex) || phasePosition.tableIndex < 0)) {
    throw new Error("Invalid verification cursor table position");
  }
  if (phasePosition.afterKeyBase64 !== undefined && phasePosition.afterKeyBase64 !== null && typeof phasePosition.afterKeyBase64 !== "string") {
    throw new Error("Invalid verification cursor heap position");
  }
  if (phasePosition.stack !== undefined && !Array.isArray(phasePosition.stack)) {
    throw new Error("Invalid verification cursor reachability stack");
  }
  if (phasePosition.visitedKeys !== undefined && !isStringArray(phasePosition.visitedKeys)) {
    throw new Error("Invalid verification cursor reachability set");
  }
  return {
    version: CURSOR_VERSION,
    root: {
      bufferBase64: parsed.root.bufferBase64,
      seq: parsed.root.seq,
    },
    phase: parsed.phase as VerificationPhase,
    phasePosition: {
      tableIndex: phasePosition.tableIndex as number | undefined,
      afterKeyBase64: phasePosition.afterKeyBase64 as string | null | undefined,
      stack: phasePosition.stack as ReachabilityFrame[] | undefined,
      visitedKeys: phasePosition.visitedKeys as string[] | undefined,
    },
    stepsTaken: parsed.stepsTaken,
    errorCount: parsed.errorCount,
    warningCount: parsed.warningCount,
    rootChecked: parsed.rootChecked === true,
  };
}

function issue(
  phase: string,
  code: string,
  message: string,
  context?: Record<string, string | number | boolean | null>,
): VerificationIssue {
  return { phase, code, message, ...(context === undefined ? {} : { context }) };
}

function addIssue(
  issues: VerificationIssue[],
  value: VerificationIssue,
  limit: number,
): void {
  if (issues.length < limit) issues.push(value);
}

function parseJson(buffer: ArrayBuffer): unknown {
  return JSON.parse(textDecoder.decode(buffer));
}

function heapReferences(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    if (value.length === 2 && value[0] === "heap-reference" && typeof value[1] === "string") {
      refs.push(value[1]);
      return refs;
    }
    for (const item of value) heapReferences(item, refs);
    return refs;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) heapReferences(item, refs);
  }
  return refs;
}

function keyBytes(keyBase64: string): ArrayBuffer {
  return decodeBase64(keyBase64).buffer;
}

function keyBase64(key: ArrayBuffer): string {
  return encodeBase64(new Uint8Array(key));
}

function validateRoot(
  rootObject: PiledriverObject,
  tables: BulldozerDatabaseTableDescriptor[],
  migrationCount: number,
): VerificationIssue[] {
  const errors: VerificationIssue[] = [];
  const rootRecord = isRecord(rootObject) ? rootObject : null;
  const snapshotValue = rootRecord === null ? undefined : Reflect.get(rootRecord, "snapshot");
  if (!isRecord(snapshotValue)) {
    errors.push(issue("root", "invalid_root_shape", "The pinned root is not a Bulldozer root object"));
    return errors;
  }
  const snapshot = snapshotValue;
  const serializedTables = snapshot.serializedTables;
  if (!isRecord(serializedTables)) {
    errors.push(issue("root", "invalid_snapshot_shape", "The pinned snapshot has no serializedTables object"));
    return errors;
  }
  if (
    typeof snapshot.mostRecentlyCompletedMigrationIndex !== "number"
    || !Number.isInteger(snapshot.mostRecentlyCompletedMigrationIndex)
    || snapshot.mostRecentlyCompletedMigrationIndex !== migrationCount
  ) {
    errors.push(issue("root", "migration_mismatch", "The pinned snapshot migration index does not match the running schema", {
      expected: migrationCount,
      actual: typeof snapshot.mostRecentlyCompletedMigrationIndex === "number" ? snapshot.mostRecentlyCompletedMigrationIndex : null,
    }));
  }
  const tableIds = new Set(tables.map(table => table.tableId));
  const serializedTableIds = Object.keys(serializedTables).sort();
  const expectedTableIds = [...tableIds].sort();
  if (JSON.stringify(serializedTableIds) !== JSON.stringify(expectedTableIds)) {
    errors.push(issue("root", "table_set_mismatch", "The pinned snapshot table set does not match the running schema"));
  }
  for (const table of tables) {
    for (const inputTableId of Object.values(table.inputTableIds)) {
      if (!tableIds.has(inputTableId)) {
        errors.push(issue("root", "missing_input_table", "A declared input table does not exist", {
          tableId: table.tableId,
          inputTableId,
        }));
      }
    }
  }
  return errors;
}

function initialReachabilityPosition(rootBuffer: ArrayBuffer): {
  stack: ReachabilityFrame[],
  visitedKeys: string[],
} {
  const rootJson = parseJson(rootBuffer);
  return {
    stack: [{ key: null, refs: heapReferences(rootJson), index: 0 }],
    visitedKeys: [],
  };
}

function currentPhasePosition(cursor: VerificationCursor): VerificationCursor["phasePosition"] {
  return {
    tableIndex: cursor.phasePosition.tableIndex,
    afterKeyBase64: cursor.phasePosition.afterKeyBase64,
    stack: cursor.phasePosition.stack,
    visitedKeys: cursor.phasePosition.visitedKeys,
  };
}

function runTablePlaceholderPhase(
  tableCount: number,
  tableIndex: number,
  remaining: number,
): { tableIndex: number, stepsTaken: number, done: boolean } {
  if (tableIndex >= tableCount) return { tableIndex, stepsTaken: 0, done: true };
  const stepsTaken = Math.min(remaining, tableCount - tableIndex);
  return {
    tableIndex: tableIndex + stepsTaken,
    stepsTaken,
    done: tableIndex + stepsTaken >= tableCount,
  };
}

export async function verifyDataIntegrity(
  bulldozerDb: BulldozerDatabase,
  request: VerifyDataIntegrityRequest,
): Promise<VerifyDataIntegrityResponse> {
  const requestedStepCount = request.step_count ?? DEFAULT_STEP_COUNT;
  if (!Number.isInteger(requestedStepCount) || requestedStepCount <= 0) {
    throw new Error("step_count must be a positive integer");
  }
  const stepBudget = Math.min(requestedStepCount, MAX_STEP_COUNT);
  const debugInfo = bulldozerDb.getDebugInfo();
  const piledriverDatabase: PiledriverDatabase = debugInfo.piledriverDatabase;
  const tables = bulldozerDb.listTables();
  const migrationCount = debugInfo.tablesState.mostRecentlyCompletedMigrationIndex;
  const errors: VerificationIssue[] = [];
  const warnings: VerificationIssue[] = [];

  let cursor: VerificationCursor;
  if (request.continue === undefined) {
    const root = await piledriverDatabase.getSerializedRootObject(ROOT_KEY);
    cursor = {
      version: CURSOR_VERSION,
      root: {
        bufferBase64: encodeBase64(new Uint8Array(root.buffer)),
        seq: [...root.seq],
      },
      phase: "root",
      phasePosition: {},
      stepsTaken: 0,
      errorCount: 0,
      warningCount: 0,
      rootChecked: false,
    };
  } else {
    cursor = decodeVerificationCursor(request.continue);
  }

  const rootBuffer = decodeBase64(cursor.root.bufferBase64).buffer;
  const rootSeq = cursor.root.seq as unknown as DatabaseSeq;
  const root = await piledriverDatabase.deserializeSerializedObject(rootBuffer, rootSeq);
  if (!cursor.rootChecked) {
    const rootErrors = validateRoot(root.object, tables, migrationCount);
    for (const value of rootErrors) addIssue(errors, value, MAX_ERRORS);
    cursor.rootChecked = true;
  }

  let remaining = stepBudget;
  while (remaining > 0 && cursor.phase !== "done") {
    if (cursor.phase === "root") {
      cursor.phase = "tables";
      cursor.phasePosition = { tableIndex: 0 };
      continue;
    }
    if (cursor.phase === "tables") {
      const tableIndex = cursor.phasePosition.tableIndex ?? 0;
      const tablePhase = runTablePlaceholderPhase(tables.length, tableIndex, remaining);
      cursor.phasePosition = { tableIndex: tablePhase.tableIndex };
      remaining -= tablePhase.stepsTaken;
      if (tablePhase.done) {
        cursor.phase = "heap-scan";
        cursor.phasePosition = { afterKeyBase64: null };
        continue;
      }
      continue;
    }
    if (cursor.phase === "heap-scan") {
      const page = await piledriverDatabase.iterateHeapEntries({
        afterKey: cursor.phasePosition.afterKeyBase64 === undefined || cursor.phasePosition.afterKeyBase64 === null
          ? undefined
          : keyBytes(cursor.phasePosition.afterKeyBase64),
        limit: Math.min(HEAP_PAGE_SIZE, remaining),
      });
      if (page.entries.length === 0) {
        const position = initialReachabilityPosition(rootBuffer);
        cursor.phase = "root-reachability";
        cursor.phasePosition = position;
        continue;
      }
      for (const entry of page.entries) {
        const entryKey = keyBase64(entry.key);
        cursor.phasePosition = { afterKeyBase64: entryKey };
        remaining--;
        try {
          const json = parseJson(entry.value);
          const canonical = new Uint8Array(textEncoder.encode(JSON.stringify(json)));
          const original = new Uint8Array(entry.value);
          if (canonical.byteLength !== original.byteLength || canonical.some((byte, index) => byte !== original[index])) {
            addIssue(errors, issue("heap-scan", "non_canonical_encoding", "A heap entry is not canonically JSON encoded", { key: entryKey }), MAX_ERRORS);
          }
          for (const ref of heapReferences(json)) {
            const referenced = await piledriverDatabase.getSerializedHeapObject(keyBytes(ref));
            if (referenced.buffer === null) {
              addIssue(errors, issue("heap-scan", "dangling_heap_reference", "A heap reference points to a missing heap entry", { key: entryKey, referencedKey: ref }), MAX_ERRORS);
            }
          }
        } catch {
          addIssue(errors, issue("heap-scan", "invalid_heap_entry", "A heap entry could not be parsed as a Piledriver object", { key: entryKey }), MAX_ERRORS);
        }
        if (remaining === 0) break;
      }
      continue;
    }
    const position = cursor.phasePosition;
    const stack = position.stack ?? [];
    const visitedKeys = position.visitedKeys ?? [];
    const frame = stack.at(-1);
    if (frame === undefined) {
      cursor.phase = "done";
      break;
    }
    if (frame.index >= frame.refs.length) {
      stack.pop();
      if (stack.length === 0) {
        cursor.phase = "done";
        break;
      }
      continue;
    }
    const ref = frame.refs[frame.index];
    frame.index++;
    if (stack.some(item => item.key === ref)) {
      addIssue(errors, issue("root-reachability", "heap_cycle", "A heap reference cycle was found", { key: ref }), MAX_ERRORS);
      continue;
    }
    if (visitedKeys.includes(ref)) continue;
    const referenced = await piledriverDatabase.getSerializedHeapObject(keyBytes(ref));
    if (referenced.buffer === null) {
      addIssue(errors, issue("root-reachability", "dangling_heap_reference", "A reachable heap reference points to a missing heap entry", { referencedKey: ref }), MAX_ERRORS);
      continue;
    }
    try {
      await piledriverDatabase.deserializeSerializedObject(referenced.buffer, referenced.seq);
      const refs = heapReferences(parseJson(referenced.buffer));
      visitedKeys.push(ref);
      stack.push({ key: ref, refs, index: 0 });
      remaining--;
    } catch {
      addIssue(errors, issue("root-reachability", "invalid_heap_entry", "A reachable heap entry could not be deserialized", { key: ref }), MAX_ERRORS);
      remaining--;
    }
  }

  cursor.stepsTaken += stepBudget - remaining;
  cursor.errorCount += errors.length;
  cursor.warningCount += warnings.length;
  const done = cursor.phase === "done";
  const nextCursor = done ? null : encodeCursor({
    ...cursor,
    phasePosition: currentPhasePosition(cursor),
  });
  return {
    success: errors.length === 0,
    done,
    next_cursor: nextCursor,
    steps_taken: stepBudget - remaining,
    errors,
    warnings,
    errors_truncated: errors.length >= MAX_ERRORS,
    warnings_truncated: warnings.length >= MAX_WARNINGS,
  };
}
