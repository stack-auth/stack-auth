import type { ItemQuantityChange, OneTimePurchase, Subscription, SubscriptionInvoice } from "@prisma/client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { SUPPORTED_CURRENCIES, type Currency } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { typedToLowercase } from "@stackframe/stack-shared/dist/utils/strings";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { InferType } from "yup";
import { productToInlineProduct } from "@/lib/payments";

type SelectedPriceMetadata = {
  interval?: unknown,
};

type SelectedPrice = Record<string, unknown> & SelectedPriceMetadata;

type ProductPriceEntryExtras = {
  serverOnly?: unknown,
  freeTrial?: unknown,
};

type ProductPriceEntry = SelectedPrice & ProductPriceEntryExtras;

export type ProductWithPrices = {
  displayName?: string,
  prices?: Record<string, ProductPriceEntry> | "include-by-default",
} | null | undefined;

type ProductSnapshot = (TransactionEntry & { type: "product_grant" })["product"];

const REFUND_TRANSACTION_SUFFIX = ":refund";

export function resolveSelectedPriceFromProduct(product: ProductWithPrices, priceId?: string | null): SelectedPrice | null {
  if (!product) return null;
  if (!priceId) return null;
  const prices = product.prices;
  if (!prices || prices === "include-by-default") return null;
  const selected = prices[priceId as keyof typeof prices] as ProductPriceEntry | undefined;
  if (!selected) return null;
  const { serverOnly: _serverOnly, freeTrial: _freeTrial, ...rest } = selected as any;
  return rest as SelectedPrice;
}

function multiplyMoneyAmount(amount: string, quantity: number, currency: Currency): string {
  if (!Number.isFinite(quantity) || Math.trunc(quantity) !== quantity) {
    throw new Error("Quantity must be an integer when multiplying money amounts");
  }
  if (quantity === 0) return "0";

  const multiplierNegative = quantity < 0;
  const safeQuantity = BigInt(Math.abs(quantity));

  const isNegative = amount.startsWith("-");
  const normalized = isNegative ? amount.slice(1) : amount;
  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const paddedFractional = fractionalPart.padEnd(currency.decimals, "0");
  const smallestUnit = BigInt(`${wholePart || "0"}${paddedFractional.padEnd(currency.decimals, "0")}`);
  const multiplied = smallestUnit * safeQuantity;

  const totalDecimals = currency.decimals;
  let multipliedStr = multiplied.toString();
  if (totalDecimals > 0) {
    if (multipliedStr.length <= totalDecimals) {
      multipliedStr = multipliedStr.padStart(totalDecimals + 1, "0");
    }
  }

  let integerPart: string;
  let fractionalResult: string | null = null;
  if (totalDecimals === 0) {
    integerPart = multipliedStr;
  } else {
    integerPart = multipliedStr.slice(0, -totalDecimals) || "0";
    const rawFraction = multipliedStr.slice(-totalDecimals);
    const trimmedFraction = rawFraction.replace(/0+$/, "");
    fractionalResult = trimmedFraction.length > 0 ? trimmedFraction : null;
  }

  integerPart = integerPart.replace(/^0+(?=\d)/, "") || "0";

  let result = fractionalResult ? `${integerPart}.${fractionalResult}` : integerPart;
  const shouldBeNegative = (isNegative ? -1 : 1) * (multiplierNegative ? -1 : 1) === -1;
  if (shouldBeNegative && result !== "0") {
    result = `-${result}`;
  }

  return result;
}

function buildChargedAmount(price: SelectedPrice | null, quantity: number): Record<string, string> {
  if (!price) return {};
  const result: Record<string, string> = {};
  for (const currency of SUPPORTED_CURRENCIES) {
    const rawAmount = price[currency.code as keyof typeof price];
    if (typeof rawAmount !== "string") continue;
    const multiplied = multiplyMoneyAmount(rawAmount, quantity, currency);
    if (multiplied === "0") continue;
    result[currency.code] = multiplied;
  }
  return result;
}

function createMoneyTransferEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  chargedAmount: Record<string, string | undefined>,
  skip: boolean,
}): TransactionEntry | null {
  if (options.skip) return null;
  const chargedCurrencies = Object.keys(options.chargedAmount);
  if (chargedCurrencies.length === 0) return null;
  const netUsd = options.chargedAmount.USD ?? "0";
  return {
    type: "money_transfer",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    charged_amount: options.chargedAmount,
    net_amount: {
      USD: netUsd,
    },
  };
}

function createProductGrantEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  productId: string | null,
  product: ProductSnapshot,
  priceId: string | null,
  quantity: number,
  subscriptionId?: string,
  oneTimePurchaseId?: string,
}): TransactionEntry {
  return {
    type: "product_grant",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    product_id: options.productId,
    product: options.product,
    price_id: options.priceId,
    quantity: options.quantity,
    subscription_id: options.subscriptionId,
    one_time_purchase_id: options.oneTimePurchaseId,
  };
}

