import { describe, expect, it } from "vitest";
import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { declareBulldozerDatabase, type BulldozerTableImplementation } from "../databases/bulldozer/index.js";
import { declareInMemoryLowLevelDatabase } from "../databases/low-level/implementations/in-memory.js";
import { declarePiledriverDatabase } from "../databases/piledriver/index.js";
import { serializeDatabaseSeq } from "../databases/index.js";
import { createPaymentsSchema } from "./schema/index.js";
import { subscription } from "./schema/schema-test-helpers.js";
import { asHeapObject, collectSerializedHeapReferences, type PiledriverObject } from "../databases/piledriver/index.js";
import { decodeVerificationCursor, handleVerifyDataIntegrityRequest, verifyDataIntegrity, verifyGenericTable, type TablePosition } from "./verify-data-integrity.js";

async function createDatabase() {
  const schema = createPaymentsSchema();
  const db = declareBulldozerDatabase(
    declarePiledriverDatabase(declareInMemoryLowLevelDatabase(crypto.randomUUID())),
    { migrations: schema.migrations },
  );
  await db.applyRemainingMigrations();
  return db;
}

async function addSubscription(db: Awaited<ReturnType<typeof createDatabase>>) {
  await db.withSnapshot(async snapshot => (await snapshot.setOrDeleteRow({
    tableId: "payments-subscriptions",
    rowIdentifier: "subscription-1",
    newRowData: subscription("subscription-1"),
  })).newSnapshot);
}

async function runToCompletion(db: Awaited<ReturnType<typeof createDatabase>>, stepCount: number) {
  let continuation: string | undefined;
  let totalSteps = 0;
  const errors: string[] = [];
  const skippedChecks: string[] = [];
  do {
    const response = await verifyDataIntegrity(db, {
      ...(continuation === undefined ? {} : { continue: continuation }),
      step_count: stepCount,
    });
    totalSteps += response.steps_taken;
    errors.push(...response.errors.map(error => error.code));
    skippedChecks.push(...response.skipped_checks.map(error => error.code));
    continuation = response.next_cursor ?? undefined;
    if (response.done) return { totalSteps, errors, skippedChecks };
  } while (continuation !== undefined);
  throw new Error("verification stopped without a cursor or done response");
}

async function runWithBudgets(db: Awaited<ReturnType<typeof createDatabase>>, budgets: number[]) {
  let continuation: string | undefined;
  const errors: string[] = [];
  const skippedChecks: string[] = [];
  let steps = 0;
  let index = 0;
  let calls = 0;
  const history: Array<{
    phase: string,
    tableId: string | null,
    groupKeyBase64: string | null,
    rowSortKeyBase64: string | null,
    hookPosition: string | null,
    afterHeapKeyBase64: string | null,
    stepsTaken: number,
    findingsCount: number,
  }> = [];
  while (true) {
    if (++calls > 100) throw new Error(`verification did not finish after ${calls} calls; history=${JSON.stringify(history)}`);
    const budget = budgets[index++ % budgets.length];
    const response = await verifyDataIntegrity(db, {
      ...(continuation === undefined ? {} : { continue: continuation }),
      step_count: budget,
    });
    const decoded = response.next_cursor === null ? null : decodeVerificationCursor(response.next_cursor);
    history.push({
      phase: decoded?.phase ?? "done",
      tableId: decoded?.tablePosition.tableId ?? null,
      groupKeyBase64: decoded?.tablePosition.groupKeyBase64 ?? null,
      rowSortKeyBase64: decoded?.tablePosition.rowSortKeyBase64 ?? null,
      hookPosition: decoded?.tablePosition.hookPosition ?? null,
      afterHeapKeyBase64: decoded?.afterHeapKeyBase64 ?? null,
      stepsTaken: response.steps_taken,
      findingsCount: response.errors.length + response.skipped_checks.length,
    });
    errors.push(...response.errors.map(error => error.code));
    skippedChecks.push(...response.skipped_checks.map(error => error.code));
    steps += response.steps_taken;
    if (response.done) return { errors, steps, skippedChecks };
    continuation = response.next_cursor ?? undefined;
    if (continuation === undefined) throw new Error("missing verification continuation");
  }
}

