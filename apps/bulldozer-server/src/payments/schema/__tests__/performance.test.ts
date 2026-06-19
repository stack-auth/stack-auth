import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBulldozerExecutionContext, type BulldozerExecutionContext } from "../../../lib/bulldozer/db";
import { createPaymentsSchema } from "../index";
import type { ProductSnapshot, SubscriptionRow } from "../types";
import { createTestDb, jsonbExpr } from "./test-helpers";

type Metric = { name: string, count: number, elapsedMs: number, opsPerSecond: number };
type SqlQuery = ReturnType<ReturnType<typeof createPaymentsSchema>["transactions"]["listRowsInGroup"]>;
type TableWithListRows = {
  listRowsInGroup(ctx: BulldozerExecutionContext, opts: {
    groupKey?: { type: "expression", sql: string },
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }): SqlQuery,
};

const USER_COUNT = 6;
const ITEM_UPDATES_PER_USER = 10;
const PREFILL_USER_COUNT = 200;
const PREFILL_ITEM_UPDATES_PER_USER = 4;
const PREFILL_SOURCE_FACT_COUNT = PREFILL_USER_COUNT * (2 + PREFILL_ITEM_UPDATES_PER_USER);
const MONTH_MS = 2_592_000_000;
const schema = createPaymentsSchema();
const db = createTestDb();
let executionContext = createBulldozerExecutionContext();

const product = (includedItems: ProductSnapshot["includedItems"]): ProductSnapshot => ({
  displayName: "Perf Product",
  customerType: "user",
  productLineId: "line-perf",
  prices: { p1: { USD: "10.00" } },
  includedItems,
});
const customerId = (namespace: string, index: number) => `${namespace}user-${index}`;
const subscription = (index: number, namespace = ""): SubscriptionRow => ({
  id: `${namespace}sub-${index}`,
  tenancyId: "t1",
  customerId: customerId(namespace, index),
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
const oneTimePurchase = (index: number, namespace = "") => ({
  id: `${namespace}otp-${index}`,
  tenancyId: "t1",
  customerId: customerId(namespace, index),
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
const manualItemQuantityChange = (userIndex: number, updateIndex: number, namespace = "") => ({
  id: `${namespace}miqc-${userIndex}-${updateIndex}`,
  tenancyId: "t1",
  customerId: customerId(namespace, userIndex),
  customerType: "user",
  itemId: updateIndex % 2 === 0 ? "credits" : "coins",
  quantity: updateIndex % 3 === 0 ? -1 : 3,
  description: null,
  expiresAtMillis: null,
  createdAtMillis: 10_000 + userIndex * 1_000 + updateIndex,
});
const groupKeyExpression = (index: number) => {
  const groupKey = JSON.stringify({ tenancyId: "t1", customerType: "user", customerId: customerId("", index) }).replaceAll("'", "''");
  return { type: "expression" as const, sql: `'${groupKey}'::jsonb` };
};
const measure = async <T>(metrics: Metric[], name: string, count: number, operation: () => Promise<T>) => {
  const start = performance.now();
  const value = await operation();
  const elapsedMs = performance.now() - start;
  const opsPerSecond = count / elapsedMs * 1_000;
  metrics.push({ name, count, elapsedMs, opsPerSecond });
  process.stdout.write(`\n[bulldozer-payments-schema-perf-server] ${name}: ${elapsedMs.toFixed(1)} ms (${count} ops, ${opsPerSecond.toFixed(2)} ops/s)\n`);
  return value;
};
const readRowsForCustomer = async (table: TableWithListRows, customerIndex: number) => {
  return await db.readRows(table.listRowsInGroup(executionContext, {
    groupKey: groupKeyExpression(customerIndex),
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));
};

describe.sequential("payments schema performance (postgres bulldozer-server)", () => {
  beforeAll(async () => {
    await db.setup();
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("runs the comparable schema workload", { timeout: 300_000 }, async () => {
    const metrics: Metric[] = [];
    executionContext = createBulldozerExecutionContext();

    await measure(metrics, "initialize schema", 1, async () => {
      for (const table of schema._allTables) await db.runStatements(table.init(executionContext));
    });

    await measure(metrics, "prefill baseline rows", PREFILL_SOURCE_FACT_COUNT, async () => {
      for (let i = 0; i < PREFILL_USER_COUNT; i++) {
        await db.runStatements(schema.subscriptions.setRow(executionContext, `prefill-sub-${i}`, jsonbExpr(subscription(i, "prefill-"))));
        await db.runStatements(schema.oneTimePurchases.setRow(executionContext, `prefill-otp-${i}`, jsonbExpr(oneTimePurchase(i, "prefill-"))));
        for (let updateIndex = 0; updateIndex < PREFILL_ITEM_UPDATES_PER_USER; updateIndex++) {
          await db.runStatements(schema.manualItemQuantityChanges.setRow(executionContext, `prefill-miqc-${i}-${updateIndex}`, jsonbExpr(manualItemQuantityChange(i, updateIndex, "prefill-"))));
        }
      }
    });

    await measure(metrics, "write subscriptions", USER_COUNT, async () => {
      for (let i = 0; i < USER_COUNT; i++) {
        await db.runStatements(schema.subscriptions.setRow(executionContext, `sub-${i}`, jsonbExpr(subscription(i))));
      }
    });

    await measure(metrics, "write one-time purchases", USER_COUNT, async () => {
      for (let i = 0; i < USER_COUNT; i++) {
        await db.runStatements(schema.oneTimePurchases.setRow(executionContext, `otp-${i}`, jsonbExpr(oneTimePurchase(i))));
      }
    });

    await measure(metrics, "write manual item quantity changes", USER_COUNT * ITEM_UPDATES_PER_USER, async () => {
      for (let userIndex = 0; userIndex < USER_COUNT; userIndex++) {
        for (let updateIndex = 0; updateIndex < ITEM_UPDATES_PER_USER; updateIndex++) {
          await db.runStatements(schema.manualItemQuantityChanges.setRow(executionContext, `miqc-${userIndex}-${updateIndex}`, jsonbExpr(manualItemQuantityChange(userIndex, updateIndex))));
        }
      }
    });

    await measure(metrics, "read owned products", USER_COUNT, async () => {
      for (let i = 0; i < USER_COUNT; i++) await readRowsForCustomer(schema.ownedProducts, i);
    });
    await measure(metrics, "read item quantities", USER_COUNT * 3, async () => {
      for (let i = 0; i < USER_COUNT; i++) {
        for (const _itemId of ["credits", "coins", "seats"]) await readRowsForCustomer(schema.itemQuantities, i);
      }
    });
    const transactionRows = await measure(metrics, "read transactions", USER_COUNT, async () => {
      let count = 0;
      for (let i = 0; i < USER_COUNT; i++) count += (await readRowsForCustomer(schema.transactions, i)).length;
      return count;
    });

    expect(transactionRows).toBe(USER_COUNT * (2 + ITEM_UPDATES_PER_USER));
    const summary = { engine: "bulldozer-server", backend: "postgres", users: USER_COUNT, prefillUsers: PREFILL_USER_COUNT, prefillSourceFacts: PREFILL_SOURCE_FACT_COUNT, transactions: transactionRows, metrics };
    writeFileSync("../../bulldozer-payments-schema-perf-server.untracked.json", JSON.stringify(summary, null, 2));
    process.stdout.write(`\n[bulldozer-payments-schema-perf-server] summary=${JSON.stringify(summary)}\n`);
  });
});
