import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { AdminTransaction, adminTransaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";


function resolveSelectedPriceFromOffer(offer: any, priceId?: string | null): any | null {
  if (!offer) return null;
  if (!priceId) return null;
  const prices = offer.prices;
  if (!prices || prices === "include-by-default") return null;
  const selected = prices[priceId];
  if (!selected) return null;
  const { serverOnly: _serverOnly, freeTrial: _freeTrial, ...rest } = selected as any;
  return rest;
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
        where: {
          tenancyId: auth.tenancy.id,
          ...(subWhere ?? {}),
          ...(query.customer_type ? { customerType: typedToUppercase(query.customer_type) as any } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
      prisma.itemQuantityChange.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          ...(iqcWhere ?? {}),
          ...(query.customer_type ? { customerType: typedToUppercase(query.customer_type) as any } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
      prisma.oneTimePurchase.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          ...(otpWhere ?? {}),
          ...(query.customer_type ? { customerType: typedToUppercase(query.customer_type) as any } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
    ]);


    const subRows: AdminTransaction[] = subs.map((s) => ({
      id: s.id,
      type: 'subscription',
      created_at_millis: s.createdAt.getTime(),
      customer_type: typedToLowercase(s.customerType) as 'user' | 'team' | 'custom',
      customer_id: s.customerId,
      quantity: s.quantity,
      test_mode: s.creationSource === 'TEST_MODE',
      offer_display_name: (s.offer as any)?.displayName ?? null,
      price: resolveSelectedPriceFromOffer(s.offer as any, (s as any).priceId),
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
      customer_type: typedToLowercase(o.customerType) as 'user' | 'team' | 'custom',
      customer_id: o.customerId,
      quantity: o.quantity,
      test_mode: o.creationSource === 'TEST_MODE',
      offer_display_name: (o.offer as any)?.displayName ?? null,
      price: resolveSelectedPriceFromOffer(o.offer as any, o.priceId as any),
      status: null,
    }));

    let merged = [...subRows, ...iqcRows, ...otpRows]
      .sort((a, b) => (a.created_at_millis === b.created_at_millis ? (a.id < b.id ? 1 : -1) : (a.created_at_millis < b.created_at_millis ? 1 : -1)));

    // Filter by type if provided (applied after merging since we fetch three tables)
    if (query.type) {
      merged = merged.filter(t => t.type === query.type);
    }

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