describe("verification cursor", () => {
  function hasIntegrityHook(value: unknown): value is { table: BulldozerTableImplementation & { verifyDataIntegrity: NonNullable<BulldozerTableImplementation["verifyDataIntegrity"]> } } {
    if (typeof value !== "object" || value === null || !("table" in value)) return false;
    const table = value.table;
    return typeof table === "object"
      && table !== null
      && "verifyDataIntegrity" in table
      && typeof table.verifyDataIntegrity === "function";
  }

  async function expectBadRequest(body: unknown) {
    try {
      await handleVerifyDataIntegrityRequest(body, async () => {
        throw new Error("verification should not run");
      });
      throw new Error("expected a bad request");
    } catch (error) {
      expect(StatusError.isStatusError(error)).toBe(true);
      if (!StatusError.isStatusError(error)) throw error;
      expect(error.statusCode).toBe(400);
    }
  }

  it("maps malformed cursor and invalid step count to bad requests", async () => {
    await expectBadRequest({ continue: "not-a-cursor" });
    await expectBadRequest({ step_count: 0 });
  });

  it("maps a wrong-version cursor to a bad request", async () => {
    const wrongVersion = Buffer.from(JSON.stringify({ version: 999 }), "utf8").toString("base64url");
    await expectBadRequest({ continue: wrongVersion });
  });

  it("returns verification findings as a normal success response", async () => {
    const finding = {
      success: false,
      done: true,
      next_cursor: null,
      steps_taken: 1,
      errors: [{ phase: "heap-scan", code: "invalid_heap_entry", message: "bad entry" }],
      errors_truncated: false,
      skipped_checks: [],
    };
    await expect(handleVerifyDataIntegrityRequest({}, async () => finding)).resolves.toEqual(finding);
  });

  it("runs a table integrity hook after the generic table pass", async () => {
    const db = await createDatabase();
    const debug = db.getDebugInfo();
    const tableState = Object.values(debug.tablesState.tables).find(hasIntegrityHook);
    if (tableState === undefined) {
      throw new Error("Expected a persisted table with an integrity hook");
    }
    let hookCalls = 0;
    tableState.table.verifyDataIntegrity = async () => {
      hookCalls++;
      return {
        issues: [{ code: "hook_ran", message: "table hook ran" }],
        stepsTaken: 1,
        nextPosition: null,
      };
    };
    let continuation: string | undefined;
    const errors: string[] = [];
    let done = false;
    for (let call = 0; call < 100; call++) {
      const response = await handleVerifyDataIntegrityRequest({
        ...(continuation === undefined ? {} : { continue: continuation }),
        step_count: 100,
      }, request => verifyDataIntegrity(db, request));
      errors.push(...response.errors.map(error => error.code));
      if (response.done) {
        done = true;
        break;
      }
      continuation = response.next_cursor ?? undefined;
      if (continuation === undefined) throw new Error("Expected a verification continuation");
    }
    expect(hookCalls).toBeGreaterThan(0);
    expect(done).toBe(true);
    expect(errors).toContain("hook_ran");
  });

  it("reports a missing serialized table without aborting the other checks", async () => {
    const db = await createDatabase();
    const debug = db.getDebugInfo();
    const tableStateEntry = Object.entries(debug.tablesState.tables)
      .map(([tableId, tableState]) => ({ tableId, tableState }))
      .find(entry => hasIntegrityHook(entry.tableState));
    if (tableStateEntry === undefined) throw new Error("Expected a persisted table with an integrity hook");
    if (!hasIntegrityHook(tableStateEntry.tableState)) throw new Error("Expected a persisted table with an integrity hook");
    const tableState = tableStateEntry.tableState;
    tableState.table.verifyDataIntegrity = async () => ({
      issues: [{ code: "remaining_table_checked", message: "remaining table checked" }],
      stepsTaken: 1,
      nextPosition: null,
    });
    const rootResult = await debug.piledriverDatabase.getRootObject(debug.rootKey);
    const root = rootResult.object;
    if (typeof root !== "object" || root === null || Array.isArray(root) || !("snapshot" in root)) {
      throw new Error("Expected a serialized Bulldozer root snapshot");
    }
    const snapshot = root.snapshot;
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot) || !("serializedTables" in snapshot)) {
      throw new Error("Expected serialized tables in the Bulldozer snapshot");
    }
    const serializedTables = snapshot.serializedTables;
    if (typeof serializedTables !== "object" || serializedTables === null || Array.isArray(serializedTables)) {
      throw new Error("Expected serialized table map");
    }
    const hookDescriptor = db.listTables().find(table => table.tableId === tableStateEntry.tableId);
    if (hookDescriptor === undefined) throw new Error("Expected the hook table descriptor");
    const hookInputTableIds = new Set<string>();
    const collectInputs = (tableId: string) => {
      const descriptor = db.listTables().find(table => table.tableId === tableId);
      if (descriptor === undefined) return;
      for (const inputTableId of Object.values(descriptor.inputTableIds)) {
        if (hookInputTableIds.has(inputTableId)) continue;
        hookInputTableIds.add(inputTableId);
        collectInputs(inputTableId);
      }
    };
    collectInputs(hookDescriptor.tableId);
    const missingTableId = Object.keys(serializedTables).find(tableId => tableId !== tableStateEntry.tableId && !hookInputTableIds.has(tableId));
    if (missingTableId === undefined) throw new Error("Expected another serialized table");
    const incompleteTables = Object.fromEntries(Object.entries(serializedTables).filter(([tableId]) => tableId !== missingTableId));
    await debug.piledriverDatabase.setRootObject(debug.rootKey, {
      ...root,
      snapshot: { ...snapshot, serializedTables: incompleteTables },
    });
    const response = await verifyDataIntegrity(db, { step_count: 1_000 });
    expect(response.success).toBe(false);
    expect(response.errors.map(error => error.code)).toEqual(expect.arrayContaining(["table_set_mismatch", "missing_serialized_table", "remaining_table_checked"]));
  });

  it("round-trips and rejects malformed or wrong-version cursors", async () => {
    const db = await createDatabase();
    await addSubscription(db);
    const response = await verifyDataIntegrity(db, { step_count: 1 });
    const cursor = response.next_cursor;
    if (cursor === null) throw new Error("Expected a verification continuation");
    const decodedCursor = decodeVerificationCursor(cursor);
    expect(decodedCursor).toMatchObject({ version: 3, stepsTaken: 1 });
    expect(() => decodeVerificationCursor("not-a-cursor")).toThrow("Invalid verification cursor");
    const wrongVersion = Buffer.from(
      JSON.stringify({ ...decodedCursor, version: 999 }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeVerificationCursor(wrongVersion)).toThrow("expected 3");
    const malformedPayload = Buffer.from(
      JSON.stringify({ ...decodedCursor, tablePosition: { ...decodedCursor.tablePosition, groupKeyBase64: "not-base64" } }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeVerificationCursor(malformedPayload)).toThrow("Invalid verification cursor state");
  });

  it("honors step budgets and resumes to the same final work", async () => {
    const db = await createDatabase();
    const unbudgeted = await runToCompletion(db, 1_000);
    const budgeted = await runToCompletion(db, 1);
    expect(budgeted.totalSteps).toBe(unbudgeted.totalSteps);
    expect(budgeted.errors).toEqual(unbudgeted.errors);
  });

  it("matches an unbudgeted run across deterministic random budgets", async () => {
    const baselineDb = await createDatabase();
    await addSubscription(baselineDb);
    const baseline = await runToCompletion(baselineDb, 1_000);
    let seed = 0x12345678;
    const nextBudget = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return 1 + (seed % 7);
    };
    for (let run = 0; run < 3; run++) {
      const db = await createDatabase();
      await addSubscription(db);
      const budgets = Array.from({ length: 12 }, nextBudget);
      const result = await runWithBudgets(db, budgets);
      expect(result.errors).toEqual(baseline.errors);
      expect(result.steps).toBe(baseline.totalSteps);
      expect(result.skippedChecks).toEqual(baseline.skippedChecks);
    }
  }, 15_000);

  it("reports dangling references from the pinned root", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const piledriver = declarePiledriverDatabase(lowLevel);
    const db = declareBulldozerDatabase(piledriver, { migrations: [] });
    await db.applyRemainingMigrations();
    const rootStore = lowLevel.declareKvStore("root");
    await rootStore.setAll([{
      key: new TextEncoder().encode("bulldozer-database-root").buffer,
      value: new TextEncoder().encode(JSON.stringify({
        snapshot: {
          serializedTables: {},
          mostRecentlyCompletedMigrationIndex: 0,
          uniqueSnapshotIdentifier: "corrupted",
          dangling: ["heap-reference", "bWlzc2luZw=="],
        },
      })).buffer,
    }]);
    const result = await verifyDataIntegrity(db, { step_count: 1_000 });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "dangling_heap_reference" }));
  });

  it("reports an unparseable heap entry", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const piledriver = declarePiledriverDatabase(lowLevel);
    const db = declareBulldozerDatabase(piledriver, { migrations: [] });
    await db.applyRemainingMigrations();
    await lowLevel.declareKvDump("heap").insertAll([new Uint8Array([0xff]).buffer]);
    const result = await verifyDataIntegrity(db, { step_count: 1_000 });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_heap_entry" }));
  });

  it("reports an inaccessible pinned root as a verification error", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const piledriver = declarePiledriverDatabase(lowLevel);
    const db = declareBulldozerDatabase(piledriver, { migrations: [] });
    await db.applyRemainingMigrations();
    const rootStore = lowLevel.declareKvStore("root");
    await rootStore.setAll([{
      key: new TextEncoder().encode("bulldozer-database-root").buffer,
      value: new TextEncoder().encode(JSON.stringify({ notSnapshot: true })).buffer,
    }]);
    const result = await verifyDataIntegrity(db, { step_count: 1_000 });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_root_shape" }));
  });

  it("reports an unparseable pinned root without throwing", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const piledriver = declarePiledriverDatabase(lowLevel);
    const db = declareBulldozerDatabase(piledriver, { migrations: [] });
    await db.applyRemainingMigrations();
    const rootStore = lowLevel.declareKvStore("root");
    await rootStore.setAll([{
      key: new TextEncoder().encode("bulldozer-database-root").buffer,
      value: new TextEncoder().encode(JSON.stringify(["heap-reference", "bWlzc2luZw==", "extra"])).buffer,
    }]);
    const result = await verifyDataIntegrity(db, { step_count: 1_000 });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_root_shape" }));
    expect(result.success).toBe(false);
  });

  it("reports a structurally invalid pinned root on continuation without throwing", async () => {
    const db = await createDatabase();
    const root = await db.getDataIntegrityState().getRoot();
    const malformed = encodeBase64(new TextEncoder().encode(JSON.stringify(["heap-reference", "bWlzc2luZw==", "extra"])));
    const continuation = Buffer.from(JSON.stringify({
      version: 3,
      root: { bufferBase64: malformed, seq: serializeDatabaseSeq(root.seq) },
      phase: "root",
      tablePosition: { tableId: null, groupKeyBase64: null, rowSortKeyBase64: null, rowIdentifiers: [], rowIdentifierCheckSkipped: false, groupComplete: false, genericDone: false, hookPosition: null },
      afterHeapKeyBase64: null,
      stepsTaken: 0,
      errorCount: 0,
      rootChecked: false,
      rootReferenceIndex: 0,
    }), "utf8").toString("base64url");
    const result = await verifyDataIntegrity(db, { continue: continuation, step_count: 1_000 });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_root_shape" }));
    expect(result.success).toBe(false);
  });
});

