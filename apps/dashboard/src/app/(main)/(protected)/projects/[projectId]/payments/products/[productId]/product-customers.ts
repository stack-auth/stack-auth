import type { Transaction, TransactionEntry } from "@hexclave/shared/dist/interface/crud/transactions";

export function isProductGrantEntry(entry: TransactionEntry): entry is Extract<TransactionEntry, { type: 'product_grant' }> {
  return entry.type === 'product_grant';
}

export type ProductCustomer = {
  customerType: string,
  customerId: string,
  latestGrantMillis: number,
};

/**
 * Collapses a list of transactions into the distinct customers that have been
 * granted a given product, most-recent grant first.
 *
 * Two non-obvious rules, both of which the previous inline implementation got
 * wrong (causing products to show "no customers"):
 *   1. A single transaction can carry multiple `product_grant` entries (e.g. a
 *      plan bought together with an add-on), so we scan *every* grant entry
 *      rather than only the first one — otherwise a product that isn't the
 *      first grant in its transaction is never matched.
 *   2. Each grant carries its own `customer_type`/`customer_id`, so we attribute
 *      the grant to that entry's customer instead of guessing from an arbitrary
 *      entry on the transaction.
 *
 * We intentionally do not restrict by transaction type: any transaction that
 * grants the product (initial purchase, server grant, renewal, ...) attributes
 * the customer, and de-duplication keeps a single row per customer.
 */
export function deriveProductCustomers(transactions: Transaction[], productId: string): ProductCustomer[] {
  const customerMap = new Map<string, ProductCustomer>();

  for (const transaction of transactions) {
    for (const entry of transaction.entries) {
      if (!isProductGrantEntry(entry)) continue;
      if (entry.product_id !== productId) continue;

      const key = `${entry.customer_type}:${entry.customer_id}`;
      const existing = customerMap.get(key);
      if (!existing || transaction.created_at_millis > existing.latestGrantMillis) {
        customerMap.set(key, {
          customerType: entry.customer_type,
          customerId: entry.customer_id,
          latestGrantMillis: transaction.created_at_millis,
        });
      }
    }
  }

  return Array.from(customerMap.values()).sort((a, b) => b.latestGrantMillis - a.latestGrantMillis);
}
