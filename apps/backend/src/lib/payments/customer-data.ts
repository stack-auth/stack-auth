/**
 * Customer-facing payment data queries backed by bulldozer tables.
 *
 * Reads from the Phase 3 output tables (OwnedProducts, ItemQuantities)
 * and returns the current state for a customer.
 */

import { Prisma } from "@/generated/prisma/client";
import { toQueryableSqlQuery } from "@/lib/bulldozer/db/index";
import { quoteSqlStringLiteral } from "@/lib/bulldozer/db/utilities";
import { ensureCustomerExists } from "@/lib/payments";
import type { PrismaClientTransaction } from "@/prisma-client";
import { createPaymentsSchema } from "./schema/index";
import type { CustomerType, ItemQuantityRow, OwnedProductsRow, SubscriptionMapRow, SubscriptionRow } from "./schema/types";

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
  table: { listRowsInGroup: (opts: any) => any },
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
): Promise<T | null> {
  const innerSql = toQueryableSqlQuery(table.listRowsInGroup({
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
  const rows = await prisma.$queryRaw`${Prisma.raw(sql)}` as any[];
  if (rows.length === 0) return null;
  return rows[0].rowdata as T;
}

/**
 * Returns the owned products for a customer.
 *
 * Returns a map of productId → { quantity, product, productLineId }.
 */
export async function getOwnedProductsForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<OwnedProductsRow["ownedProducts"]> {
  await ensureCustomerExists({
    prisma: options.prisma,
    tenancyId: options.tenancyId,
    customerType: options.customerType,
    customerId: options.customerId,
  });
  const row = await getLatestRow<OwnedProductsRow>(
    options.prisma,
    schema.ownedProducts,
    options.tenancyId,
    options.customerType,
    options.customerId,
  );
  return row?.ownedProducts ?? {};
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
  await ensureCustomerExists({
    prisma: options.prisma,
    tenancyId: options.tenancyId,
    customerType: options.customerType,
    customerId: options.customerId,
  });
  const row = await getLatestRow<ItemQuantityRow>(
    options.prisma,
    schema.itemQuantities,
    options.tenancyId,
    options.customerType,
    options.customerId,
  );
  return row?.itemQuantities ?? {};
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
  const quantities = await getItemQuantitiesForCustomer({
    prisma: options.prisma,
    tenancyId: options.tenancyId,
    customerType: options.customerType,
    customerId: options.customerId,
  });
  return quantities[options.itemId] ?? 0;
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
  const row = await getLatestRow<SubscriptionMapRow>(
    options.prisma,
    schema.subscriptionMapByCustomer,
    options.tenancyId,
    options.customerType,
    options.customerId,
  );
  return row?.subscriptions ?? {};
}
