import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma } from "@prisma/client";
import { AdminTransaction, adminTransaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";


type SelectedPrice = NonNullable<AdminTransaction['price']>;
type OfferWithPrices = {
  displayName?: string,
  prices?: Record<string, SelectedPrice & { serverOnly?: unknown, freeTrial?: unknown }> | "include-by-default",
} | null | undefined;

function resolveSelectedPriceFromOffer(offer: OfferWithPrices, priceId?: string | null): SelectedPrice | null {
  if (!offer) return null;
  if (!priceId) return null;
  const prices = offer.prices;
  if (!prices || prices === "include-by-default") return null;
  const selected = prices[priceId as keyof typeof prices] as (SelectedPrice & { serverOnly?: unknown, freeTrial?: unknown }) | undefined;
  if (!selected) return null;
  const { serverOnly: _serverOnly, freeTrial: _freeTrial, ...rest } = selected as any;
  return rest as SelectedPrice;
}

function getOfferDisplayName(offer: OfferWithPrices): string | null {
  return offer?.displayName ?? null;
}


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
      transactions: yupArray(adminTransaction).defined(),
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

    let merged: AdminTransaction[] = [];

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

    const subRows: AdminTransaction[] = subs.map((s) => ({
      id: s.id,
      type: 'subscription',
      created_at_millis: s.createdAt.getTime(),
      customer_type: typedToLowercase(s.customerType),
      customer_id: s.customerId,
      quantity: s.quantity,
      test_mode: s.creationSource === 'TEST_MODE',
      offer_display_name: getOfferDisplayName(s.offer as OfferWithPrices),
      price: resolveSelectedPriceFromOffer(s.offer as OfferWithPrices, s.priceId ?? null),
      status: s.status,
    }));

    const iqcRows: AdminTransaction[] = iqcs.map((i) => {
      const itemCfg = getOrUndefined(auth.tenancy.config.payments.items, i.itemId) as { customerType?: 'user' | 'team' | 'custom' } | undefined;
      const customerType = (itemCfg && itemCfg.customerType) ? itemCfg.customerType : 'custom';
      return {
        id: i.id,
        type: 'item_quantity_change',
        created_at_millis: i.createdAt.getTime(),
        customer_type: customerType,
        customer_id: i.customerId,
        quantity: i.quantity,
        test_mode: false,
        offer_display_name: null,
        price: null,
        status: null,
        item_id: i.itemId,
        description: i.description ?? null,
        expires_at_millis: i.expiresAt ? i.expiresAt.getTime() : null,
      } as const;
    });

    const otpRows: AdminTransaction[] = otps.map((o) => ({
      id: o.id,
      type: 'one_time',
      created_at_millis: o.createdAt.getTime(),
      customer_type: typedToLowercase(o.customerType),
      customer_id: o.customerId,
      quantity: o.quantity,
      test_mode: o.creationSource === 'TEST_MODE',
      offer_display_name: getOfferDisplayName(o.offer as OfferWithPrices),
      price: resolveSelectedPriceFromOffer(o.offer as OfferWithPrices, o.priceId ?? null),
      status: null,
    }));

    merged = [...subRows, ...iqcRows, ...otpRows]
      .sort((a, b) => (a.created_at_millis === b.created_at_millis ? (a.id < b.id ? 1 : -1) : (a.created_at_millis < b.created_at_millis ? 1 : -1)));

    const page = merged.slice(0, limit);
    let lastSubId = "";
    let lastIqcId = "";
    let lastOtpId = "";
    for (const r of page) {
      if (r.type === 'subscription') lastSubId = r.id;
      if (r.type === 'item_quantity_change') lastIqcId = r.id;
      if (r.type === 'one_time') lastOtpId = r.id;
    }

    const nextCursor = page.length === limit
      ? [lastSubId, lastIqcId, lastOtpId].join('|')
      : null;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        transactions: page,
        next_cursor: nextCursor,
      },
    };
  },
});


