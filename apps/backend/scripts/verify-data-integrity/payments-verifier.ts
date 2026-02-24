import { SubscriptionStatus } from "@/generated/prisma/client";
import { getItemQuantityForCustomer } from "@/lib/payments";
import type { Tenancy } from "@/lib/tenancies";
import type { getPrismaClientForTenancy } from "@/prisma-client";
import type { OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import type { TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { FAR_FUTURE_DATE, addInterval, getIntervalsElapsed, type DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { deindent, stringCompare, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";

import type { ExpectStatusCode } from "./api";
import { fetchAllTransactionsForProject } from "./stripe-payout-integrity";

export type CustomerType = "user" | "team" | "custom";

type PaymentsConfig = OrganizationRenderedConfig["payments"];
type PaymentsProduct = PaymentsConfig["products"][string];

type LedgerTransaction = {
  amount: number,
  grantTime: Date,
  expirationTime: Date,
};

type CustomerTransactionEntry = {
  transactionId: string,
  createdAtMillis: number,
  entry: TransactionEntry,
};

type ExpectedOwnedProduct = {
  id: string | null,
  type: "one_time" | "subscription",
  quantity: number,
};

const DEFAULT_PRODUCT_START_DATE = new Date("1973-01-01T12:00:00.000Z");

type IncludedItemConfig = {
  quantity?: number,
  repeat?: DayInterval | "never" | null,
  expires?: "never" | "when-purchase-expires" | "when-repeated" | null,
};

type SubscriptionSnapshot = {
  id: string,
  quantity: number,
  status: SubscriptionStatus,
  currentPeriodStart: Date,
  currentPeriodEnd: Date | null,
  cancelAtPeriodEnd: boolean,
  createdAt: Date,
  endedAt: Date | null,
  refundedAt: Date | null,
};

type OneTimePurchaseSnapshot = {
  id: string,
  quantity: number,
  createdAt: Date,
  refundedAt: Date | null,
};

type ItemQuantityChangeSnapshot = {
  id: string,
  createdAt: Date,
  expiresAt: Date | null,
};

type PrismaForTenancy = Awaited<ReturnType<typeof getPrismaClientForTenancy>>;

type ExtraItemQuantityChangeRow = {
  id: string,
  itemId: string,
  quantity: number,
  createdAt: Date,
  expiresAt: Date | null,
};

function getCustomerKey(customerType: CustomerType, customerId: string) {
  return `${customerType}:${customerId}`;
}

function isCustomerTransactionEntry(entry: TransactionEntry): entry is Extract<TransactionEntry, { customer_type: CustomerType, customer_id: string }> {
  return "customer_type" in entry && "customer_id" in entry;
}

function normalizeRepeat(repeat: unknown): DayInterval | null {
  if (repeat === "never") return null;
  if (!Array.isArray(repeat) || repeat.length !== 2) return null;
  const [amount, unit] = repeat;
  if (typeof amount !== "number") return null;
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") return null;
  return [amount, unit];
}

function pushLedgerEntry(ledgerByItemId: Map<string, LedgerTransaction[]>, itemId: string, entry: LedgerTransaction) {
  const existing = ledgerByItemId.get(itemId);
  if (existing) {
    existing.push(entry);
    return;
  }
  ledgerByItemId.set(itemId, [entry]);
}

function computeLedgerBalanceAtNow(transactions: LedgerTransaction[], now: Date): number {
  const grantedAt = new Map<number, number>();
  const expiredAt = new Map<number, number>();
  const usedAt = new Map<number, number>();
  const timeSet = new Set<number>();

  for (const t of transactions) {
    const grantTime = t.grantTime.getTime();
    if (t.grantTime <= now && t.amount < 0 && t.expirationTime > now) {
      usedAt.set(grantTime, (-1 * t.amount) + (usedAt.get(grantTime) ?? 0));
    }
    if (t.grantTime <= now && t.amount > 0) {
      grantedAt.set(grantTime, (grantedAt.get(grantTime) ?? 0) + t.amount);
    }
    if (t.expirationTime <= now && t.amount > 0) {
      const time2 = t.expirationTime.getTime();
      expiredAt.set(time2, (expiredAt.get(time2) ?? 0) + t.amount);
      timeSet.add(time2);
    }
    timeSet.add(grantTime);
  }
  const times = Array.from(timeSet.values()).sort((a, b) => a - b);
  if (times.length === 0) {
    return 0;
  }

  let grantedSum = 0;
  let expiredSum = 0;
  let usedSum = 0;
  let usedOrExpiredSum = 0;
  for (const t of times) {
    const g = grantedAt.get(t) ?? 0;
    const e = expiredAt.get(t) ?? 0;
    const u = usedAt.get(t) ?? 0;
    grantedSum += g;
    expiredSum += e;
    usedSum += u;
    usedOrExpiredSum = Math.max(usedOrExpiredSum + u, expiredSum);
  }
  return grantedSum - usedOrExpiredSum;
}

function addWhenRepeatedItemWindowTransactions(options: {
  baseQty: number,
  repeat: DayInterval,
  anchor: Date,
  nowClamped: Date,
  hardEnd: Date | null,
}): LedgerTransaction[] {
  const { baseQty, repeat, anchor, nowClamped } = options;
  const endLimit = options.hardEnd ?? FAR_FUTURE_DATE;
  const finalNow = nowClamped < endLimit ? nowClamped : endLimit;
  if (finalNow < anchor) return [];

  const entries: LedgerTransaction[] = [];
  const elapsed = getIntervalsElapsed(anchor, finalNow, repeat);

  for (let i = 0; i <= elapsed; i++) {
    const windowStart = addInterval(new Date(anchor), [repeat[0] * i, repeat[1]]);
    const windowEnd = addInterval(new Date(windowStart), repeat);
    entries.push({ amount: baseQty, grantTime: windowStart, expirationTime: windowEnd });
  }

  return entries;
}

function addSubscriptionIncludedItems(options: {
  ledgerByItemId: Map<string, LedgerTransaction[]>,
  includedItems: Record<string, IncludedItemConfig> | undefined,
  subscription: Pick<SubscriptionSnapshot, "quantity" | "currentPeriodStart" | "currentPeriodEnd" | "createdAt">,
  now: Date,
}) {
  const { subscription, ledgerByItemId, includedItems, now } = options;
  for (const [itemId, inc] of Object.entries(includedItems ?? {})) {
    const baseQty = (inc.quantity ?? 0) * subscription.quantity;
    if (baseQty <= 0) continue;
    const pStart = subscription.currentPeriodStart;
    const pEnd = subscription.currentPeriodEnd ?? FAR_FUTURE_DATE;
    const nowClamped = now < pEnd ? now : pEnd;
    if (nowClamped < pStart) continue;

    const repeat = normalizeRepeat(inc.repeat ?? null);
    const expires = inc.expires ?? "never";

    if (!repeat) {
      const expirationTime = expires === "when-purchase-expires" ? pEnd : FAR_FUTURE_DATE;
      pushLedgerEntry(ledgerByItemId, itemId, {
        amount: baseQty,
        grantTime: pStart,
        expirationTime,
      });
      continue;
    }

    if (expires === "when-purchase-expires") {
      const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
      const occurrences = elapsed + 1;
      const amount = occurrences * baseQty;
      pushLedgerEntry(ledgerByItemId, itemId, {
        amount,
        grantTime: pStart,
        expirationTime: pEnd,
      });
      continue;
    }

    if (expires === "when-repeated") {
      const entries = addWhenRepeatedItemWindowTransactions({
        baseQty,
        repeat,
        anchor: subscription.createdAt,
        nowClamped,
        hardEnd: subscription.currentPeriodEnd,
      });
      for (const entry of entries) {
        pushLedgerEntry(ledgerByItemId, itemId, entry);
      }
      continue;
    }

    const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
    const occurrences = elapsed + 1;
    const amount = occurrences * baseQty;
    pushLedgerEntry(ledgerByItemId, itemId, {
      amount,
      grantTime: pStart,
      expirationTime: FAR_FUTURE_DATE,
    });
  }
}

function addOneTimeIncludedItems(options: {
  ledgerByItemId: Map<string, LedgerTransaction[]>,
  includedItems: Record<string, IncludedItemConfig> | undefined,
  quantity: number,
  createdAt: Date,
}) {
  const { ledgerByItemId, includedItems, quantity, createdAt } = options;
  for (const [itemId, inc] of Object.entries(includedItems ?? {})) {
    const baseQty = (inc.quantity ?? 0) * quantity;
    if (baseQty <= 0) continue;
    pushLedgerEntry(ledgerByItemId, itemId, {
      amount: baseQty,
      grantTime: createdAt,
      expirationTime: FAR_FUTURE_DATE,
    });
  }
}

function buildExpectedItemQuantitiesForCustomer(options: {
  entries: CustomerTransactionEntry[],
  defaultProducts: Array<{ productId: string, product: PaymentsProduct }>,
  extraItemQuantityChanges: Array<{
    itemId: string,
    quantity: number,
    createdAt: Date,
    expiresAt: Date | null,
  }>,
  itemQuantityChangeById: Map<string, ItemQuantityChangeSnapshot>,
  subscriptionById: Map<string, SubscriptionSnapshot>,
  oneTimePurchaseById: Map<string, OneTimePurchaseSnapshot>,
  now: Date,
}) {
  const ledgerByItemId = new Map<string, LedgerTransaction[]>();

  for (const change of options.extraItemQuantityChanges) {
    pushLedgerEntry(ledgerByItemId, change.itemId, {
      amount: change.quantity,
      grantTime: change.createdAt,
      expirationTime: change.expiresAt ?? FAR_FUTURE_DATE,
    });
  }

  for (const { entry, transactionId, createdAtMillis } of options.entries) {
    if (entry.type === "item-quantity-change") {
      const change = options.itemQuantityChangeById.get(transactionId);
      if (!change) {
        continue;
      }
      pushLedgerEntry(ledgerByItemId, entry.item_id, {
        amount: entry.quantity,
        grantTime: change.createdAt,
        expirationTime: change.expiresAt ?? FAR_FUTURE_DATE,
      });
      continue;
    }

    if (entry.type !== "product-grant") continue;

    const includedItems = entry.product.included_items;

    if (entry.subscription_id) {
      const subscription = options.subscriptionById.get(entry.subscription_id);
      if (!subscription) {
        continue;
      }
      addSubscriptionIncludedItems({
        ledgerByItemId,
        includedItems,
        subscription,
        now: options.now,
      });
      continue;
    }

    if (entry.one_time_purchase_id) {
      const purchase = options.oneTimePurchaseById.get(entry.one_time_purchase_id);
      if (!purchase) {
        continue;
      }
      addOneTimeIncludedItems({
        ledgerByItemId,
        includedItems,
        quantity: purchase.quantity,
        createdAt: purchase.createdAt,
      });
      continue;
    }

    addOneTimeIncludedItems({
      ledgerByItemId,
      includedItems,
      quantity: entry.quantity,
      createdAt: new Date(createdAtMillis),
    });
  }

  for (const { product } of options.defaultProducts) {
    addSubscriptionIncludedItems({
      ledgerByItemId,
      includedItems: product.includedItems,
      subscription: {
        quantity: 1,
        currentPeriodStart: DEFAULT_PRODUCT_START_DATE,
        currentPeriodEnd: null,
        createdAt: DEFAULT_PRODUCT_START_DATE,
      },
      now: options.now,
    });
  }

  const results = new Map<string, number>();
  for (const [itemId, ledger] of ledgerByItemId) {
    results.set(itemId, computeLedgerBalanceAtNow(ledger, options.now));
  }
  return results;
}

function buildExpectedOwnedProductsForCustomer(options: {
  entries: CustomerTransactionEntry[],
  defaultProducts: Array<{ productId: string, product: PaymentsProduct }>,
  subscriptionById: Map<string, SubscriptionSnapshot>,
  oneTimePurchaseById: Map<string, OneTimePurchaseSnapshot>,
}) {
  const expected: ExpectedOwnedProduct[] = [];
  for (const { entry } of options.entries) {
    if (entry.type !== "product-grant") continue;

    if (entry.subscription_id) {
      const subscription = options.subscriptionById.get(entry.subscription_id);
      if (!subscription) {
        continue;
      }
      const isActive = subscription.status === SubscriptionStatus.active || subscription.status === SubscriptionStatus.trialing;
      if (!isActive) {
        const now = new Date();
        const endedAt = subscription.endedAt;
        const periodEnd = subscription.currentPeriodEnd;
        const stillProviding = endedAt ? endedAt > now : periodEnd ? periodEnd > now : false;
        if (!stillProviding) {
          continue;
        }
      }
      expected.push({
        id: entry.product_id ?? null,
        type: "subscription",
        quantity: subscription.quantity,
      });
      continue;
    }

    if (entry.one_time_purchase_id) {
      const purchase = options.oneTimePurchaseById.get(entry.one_time_purchase_id);
      if (!purchase) {
        continue;
      }
      if (purchase.refundedAt) continue;
      expected.push({
        id: entry.product_id ?? null,
        type: "one_time",
        quantity: purchase.quantity,
      });
      continue;
    }

    expected.push({
      id: entry.product_id ?? null,
      type: "one_time",
      quantity: entry.quantity,
    });
  }

  for (const { productId } of options.defaultProducts) {
    expected.push({
      id: productId,
      type: "subscription",
      quantity: 1,
    });
  }

  return expected;
}

function getDefaultProductsForCustomer(options: {
  paymentsConfig: PaymentsConfig,
  customerType: CustomerType,
  subscribedProductLineIds: Set<string>,
  subscribedProductIds: Set<string>,
}) {
  const defaultsByProductLine = new Map<string, { productId: string, product: PaymentsProduct }>();
  const ungroupedDefaults: Array<{ productId: string, product: PaymentsProduct }> = [];

  for (const [productId, product] of Object.entries(options.paymentsConfig.products)) {
    if (product.customerType !== options.customerType) continue;
    if (product.prices !== "include-by-default") continue;

    if (product.productLineId) {
      if (!defaultsByProductLine.has(product.productLineId)) {
        defaultsByProductLine.set(product.productLineId, { productId, product });
      }
      continue;
    }

    ungroupedDefaults.push({ productId, product });
  }

  const defaults: Array<{ productId: string, product: PaymentsProduct }> = [];
  for (const [productLineId, product] of defaultsByProductLine) {
    if (options.subscribedProductLineIds.has(productLineId)) continue;
    defaults.push(product);
  }
  for (const product of ungroupedDefaults) {
    if (options.subscribedProductIds.has(product.productId)) continue;
    defaults.push(product);
  }
  return defaults;
}

function getIncludeByDefaultConflicts(paymentsConfig: PaymentsConfig) {
  const conflicts = new Map<string, string[]>();
  for (const productLineId of Object.keys(paymentsConfig.productLines)) {
    const defaultProducts = Object.entries(paymentsConfig.products)
      .filter(([_, product]) => product.productLineId === productLineId && product.prices === "include-by-default")
      .map(([productId]) => productId);
    if (defaultProducts.length > 1) {
      conflicts.set(productLineId, defaultProducts);
    }
  }
  return conflicts;
}

function normalizeOwnedProducts(list: ExpectedOwnedProduct[]) {
  return list
    .map((item) => ({
      id: item.id ?? null,
      type: item.type,
      quantity: item.quantity,
    }))
    .sort((a, b) => {
      const aId = a.id ?? "";
      const bId = b.id ?? "";
      if (aId !== bId) return stringCompare(aId, bId);
      if (a.type !== b.type) return stringCompare(a.type, b.type);
      return a.quantity - b.quantity;
    });
}

async function fetchAllOwnedProductsForCustomer(options: {
  projectId: string,
  customerType: CustomerType,
  customerId: string,
  expectStatusCode: ExpectStatusCode,
}) {
  const items: Array<ExpectedOwnedProduct> = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const endpoint = urlString`/api/v1/payments/products/${options.customerType}/${options.customerId}` + (params.toString() ? `?${params.toString()}` : "");
    const response = await options.expectStatusCode(200, endpoint, {
      method: "GET",
      headers: {
        "x-stack-project-id": options.projectId,
        "x-stack-access-type": "admin",
        "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
      },
    }) as { items: Array<ExpectedOwnedProduct>, pagination: { next_cursor: string | null } };
    items.push(...response.items.map((item) => ({
      id: item.id ?? null,
      type: item.type,
      quantity: item.quantity,
    })));
    cursor = response.pagination.next_cursor;
  } while (cursor);

  return items;
}

export async function createPaymentsVerifier(options: {
  projectId: string,
  tenancyId: string,
  tenancy: Tenancy,
  paymentsConfig: PaymentsConfig,
  prisma: PrismaForTenancy,
  expectStatusCode: ExpectStatusCode,
}) {
  const includeByDefaultConflicts = getIncludeByDefaultConflicts(options.paymentsConfig);
  if (includeByDefaultConflicts.size > 0) {
    const conflictSummary = Array.from(includeByDefaultConflicts.entries())
      .map(([productLineId, productIds]) => `${productLineId}: ${productIds.join(", ")}`)
      .join("; ");
    console.warn(`Skipping payments verification for project ${options.projectId} due to include-by-default conflicts (${conflictSummary}).`);
    return {
      verifyCustomerPayments: async () => { },
      customCustomerIds: new Set<string>(),
    };
  }

  const transactions = await fetchAllTransactionsForProject({
    projectId: options.projectId,
    expectStatusCode: options.expectStatusCode,
  });
  const paymentsConfig = options.paymentsConfig;

  const entriesByCustomer = new Map<string, CustomerTransactionEntry[]>();
  const subscriptionIds = new Set<string>();
  const oneTimePurchaseIds = new Set<string>();
  const itemQuantityChangeIds = new Set<string>();
  const customCustomerIds = new Set<string>();

  for (const transaction of transactions) {
    for (const entry of transaction.entries) {
      if (!isCustomerTransactionEntry(entry)) continue;
      const customerKey = getCustomerKey(entry.customer_type, entry.customer_id);
      const entries = entriesByCustomer.get(customerKey) ?? [];
      entries.push({
        transactionId: transaction.id,
        createdAtMillis: transaction.created_at_millis,
        entry,
      });
      entriesByCustomer.set(customerKey, entries);

      if (entry.customer_type === "custom") {
        customCustomerIds.add(entry.customer_id);
      }

      if (entry.type === "item-quantity-change") {
        itemQuantityChangeIds.add(transaction.id);
        continue;
      }
      if (entry.type !== "product-grant") continue;
      if (entry.subscription_id) {
        subscriptionIds.add(entry.subscription_id);
      }
      if (entry.one_time_purchase_id) {
        oneTimePurchaseIds.add(entry.one_time_purchase_id);
      }
    }
  }

  const subscriptionIdList = Array.from(subscriptionIds);
  const oneTimePurchaseIdList = Array.from(oneTimePurchaseIds);
  const itemQuantityChangeIdList = Array.from(itemQuantityChangeIds);

  const [subscriptions, oneTimePurchases, itemQuantityChanges] = await Promise.all([
    subscriptionIdList.length === 0 ? Promise.resolve([] as SubscriptionSnapshot[]) : options.prisma.subscription.findMany({
      where: {
        tenancyId: options.tenancyId,
        id: { in: subscriptionIdList },
      },
      select: {
        id: true,
        quantity: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        createdAt: true,
        endedAt: true,
        refundedAt: true,
      },
    }),
    oneTimePurchaseIdList.length === 0 ? Promise.resolve([] as OneTimePurchaseSnapshot[]) : options.prisma.oneTimePurchase.findMany({
      where: {
        tenancyId: options.tenancyId,
        id: { in: oneTimePurchaseIdList },
      },
      select: {
        id: true,
        quantity: true,
        createdAt: true,
        refundedAt: true,
      },
    }),
    itemQuantityChangeIdList.length === 0 ? Promise.resolve([] as ItemQuantityChangeSnapshot[]) : options.prisma.itemQuantityChange.findMany({
      where: {
        tenancyId: options.tenancyId,
        id: { in: itemQuantityChangeIdList },
      },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
  ]);

  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const oneTimePurchaseById = new Map(oneTimePurchases.map((purchase) => [purchase.id, purchase]));
  const itemQuantityChangeById = new Map(itemQuantityChanges.map((change) => [change.id, change]));

  async function verifyCustomerPayments(customer: { customerType: CustomerType, customerId: string }) {
    const entries = entriesByCustomer.get(getCustomerKey(customer.customerType, customer.customerId)) ?? [];
    const now = new Date();

    const entryItemQuantityChangeIds = new Set<string>();
    for (const { entry, transactionId } of entries) {
      if (entry.type !== "item-quantity-change") continue;
      entryItemQuantityChangeIds.add(transactionId);
    }
    const extraItemQuantityChanges: ExtraItemQuantityChangeRow[] = await options.prisma.itemQuantityChange.findMany({
      where: {
        tenancyId: options.tenancyId,
        customerId: customer.customerId,
        customerType: typedToUppercase(customer.customerType),
      },
      select: {
        id: true,
        itemId: true,
        quantity: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    const missingItemQuantityChanges = extraItemQuantityChanges.filter((change) => !entryItemQuantityChangeIds.has(change.id));

    const subscribedProductLineIds = new Set<string>();
    const subscribedProductIds = new Set<string>();
    const dbSubscriptions = await options.prisma.subscription.findMany({
      where: {
        tenancyId: options.tenancyId,
        customerId: customer.customerId,
        customerType: typedToUppercase(customer.customerType),
      },
      select: {
        productId: true,
      },
    });
    for (const { productId } of dbSubscriptions) {
      if (!productId) continue;
      subscribedProductIds.add(productId);
      const configProduct = paymentsConfig.products[productId] as PaymentsProduct | undefined;
      if (!configProduct) continue;
      if (configProduct.productLineId) {
        subscribedProductLineIds.add(configProduct.productLineId);
      }
    }

    const defaultProducts = getDefaultProductsForCustomer({
      paymentsConfig,
      customerType: customer.customerType,
      subscribedProductLineIds,
      subscribedProductIds,
    });

    const expectedItems = buildExpectedItemQuantitiesForCustomer({
      entries,
      defaultProducts,
      extraItemQuantityChanges: missingItemQuantityChanges,
      itemQuantityChangeById,
      subscriptionById,
      oneTimePurchaseById,
      now,
    });

    for (const [itemId, item] of Object.entries(paymentsConfig.items)) {
      if (item.customerType !== customer.customerType) continue;
      const expectedQuantity = expectedItems.get(itemId) ?? 0;
      const endpoint = urlString`/api/v1/payments/items/${customer.customerType}/${customer.customerId}/${itemId}`;
      const response = await options.expectStatusCode(200, endpoint, {
        method: "GET",
        headers: {
          "x-stack-project-id": options.projectId,
          "x-stack-access-type": "admin",
          "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
        },
      }) as { quantity: number };
      if (response.quantity !== expectedQuantity) {
        const dbQuantity = await getItemQuantityForCustomer({
          prisma: options.prisma,
          tenancy: options.tenancy,
          itemId,
          customerId: customer.customerId,
          customerType: customer.customerType,
        });
        if (dbQuantity !== response.quantity) {
          throw new StackAssertionError(deindent`
            Item quantity mismatch for ${customer.customerType} ${customer.customerId} item ${itemId}.
            Expected ${expectedQuantity} but got ${response.quantity}.
          `, { expectedQuantity, actualQuantity: response.quantity, dbQuantity });
        }
        console.warn(deindent`
          Item quantity mismatch for ${customer.customerType} ${customer.customerId} item ${itemId}.
          Expected ${expectedQuantity} from transactions but got ${response.quantity} (db=${dbQuantity}); skipping.
        `);
      }
    }

    const expectedProducts = buildExpectedOwnedProductsForCustomer({
      entries,
      defaultProducts,
      subscriptionById,
      oneTimePurchaseById,
    });
    const actualProducts = await fetchAllOwnedProductsForCustomer({
      projectId: options.projectId,
      customerType: customer.customerType,
      customerId: customer.customerId,
      expectStatusCode: options.expectStatusCode,
    });

    const normalizedExpected = normalizeOwnedProducts(expectedProducts);
    const normalizedActual = normalizeOwnedProducts(actualProducts);

    if (!deepPlainEquals(normalizedExpected, normalizedActual)) {
      throw new StackAssertionError(deindent`
        Owned products mismatch for ${customer.customerType} ${customer.customerId}.
        Expected:
          ${JSON.stringify(normalizedExpected, null, 2)}
        Actual:
          ${JSON.stringify(normalizedActual, null, 2)}
      `, { expected: normalizedExpected, actual: normalizedActual });
    }
  }

  return {
    verifyCustomerPayments,
    customCustomerIds,
  };
}

