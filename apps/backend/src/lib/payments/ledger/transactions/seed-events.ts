import { PrismaClientTransaction } from "@/prisma-client";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import type { FullTransactionFilter, SeedEvent } from "./types";

export async function fetchSeedEvents(prisma: PrismaClientTransaction, tenancyId: string, filter: FullTransactionFilter): Promise<SeedEvent[]> {
  const customerWhere = {
    ...(filter.customerType ? { customerType: typedToUppercase(filter.customerType) } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
  };
  const [defaultSnapshots, subscriptions, invoices, oneTimePurchases, itemChanges] = await Promise.all([
    prisma.defaultProductsSnapshot.findMany({
      where: { tenancyId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.subscription.findMany({
      where: { tenancyId, ...customerWhere },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.subscriptionInvoice.findMany({
      where: {
        tenancyId,
        subscription: { tenancyId, ...customerWhere },
      },
      include: { subscription: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.oneTimePurchase.findMany({
      where: { tenancyId, ...customerWhere },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.itemQuantityChange.findMany({
      where: { tenancyId, ...customerWhere },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const events: SeedEvent[] = [];
  for (const row of defaultSnapshots) {
    events.push({ kind: "default-products-change-event", at: row.createdAt.getTime(), snapshotRow: row });
  }
  for (const subscription of subscriptions) {
    events.push({ kind: "subscription-start-event", at: subscription.createdAt.getTime(), subscription });
    if (subscription.endedAt) events.push({ kind: "subscription-end-event", at: subscription.endedAt.getTime(), subscription });
    if (subscription.cancelAtPeriodEnd && !subscription.endedAt) {
      events.push({ kind: "subscription-cancel-event", at: subscription.updatedAt.getTime(), subscription });
    }
    if (subscription.refundedAt) {
      events.push({ kind: "subscription-refund-event", at: subscription.refundedAt.getTime(), subscription });
    }
  }
  for (const invoice of invoices) {
    if (!invoice.isSubscriptionCreationInvoice) {
      events.push({ kind: "subscription-renewal-event", at: invoice.createdAt.getTime(), invoice });
    }
  }
  for (const purchase of oneTimePurchases) {
    events.push({ kind: "one-time-purchase-event", at: purchase.createdAt.getTime(), purchase });
    if (purchase.refundedAt) {
      events.push({ kind: "one-time-purchase-refund-event", at: purchase.refundedAt.getTime(), purchase });
    }
  }
  for (const change of itemChanges) {
    events.push({ kind: "item-quantity-change-event", at: change.createdAt.getTime(), change });
  }
  return events;
}
