import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { describe, expect, it } from "vitest";
import { describeDetail, getTransactionSummary } from "./transaction-table";

function makeTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: "txn-1",
    created_at_millis: 1_700_000_000_000,
    effective_at_millis: 1_700_000_000_000,
    type: "purchase",
    customer_type: "user",
    customer_id: "user-1",
    entries: [],
    adjusted_by: [],
    test_mode: false,
    ...overrides,
  } as Transaction;
}

describe("getTransactionSummary — refund rows", () => {
  it("populates customer from transaction-level fields on a test-mode end-now refund row", () => {
    // A test-mode `end_action="now"` refund row's only surviving public entry
    // is a product_revocation, which carries no customer fields. The summary
    // must still resolve the customer from the transaction-level fields.
    const refundRow = makeTransaction({
      id: "refund:sub-start:sub-1:uuid",
      type: "refund",
      customer_type: "team",
      customer_id: "team-42",
      test_mode: true,
      entries: [
        { type: "product_revocation", adjusted_transaction_id: "sub-start:sub-1", adjusted_entry_index: 0, quantity: 1 },
      ],
    });

    const summary = getTransactionSummary(refundRow);
    expect(summary.customerType).toBe("team");
    expect(summary.customerId).toBe("team-42");
    expect(summary.detail).toBe("Product access revoked");
    expect(summary.amountDisplay).toBe("Test mode");
    expect(summary.displayType.label).toBe("Refund");
  });

  it("renders an empty-entries refund row (test-mode end-at-period-end) with customer and detail", () => {
    // An `end_action="at-period-end"` test-mode refund writes a row with no
    // entries at all — it must not render as a fully blank line.
    const emptyRefund = makeTransaction({
      id: "refund:sub-start:sub-2:uuid",
      type: "refund",
      customer_type: "user",
      customer_id: "user-9",
      test_mode: true,
      entries: [],
    });

    const summary = getTransactionSummary(emptyRefund);
    expect(summary.customerType).toBe("user");
    expect(summary.customerId).toBe("user-9");
    expect(summary.detail).toBe("Refund");
    expect(summary.amountDisplay).toBe("Test mode");
  });

  it("describes a money-only refund row as 'Refund' (no product revocation)", () => {
    const moneyRefund = makeTransaction({
      type: "refund",
      entries: [
        {
          type: "money_transfer",
          adjusted_transaction_id: "otp:p1",
          adjusted_entry_index: 0,
          customer_type: "user",
          customer_id: "user-1",
          charged_amount: { USD: "50.00" },
          net_amount: { USD: "50.00" },
        },
      ],
    });
    expect(describeDetail(moneyRefund, "other")).toBe("Refund");
  });
});

describe("getTransactionSummary — non-refund rows still work", () => {
  it("derives customer from transaction-level fields and keeps item-change detail", () => {
    const itemTxn = makeTransaction({
      type: "manual-item-quantity-change",
      customer_type: "team",
      customer_id: "team-7",
      entries: [
        {
          type: "item_quantity_change",
          adjusted_transaction_id: null,
          adjusted_entry_index: null,
          customer_type: "team",
          customer_id: "team-7",
          item_id: "credits",
          quantity: 100,
        },
      ],
    });

    const summary = getTransactionSummary(itemTxn);
    expect(summary.customerType).toBe("team");
    expect(summary.customerId).toBe("team-7");
    expect(summary.detail).toBe("credits (+100)");
  });
});
