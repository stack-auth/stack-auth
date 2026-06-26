/**
 * Dual-write helpers: convert Prisma payment rows to Bulldozer stored table
 * format and execute setRow. Called alongside every Prisma create/update/upsert
 * on the four payment models.
 *
 * The conversion functions (subscriptionToStoredRow, etc.) are also reused by
 * the ingress script (bulldozer-payments-init.ts).
 */

import { bulldozerCustomerPath, fetchBulldozerServerJson } from "@/lib/bulldozer-server-client";
import type { ManualTransactionRow } from "@/lib/payments/schema/types";

function dateToMillis(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

// ── Conversion functions ──────────────────────────────────────────────
// Each takes a Prisma row (any shape from create/upsert/findUnique) and
// returns the Bulldozer stored table row format.

export function subscriptionToStoredRow(sub: {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: string,
  productId: string | null,
  priceId: string | null,
  product: unknown,
  quantity: number,
  stripeSubscriptionId: string | null,
  status: string,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  cancelAtPeriodEnd: boolean,
  canceledAt: Date | null,
  endedAt: Date | null,
  refundedAt: Date | null,
  productRevokedAt: Date | null,
  creationSource: string,
  createdAt: Date,
}): Record<string, unknown> {
  return {
    id: sub.id,
    tenancyId: sub.tenancyId,
    customerId: sub.customerId,
    customerType: sub.customerType.toLowerCase(),
    productId: sub.productId,
    priceId: sub.priceId,
    product: sub.product,
    quantity: sub.quantity,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    status: sub.status.toLowerCase(),
    currentPeriodStartMillis: dateToMillis(sub.currentPeriodStart),
    currentPeriodEndMillis: dateToMillis(sub.currentPeriodEnd),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    canceledAtMillis: dateToMillis(sub.canceledAt),
    endedAtMillis: dateToMillis(sub.endedAt),
    refundedAtMillis: dateToMillis(sub.refundedAt),
    productRevokedAtMillis: dateToMillis(sub.productRevokedAt),
    creationSource: sub.creationSource,
    createdAtMillis: dateToMillis(sub.createdAt),
  };
}

export function subscriptionInvoiceToStoredRow(inv: {
  id: string,
  tenancyId: string,
  stripeSubscriptionId: string,
  stripeInvoiceId: string,
  isSubscriptionCreationInvoice: boolean,
  status: string | null,
  amountTotal: number | null,
  hostedInvoiceUrl: string | null,
  createdAt: Date,
}): Record<string, unknown> {
  return {
    id: inv.id,
    tenancyId: inv.tenancyId,
    stripeSubscriptionId: inv.stripeSubscriptionId,
    stripeInvoiceId: inv.stripeInvoiceId,
    isSubscriptionCreationInvoice: inv.isSubscriptionCreationInvoice,
    status: inv.status,
    amountTotal: inv.amountTotal,
    hostedInvoiceUrl: inv.hostedInvoiceUrl,
    createdAtMillis: dateToMillis(inv.createdAt),
  };
}

export function oneTimePurchaseToStoredRow(p: {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: string,
  productId: string | null,
  priceId: string | null,
  product: unknown,
  quantity: number,
  stripePaymentIntentId: string | null,
  revokedAt: Date | null,
  refundedAt: Date | null,
  creationSource: string,
  createdAt: Date,
}): Record<string, unknown> {
  return {
    id: p.id,
    tenancyId: p.tenancyId,
    customerId: p.customerId,
    customerType: p.customerType.toLowerCase(),
    productId: p.productId,
    priceId: p.priceId,
    product: p.product,
    quantity: p.quantity,
    stripePaymentIntentId: p.stripePaymentIntentId,
    revokedAtMillis: dateToMillis(p.revokedAt),
    refundedAtMillis: dateToMillis(p.refundedAt),
    creationSource: p.creationSource,
    createdAtMillis: dateToMillis(p.createdAt),
  };
}

export function itemQuantityChangeToStoredRow(c: {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: string,
  itemId: string,
  quantity: number,
  description: string | null,
  expiresAt: Date | null,
  createdAt: Date,
}): Record<string, unknown> {
  return {
    id: c.id,
    tenancyId: c.tenancyId,
    customerId: c.customerId,
    customerType: c.customerType.toLowerCase(),
    itemId: c.itemId,
    quantity: c.quantity,
    description: c.description ?? null,
    expiresAtMillis: dateToMillis(c.expiresAt),
    createdAtMillis: dateToMillis(c.createdAt),
  };
}

export function manualTransactionToStoredRow(transaction: ManualTransactionRow): Record<string, unknown> {
  return transaction;
}

// ── Dual-write executors ──────────────────────────────────────────────

async function postBulldozerRow(path: string, rowData: Record<string, unknown>) {
  await fetchBulldozerServerJson<{ success: true }>({
    method: "POST",
    path,
    body: { rowData },
  });
}

function lowerCustomerType(customerType: string): "user" | "team" | "custom" {
  const lowered = customerType.toLowerCase();
  if (lowered === "user" || lowered === "team" || lowered === "custom") {
    return lowered;
  }
  throw new Error(`Invalid customer type for Bulldozer row: ${customerType}`);
}

function readManualTransactionTenancyId(transaction: ManualTransactionRow): string {
  const tenancyId = transaction.tenancyId;
  if (typeof tenancyId !== "string" || tenancyId.length === 0) {
    throw new Error("Manual transaction is missing tenancyId");
  }
  return tenancyId;
}

export async function bulldozerWriteSubscription(
  sub: Parameters<typeof subscriptionToStoredRow>[0],
) {
  await postBulldozerRow(
    `/v1/${encodeURIComponent(sub.tenancyId)}/stripe/subscriptions/changed`,
    subscriptionToStoredRow(sub),
  );
}

export async function bulldozerWriteSubscriptionInvoice(
  inv: Parameters<typeof subscriptionInvoiceToStoredRow>[0],
) {
  await postBulldozerRow(
    `/v1/${encodeURIComponent(inv.tenancyId)}/stripe/subscription-invoices/changed`,
    subscriptionInvoiceToStoredRow(inv),
  );
}

export async function bulldozerWriteOneTimePurchase(
  purchase: Parameters<typeof oneTimePurchaseToStoredRow>[0],
) {
  await postBulldozerRow(
    `/v1/${encodeURIComponent(purchase.tenancyId)}/stripe/one-time-purchases/changed`,
    oneTimePurchaseToStoredRow(purchase),
  );
}

export async function bulldozerWriteItemQuantityChange(
  change: Parameters<typeof itemQuantityChangeToStoredRow>[0],
) {
  await postBulldozerRow(
    bulldozerCustomerPath({
      tenancyId: change.tenancyId,
      customerType: lowerCustomerType(change.customerType),
      customerId: change.customerId,
      suffix: "manual-item-quantity-changes",
    }),
    itemQuantityChangeToStoredRow(change),
  );
}

export async function bulldozerWriteManualTransaction(
  transactionId: string,
  transaction: ManualTransactionRow,
) {
  await postBulldozerRow(
    `/v1/${encodeURIComponent(readManualTransactionTenancyId(transaction))}/transactions/${encodeURIComponent(transactionId)}/refund`,
    manualTransactionToStoredRow(transaction),
  );
}
