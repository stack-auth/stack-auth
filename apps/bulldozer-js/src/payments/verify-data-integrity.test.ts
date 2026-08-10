import { describe, expect, it } from "vitest";
import { declareBulldozerDatabase } from "../databases/bulldozer/index.js";
import { declareInMemoryLowLevelDatabase } from "../databases/low-level/implementations/in-memory.js";
import { declarePiledriverDatabase } from "../databases/piledriver/index.js";
import { createPaymentsSchema } from "./schema/index.js";
import { subscription } from "./schema/schema-test-helpers.js";
import { asHeapObject, collectSerializedHeapReferences, type PiledriverObject } from "../databases/piledriver/index.js";
import { decodeVerificationCursor, verifyDataIntegrity, verifyGenericTable, type TablePosition } from "./verify-data-integrity.js";

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
  do {
    const response = await verifyDataIntegrity(db, {
      ...(continuation === undefined ? {} : { continue: continuation }),
      step_count: stepCount,
    });
    totalSteps += response.steps_taken;
    errors.push(...response.errors.map(error => error.code));
    continuation = response.next_cursor ?? undefined;
    if (response.done) return { totalSteps, errors, skippedChecks: [] };
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
  it("round-trips and rejects malformed or wrong-version cursors", async () => {
    const db = await createDatabase();
    await addSubscription(db);
    const response = await verifyDataIntegrity(db, { step_count: 1 });
    expect(response.next_cursor).not.toBeNull();
    expect(decodeVerificationCursor(response.next_cursor!)).toMatchObject({ version: 2, stepsTaken: 1 });
    expect(() => decodeVerificationCursor("not-a-cursor")).toThrow("Invalid verification cursor");
    const wrongVersion = Buffer.from(
      JSON.stringify({ ...decodeVerificationCursor(response.next_cursor!), version: 999 }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeVerificationCursor(wrongVersion)).toThrow("expected 2");
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
          dangling: ["heap-reference", "missing"],
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

  it("reports group, row, enclosing-group, duplicate-id, and heap-key violations", async () => {
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
