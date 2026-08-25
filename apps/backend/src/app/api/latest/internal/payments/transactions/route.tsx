import { fetchBulldozerServerJson } from "@/lib/bulldozer-server-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { TRANSACTION_TYPES, transactionSchema, type Transaction } from "@hexclave/shared/dist/interface/crud/transactions";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@hexclave/shared/dist/utils/currency-constants";
import { stripeUnitsToMoneyAmount } from "@hexclave/shared/dist/utils/currencies";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD")
  ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

async function applyPromoDiscountsToPurchaseTransactions(options: {
  tenancy: Parameters<typeof getPrismaClientForTenancy>[0],
  transactions: Transaction[],
}): Promise<Transaction[]> {
  const oneTimePurchaseIds = new Set<string>();
  const subscriptionIds = new Set<string>();
  for (const transaction of options.transactions) {
    if (transaction.type !== "purchase") continue;
    for (const entry of transaction.entries) {
      if (entry.type !== "product_grant") continue;
      if (entry.one_time_purchase_id != null) oneTimePurchaseIds.add(entry.one_time_purchase_id);
      if (entry.subscription_id != null) subscriptionIds.add(entry.subscription_id);
    }
  }
  if (oneTimePurchaseIds.size === 0 && subscriptionIds.size === 0) return options.transactions;

  const prisma = await getPrismaClientForTenancy(options.tenancy);
  const redemptions = await prisma.promoCodeRedemption.findMany({
    where: {
      tenancyId: options.tenancy.id,
      status: "APPLIED",
      OR: [
        ...(oneTimePurchaseIds.size > 0 ? [{ oneTimePurchaseId: { in: [...oneTimePurchaseIds] } }] : []),
        ...(subscriptionIds.size > 0 ? [{ subscriptionId: { in: [...subscriptionIds] } }] : []),
      ],
    },
    select: {
      oneTimePurchaseId: true,
      subscriptionId: true,
      finalAmountUsdCents: true,
    },
    orderBy: [{ appliedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  const finalAmountByPurchaseId = new Map<string, number>();
  const finalAmountBySubscriptionId = new Map<string, number>();
  for (const redemption of redemptions) {
    if (redemption.oneTimePurchaseId != null && !finalAmountByPurchaseId.has(redemption.oneTimePurchaseId)) {
      finalAmountByPurchaseId.set(redemption.oneTimePurchaseId, redemption.finalAmountUsdCents);
    }
    if (redemption.subscriptionId != null && !finalAmountBySubscriptionId.has(redemption.subscriptionId)) {
      finalAmountBySubscriptionId.set(redemption.subscriptionId, redemption.finalAmountUsdCents);
    }
  }

  return options.transactions.map((transaction) => {
    if (transaction.type !== "purchase") return transaction;
    const grant = transaction.entries.find((entry) => entry.type === "product_grant");
    if (grant?.type !== "product_grant") return transaction;
    const finalAmountUsdCents = grant.one_time_purchase_id != null
      ? finalAmountByPurchaseId.get(grant.one_time_purchase_id)
      : grant.subscription_id != null
        ? finalAmountBySubscriptionId.get(grant.subscription_id)
        : undefined;
    if (finalAmountUsdCents == null) return transaction;
    const finalAmountUsd = stripeUnitsToMoneyAmount(finalAmountUsdCents, USD_CURRENCY);
    return {
      ...transaction,
      entries: transaction.entries.map((entry) => entry.type === "money_transfer" ? {
        ...entry,
        charged_amount: { ...entry.charged_amount, USD: finalAmountUsd },
        net_amount: { USD: finalAmountUsd },
      } : entry),
    };
  });
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
      type: yupString().oneOf(TRANSACTION_TYPES).optional(),
      customer_type: yupString().oneOf(['user', 'team', 'custom']).optional(),
      customer_id: yupString().optional(),
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
    const rawLimit = query.limit ?? "50";
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));
    const searchParams = new URLSearchParams({
      limit: String(limit),
    });
    if (query.cursor != null) searchParams.set("cursor", query.cursor);
    if (query.type != null) searchParams.set("type", query.type);
    if (query.customer_type != null) searchParams.set("customer_type", query.customer_type);
    if (query.customer_id != null) searchParams.set("customer_id", query.customer_id);
    const { transactions, next_cursor } = await fetchBulldozerServerJson<{
      transactions: Transaction[],
      next_cursor: string | null,
    }>({
      method: "GET",
      path: `/v1/${encodeURIComponent(auth.tenancy.id)}/transactions?${searchParams.toString()}`,
    });

    const promoAdjustedTransactions = await applyPromoDiscountsToPurchaseTransactions({
      tenancy: auth.tenancy,
      transactions,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        transactions: promoAdjustedTransactions,
        next_cursor,
      },
    };
  },
});
