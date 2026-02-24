import type { CustomerType, OneTimePurchase, Subscription, SubscriptionInvoice } from "@/generated/prisma/client";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";

export type FullTransactionFilter = {
  customerType?: "user" | "team" | "custom",
  customerId?: string,
  type?: Transaction["type"],
};

export type TransactionOrderBy = "createdAt-desc";
export type RepeatInterval = [number, "minute" | "hour" | "day" | "week" | "month" | "year"];

export type GrantSlice = {
  txId: string,
  entryIndex: number,
  quantity: number,
};

export type ActiveItemState = {
  expires: string,
  repeat: RepeatInterval | null,
  grants: GrantSlice[],
};

export type ActivePurchaseState = {
  sourceKind: "subscription" | "one-time-purchase",
  sourceId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
  testMode: boolean,
  quantity: number,
  product: any,
  productGrantPointer: { txId: string, entryIndex: number },
  itemStates: Map<string, ActiveItemState>,
};

export type ActiveDefaultItemState = {
  quantity: number,
  repeat: RepeatInterval | null,
  expiresWhenRepeated: boolean,
  sourceTxId: string,
  grants: GrantSlice[],
};

export type SeedEvent =
  | { kind: "default-products-change-event", at: number, snapshotRow: { id: string, snapshot: unknown, createdAt: Date } }
  | { kind: "subscription-start-event", at: number, subscription: Subscription }
  | { kind: "subscription-renewal-event", at: number, invoice: SubscriptionInvoice & { subscription: Subscription } }
  | { kind: "subscription-end-event", at: number, subscription: Subscription }
  | { kind: "subscription-cancel-event", at: number, subscription: Subscription }
  | { kind: "subscription-refund-event", at: number, subscription: Subscription }
  | { kind: "one-time-purchase-event", at: number, purchase: OneTimePurchase }
  | { kind: "one-time-purchase-refund-event", at: number, purchase: OneTimePurchase }
  | {
    kind: "item-quantity-change-event",
    at: number,
    change: { id: string, createdAt: Date, customerId: string, customerType: CustomerType, itemId: string, quantity: number },
  }
  | {
    kind: "default-product-item-grant-repeat-event",
    at: number,
    repeat: RepeatInterval,
    causedByTxId: string,
    items: Array<{
      productId: string,
      itemId: string,
      quantity: number,
      expiresWhenRepeated: boolean,
      adjustedTxId: string,
      adjustedEntryIndex: number,
    }>,
  }
  | {
    kind: "item-grant-repeat-event",
    at: number,
    repeat: RepeatInterval,
    sourceKey: string,
    causedByTxId: string,
    items: Array<{
      itemId: string,
      quantity: number,
      expiresWhenRepeated: boolean,
      adjustedTxId: string,
      adjustedEntryIndex: number,
    }>,
  };
