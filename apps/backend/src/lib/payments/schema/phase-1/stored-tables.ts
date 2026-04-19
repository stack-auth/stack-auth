/**
 * Phase 1: StoredTable definitions for the payments pipeline.
 *
 * These are the "seed" tables that mirror Prisma models (plus ManualTransactions
 * which has no Prisma backing). All downstream event, transaction, and query
 * tables are derived from these via Bulldozer table algebra.
 */

import { declareStoredTable } from "@/lib/bulldozer/db/index";
import type {
  ManualItemQuantityChangeRow,
  ManualTransactionRow,
  OneTimePurchaseRow,
  SubscriptionInvoiceRow,
  SubscriptionRow,
} from "../types";

export function createSeedEventsStoredTables() {
  const subscriptions = declareStoredTable<SubscriptionRow>({
    tableId: "payments-subscriptions",
  });

  const subscriptionInvoices = declareStoredTable<SubscriptionInvoiceRow>({
    tableId: "payments-subscription-invoices",
  });

  const oneTimePurchases = declareStoredTable<OneTimePurchaseRow>({
    tableId: "payments-one-time-purchases",
  });

  const manualItemQuantityChanges = declareStoredTable<ManualItemQuantityChangeRow>({
    tableId: "payments-manual-item-quantity-changes",
  });

  const manualTransactions = declareStoredTable<ManualTransactionRow>({
    tableId: "payments-manual-transactions",
  });

  return {
    subscriptions,
    subscriptionInvoices,
    oneTimePurchases,
    manualItemQuantityChanges,
    manualTransactions,
  };
}

export type SeedEventsStoredTables = ReturnType<typeof createSeedEventsStoredTables>;
