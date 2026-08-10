import { describe, expect, it } from "vitest";
import { declareBulldozerDatabase } from "../databases/bulldozer/index.js";
import { declareInMemoryLowLevelDatabase } from "../databases/low-level/implementations/in-memory.js";
import { declarePiledriverDatabase } from "../databases/piledriver/index.js";
import { createPaymentsSchema } from "./schema/index.js";
import { decodeVerificationCursor, verifyDataIntegrity } from "./verify-data-integrity.js";

async function createDatabase() {
  const schema = createPaymentsSchema();
  const db = declareBulldozerDatabase(
    declarePiledriverDatabase(declareInMemoryLowLevelDatabase(crypto.randomUUID())),
    { migrations: schema.migrations },
  );
  await db.applyRemainingMigrations();
  return db;
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
    if (response.done) return { totalSteps, errors };
  } while (continuation !== undefined);
  throw new Error("verification stopped without a cursor or done response");
}

describe("verification cursor", () => {
  it("round-trips and rejects malformed or wrong-version cursors", async () => {
    const db = await createDatabase();
    const response = await verifyDataIntegrity(db, { step_count: 1 });
    expect(response.next_cursor).not.toBeNull();
    expect(decodeVerificationCursor(response.next_cursor!)).toMatchObject({ version: 1, stepsTaken: 1 });
    expect(() => decodeVerificationCursor("not-a-cursor")).toThrow("Invalid verification cursor");
    const wrongVersion = Buffer.from(
      JSON.stringify({ ...decodeVerificationCursor(response.next_cursor!), version: 999 }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeVerificationCursor(wrongVersion)).toThrow("expected 1");
  });

  it("honors step budgets and resumes to the same final work", async () => {
    const db = await createDatabase();
    const unbudgeted = await runToCompletion(db, 1_000);
    const budgeted = await runToCompletion(db, 1);
    expect(budgeted.totalSteps).toBe(unbudgeted.totalSteps);
    expect(budgeted.errors).toEqual(unbudgeted.errors);
  });

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
