import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma } from "@prisma/client";
import { transactionSchema, type Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { buildItemQuantityChangeTransaction, buildOneTimePurchaseTransaction, buildSubscriptionTransaction } from "./transaction-builder";

type TransactionSource = "subscription" | "item_quantity_change" | "one_time";

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
      type: yupString().oneOf(['subscription', 'one_time', 'item_quantity_change']).optional(),
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
    const [subCursor, iqcCursor, otpCursor] = (cursorStr.split("|") as [string?, string?, string?]);

    const paginateWhere = async <T extends "subscription" | "itemQuantityChange" | "oneTimePurchase">(
      table: T,
      cursorId?: string
    ): Promise<
      T extends "subscription"
      ? Prisma.SubscriptionWhereInput | undefined
      : T extends "itemQuantityChange"
      ? Prisma.ItemQuantityChangeWhereInput | undefined
      : Prisma.OneTimePurchaseWhereInput | undefined
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
      } else {
        pivot = await prisma.oneTimePurchase.findUnique({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: cursorId } },
          select: { createdAt: true },
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

    const [subWhere, iqcWhere, otpWhere] = await Promise.all([
      paginateWhere("subscription", subCursor),
      paginateWhere("itemQuantityChange", iqcCursor),
      paginateWhere("oneTimePurchase", otpCursor),
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

    const [subs, iqcs, otps] = await Promise.all([
      (query.type === "subscription" || !query.type) ? prisma.subscription.findMany({
        where: { tenancyId: auth.tenancy.id, ...(subWhere ?? {}), ...customerTypeFilter },
        orderBy: baseOrder,
        take: limit,
      }) : [],
      (query.type === "item_quantity_change" || !query.type) ? prisma.itemQuantityChange.findMany({
        where: { tenancyId: auth.tenancy.id, ...(iqcWhere ?? {}), ...customerTypeFilter },
        orderBy: baseOrder,
        take: limit,
      }) : [],
      (query.type === "one_time" || !query.type) ? prisma.oneTimePurchase.findMany({
        where: { tenancyId: auth.tenancy.id, ...(otpWhere ?? {}), ...customerTypeFilter },
        orderBy: baseOrder,
        take: limit,
      }) : [],
    ]);

    merged = [
      ...subs.map((subscription) => ({
        source: "subscription" as const,
        id: subscription.id,
        createdAt: subscription.createdAt,
        transaction: buildSubscriptionTransaction({ subscription }),
      })),
      ...iqcs.map((change) => ({
        source: "item_quantity_change" as const,
        id: change.id,
        createdAt: change.createdAt,
        transaction: buildItemQuantityChangeTransaction({ change, tenancy: auth.tenancy }),
      })),
      ...otps.map((purchase) => ({
        source: "one_time" as const,
        id: purchase.id,
        createdAt: purchase.createdAt,
        transaction: buildOneTimePurchaseTransaction({ purchase }),
      })),
    ].sort((a, b) => {
      if (a.createdAt.getTime() === b.createdAt.getTime()) {
        return a.id < b.id ? 1 : -1;
      }
      return a.createdAt.getTime() < b.createdAt.getTime() ? 1 : -1;
    });

    const page = merged.slice(0, limit);
    let lastSubId = "";
    let lastIqcId = "";
    let lastOtpId = "";
    for (const r of page) {
      if (r.source === "subscription") lastSubId = r.id;
      if (r.source === "item_quantity_change") lastIqcId = r.id;
      if (r.source === "one_time") lastOtpId = r.id;
    }

    const nextCursor = page.length === limit
      ? [lastSubId, lastIqcId, lastOtpId].join('|')
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

