/**
 * Type definitions for the payments Bulldozer table algebra pipeline.
 *
 * Data flows: SeedEventsTables -> Events -> Transactions -> TransactionEntries -> CompactedEntries / OwnedProducts / ItemQuantities
 *
 * All field names use camelCase since they're stored as JSONB keys
 * in the BulldozerStorageEngine.
 */

export const PAYMENT_PROVIDERS = ["test_mode", "stripe"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const CUSTOMER_TYPES = ["user", "team", "custom"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "canceled",
  "paused",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "unpaid",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PURCHASE_CREATION_SOURCES = ["PURCHASE_PAGE", "TEST_MODE", "API_GRANT"] as const;
export type PurchaseCreationSource = (typeof PURCHASE_CREATION_SOURCES)[number];

export type DayInterval = [number, "day" | "week" | "month" | "year"];

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type IncludedItemConfig = {
  quantity: number,
  repeat?: DayInterval | "never" | null,
  expires?: "never" | "when-purchase-expires" | "when-repeated" | null,
};

export type ProductSnapshot = {
  displayName?: string | null,
  productLineId?: string | null,
  customerType: CustomerType,
  stackable?: boolean | null,
  serverOnly?: boolean | null,
  freeTrial?: DayInterval | null,
  isAddOnTo?: false | Record<string, true> | null,
  prices: Record<string, Record<string, Json>>,
  includedItems: Record<string, IncludedItemConfig>,
  clientMetadata?: Json | null,
  clientReadOnlyMetadata?: Json | null,
  serverMetadata?: Json | null,
};

export type SubscriptionRow = {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  productId: string | null,
  priceId: string | null,
  product: ProductSnapshot,
  quantity: number,
  stripeSubscriptionId: string | null,
  status: SubscriptionStatus,
  currentPeriodStartMillis: number,
  currentPeriodEndMillis: number,
  cancelAtPeriodEnd: boolean,
  canceledAtMillis: number | null,
  endedAtMillis: number | null,
  refundedAtMillis: number | null,
  productRevokedAtMillis: number | null,
  creationSource: PurchaseCreationSource,
  createdAtMillis: number,
};

export type SubscriptionInvoiceRow = {
  id: string,
  tenancyId: string,
  stripeSubscriptionId: string,
  stripeInvoiceId: string,
  isSubscriptionCreationInvoice: boolean,
  status: string | null,
  amountTotal: number | null,
  hostedInvoiceUrl: string | null,
  createdAtMillis: number,
};

export type OneTimePurchaseRow = {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  productId: string | null,
  priceId: string | null,
  product: ProductSnapshot,
  quantity: number,
  stripePaymentIntentId: string | null,
  revokedAtMillis: number | null,
  refundedAtMillis: number | null,
  creationSource: PurchaseCreationSource,
  createdAtMillis: number,
};

export type ManualItemQuantityChangeRow = {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  itemId: string,
  quantity: number,
  description: string | null,
  expiresAtMillis: number | null,
  createdAtMillis: number,
};

export const TRANSACTION_TYPES = [
  "subscription-renewal",
  "subscription-cancel",
  "subscription-end",
  "subscription-start",
  "item-grant-repeat",
  "one-time-purchase",
  "manual-item-quantity-change",
  "refund",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type ActiveSubscriptionChangeEntryData = {
  type: "active-subscription-change",
  customerType: CustomerType,
  customerId: string,
  subscriptionId: string,
  changeType: "cancel",
};

export type ActiveSubscriptionEndEntryData = {
  type: "active-subscription-end",
  customerType: CustomerType,
  customerId: string,
  subscriptionId: string,
};

export type MoneyTransferEntryData = {
  type: "money-transfer",
  customerType: CustomerType,
  customerId: string,
  chargedAmount: Record<string, string>,
};

export type ActiveSubscriptionStartEntryData = {
  type: "active-subscription-start",
  customerType: CustomerType,
  customerId: string,
  subscriptionId: string,
};

export type ProductGrantEntryData = {
  type: "product-grant",
  customerType: CustomerType,
  customerId: string,
  productId: string | null,
  product: ProductSnapshot,
  quantity: number,
  productLineId: string | null,
  subscriptionId?: string | null,
  oneTimePurchaseId?: string | null,
};

export type ProductRevocationEntryData = {
  type: "product-revocation",
  customerType: CustomerType,
  customerId: string,
  adjustedTransactionId: string,
  adjustedEntryIndex: number,
  quantity: number,
  productId: string | null,
  productLineId: string | null,
};

export type ItemQuantityExpireEntryData = {
  type: "item-quantity-expire",
  customerType: CustomerType,
  customerId: string,
  adjustedTransactionId: string,
  adjustedEntryIndex: number,
  quantity: number,
  itemId: string,
};

export type ItemQuantityChangeEntryData = {
  type: "item-quantity-change",
  customerType: CustomerType,
  customerId: string,
  quantity: number,
  itemId: string,
  expiresWhen: "when-purchase-expires" | "when-repeated" | null,
};

export type CompactedItemQuantityChangeEntryData = {
  type: "compacted-item-quantity-change",
  customerType: CustomerType,
  customerId: string,
  quantity: number,
  itemId: string,
};

export type TransactionEntryData =
  | ActiveSubscriptionChangeEntryData
  | ActiveSubscriptionEndEntryData
  | MoneyTransferEntryData
  | ActiveSubscriptionStartEntryData
  | ProductGrantEntryData
  | ProductRevocationEntryData
  | ItemQuantityExpireEntryData
  | ItemQuantityChangeEntryData;

export type CompactedTransactionEntryData =
  | TransactionEntryData
  | CompactedItemQuantityChangeEntryData;

export const TRANSACTION_ENTRY_TYPES = [
  "active-subscription-change",
  "active-subscription-end",
  "money-transfer",
  "active-subscription-start",
  "product-grant",
  "product-revocation",
  "item-quantity-expire",
  "item-quantity-change",
  "compacted-item-quantity-change",
] as const;
export type TransactionEntryType = (typeof TRANSACTION_ENTRY_TYPES)[number];

export type TransactionRow = {
  txnId: string,
  tenancyId: string,
  effectiveAtMillis: number,
  type: TransactionType,
  entries: TransactionEntryData[],
  customerType: CustomerType,
  customerId: string,
  paymentProvider: PaymentProvider | null,
  createdAtMillis: number,
};

export type ManualTransactionRow = TransactionRow;

type BaseEntryRowFields = {
  index: number,
  txnId: string,
  txnEffectiveAtMillis: number,
  txnCreatedAtMillis: number,
  txnType: TransactionType,
  tenancyId: string,
  paymentProvider: PaymentProvider | null,
};

export type TransactionEntryRow = TransactionEntryData & BaseEntryRowFields;
export type CompactedTransactionEntryRow = CompactedTransactionEntryData & BaseEntryRowFields;

export type EntryBackReference = {
  transactionId: string,
  entryIndex: number,
};

export type SubscriptionRenewalEventRow = {
  subscriptionId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  invoiceId: string,
  chargedAmount: Record<string, string>,
  paymentProvider: PaymentProvider,
  effectiveAtMillis: number,
  createdAtMillis: number,
};

export type SubscriptionCancelEventRow = {
  subscriptionId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  changeType: "cancel",
  paymentProvider: PaymentProvider,
  effectiveAtMillis: number,
  createdAtMillis: number,
};

export type SubscriptionStartEventRow = {
  subscriptionId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  productId: string | null,
  product: ProductSnapshot,
  productLineId: string | null,
  priceId: string | null,
  quantity: number,
  chargedAmount: Record<string, string>,
  itemGrants: Array<{
    itemId: string,
    quantity: number,
    expiresWhen: "when-purchase-expires" | "when-repeated" | null,
  }>,
  paymentProvider: PaymentProvider,
  effectiveAtMillis: number,
  createdAtMillis: number,
};

export type SubscriptionEndEventRow = {
  subscriptionId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  productId: string | null,
  productLineId: string | null,
  quantity: number,
  startProductGrantRef: EntryBackReference,
  itemQuantityChangesToExpire: Array<EntryBackReference & {
    itemId: string,
    quantity: number,
  }>,
  productRevokedAtMillis: number | null,
  paymentProvider: PaymentProvider,
  effectiveAtMillis: number,
  createdAtMillis: number,
};

export type ItemGrantRepeatEventRow = {
  sourceType: "subscription" | "one_time_purchase",
  sourceId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  itemGrants: Array<{
    itemId: string,
    quantity: number,
    expiresWhen: "when-purchase-expires" | "when-repeated" | null,
  }>,
  previousGrantsToExpire: Array<EntryBackReference & {
    itemId: string,
    quantity: number,
  }>,
  paymentProvider: PaymentProvider,
  effectiveAtMillis: number,
  createdAtMillis: number,
};

export type OneTimePurchaseEventRow = {
  purchaseId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  productId: string | null,
  product: ProductSnapshot,
  productLineId: string | null,
  priceId: string | null,
  quantity: number,
  chargedAmount: Record<string, string>,
  itemGrants: Array<{
    itemId: string,
    quantity: number,
    expiresWhen: "when-purchase-expires" | "when-repeated" | null,
  }>,
  paymentProvider: PaymentProvider,
  effectiveAtMillis: number,
  createdAtMillis: number,
};

export type ManualItemQuantityChangeEventRow = {
  changeId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  itemId: string,
  quantity: number,
  effectiveAtMillis: number,
  createdAtMillis: number,
};

export type OwnedProductsRow = {
  txnEffectiveAtMillis: number,
  txnId: string,
  ownedProducts: Record<string, {
    quantity: number,
    product: ProductSnapshot,
    productLineId: string | null,
  }>,
  customerType: CustomerType,
  customerId: string,
  tenancyId: string,
};

export type ItemChangeWithExpiryRow = {
  txnId: string,
  txnEffectiveAtMillis: number,
  customerType: CustomerType,
  customerId: string,
  tenancyId: string,
  itemId: string,
  quantity: number,
  expiresAtMillis: number | null,
};

export type ItemQuantityRow = {
  txnEffectiveAtMillis: number,
  txnId: string,
  itemQuantities: Record<string, number>,
  customerType: CustomerType,
  customerId: string,
  tenancyId: string,
};

export type SubscriptionMapRow = {
  subscriptions: Record<string, SubscriptionRow>,
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
};
