import { afterAll, describe, expect, it } from "vitest";
import { declareInMemoryLowLevelDatabase } from "../../databases/low-level/implementations/in-memory.js";
import { declareInstantAvailabilityLowLevelDatabase } from "../../databases/low-level/implementations/instant-availability.js";
import { declareLmdbLowLevelDatabase } from "../../databases/low-level/implementations/lmdb.js";
import { declareBulldozerDatabase } from "../../databases/bulldozer/index.js";
import { declarePiledriverDatabase, PiledriverObject } from "../../databases/piledriver/index.js";
import { createPaymentsSchema } from "./index.js";
import type { ProductSnapshot, SubscriptionRow } from "./types.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Metric = { name: string, count: number, elapsedMs: number, opsPerSecond: number };
type Snapshot = Awaited<ReturnType<ReturnType<typeof declareBulldozerDatabase>["getSnapshot"]>>["snapshot"];

const USER_COUNT = 6;
const ITEM_UPDATES_PER_USER = 10;
const MONTH_MS = 2_592_000_000;
const tempPaths: string[] = [];
const perfBackend = process.env.BULLDOZER_PAYMENTS_PERF_BACKEND ?? "lmdb-instant";

const product = (includedItems: ProductSnapshot["includedItems"]): ProductSnapshot => ({
  displayName: "Perf Product",
  customerType: "user",
  productLineId: "line-perf",
  prices: { p1: { USD: "10.00" } },
  includedItems,
});
const subscription = (index: number): SubscriptionRow => ({
  id: `sub-${index}`,
  tenancyId: "t1",
  customerId: `user-${index}`,
  customerType: "user",
  productId: "prod-sub",
  priceId: "p1",
  product: product({
    credits: { quantity: 100, expires: "never" },
    seats: { quantity: 1, expires: "when-purchase-expires" },
  }),
  quantity: 1,
  stripeSubscriptionId: null,
  status: "active",
  currentPeriodStartMillis: 0,
  currentPeriodEndMillis: MONTH_MS,
  cancelAtPeriodEnd: false,
  canceledAtMillis: null,
  endedAtMillis: null,
  refundedAtMillis: null,
  productRevokedAtMillis: null,
  creationSource: "TEST_MODE",
  createdAtMillis: 1_000 + index,
});
const oneTimePurchase = (index: number) => ({
  id: `otp-${index}`,
  tenancyId: "t1",
  customerId: `user-${index}`,
  customerType: "user",
  productId: "prod-otp",
  priceId: "p1",
  product: product({
    coins: { quantity: 50, expires: "never" },
  }),
  quantity: 2,
  stripePaymentIntentId: null,
  revokedAtMillis: null,
  refundedAtMillis: null,
  creationSource: "TEST_MODE",
  createdAtMillis: 2_000 + index,
});
const manualItemQuantityChange = (userIndex: number, updateIndex: number) => ({
  id: `miqc-${userIndex}-${updateIndex}`,
  tenancyId: "t1",
  customerId: `user-${userIndex}`,
  customerType: "user",
  itemId: updateIndex % 2 === 0 ? "credits" : "coins",
  quantity: updateIndex % 3 === 0 ? -1 : 3,
  description: null,
  expiresAtMillis: null,
  createdAtMillis: 10_000 + userIndex * 1_000 + updateIndex,
});
const customerGroup = (index: number): PiledriverObject => ({ tenancyId: "t1", customerType: "user", customerId: `user-${index}` });
const rows = async (snapshot: Snapshot, tableId: string, groupKey: PiledriverObject) => {
  const result = [];
  for await (const row of snapshot.listRowsInGroup({ tableId, groupKey, range: {} })) result.push(row);
  return result;
};
const measure = async <T>(metrics: Metric[], name: string, count: number, operation: () => Promise<T>) => {
  const start = performance.now();
  const value = await operation();
  const elapsedMs = performance.now() - start;
  const opsPerSecond = count / elapsedMs * 1_000;
  metrics.push({ name, count, elapsedMs, opsPerSecond });
  process.stdout.write(`\n[bulldozer-payments-schema-perf-js] ${name}: ${elapsedMs.toFixed(1)} ms (${count} ops, ${opsPerSecond.toFixed(2)} ops/s)\n`);
  return value;
};
const newLowLevelDb = () => {
  if (perfBackend === "lmdb" || perfBackend === "lmdb-instant") {
    const path = mkdtempSync(join(tmpdir(), "bulldozer-payments-schema-perf-"));
    tempPaths.push(path);
    const lmdb = declareLmdbLowLevelDatabase({ path, dbId: crypto.randomUUID() });
    return perfBackend === "lmdb-instant" ? declareInstantAvailabilityLowLevelDatabase(lmdb) : lmdb;
  }
  return declareInMemoryLowLevelDatabase(crypto.randomUUID());
};
const newPaymentsDb = async () => {
  const schema = createPaymentsSchema();
  const db = declareBulldozerDatabase(declarePiledriverDatabase(newLowLevelDb()), { migrations: schema.migrations });
  await db.applyRemainingMigrations();
  return { db, schema };
};