function fakePosition(overrides: Partial<TablePosition> = {}): TablePosition {
  return {
    tableId: "fake",
    groupKeyBase64: null,
    rowSortKeyBase64: null,
    rowIdentifiers: [],
    rowIdentifierCheckSkipped: false,
    groupComplete: false,
    genericDone: false,
    hookPosition: null,
    ...overrides,
  };
}

function fakeTable(groups: Array<{ groupKey: PiledriverObject, rows: Array<{ groupKey: PiledriverObject, rowIdentifier: string, rowSortKey: PiledriverObject }> }>) {
  let groupsListed = false;
  return {
    tableId: "fake",
    serializedTable: {},
    inputTables: {},
    table: {
      async *listGroups({ range }: { range: { gt?: PiledriverObject } }) {
        if (groupsListed) return;
        groupsListed = true;
        for (const group of groups) {
          if (range.gt !== undefined) continue;
          yield { groupKey: group.groupKey };
        }
      },
      async *listRowsInGroup({ groupKey }: { groupKey: PiledriverObject }) {
        const group = groups.find(candidate => candidate.groupKey === groupKey);
        for (const row of group?.rows ?? []) yield { ...row, rowData: {} };
      },
      compareGroupKeys({ a, b }: { a: PiledriverObject, b: PiledriverObject }) {
        return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
      },
      compareSortKeys({ a, b }: { a: PiledriverObject, b: PiledriverObject }) {
        return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
      },
    },
  };
}

