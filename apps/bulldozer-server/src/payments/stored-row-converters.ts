import type { ManualTransactionRow } from "./schema/types";

function dateToMillis(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

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