describe("payments schema performance", () => {
  it("runs the comparable schema workload", { timeout: 120_000 }, async () => {
    const metrics: Metric[] = [];
    let initialized!: Awaited<ReturnType<typeof newPaymentsDb>>;

    initialized = await measure(metrics, "initialize schema", 1, newPaymentsDb);
    const { db, schema } = initialized;

    await measure(metrics, "write subscriptions", USER_COUNT, async () => {
      for (let i = 0; i < USER_COUNT; i++) {
        await db.withSnapshot(async snapshot => await snapshot.setOrDeleteRow({ tableId: schema.subscriptions, rowIdentifier: `sub-${i}`, newRowData: subscription(i) as unknown as PiledriverObject }));
      }
    });

    await measure(metrics, "write one-time purchases", USER_COUNT, async () => {
      for (let i = 0; i < USER_COUNT; i++) {
        await db.withSnapshot(async snapshot => await snapshot.setOrDeleteRow({ tableId: schema.oneTimePurchases, rowIdentifier: `otp-${i}`, newRowData: oneTimePurchase(i) as unknown as PiledriverObject }));
      }
    });

    await measure(metrics, "write manual item quantity changes", USER_COUNT * ITEM_UPDATES_PER_USER, async () => {
      for (let userIndex = 0; userIndex < USER_COUNT; userIndex++) {
        for (let updateIndex = 0; updateIndex < ITEM_UPDATES_PER_USER; updateIndex++) {
          await db.withSnapshot(async snapshot => await snapshot.setOrDeleteRow({
            tableId: schema.manualItemQuantityChanges,
            rowIdentifier: `miqc-${userIndex}-${updateIndex}`,
            newRowData: manualItemQuantityChange(userIndex, updateIndex),
          }));
        }
      }
    });

    const { snapshot } = await db.getSnapshot();
    await measure(metrics, "read owned products", USER_COUNT, async () => {
      for (let i = 0; i < USER_COUNT; i++) await rows(snapshot, schema.ownedProducts, customerGroup(i));
    });
    await measure(metrics, "read item quantities", USER_COUNT * 3, async () => {
      for (let i = 0; i < USER_COUNT; i++) {
        for (const _itemId of ["credits", "coins", "seats"]) await rows(snapshot, schema.itemQuantities, customerGroup(i));
      }
    });
    const transactionRows = await measure(metrics, "read transactions", USER_COUNT, async () => {
      let count = 0;
      for (let i = 0; i < USER_COUNT; i++) count += (await rows(snapshot, schema.transactions, customerGroup(i))).length;
      return count;
    });

    expect(transactionRows).toBe(USER_COUNT * (2 + ITEM_UPDATES_PER_USER));
    const summary = { engine: "bulldozer-js", backend: perfBackend, users: USER_COUNT, transactions: transactionRows, metrics };
    writeFileSync("../../bulldozer-payments-schema-perf-js.untracked.json", JSON.stringify(summary, null, 2));
    process.stdout.write(`\n[bulldozer-payments-schema-perf-js] summary=${JSON.stringify(summary)}\n`);
  });
});

afterAll(() => {
  for (const path of tempPaths) rmSync(path, { recursive: true, force: true });
});