describe("generic table corruption checks", () => {
  it("does not treat inline array contents as heap references", () => {
    expect(collectSerializedHeapReferences(["array", [["array", ["heap-reference", "literal-value"]]]])).toEqual([]);
  });

  it("preserves null group and sort keys across continuation", async () => {
    const result = await verifyGenericTable(
      fakeTable([{
        groupKey: null,
        rows: [{ groupKey: null, rowIdentifier: "null-row", rowSortKey: null }],
      }]),
      fakePosition(),
      1,
    );
    expect(result.issues).toEqual([]);
    expect(result.finished).toBe(false);
    const completed = await verifyGenericTable(fakeTable([{
      groupKey: null,
      rows: [{ groupKey: null, rowIdentifier: "null-row", rowSortKey: null }],
    }]), result.position, 10);
    expect(completed.issues).toEqual([]);
  });

  it("reports a violation in a later group", async () => {
    let listed = false;
    const table = {
      tableId: "later-group",
      serializedTable: {},
      inputTables: {},
      table: {
        async *listGroups() {
          if (listed) return;
          listed = true;
          yield { groupKey: "a" };
        },
        async *listRowsInGroup() {},
        compareGroupKeys({ a, b }: { a: PiledriverObject, b: PiledriverObject }) {
          return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
        },
        compareSortKeys() {
          return 0;
        },
      },
    };
    const result = await verifyGenericTable(table, fakePosition({
      groupKeyBase64: Buffer.from(JSON.stringify("b"), "utf8").toString("base64url"),
      groupComplete: true,
    }), 10);
    expect(result.issues.map(issue => issue.code)).toContain("group_order");
  });

  it("reports group order corruption independently", async () => {
    const result = await verifyGenericTable({
      tableId: "group-order",
      serializedTable: {},
      inputTables: {},
      table: {
        async *listGroups() {
          yield { groupKey: "b" };
          yield { groupKey: "a" };
        },
        async *listRowsInGroup() {},
        compareGroupKeys({ a, b }: { a: PiledriverObject, b: PiledriverObject }) {
          return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
        },
        compareSortKeys() { return 0; },
      },
    }, fakePosition(), 10);
    expect(result.issues.map(issue => issue.code)).toContain("group_order");
  });

  it("reports duplicate group corruption independently", async () => {
    const result = await verifyGenericTable({
      tableId: "duplicate-group",
      serializedTable: {},
      inputTables: {},
      table: {
        async *listGroups() {
          yield { groupKey: "a" };
          yield { groupKey: "a" };
        },
        async *listRowsInGroup() {},
        compareGroupKeys() { return 0; },
        compareSortKeys() { return 0; },
      },
    }, fakePosition(), 10);
    expect(result.issues.map(issue => issue.code)).toContain("group_order");
  });

  it("reports a non-canonical group key independently", async () => {
    const result = await verifyGenericTable(fakeTable([
      { groupKey: asHeapObject({}), rows: [] },
    ]), fakePosition(), 10);
    expect(result.issues.map(issue => issue.code)).toContain("heap_group_key");
  });

  it("reports row and duplicate-id violations", async () => {
    const cases = [
      fakeTable([{ groupKey: "g", rows: [
        { groupKey: "wrong", rowIdentifier: "a", rowSortKey: "b" },
        { groupKey: "g", rowIdentifier: "a", rowSortKey: "a" },
      ] }]),
    ];
    const findings = [];
    for (const target of cases) {
      const result = await verifyGenericTable(target, fakePosition(), 100);
      findings.push(...result.issues.map(issue => issue.code));
    }
    expect(findings).toMatchInlineSnapshot(`
      [
        "row_group_mismatch",
        "row_order",
        "duplicate_row_identifier",
      ]
    `);
    const heapResult = await verifyGenericTable(
      fakeTable([{ groupKey: asHeapObject({}), rows: [] }]),
      fakePosition(),
      1,
    );
    expect(heapResult.issues.map(issue => issue.code)).toMatchInlineSnapshot(`
      [
        "heap_group_key",
      ]
    `);
  });

  it("keeps duplicate tracking bounded and reports the skipped check", async () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({
      groupKey: "g",
      rowIdentifier: `row-${index}`,
      rowSortKey: String(index).padStart(3, "0"),
    }));
    const result = await verifyGenericTable(fakeTable([{ groupKey: "g", rows }]), fakePosition(), 1_000);
    expect(result.skippedChecks).toContainEqual(expect.objectContaining({ code: "duplicate_row_identifier_check_skipped" }));
    expect(result.position.rowIdentifiers.length).toBeLessThanOrEqual(256);
  });
});
