import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToLowercase } from "@stackframe/stack-shared/dist/utils/strings";

type PriceInfo = { currency: string, unit_amount: number, interval: null | [number, 'day' | 'week' | 'month' | 'year'] };

function resolvePriceFromOffer(offer: any, priceId?: string | null): PriceInfo | null {
  if (!offer) return null;
  if (!priceId) return null;
  const prices = offer.prices;
  if (!prices || prices === "include-by-default") return null;
  const selected = prices[priceId];
  if (!selected) return null;
  // Prefer USD if present; otherwise pick the first defined currency key
  if (selected.USD) {
    return {
      currency: "usd",
      unit_amount: Number(selected.USD),
      interval: selected.interval ?? null,
    };
  }
  const currencyKey = Object.keys(selected).find((k) => k !== "interval" && k !== "freeTrial" && selected[k] != null);
  if (currencyKey) {
    return {
      currency: String(currencyKey).toLowerCase(),
      unit_amount: Number(selected[currencyKey]),
      interval: selected.interval ?? null,
    };
  }
  return null;
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
      limit: yupString().optional(), // numbers come in as strings
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      purchases: yupMixed().defined(),
      next_cursor: yupString().nullable().defined(),
    }).defined(),
  }),
  handler: async ({ auth, query }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50)));
    const cursorStr = query.cursor ?? "";
    const [subCursor, iqcCursor, otpCursor] = (cursorStr.split("|") as [string?, string?, string?]);

    // Helper to build where for pagination by createdAt desc then id desc
    const paginateWhere = async (table: "subscription" | "itemQuantityChange" | "oneTimePurchase", cursorId?: string) => {
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
      } as const;
    };

    const [subWhere, iqcWhere, otpWhere] = await Promise.all([
      paginateWhere("subscription", subCursor),
      paginateWhere("itemQuantityChange", iqcCursor),
      paginateWhere("oneTimePurchase", otpCursor),
    ]);

    const [subs, iqcs, otps] = await Promise.all([
      prisma.subscription.findMany({
        where: { tenancyId: auth.tenancy.id, ...(subWhere ?? {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
      prisma.itemQuantityChange.findMany({
        where: { tenancyId: auth.tenancy.id, ...(iqcWhere ?? {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
      prisma.oneTimePurchase.findMany({
        where: { tenancyId: auth.tenancy.id, ...(otpWhere ?? {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
    ]);

    type AdminPurchase = {
      id: string,
      kind: 'subscription' | 'one_time' | 'item_quantity_change',
      created_at_millis: number,
      customer_type: 'user' | 'team' | 'custom',
      customer_id: string,
      quantity: number,
      test_mode: boolean,
      offer_id: string | null,
      offer_display_name: string | null,
      price: null | PriceInfo,
      status: string | null,
      item_id?: string,
      description?: string | null,
      expires_at_millis?: number | null,
    };

    const subRows: AdminPurchase[] = subs.map((s) => ({
      id: s.id,
      kind: 'subscription',
      created_at_millis: s.createdAt.getTime(),
      customer_type: typedToLowercase(s.customerType) as 'user' | 'team' | 'custom',
      customer_id: s.customerId,
      quantity: s.quantity,
      test_mode: s.creationSource === 'TEST_MODE',
      offer_id: s.offerId ?? null,
      offer_display_name: (s.offer as any)?.displayName ?? null,
      price: resolvePriceFromOffer(s.offer as any, (s as any).priceId),
      status: s.status,
    }));

    const iqcRows: AdminPurchase[] = iqcs.map((i) => {
      const itemCfg = getOrUndefined(auth.tenancy.config.payments.items, i.itemId) as { customerType?: 'user' | 'team' | 'custom' } | undefined;
      const customerType = (itemCfg && itemCfg.customerType) ? itemCfg.customerType : 'custom';
      return {
        id: i.id,
        kind: 'item_quantity_change',
        created_at_millis: i.createdAt.getTime(),
        customer_type: customerType,
        customer_id: i.customerId,
        quantity: i.quantity,
        test_mode: false,
        offer_id: null,
        offer_display_name: null,
        price: null,
        status: null,
        item_id: i.itemId,
        description: i.description ?? null,
        expires_at_millis: i.expiresAt ? i.expiresAt.getTime() : null,
      } as const;
    });

    const otpRows: AdminPurchase[] = otps.map((o) => ({
      id: o.id,
      kind: 'one_time',
      created_at_millis: o.createdAt.getTime(),
      customer_type: typedToLowercase(o.customerType) as 'user' | 'team' | 'custom',
      customer_id: o.customerId,
      quantity: o.quantity,
      test_mode: o.creationSource === 'TEST_MODE',
      offer_id: o.offerId ?? null,
      offer_display_name: (o.offer as any)?.displayName ?? null,
      price: resolvePriceFromOffer(o.offer as any, o.priceId as any),
      status: null,
    }));

    const merged = [...subRows, ...iqcRows, ...otpRows]
      .sort((a, b) => (a.created_at_millis === b.created_at_millis ? (a.id < b.id ? 1 : -1) : (a.created_at_millis < b.created_at_millis ? 1 : -1)));

    const page = merged.slice(0, limit);

    let lastSubId = "";
    let lastIqcId = "";
    let lastOtpId = "";
    for (const r of page) {
      if (r.kind === 'subscription') lastSubId = r.id;
      if (r.kind === 'item_quantity_change') lastIqcId = r.id;
      if (r.kind === 'one_time') lastOtpId = r.id;
    }

    const nextCursor = page.length === limit
      ? [lastSubId, lastIqcId, lastOtpId].join('|')
      : null;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        purchases: page,
        next_cursor: nextCursor,
      },
    };
  },
});


