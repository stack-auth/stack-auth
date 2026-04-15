/**
 * Phase 2→3 integration tests.
 *
 * Tests the compacted-entries → owned-products / item-quantities pipeline
 * WITHOUT TimeFold dependency. Uses:
 *   - OneTimePurchases (stored table → event, no TimeFold)
 *   - ManualTransactions type="refund" (passed through directly)
 *   - ManualItemQuantityChanges (stored table → event, no TimeFold)
 *
 * Each test uses a unique customerId for natural isolation via the
 * per-customer LFold grouping — no beforeEach reinit needed.
 */

import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { createPaymentsSchema } from "../index";
import { createTestDb, jsonbExpr } from "./test-helpers";

describe.sequential("payments schema integration phase 2→3 (real postgres)", () => {
  const db = createTestDb();
  const { runStatements, readRows } = db;
  const schema = createPaymentsSchema();

  const getRowsForTenancy = async (table: { listRowsInGroup: (opts: any) => any }, tenancyId: string) => {
    const rows = await readRows(table.listRowsInGroup({ start: "start", end: "end", startInclusive: true, endInclusive: true }));
    return rows.map((r: any) => r.rowdata).filter((r: any) => r.tenancyId === tenancyId);
  };

  const makeOtp = (id: string, tenancyId: string, customerId: string, productId: string, opts: {
    displayName?: string,
    quantity?: number,
    includedItems?: Record<string, unknown>,
    createdAtMillis: number,
  }) => schema.oneTimePurchases.setRow(id, jsonbExpr({
    id,
    tenancyId,
    customerId,
    customerType: "user",
    productId,
    priceId: `price-${productId}`,
    product: {
      displayName: opts.displayName ?? productId,
      customerType: "user",
      productLineId: `line-${productId}`,
      prices: { [`price-${productId}`]: { USD: "10" } },
      includedItems: opts.includedItems ?? {},
    },
    quantity: opts.quantity ?? 1,
    stripePaymentIntentId: `pi-${id}`,
    revokedAtMillis: null,
    refundedAtMillis: null,
    creationSource: "PURCHASE_PAGE",
    createdAtMillis: opts.createdAtMillis,
  }));

  const makeRefund = (id: string, tenancyId: string, customerId: string, entries: unknown[], effectiveAtMillis: number) =>
    schema.manualTransactions.setRow(id, jsonbExpr({
      txnId: `refund:${id}`,
      tenancyId,
      type: "refund",
      effectiveAtMillis,
      customerType: "user",
      customerId,
      paymentProvider: "stripe",
      createdAtMillis: effectiveAtMillis,
      entries,
    }));

  beforeAll(async () => {
    await db.setup();
    for (const table of schema._allTables) {
      await runStatements(table.init());
    }
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });


  // ============================================================
  // Owned Products
  // ============================================================

  it("should show a product as owned after an OTP grant", async () => {
    const t = "t1";
    await runStatements(makeOtp("otp-grant", t, "u1", "prod-A", {
      displayName: "Starter Pack",
      createdAtMillis: 1000,
    }));

    const rows = await getRowsForTenancy(schema.ownedProducts, t);
    const row = rows.find((r: any) => r.txnId === "otp:otp-grant");
    expect(row).toBeDefined();
    expect(row.ownedProducts["prod-A"].quantity).toBe(1);
    expect(row.ownedProducts["prod-A"].product.displayName).toBe("Starter Pack");
    expect(row.ownedProducts["prod-A"].productLineId).toBe("line-prod-A");
  });

  it("should show multiple products independently", async () => {
    const t = "t1";
    await runStatements(makeOtp("otp-multi-A", t, "u1", "prod-M1", { createdAtMillis: 1000 }));
    await runStatements(makeOtp("otp-multi-B", t, "u1", "prod-M2", { createdAtMillis: 1100 }));

    const rows = await getRowsForTenancy(schema.ownedProducts, t);
    const latest = rows
      .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis)
      .at(-1);
    expect(latest.ownedProducts["prod-M1"]?.quantity).toBe(1);
    expect(latest.ownedProducts["prod-M2"]?.quantity).toBe(1);
  });

  it("should revoke only the targeted product, leaving others intact", async () => {
    const t = "t1";
    await runStatements(makeOtp("otp-rev-A", t, "u1", "prod-R1", { createdAtMillis: 1000 }));
    await runStatements(makeOtp("otp-rev-B", t, "u1", "prod-R2", { createdAtMillis: 1100 }));
    await runStatements(makeRefund("revoke-A", t, "u1", [{
      type: "product-revocation",
      customerType: "user",
      customerId: "u1",
      adjustedTransactionId: "otp:otp-rev-A",
      adjustedEntryIndex: 0,
      quantity: 1,
      productId: "prod-R1",
      productLineId: "line-prod-R1",
    }], 2000));

    const rows = await getRowsForTenancy(schema.ownedProducts, t);
    const afterRevoke = rows.find((r: any) => r.txnId === "refund:revoke-A");
    expect(afterRevoke).toBeDefined();
    expect(afterRevoke.ownedProducts["prod-R1"].quantity).toBe(0);
    expect(afterRevoke.ownedProducts["prod-R2"].quantity).toBe(1);
  });

  it("should key inline products (null productId) under '__null__' in ownedProducts", async () => {
    const t = "t1";
    await runStatements(schema.oneTimePurchases.setRow("otp-inline", jsonbExpr({
      id: "otp-inline",
      tenancyId: t,
      customerId: "u1",
      customerType: "user",
      productId: null,
      priceId: null,
      product: {
        displayName: "Inline Product",
        customerType: "user",
        prices: {},
        includedItems: {},
      },
      quantity: 1,
      stripePaymentIntentId: null,
      revokedAtMillis: null,
      refundedAtMillis: null,
      creationSource: "TEST_MODE",
      createdAtMillis: 500,
    })));

    const rows = await getRowsForTenancy(schema.ownedProducts, t);
    const row = rows.find((r: any) => r.txnId === "otp:otp-inline");
    expect(row).toBeDefined();
    expect(row.ownedProducts["__null__"]).toBeDefined();
    expect(row.ownedProducts["__null__"].quantity).toBe(1);
    expect(row.ownedProducts["__null__"].product.displayName).toBe("Inline Product");
  });

  it("should partially revoke: grant qty=3, revoke qty=1 → qty=2", async () => {
    const t = "t1";
    await runStatements(makeOtp("otp-partial", t, "u1", "prod-C", {
      quantity: 3,
      createdAtMillis: 1000,
    }));
    await runStatements(makeRefund("revoke-partial", t, "u1", [{
      type: "product-revocation",
      customerType: "user",
      customerId: "u1",
      adjustedTransactionId: "otp:otp-partial",
      adjustedEntryIndex: 0,
      quantity: 1,
      productId: "prod-C",
      productLineId: "line-prod-C",
    }], 2000));

    const rows = await getRowsForTenancy(schema.ownedProducts, t);
    const after = rows.find((r: any) => r.txnId === "refund:revoke-partial");
    expect(after).toBeDefined();
    expect(after.ownedProducts["prod-C"].quantity).toBe(2);
  });

  it("should cap over-revocation at 0", async () => {
    const t = "t1";
    await runStatements(makeOtp("otp-over", t, "u1", "prod-D", { createdAtMillis: 1000 }));
    await runStatements(makeRefund("revoke-over", t, "u1", [{
      type: "product-revocation",
      customerType: "user",
      customerId: "u1",
      adjustedTransactionId: "otp:otp-over",
      adjustedEntryIndex: 0,
      quantity: 5,
      productId: "prod-D",
      productLineId: "line-prod-D",
    }], 2000));

    const rows = await getRowsForTenancy(schema.ownedProducts, t);
    const after = rows.find((r: any) => r.txnId === "refund:revoke-over");
    expect(after).toBeDefined();
    expect(after.ownedProducts["prod-D"].quantity).toBe(0);
  });

  it("should accumulate multiple grants of the same product", async () => {
    const t = "t1";
    await runStatements(makeOtp("otp-acc-1", t, "u1", "prod-E", { createdAtMillis: 1000 }));
    await runStatements(makeOtp("otp-acc-2", t, "u1", "prod-E", { createdAtMillis: 1100 }));

    const rows = await getRowsForTenancy(schema.ownedProducts, t);
    const after = rows.find((r: any) => r.txnId === "otp:otp-acc-2");
    expect(after).toBeDefined();
    expect(after.ownedProducts["prod-E"].quantity).toBe(2);
  });


  // ============================================================
  // Item Quantities
  // ============================================================

  it("should show item quantities from OTP grants", async () => {
    const t = "t1";
    const item = `tokens-${t}`;
    await runStatements(makeOtp(`otp-iq-${t}`, t, "u1", "prod-tokens", {
      includedItems: { [item]: { quantity: 100, expires: "never" } },
      createdAtMillis: 1000,
    }));

    const rows = await getRowsForTenancy(schema.itemQuantities, t);
    expect(rows.length).toBe(1);
    expect(rows[0].itemQuantities[item]).toBe(100);
  });

  it("should accumulate manual item changes with OTP grants", async () => {
    const t = "t1";
    const item = `credits-${t}`;
    await runStatements(makeOtp(`otp-${t}`, t, "u1", "prod-credits", {
      includedItems: { [item]: { quantity: 100, expires: "never" } },
      createdAtMillis: 1000,
    }));
    await runStatements(schema.manualItemQuantityChanges.setRow(`iqc-${t}`, jsonbExpr({
      id: `iqc-${t}`,
      tenancyId: t,
      customerId: "u1",
      customerType: "user",
      itemId: item,
      quantity: -30,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 1100,
    })));

    const rows = (await getRowsForTenancy(schema.itemQuantities, t))
      .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);
    expect(rows.at(-1).itemQuantities[item]).toBe(70);
  });

  it("should track different items independently", async () => {
    const t = "t1";
    const itemA = `coins-${t}`;
    const itemB = `gems-${t}`;
    await runStatements(makeOtp(`otp-a-${t}`, t, "u1", "prod-coins", {
      includedItems: { [itemA]: { quantity: 100, expires: "never" } },
      createdAtMillis: 1000,
    }));
    await runStatements(makeOtp(`otp-b-${t}`, t, "u1", "prod-gems", {
      includedItems: { [itemB]: { quantity: 50, expires: "never" } },
      createdAtMillis: 1100,
    }));

    const rows = (await getRowsForTenancy(schema.itemQuantities, t))
      .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);
    expect(rows.at(-1).itemQuantities[itemA]).toBe(100);
    expect(rows.at(-1).itemQuantities[itemB]).toBe(50);
  });

  it("should not compact items across different customers", async () => {
    // Two customers both get 100 coins (same itemId) via separate OTPs.
    // Each customer then spends 30. With correct per-customer compaction,
    // each customer's compacted entry should be 70. With broken cross-customer
    // compaction, they'd be merged into a single entry of 140.
    const t = "t1";
    await runStatements(makeOtp("otp-iso-c1", t, "customer-A", "prod-coins-iso", {
      includedItems: { coins: { quantity: 100, expires: "never" } },
      createdAtMillis: 1000,
    }));
    await runStatements(makeOtp("otp-iso-c2", t, "customer-B", "prod-coins-iso", {
      includedItems: { coins: { quantity: 100, expires: "never" } },
      createdAtMillis: 1000,
    }));
    await runStatements(schema.manualItemQuantityChanges.setRow("iqc-iso-c1", jsonbExpr({
      id: "iqc-iso-c1",
      tenancyId: t,
      customerId: "customer-A",
      customerType: "user",
      itemId: "coins",
      quantity: -30,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 1100,
    })));
    await runStatements(schema.manualItemQuantityChanges.setRow("iqc-iso-c2", jsonbExpr({
      id: "iqc-iso-c2",
      tenancyId: t,
      customerId: "customer-B",
      customerType: "user",
      itemId: "coins",
      quantity: -30,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 1100,
    })));

    const allRows = await getRowsForTenancy(schema.itemQuantities, t);
    const customerA = allRows.filter((r: any) => r.customerId === "customer-A");
    const customerB = allRows.filter((r: any) => r.customerId === "customer-B");

    const latestA = customerA.sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis).at(-1);
    const latestB = customerB.sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis).at(-1);

    expect(latestA).toBeDefined();
    expect(latestB).toBeDefined();
    expect(latestA.itemQuantities.coins).toBe(70);
    expect(latestB.itemQuantities.coins).toBe(70);
  });
});
