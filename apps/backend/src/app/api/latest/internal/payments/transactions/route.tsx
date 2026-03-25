import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma } from "@/generated/prisma/client";
import { TRANSACTION_TYPES, transactionSchema, type Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import {
  buildItemQuantityChangeTransaction,
  buildOneTimePurchaseTransaction,
  buildSubscriptionTransaction,
  buildSubscriptionRenewalTransaction
} from "./transaction-builder";

type TransactionSource = "subscription" | "item_quantity_change" | "one_time" | "subscription-invoice";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      limit: yupString().optional(),
      type: yupString().oneOf(TRANSACTION_TYPES).optional(),
      customer_type: yupString().oneOf(['user', 'team', 'custom']).optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      transactions: yupArray(transactionSchema).defined(),
      next_cursor: yupString().nullable().defined(),
    }).defined(),
  }),
  handler: async ({ auth, query }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const rawLimit = query.limit ?? "50";
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));
    const cursorStr = query.cursor ?? "";
    const [subCursor, iqcCursor, otpCursor, siCursor] = (cursorStr.split("|") as [string?, string?, string?, string?]);

    const paginateWhere = async <T extends "subscription" | "itemQuantityChange" | "oneTimePurchase" | "subscriptionInvoice">(
      table: T,
      cursorId?: string
    ): Promise<
      T extends "subscription"
      ? Prisma.SubscriptionWhereInput | undefined
      : T extends "itemQuantityChange"
      ? Prisma.ItemQuantityChangeWhereInput | undefined
      : T extends "oneTimePurchase"
      ? Prisma.OneTimePurchaseWhereInput | undefined
      : Prisma.SubscriptionInvoiceWhereInput | undefined
    > => {
      if (!cursorId) return undefined as any;
      let pivot: { createdAt: Date } | null = null;
      if (table === "subscription") {
        pivot = await prisma.subscription.findUnique({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: cursorId } },
          select: { createdAt: true },
        });
      } else if (table === "itemQuantityChange") {
        pivot = await prisma.itemQuantityChange.findUnique({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: cursorId } },
          select: { createdAt: true },
        });
      } else if (table === "oneTimePurchase") {
        pivot = await prisma.oneTimePurchase.findUnique({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: cursorId } },
          select: { createdAt: true },
        });
      } else {
        pivot = await prisma.subscriptionInvoice.findUnique({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: cursorId } },
          select: { createdAt: true }
        });
      }
      if (!pivot) return undefined as any;
      return {
        OR: [
          { createdAt: { lt: pivot.createdAt } },
          { AND: [{ createdAt: { equals: pivot.createdAt } }, { id: { lt: cursorId } }] },
        ],
      } as any;
    };

    const [subWhere, iqcWhere, otpWhere, siWhere] = await Promise.all([
      paginateWhere("subscription", subCursor),
      paginateWhere("itemQuantityChange", iqcCursor),
      paginateWhere("oneTimePurchase", otpCursor),
      paginateWhere("subscriptionInvoice", siCursor)
    ]);

    const baseOrder = [{ createdAt: "desc" as const }, { id: "desc" as const }];
    const customerTypeFilter = query.customer_type ? { customerType: typedToUppercase(query.customer_type) } : {};

    type TransactionRow = {
      source: TransactionSource,
      id: string,
      createdAt: Date,
      transaction: Transaction,
    };
    let merged: TransactionRow[] = [];

    const [
      subscriptions,
      itemQuantityChanges,
      oneTimePayments,
      subscriptionInvoices
    ] = await Promise.all([
      prisma.subscription.findMany({
        where: { tenancyId: auth.tenancy.id, ...(subWhere ?? {}), ...customerTypeFilter },
        orderBy: baseOrder,
        take: limit,
      }),
      prisma.itemQuantityChange.findMany({
        where: { tenancyId: auth.tenancy.id, ...(iqcWhere ?? {}), ...customerTypeFilter },
        orderBy: baseOrder,
        take: limit,
      }),
      prisma.oneTimePurchase.findMany({
        where: { tenancyId: auth.tenancy.id, ...(otpWhere ?? {}), ...customerTypeFilter },
        orderBy: baseOrder,
        take: limit,
      }),
      prisma.subscriptionInvoice.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          ...(siWhere ?? {}),
          subscription: customerTypeFilter,
          isSubscriptionCreationInvoice: false,
        },
        include: {
          subscription: true
        },
        orderBy: baseOrder,
        take: limit,
      })
    ]);

    merged = [
      ...subscriptions.map((subscription) => ({
        source: "subscription" as const,
        id: subscription.id,
        createdAt: subscription.createdAt,
        transaction: buildSubscriptionTransaction({ subscription }),
      })),
      ...itemQuantityChanges.map((change) => ({
        source: "item_quantity_change" as const,
        id: change.id,
        createdAt: change.createdAt,
        transaction: buildItemQuantityChangeTransaction({ change }),
      })),
      ...oneTimePayments.map((purchase) => ({
        source: "one_time" as const,
        id: purchase.id,
        createdAt: purchase.createdAt,
        transaction: buildOneTimePurchaseTransaction({ purchase }),
      })),
      ...subscriptionInvoices.map((subscriptionInvoice) => ({
        source: "subscription-invoice" as const,
        id: subscriptionInvoice.id,
        createdAt: subscriptionInvoice.createdAt,
        transaction: buildSubscriptionRenewalTransaction({
          subscription: subscriptionInvoice.subscription,
          subscriptionInvoice: subscriptionInvoice
        })
      }))
    ].sort((a, b) => {
      if (a.createdAt.getTime() === b.createdAt.getTime()) {
        return a.id < b.id ? 1 : -1;
      }
      return a.createdAt.getTime() < b.createdAt.getTime() ? 1 : -1;
    });

    const filtered = merged.filter((row) => {
      if (!query.type) return true;
      return row.transaction.type === query.type;
    });

    const page = filtered.slice(0, limit);
    let lastSubId = "";
    let lastIqcId = "";
    let lastOtpId = "";
    let lastSiId = "";
    for (const r of page) {
      if (r.source === "subscription") lastSubId = r.id;
      if (r.source === "item_quantity_change") lastIqcId = r.id;
      if (r.source === "one_time") lastOtpId = r.id;
      if (r.source === "subscription-invoice") lastSiId = r.id;
    }

    const nextCursor = page.length === limit
      ? [lastSubId, lastIqcId, lastOtpId, lastSiId].join('|')
      : null;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        transactions: page.map((row) => row.transaction),
        next_cursor: nextCursor,
      },
    };
  },
});
