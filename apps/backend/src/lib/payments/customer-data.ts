/**
 * Customer-facing payment data queries backed by bulldozer tables.
 *
 * Reads from the Phase 3 output tables (OwnedProducts, ItemQuantities)
 * and returns the current state for a customer.
 */

import { CustomerType as PrismaCustomerType, Prisma, SubscriptionStatus as PrismaSubscriptionStatus } from "@/generated/prisma/client";
import { createBulldozerExecutionContext, type BulldozerExecutionContext, toQueryableSqlQuery } from "@/lib/bulldozer/db/index";
import { quoteSqlStringLiteral } from "@/lib/bulldozer/db/utilities";
import type { PrismaClientTransaction } from "@/prisma-client";
import { createPaymentsSchema } from "./schema/index";
import type { CustomerType, DayInterval, IncludedItemConfig, ItemQuantityRow, Json, OwnedProductsRow, ProductSnapshot, PurchaseCreationSource, SubscriptionMapRow, SubscriptionRow, SubscriptionStatus } from "./schema/types";

const schema = createPaymentsSchema();

function customerGroupKeySql(tenancyId: string, customerType: CustomerType, customerId: string) {
  const json = JSON.stringify({ tenancyId, customerType, customerId });
  return `${quoteSqlStringLiteral(json).sql}::jsonb`;
}

/**
 * Reads the latest (last) row from a sorted bulldozer table for a specific
 * customer. Uses ORDER BY DESC LIMIT 1 to avoid loading all rows.
 */
