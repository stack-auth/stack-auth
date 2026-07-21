import type { Transaction, TransactionEntry } from "@hexclave/shared/dist/interface/crud/transactions";
import { describe, expect, it } from "vitest";
import { deriveProductCustomers } from "./product-customers";

function grant(overrides: Partial<Extract<TransactionEntry, { type: 'product_grant' }>>): TransactionEntry {
  return {
    type: 'product_grant',
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: 'user',
    customer_id: 'u1',
    product_id: 'pro',
    product: {
      display_name: 'Pro',
      customer_type: 'user',
      stackable: false,
      server_only: false,
      prices: {},
      included_items: {},
      client_metadata: null,
      client_read_only_metadata: null,
      server_metadata: null,
    },
    price_id: 'monthly',
    quantity: 1,
    ...overrides,
  } as TransactionEntry;
}

function transaction(overrides: Partial<Transaction> & { entries: TransactionEntry[] }): Transaction {
  return {
    id: 't1',
    created_at_millis: 1_000,
    effective_at_millis: 1_000,
    type: 'purchase',
    customer_type: 'user',
    customer_id: 'u1',
    adjusted_by: [],
    test_mode: false,
    ...overrides,
  } as Transaction;
}

describe("deriveProductCustomers", () => {
  it("attributes a customer whose product is not the first grant in the transaction", () => {
    // A single purchase that grants a base plan AND an add-on. The target
    // product ("extra_seats") is the *second* grant. The old implementation only
    // inspected the first grant and dropped this customer entirely.
    const tx = transaction({
      id: 'bundle',
      customer_type: 'team',
      customer_id: 'team1',
      entries: [
        grant({ product_id: 'team_pro', customer_type: 'team', customer_id: 'team1' }),
        grant({ product_id: 'extra_seats', customer_type: 'team', customer_id: 'team1' }),
      ],
    });

    expect(deriveProductCustomers([tx], 'extra_seats')).toEqual([
      { customerType: 'team', customerId: 'team1', latestGrantMillis: 1_000 },
    ]);
  });

  it("attributes each grant to the customer on the grant entry, not an arbitrary entry", () => {
    // Defensive: even if entries carry mixed customers, the grant's own customer
    // is used rather than the first entry that happens to have customer fields.
    const tx = transaction({
      id: 'mixed',
      entries: [
        { ...grant({ product_id: 'other', customer_type: 'user', customer_id: 'u_other' }) },
        grant({ product_id: 'growth', customer_type: 'team', customer_id: 'team_growth' }),
      ],
    });

    expect(deriveProductCustomers([tx], 'growth')).toEqual([
      { customerType: 'team', customerId: 'team_growth', latestGrantMillis: 1_000 },
    ]);
  });

  it("de-duplicates a customer across transactions, keeping the latest grant", () => {
    const older = transaction({ id: 'a', created_at_millis: 1_000, entries: [grant({ product_id: 'pro' })] });
    const newer = transaction({ id: 'b', created_at_millis: 5_000, type: 'subscription-renewal', entries: [grant({ product_id: 'pro' })] });

    const result = deriveProductCustomers([older, newer], 'pro');
    expect(result).toEqual([
      { customerType: 'user', customerId: 'u1', latestGrantMillis: 5_000 },
    ]);
  });

  it("sorts distinct customers by most recent grant first", () => {
    const txs = [
      transaction({ id: 'a', created_at_millis: 1_000, customer_id: 'u1', entries: [grant({ customer_id: 'u1' })] }),
      transaction({ id: 'b', created_at_millis: 9_000, customer_id: 'u2', entries: [grant({ customer_id: 'u2' })] }),
      transaction({ id: 'c', created_at_millis: 5_000, customer_id: 'u3', entries: [grant({ customer_id: 'u3' })] }),
    ];

    expect(deriveProductCustomers(txs, 'pro').map(c => c.customerId)).toEqual(['u2', 'u3', 'u1']);
  });

  it("ignores transactions that do not grant the product", () => {
    const tx = transaction({ id: 'a', entries: [grant({ product_id: 'something_else' })] });
    expect(deriveProductCustomers([tx], 'pro')).toEqual([]);
  });
});
