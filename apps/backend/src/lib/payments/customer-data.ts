/**
 * Customer-facing payment data queries backed by bulldozer tables.
 *
 * Reads from the Phase 3 output tables (OwnedProducts, ItemQuantities)
 * and returns the current state for a customer.
 */

import { bulldozerCustomerPath, fetchBulldozerServerJson } from "@/lib/bulldozer-server-client";
import type { PrismaClientTransaction } from "@/prisma-client";
import type { CustomerType, OwnedProductsRow, SubscriptionRow } from "./schema/types";

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
  const response = await fetchBulldozerServerJson<{ ownedProducts: OwnedProductsRow["ownedProducts"] }>({
    method: "GET",
    path: bulldozerCustomerPath({
      tenancyId: options.tenancyId,
      customerType: options.customerType,
      customerId: options.customerId,
      suffix: "owned-products",
    }),
  });
  return response.ownedProducts;
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
  const response = await fetchBulldozerServerJson<{ itemQuantities: Record<string, number> }>({
    method: "GET",
    path: bulldozerCustomerPath({
      tenancyId: options.tenancyId,
      customerType: options.customerType,
      customerId: options.customerId,
      suffix: "item-quantities",
    }),
  });
  return response.itemQuantities;
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
  const response = await fetchBulldozerServerJson<{ subscriptions: Record<string, SubscriptionRow> }>({
    method: "GET",
    path: bulldozerCustomerPath({
      tenancyId: options.tenancyId,
      customerType: options.customerType,
      customerId: options.customerId,
      suffix: "subscriptions",
    }),
  });
  return response.subscriptions;
}