async function getLatestRow<T>(
  prisma: PrismaClientTransaction,
  table: { listRowsInGroup: (ctx: BulldozerExecutionContext, opts: any) => any },
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
): Promise<T | null> {
  const executionContext = createBulldozerExecutionContext();
  const innerSql = toQueryableSqlQuery(table.listRowsInGroup(executionContext, {
    groupKey: { type: "expression", sql: customerGroupKeySql(tenancyId, customerType, customerId) },
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));

  const sql = `
    SELECT * FROM (${innerSql}) AS "__all_rows"
    ORDER BY "__all_rows"."rowsortkey" DESC NULLS LAST, "__all_rows"."rowidentifier" DESC
    LIMIT 1
  `;
  const replicaClient = '$replica' in prisma ? (prisma as any).$replica() : prisma;
  const rows = await replicaClient.$queryRaw`${Prisma.raw(sql)}` as any[];
  if (rows.length === 0) return null;
  return rows[0].rowdata as T;
}

/**
 * Returns the owned products for a customer.
 *
 * Returns a map of productId → { quantity, product, productLineId }.
 * Inline products (null productId) are keyed as '__null__'.
 */
export async function getOwnedProductsForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<OwnedProductsRow["ownedProducts"]> {
  return await getCurrentOwnedProductsFromPrisma(options);
}

async function getOwnedProductsRow(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<OwnedProductsRow | null> {
  return await getLatestRow<OwnedProductsRow>(
    options.prisma,
    schema.ownedProducts,
    options.tenancyId,
    options.customerType,
    options.customerId,
  );
}

/**
 * Returns all item quantities for a customer.
 *
 * Returns a map of itemId → net quantity.
 */
export async function getItemQuantitiesForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<Record<string, number>> {
  const row = await getItemQuantitiesRow(options);
  return row?.itemQuantities ?? {};
}

async function getItemQuantitiesRow(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<ItemQuantityRow | null> {
  return await getLatestRow<ItemQuantityRow>(
    options.prisma,
    schema.itemQuantities,
    options.tenancyId,
    options.customerType,
    options.customerId,
  );
}

/**
 * Returns the quantity of a specific item for a customer.
 * Returns 0 if the item has never been granted.
 */
export async function getItemQuantityForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  itemId: string,
  customerId: string,
  customerType: CustomerType,
}): Promise<number> {
  return await getCurrentItemQuantityFromPrisma(options);
}

function customerTypeToPrisma(customerType: CustomerType): PrismaCustomerType {
  switch (customerType) {
    case "user": {
      return PrismaCustomerType.USER;
    }
    case "team": {
      return PrismaCustomerType.TEAM;
    }
    case "custom": {
      return PrismaCustomerType.CUSTOM;
    }
  }
}

function readSubscriptionStatusFromPrisma(status: PrismaSubscriptionStatus): SubscriptionStatus {
  switch (status) {
    case PrismaSubscriptionStatus.active:
    case PrismaSubscriptionStatus.trialing:
    case PrismaSubscriptionStatus.canceled:
    case PrismaSubscriptionStatus.paused:
    case PrismaSubscriptionStatus.incomplete:
    case PrismaSubscriptionStatus.incomplete_expired:
    case PrismaSubscriptionStatus.past_due:
    case PrismaSubscriptionStatus.unpaid: {
      return status;
    }
  }
}

function readPurchaseCreationSourceFromPrisma(source: string): PurchaseCreationSource {
  switch (source) {
    case "PURCHASE_PAGE":
    case "TEST_MODE":
    case "API_GRANT": {
      return source;
    }
    default: {
      throw new Error(`Unknown purchase creation source: ${source}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): value is Json {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJson);
  }
  return false;
}

function readCustomerType(value: unknown, fallback: CustomerType): CustomerType {
  return value === "user" || value === "team" || value === "custom" ? value : fallback;
}

function readDayInterval(value: unknown): DayInterval | "never" | null | undefined {
  if (value === undefined || value === "never" || value === null) {
    return value;
  }
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number") {
    return undefined;
  }
  const unit = value[1];
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") {
    return undefined;
  }
  return [value[0], unit];
}

function readIncludedItems(value: unknown): Record<string, IncludedItemConfig> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result = new Map<string, IncludedItemConfig>();
  for (const [itemId, itemConfig] of Object.entries(value)) {
    if (!isRecord(itemConfig) || typeof itemConfig.quantity !== "number") {
      return null;
    }
    const repeat = readDayInterval(itemConfig.repeat);
    if (repeat === undefined && "repeat" in itemConfig) {
      return null;
    }
    const expires = itemConfig.expires;
    if (
      expires !== undefined
      && expires !== null
      && expires !== "never"
      && expires !== "when-purchase-expires"
      && expires !== "when-repeated"
    ) {
      return null;
    }
    result.set(itemId, {
      quantity: itemConfig.quantity,
      ...(repeat === undefined ? {} : { repeat }),
      ...(expires === undefined ? {} : { expires }),
    });
  }
  return Object.fromEntries(result);
}

function readPrices(value: unknown): Record<string, Record<string, Json>> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result = new Map<string, Record<string, Json>>();
  for (const [priceId, price] of Object.entries(value)) {
    if (!isRecord(price)) {
      return null;
    }
    const priceResult = new Map<string, Json>();
    for (const [key, priceValue] of Object.entries(price)) {
      if (!isJson(priceValue)) {
        return null;
      }
      priceResult.set(key, priceValue);
    }
    result.set(priceId, Object.fromEntries(priceResult));
  }
  return Object.fromEntries(result);
}

function readOptionalJson(value: unknown): Json | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return isJson(value) ? value : undefined;
}

function readProductSnapshot(product: unknown, fallbackCustomerType: CustomerType): ProductSnapshot | null {
  if (!isRecord(product)) {
    return null;
  }
  const prices = readPrices(product.prices);
  const includedItems = readIncludedItems(product.includedItems);
  if (prices == null || includedItems == null) {
    return null;
  }

  const snapshot: ProductSnapshot = {
    customerType: readCustomerType(product.customerType, fallbackCustomerType),
    prices,
    includedItems,
  };
  if (typeof product.displayName === "string" || product.displayName === null) snapshot.displayName = product.displayName;
  if (typeof product.productLineId === "string" || product.productLineId === null) snapshot.productLineId = product.productLineId;
  if (typeof product.stackable === "boolean" || product.stackable === null) snapshot.stackable = product.stackable;
  if (typeof product.serverOnly === "boolean" || product.serverOnly === null) snapshot.serverOnly = product.serverOnly;
  if (product.isAddOnTo === false || product.isAddOnTo === null || isRecord(product.isAddOnTo)) {
    const addOnTo = product.isAddOnTo;
    if (addOnTo === false || addOnTo === null) {
      snapshot.isAddOnTo = addOnTo;
    } else {
      const entries = Object.entries(addOnTo);
      if (entries.every(([, enabled]) => enabled === true)) {
        snapshot.isAddOnTo = Object.fromEntries(entries.map(([key]) => [key, true]));
      }
    }
  }
  const clientMetadata = readOptionalJson(product.clientMetadata);
  if (clientMetadata !== undefined) snapshot.clientMetadata = clientMetadata;
  const clientReadOnlyMetadata = readOptionalJson(product.clientReadOnlyMetadata);
  if (clientReadOnlyMetadata !== undefined) snapshot.clientReadOnlyMetadata = clientReadOnlyMetadata;
  const serverMetadata = readOptionalJson(product.serverMetadata);
  if (serverMetadata !== undefined) snapshot.serverMetadata = serverMetadata;
  return snapshot;
}

function readIncludedItemQuantityFromProduct(product: unknown, itemId: string): number {
  if (!isRecord(product) || !isRecord(product.includedItems)) {
    return 0;
  }
  const includedItem = product.includedItems[itemId];
  if (!isRecord(includedItem) || typeof includedItem.quantity !== "number") {
    return 0;
  }
  return includedItem.quantity;
}

async function getActiveSubscriptionRows(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
}) {
  const now = new Date();
  return await options.prisma.subscription.findMany({
    where: {
      tenancyId: options.tenancyId,
      customerId: options.customerId,
      customerType: customerTypeToPrisma(options.customerType),
      OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      AND: [
        { OR: [{ productRevokedAt: null }, { productRevokedAt: { gt: now } }] },
        { OR: [{ refundedAt: null }, { refundedAt: { gt: now } }] },
      ],
    },
    select: {
      id: true,
      tenancyId: true,
      customerId: true,
      customerType: true,
      productId: true,
      priceId: true,
      product: true,
      quantity: true,
      stripeSubscriptionId: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      canceledAt: true,
      endedAt: true,
      refundedAt: true,
      productRevokedAt: true,
      creationSource: true,
      createdAt: true,
    },
  });
}

function addOwnedProduct(
  result: Map<string, OwnedProductsRow["ownedProducts"][string]>,
  productId: string | null,
  quantity: number,
  product: ProductSnapshot,
) {
  const key = productId ?? "__null__";
  const existing = result.get(key);
  result.set(key, {
    quantity: (existing?.quantity ?? 0) + quantity,
    product,
    productLineId: product.productLineId ?? null,
  });
}

async function getInitialSubscriptionOwnedProducts(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
}): Promise<OwnedProductsRow["ownedProducts"]> {
  const subscriptions = await getActiveSubscriptionRows(options);
  const result = new Map<string, OwnedProductsRow["ownedProducts"][string]>();
  for (const subscription of subscriptions) {
    const product = readProductSnapshot(subscription.product, options.customerType);
    if (product == null) {
      continue;
    }
    addOwnedProduct(result, subscription.productId, subscription.quantity, product);
  }
  return Object.fromEntries(result);
}

async function getCurrentOwnedProductsFromPrisma(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
}): Promise<OwnedProductsRow["ownedProducts"]> {
  const [subscriptions, oneTimePurchases] = await Promise.all([
    getActiveSubscriptionRows(options),
    options.prisma.oneTimePurchase.findMany({
      where: {
        tenancyId: options.tenancyId,
        customerId: options.customerId,
        customerType: customerTypeToPrisma(options.customerType),
        revokedAt: null,
        refundedAt: null,
      },
      select: {
        productId: true,
        product: true,
        quantity: true,
      },
    }),
  ]);

  const result = new Map<string, OwnedProductsRow["ownedProducts"][string]>();
  for (const subscription of subscriptions) {
    const product = readProductSnapshot(subscription.product, options.customerType);
    if (product == null) {
      continue;
    }
    addOwnedProduct(result, subscription.productId, subscription.quantity, product);
  }
  for (const purchase of oneTimePurchases) {
    const product = readProductSnapshot(purchase.product, options.customerType);
    if (product == null) {
      continue;
    }
    addOwnedProduct(result, purchase.productId, purchase.quantity, product);
  }
  return Object.fromEntries(result);
}

async function getInitialSubscriptionItemQuantity(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  itemId: string,
  customerId: string,
  customerType: CustomerType,
}): Promise<number> {
  const subscriptions = await getActiveSubscriptionRows(options);

  let total = 0;
  for (const subscription of subscriptions) {
    total += readIncludedItemQuantityFromProduct(subscription.product, options.itemId) * subscription.quantity;
  }
  return total;
}

async function getActiveOneTimePurchaseItemQuantity(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  itemId: string,
  customerId: string,
  customerType: CustomerType,
}): Promise<number> {
  const purchases = await options.prisma.oneTimePurchase.findMany({
    where: {
      tenancyId: options.tenancyId,
      customerId: options.customerId,
      customerType: customerTypeToPrisma(options.customerType),
      revokedAt: null,
      refundedAt: null,
    },
    select: {
      product: true,
      quantity: true,
    },
  });

  let total = 0;
  for (const purchase of purchases) {
    total += readIncludedItemQuantityFromProduct(purchase.product, options.itemId) * purchase.quantity;
  }
  return total;
}

async function getCurrentItemQuantityFromPrisma(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  itemId: string,
  customerId: string,
  customerType: CustomerType,
}): Promise<number> {
  const now = new Date();
  const [subscriptionQuantity, oneTimePurchaseQuantity, manualQuantityResult] = await Promise.all([
    getInitialSubscriptionItemQuantity(options),
    getActiveOneTimePurchaseItemQuantity(options),
    options.prisma.itemQuantityChange.aggregate({
      where: {
        tenancyId: options.tenancyId,
        customerId: options.customerId,
        customerType: customerTypeToPrisma(options.customerType),
        itemId: options.itemId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _sum: {
        quantity: true,
      },
    }),
  ]);

  return subscriptionQuantity + oneTimePurchaseQuantity + (manualQuantityResult._sum.quantity ?? 0);
}


// ── Per-customer subscription map ─────────────────────────────────────

/**
 * Returns a map of subscriptionId → SubscriptionRow for a customer.
 * Reads from the subscriptions LFold (O(1) per customer, no full table scan).
 */
export async function getSubscriptionMapForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<Record<string, SubscriptionRow>> {
  const subscriptions = await options.prisma.subscription.findMany({
    where: {
      tenancyId: options.tenancyId,
      customerId: options.customerId,
      customerType: customerTypeToPrisma(options.customerType),
    },
  });
  const result = new Map<string, SubscriptionRow>();
  for (const subscription of subscriptions) {
    const product = readProductSnapshot(subscription.product, options.customerType);
    if (product == null) {
      continue;
    }
    result.set(subscription.id, {
      id: subscription.id,
      tenancyId: subscription.tenancyId,
      customerId: subscription.customerId,
      customerType: options.customerType,
      productId: subscription.productId,
      priceId: subscription.priceId,
      product,
      quantity: subscription.quantity,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      status: readSubscriptionStatusFromPrisma(subscription.status),
      currentPeriodStartMillis: subscription.currentPeriodStart.getTime(),
      currentPeriodEndMillis: subscription.currentPeriodEnd.getTime(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAtMillis: subscription.canceledAt?.getTime() ?? null,
      endedAtMillis: subscription.endedAt?.getTime() ?? null,
      refundedAtMillis: subscription.refundedAt?.getTime() ?? null,
      productRevokedAtMillis: subscription.productRevokedAt?.getTime() ?? null,
      creationSource: readPurchaseCreationSourceFromPrisma(subscription.creationSource),
      createdAtMillis: subscription.createdAt.getTime(),
    });
  }
  return Object.fromEntries(result);
}
