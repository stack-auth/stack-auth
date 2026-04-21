/**
 * Tests for the bulldozer dual-write conversion functions and setRow behavior.
 *
 * Verifies that:
 * - Conversion functions produce correct Bulldozer stored table row format
 * - setRow inserts new rows into BulldozerStorageEngine
 * - setRow updates (overwrites) existing rows without creating duplicates
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBulldozerExecutionContext } from "@/lib/bulldozer/db/index";
import { createPaymentsSchema } from "@/lib/payments/schema/index";
import {
  subscriptionToStoredRow,
  subscriptionInvoiceToStoredRow,
  oneTimePurchaseToStoredRow,
  itemQuantityChangeToStoredRow,
} from "@/lib/payments/bulldozer-dual-write";
import { createTestDb, jsonbExpr } from "./test-helpers";

const db = createTestDb();
const schema = createPaymentsSchema();
let executionContext = createBulldozerExecutionContext();

beforeAll(async () => {
  await db.setup();
  for (const table of schema._allTables) {
    await db.runStatements(table.init(executionContext));
  }
}, 60_000);

afterAll(async () => {
  await db.teardown();
});

beforeEach(() => {
  executionContext = createBulldozerExecutionContext();
});

const { runStatements } = db;

async function getStoredRowData(tableId: string, rowId: string): Promise<unknown | null> {
  const sql = db.sql;
  const rows = await sql.unsafe(`
    SELECT "value"->'rowData' AS "rowData"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = ARRAY[
      to_jsonb('table'::text),
      to_jsonb('external:${tableId}'::text),
      to_jsonb('storage'::text),
      to_jsonb('rows'::text),
      to_jsonb('${rowId}'::text)
    ]::jsonb[]
  `);
  return rows.length > 0 ? rows[0].rowData : null;
}

async function countStoredRows(tableId: string): Promise<number> {
  const sql = db.sql;
  const rows = await sql.unsafe(`
    SELECT count(*) AS "cnt"
    FROM "BulldozerStorageEngine"
    WHERE "keyPathParent" = (
      SELECT "keyPath" FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ARRAY[
        to_jsonb('table'::text),
        to_jsonb('external:${tableId}'::text),
        to_jsonb('storage'::text),
        to_jsonb('rows'::text)
      ]::jsonb[]
    )
  `);
  return Number(rows[0].cnt);
}

describe("conversion functions", () => {
  it("subscriptionToStoredRow converts dates to millis and lowercases enums", () => {
    const row = subscriptionToStoredRow({
      id: "sub-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      productId: "prod-1",
      priceId: "price-1",
      product: { displayName: "Test" },
      quantity: 1,
      stripeSubscriptionId: null,
      status: "ACTIVE",
      currentPeriodStart: new Date("2024-01-01T00:00:00Z"),
      currentPeriodEnd: new Date("2024-02-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      refundedAt: null,
      creationSource: "TEST_MODE",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    expect(row.customerType).toBe("user");
    expect(row.status).toBe("active");
    expect(row.currentPeriodStartMillis).toBe(new Date("2024-01-01T00:00:00Z").getTime());
    expect(row.currentPeriodEndMillis).toBe(new Date("2024-02-01T00:00:00Z").getTime());
    expect(row.endedAtMillis).toBeNull();
    expect(row.creationSource).toBe("TEST_MODE");
  });

  it("oneTimePurchaseToStoredRow handles revokedAt and refundedAt", () => {
    const row = oneTimePurchaseToStoredRow({
      id: "otp-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "TEAM",
      productId: null,
      priceId: null,
      product: {},
      quantity: 2,
      stripePaymentIntentId: "pi-123",
      revokedAt: new Date("2024-06-01T00:00:00Z"),
      refundedAt: null,
      creationSource: "PURCHASE_PAGE",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    expect(row.customerType).toBe("team");
    expect(row.revokedAtMillis).toBe(new Date("2024-06-01T00:00:00Z").getTime());
    expect(row.refundedAtMillis).toBeNull();
  });

  it("itemQuantityChangeToStoredRow omits paymentProvider", () => {
    const row = itemQuantityChangeToStoredRow({
      id: "iqc-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      itemId: "credits",
      quantity: 50,
      description: "bonus grant",
      expiresAt: null,
      createdAt: new Date("2024-03-15T00:00:00Z"),
    });

    expect(row).not.toHaveProperty("paymentProvider");
    expect(row.description).toBe("bonus grant");
    expect(row.expiresAtMillis).toBeNull();
  });
});


describe("setRow via dual-write conversion", () => {
  it("inserts a new subscription row into BulldozerStorageEngine", async () => {
    const rowData = subscriptionToStoredRow({
      id: "dw-sub-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      productId: "prod-1",
      priceId: "p1",
      product: { displayName: "Plan A", customerType: "user", prices: "include-by-default", includedItems: {} },
      quantity: 1,
      stripeSubscriptionId: null,
      status: "active",
      currentPeriodStart: new Date("2024-01-01T00:00:00Z"),
      currentPeriodEnd: new Date("2024-02-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      refundedAt: null,
      creationSource: "TEST_MODE",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    await runStatements(schema.subscriptions.setRow(executionContext, "dw-sub-1", jsonbExpr(rowData)));

    const stored = await getStoredRowData("payments-subscriptions", "dw-sub-1");
    expect(stored).not.toBeNull();
    expect((stored as any).id).toBe("dw-sub-1");
    expect((stored as any).status).toBe("active");
    expect((stored as any).customerType).toBe("user");
  });

  it("overwrites an existing subscription row (no duplicates)", { timeout: 60_000 }, async () => {
    // Seed the initial row so this test is self-contained
    const seedRowData = subscriptionToStoredRow({
      id: "dw-sub-overwrite",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      productId: "prod-1",
      priceId: "p1",
      product: { displayName: "Plan A", customerType: "user", prices: "include-by-default", includedItems: {} },
      quantity: 1,
      stripeSubscriptionId: null,
      status: "active",
      currentPeriodStart: new Date("2024-01-01T00:00:00Z"),
      currentPeriodEnd: new Date("2024-02-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      refundedAt: null,
      creationSource: "TEST_MODE",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });
    await runStatements(schema.subscriptions.setRow(executionContext, "dw-sub-overwrite", jsonbExpr(seedRowData)));
    const countBefore = await countStoredRows("payments-subscriptions");

    const updatedRowData = subscriptionToStoredRow({
      id: "dw-sub-overwrite",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      productId: "prod-1",
      priceId: "p1",
      product: { displayName: "Plan A", customerType: "user", prices: "include-by-default", includedItems: {} },
      quantity: 1,
      stripeSubscriptionId: null,
      status: "canceled",
      currentPeriodStart: new Date("2024-01-01T00:00:00Z"),
      currentPeriodEnd: new Date("2024-01-15T00:00:00Z"),
      cancelAtPeriodEnd: true,
      canceledAt: new Date("2024-01-10T00:00:00Z"),
      endedAt: new Date("2024-01-15T00:00:00Z"),
      refundedAt: null,
      creationSource: "TEST_MODE",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    await runStatements(schema.subscriptions.setRow(executionContext, "dw-sub-overwrite", jsonbExpr(updatedRowData)));

    const countAfter = await countStoredRows("payments-subscriptions");
    expect(countAfter).toBe(countBefore);

    const stored = await getStoredRowData("payments-subscriptions", "dw-sub-overwrite") as any;
    expect(stored.status).toBe("canceled");
    expect(stored.cancelAtPeriodEnd).toBe(true);
    expect(stored.endedAtMillis).toBe(new Date("2024-01-15T00:00:00Z").getTime());
  });

  it("inserts a new OTP row", async () => {
    const rowData = oneTimePurchaseToStoredRow({
      id: "dw-otp-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      productId: "prod-pack",
      priceId: "p1",
      product: { displayName: "Pack", customerType: "user", prices: { p1: { USD: "10" } }, includedItems: {} },
      quantity: 1,
      stripePaymentIntentId: null,
      revokedAt: null,
      refundedAt: null,
      creationSource: "TEST_MODE",
      createdAt: new Date("2024-02-01T00:00:00Z"),
    });

    await runStatements(schema.oneTimePurchases.setRow(executionContext, "dw-otp-1", jsonbExpr(rowData)));

    const stored = await getStoredRowData("payments-one-time-purchases", "dw-otp-1") as any;
    expect(stored).not.toBeNull();
    expect(stored.id).toBe("dw-otp-1");
    expect(stored.refundedAtMillis).toBeNull();
  });

  it("overwrites OTP row on refund (refundedAt set)", async () => {
    // Seed the initial row so this test is self-contained
    const seedRowData = oneTimePurchaseToStoredRow({
      id: "dw-otp-overwrite",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      productId: "prod-pack",
      priceId: "p1",
      product: { displayName: "Pack", customerType: "user", prices: { p1: { USD: "10" } }, includedItems: {} },
      quantity: 1,
      stripePaymentIntentId: null,
      revokedAt: null,
      refundedAt: null,
      creationSource: "TEST_MODE",
      createdAt: new Date("2024-02-01T00:00:00Z"),
    });
    await runStatements(schema.oneTimePurchases.setRow(executionContext, "dw-otp-overwrite", jsonbExpr(seedRowData)));
    const countBefore = await countStoredRows("payments-one-time-purchases");

    const refundedRowData = oneTimePurchaseToStoredRow({
      id: "dw-otp-overwrite",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      productId: "prod-pack",
      priceId: "p1",
      product: { displayName: "Pack", customerType: "user", prices: { p1: { USD: "10" } }, includedItems: {} },
      quantity: 1,
      stripePaymentIntentId: null,
      revokedAt: null,
      refundedAt: new Date("2024-03-01T00:00:00Z"),
      creationSource: "TEST_MODE",
      createdAt: new Date("2024-02-01T00:00:00Z"),
    });

    await runStatements(schema.oneTimePurchases.setRow(executionContext, "dw-otp-overwrite", jsonbExpr(refundedRowData)));

    const countAfter = await countStoredRows("payments-one-time-purchases");
    expect(countAfter).toBe(countBefore);

    const stored = await getStoredRowData("payments-one-time-purchases", "dw-otp-overwrite") as any;
    expect(stored.refundedAtMillis).toBe(new Date("2024-03-01T00:00:00Z").getTime());
  });

  it("inserts an item quantity change row", async () => {
    const rowData = itemQuantityChangeToStoredRow({
      id: "dw-iqc-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "USER",
      itemId: "credits",
      quantity: 100,
      description: "initial grant",
      expiresAt: null,
      createdAt: new Date("2024-04-01T00:00:00Z"),
    });

    await runStatements(schema.manualItemQuantityChanges.setRow(executionContext, "dw-iqc-1", jsonbExpr(rowData)));

    const stored = await getStoredRowData("payments-manual-item-quantity-changes", "dw-iqc-1") as any;
    expect(stored).not.toBeNull();
    expect(stored.itemId).toBe("credits");
    expect(stored.quantity).toBe(100);
    expect(stored.description).toBe("initial grant");
  });

  it("inserts a subscription invoice row", async () => {
    const rowData = subscriptionInvoiceToStoredRow({
      id: "dw-inv-1",
      tenancyId: "t1",
      stripeSubscriptionId: "stripe-sub-123",
      stripeInvoiceId: "stripe-inv-456",
      isSubscriptionCreationInvoice: true,
      status: "paid",
      amountTotal: 1000,
      hostedInvoiceUrl: "https://example.com/invoice",
      createdAt: new Date("2024-05-01T00:00:00Z"),
    });

    await runStatements(schema.subscriptionInvoices.setRow(executionContext, "dw-inv-1", jsonbExpr(rowData)));

    const stored = await getStoredRowData("payments-subscription-invoices", "dw-inv-1") as any;
    expect(stored).not.toBeNull();
    expect(stored.stripeInvoiceId).toBe("stripe-inv-456");
    expect(stored.isSubscriptionCreationInvoice).toBe(true);
    expect(stored.amountTotal).toBe(1000);
  });
});