function buildRefundAdjustments(options: { refundedAt?: Date | null, entries: TransactionEntry[], transactionId: string }): Transaction["adjusted_by"] {
  if (!options.refundedAt) {
    return [];
  }
  const productGrantIndex = options.entries.findIndex((entry) => entry.type === "product_grant");
  const entryIndex = productGrantIndex >= 0 ? productGrantIndex : 0;
  return [{
    transaction_id: `${options.transactionId}${REFUND_TRANSACTION_SUFFIX}`,
    entry_index: entryIndex,
  }];
}

export function buildSubscriptionTransaction(options: {
  subscription: Subscription,
}): Transaction {
  const { subscription } = options;
  const customerType = typedToLowercase(subscription.customerType);
  const product = subscription.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const selectedPrice = resolveSelectedPriceFromProduct(product, subscription.priceId ?? null);
  const quantity = subscription.quantity;
  const chargedAmount = buildChargedAmount(selectedPrice, quantity);
  const testMode = subscription.creationSource === "TEST_MODE";

  const entries: TransactionEntry[] = [
    createProductGrantEntry({
      customerType,
      customerId: subscription.customerId,
      productId: subscription.productId ?? null,
      product: inlineProduct,
      priceId: subscription.priceId ?? null,
      quantity,
      subscriptionId: subscription.id,
    }),
  ];

  const moneyTransfer = createMoneyTransferEntry({
    customerType,
    customerId: subscription.customerId,
    chargedAmount,
    skip: testMode,
  });
  if (moneyTransfer) {
    entries.push(moneyTransfer);
  }

  const adjustedBy = buildRefundAdjustments({
    refundedAt: subscription.refundedAt,
    entries,
    transactionId: subscription.id,
  });

  return {
    id: subscription.id,
    created_at_millis: subscription.createdAt.getTime(),
    effective_at_millis: subscription.createdAt.getTime(),
    type: "purchase",
    entries,
    adjusted_by: adjustedBy,
    test_mode: testMode,
  };
}

export function buildOneTimePurchaseTransaction(options: {
  purchase: OneTimePurchase,
}): Transaction {
  const { purchase } = options;
  const customerType = typedToLowercase(purchase.customerType);
  const product = purchase.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const selectedPrice = resolveSelectedPriceFromProduct(product, purchase.priceId ?? null);
  const quantity = purchase.quantity;
  const chargedAmount = buildChargedAmount(selectedPrice, quantity);
  const testMode = purchase.creationSource === "TEST_MODE";

  const entries: TransactionEntry[] = [
    createProductGrantEntry({
      customerType,
      customerId: purchase.customerId,
      productId: purchase.productId ?? null,
      product: inlineProduct,
      priceId: purchase.priceId ?? null,
      quantity,
      oneTimePurchaseId: purchase.id,
    }),
  ];

  const moneyTransfer = createMoneyTransferEntry({
    customerType,
    customerId: purchase.customerId,
    chargedAmount,
    skip: testMode,
  });
  if (moneyTransfer) {
    entries.push(moneyTransfer);
  }

  const adjustedBy = buildRefundAdjustments({
    refundedAt: purchase.refundedAt,
    entries,
    transactionId: purchase.id,
  });

  return {
    id: purchase.id,
    created_at_millis: purchase.createdAt.getTime(),
    effective_at_millis: purchase.createdAt.getTime(),
    type: "purchase",
    entries,
    adjusted_by: adjustedBy,
    test_mode: testMode,
  };
}

export function buildItemQuantityChangeTransaction(options: {
  change: ItemQuantityChange,
}): Transaction {
  const { change } = options;
  const customerType = typedToLowercase(change.customerType);

  const entries: TransactionEntry[] = [
    {
      type: "item_quantity_change",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: change.customerId,
      item_id: change.itemId,
      quantity: change.quantity,
    },
  ];

  return {
    id: change.id,
    created_at_millis: change.createdAt.getTime(),
    effective_at_millis: change.createdAt.getTime(),
    type: "manual-item-quantity-change",
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

export function buildSubscriptionRenewalTransaction(options: {
  subscription: Subscription,
  subscriptionInvoice: SubscriptionInvoice,
}): Transaction {
  const { subscription, subscriptionInvoice } = options;
  const product = subscription.product as InferType<typeof productSchema>;
  const selectedPrice = resolveSelectedPriceFromProduct(product, subscription.priceId ?? null);
  const chargedAmount = buildChargedAmount(selectedPrice, subscription.quantity);

  const entries: TransactionEntry[] = [
    {
      type: "money_transfer",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      charged_amount: chargedAmount,
      // todo: store net amount
      net_amount: { USD: chargedAmount.USD },
      customer_id: subscription.customerId,
      customer_type: typedToLowercase(subscription.customerType),
    },
  ];

  return {
    type: "subscription-renewal",
    id: subscriptionInvoice.id,
    test_mode: false,
    entries,
    adjusted_by: [],
    created_at_millis: subscriptionInvoice.createdAt.getTime(),
    effective_at_millis: subscriptionInvoice.createdAt.getTime(),
  };
}
