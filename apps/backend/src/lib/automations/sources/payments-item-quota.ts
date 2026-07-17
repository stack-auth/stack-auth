import { PrismaClientTransaction } from "@/prisma-client";
import {
  getItemQuantityForCustomer,
  getOwnedProductsForCustomer,
  getSubscriptionMapForCustomer,
} from "@/lib/payments/customer-data";
import { AutomationSourceAdapter, AutomationSourceDecision, AutomationSourceEvaluationResult } from "../rule-evaluator";
import { AutomationRuleTenancy, NonRetryableAutomationRuleError, PaymentsItemQuotaAutomationRule, paymentsItemQuotaSourceType } from "../rules";

export type PaymentsItemQuotaProjectUserPage = {
  projectUserIds: string[],
  nextCursor: string | null,
};

export type PaymentsItemQuotaProjectUserReader<TPrisma> = {
  listCandidateUserIds: (options: {
    prisma: TPrisma,
    tenancyId: string,
    limit: number,
    cursor?: string | null,
  }) => Promise<PaymentsItemQuotaProjectUserPage>,
};

export type PaymentsItemQuotaProjectUserPrisma = {
  projectUser: {
    findMany: (options: {
      where: {
        tenancyId: string,
        projectUserId?: {
          gt: string,
        },
      },
      orderBy: {
        projectUserId: "asc",
      },
      take: number,
      select: {
        projectUserId: true,
      },
    }) => Promise<Array<{ projectUserId: string }>>,
  },
};

export const prismaPaymentsItemQuotaProjectUserReader: PaymentsItemQuotaProjectUserReader<PaymentsItemQuotaProjectUserPrisma> = {
  async listCandidateUserIds(options) {
    const rows = await options.prisma.projectUser.findMany({
      where: {
        tenancyId: options.tenancyId,
        ...(options.cursor == null ? {} : {
          projectUserId: {
            gt: options.cursor,
          },
        }),
      },
      orderBy: {
        projectUserId: "asc",
      },
      take: options.limit,
      select: {
        projectUserId: true,
      },
    });

    return {
      projectUserIds: rows.map((row) => row.projectUserId),
      nextCursor: rows.length === options.limit ? rows[rows.length - 1]?.projectUserId ?? null : null,
    };
  },
};

export type PaymentsItemQuotaOwnedProduct = {
  quantity: number,
  product: {
    includedItems?: Record<string, {
      quantity?: number,
    } | undefined>,
  },
  productLineId?: string | null,
};

export type PaymentsItemQuotaSubscription = {
  status: string,
};

export type PaymentsItemQuotaCustomerDataReaders<TPrisma> = {
  getItemQuantityForCustomer: (options: {
    prisma: TPrisma,
    tenancyId: string,
    itemId: string,
    customerId: string,
    customerType: "user",
  }) => Promise<number>,
  getOwnedProductsForCustomer: (options: {
    prisma: TPrisma,
    tenancyId: string,
    customerType: "user",
    customerId: string,
  }) => Promise<Record<string, PaymentsItemQuotaOwnedProduct>>,
  getSubscriptionMapForCustomer: (options: {
    prisma: TPrisma,
    tenancyId: string,
    customerType: "user",
    customerId: string,
  }) => Promise<Record<string, PaymentsItemQuotaSubscription>>,
};

export const paymentsItemQuotaCustomerDataReaders: PaymentsItemQuotaCustomerDataReaders<PrismaClientTransaction> = {
  getItemQuantityForCustomer,
  getOwnedProductsForCustomer,
  getSubscriptionMapForCustomer,
};

export function createPaymentsItemQuotaSourceAdapter<TPrisma>(options: {
  prisma: TPrisma,
  projectUserReader: PaymentsItemQuotaProjectUserReader<TPrisma>,
  customerDataReaders: PaymentsItemQuotaCustomerDataReaders<TPrisma>,
}): AutomationSourceAdapter {
  return {
    evaluate: async (evaluateOptions) => await evaluatePaymentsItemQuotaSource({
      ...evaluateOptions,
      prisma: options.prisma,
      projectUserReader: options.projectUserReader,
      customerDataReaders: options.customerDataReaders,
    }),
  };
}

async function evaluatePaymentsItemQuotaSource<TPrisma>(options: {
  prisma: TPrisma,
  projectUserReader: PaymentsItemQuotaProjectUserReader<TPrisma>,
  customerDataReaders: PaymentsItemQuotaCustomerDataReaders<TPrisma>,
  tenancy: AutomationRuleTenancy,
  ruleId: string,
  rule: PaymentsItemQuotaAutomationRule,
  limit?: number,
  cursor?: string | null,
}): Promise<AutomationSourceEvaluationResult> {
  const itemId = options.rule.source.itemId;
  const item = options.tenancy.config.payments?.items?.[itemId];
  if (item === undefined) {
    throw new NonRetryableAutomationRuleError("missing-item", `Automation rule "${options.ruleId}" references payments item "${itemId}", but that item does not exist.`);
  }
  if (item.customerType !== "user") {
    throw new NonRetryableAutomationRuleError("incompatible-item", `Automation rule "${options.ruleId}" references payments item "${itemId}" with customerType "${item.customerType ?? "<missing>"}"; V1 supports only user items.`);
  }

  const limit = normalizeLimit(options.limit);
  const page = await options.projectUserReader.listCandidateUserIds({
    prisma: options.prisma,
    tenancyId: options.tenancy.id,
    limit,
    cursor: options.cursor,
  });

  const decisions: AutomationSourceDecision[] = [];
  for (const projectUserId of page.projectUserIds) {
    const [currentQuantity, ownedProducts, subscriptionMap] = await Promise.all([
      options.customerDataReaders.getItemQuantityForCustomer({
        prisma: options.prisma,
        tenancyId: options.tenancy.id,
        itemId,
        customerId: projectUserId,
        customerType: "user",
      }),
      options.customerDataReaders.getOwnedProductsForCustomer({
        prisma: options.prisma,
        tenancyId: options.tenancy.id,
        customerType: "user",
        customerId: projectUserId,
      }),
      options.customerDataReaders.getSubscriptionMapForCustomer({
        prisma: options.prisma,
        tenancyId: options.tenancy.id,
        customerType: "user",
        customerId: projectUserId,
      }),
    ]);

    const entitlementQuantity = getEntitlementQuantity(ownedProducts, itemId);
    const thresholdKind = getThresholdKind({
      currentQuantity,
      entitlementQuantity,
      rule: options.rule,
    });
    if (thresholdKind === null) {
      continue;
    }

    const ownedProductIds = getOwnedProductIds(ownedProducts);
    const activeSubscriptionIds = getActiveSubscriptionIds(subscriptionMap);
    decisions.push({
      subject: {
        type: "user",
        id: projectUserId,
      },
      signal: {
        key: `${itemId}:${thresholdKind}`,
        kind: thresholdKind,
      },
      sourceSnapshot: {
        sourceType: paymentsItemQuotaSourceType,
        itemId,
        itemDisplayName: item.displayName ?? itemId,
        currentQuantity,
        entitlementQuantity: entitlementQuantity > 0 ? entitlementQuantity : null,
        thresholdKind,
        ownedProductIds,
        activeSubscriptionIds,
      },
    });
  }

  return {
    evaluatedCount: page.projectUserIds.length,
    nextCursor: page.nextCursor,
    decisions,
  };
}

function normalizeLimit(limit: number | undefined) {
  if (limit === undefined) return 100;
  return Math.max(1, Math.min(Math.floor(limit), 1000));
}

function getEntitlementQuantity(ownedProducts: Record<string, PaymentsItemQuotaOwnedProduct>, itemId: string) {
  return Object.values(ownedProducts).reduce((sum, ownedProduct) => {
    const includedQuantity = ownedProduct.product.includedItems?.[itemId]?.quantity ?? 0;
    return sum + includedQuantity * ownedProduct.quantity;
  }, 0);
}

function getThresholdKind(options: {
  currentQuantity: number,
  entitlementQuantity: number,
  rule: PaymentsItemQuotaAutomationRule,
}): "near" | "over" | null {
  const thresholds = options.rule.source.thresholds;
  if (thresholds.overLimitQuantity !== undefined && options.currentQuantity <= thresholds.overLimitQuantity) {
    return "over";
  }
  if (thresholds.nearRemainingQuantity !== undefined && options.currentQuantity <= thresholds.nearRemainingQuantity) {
    return "near";
  }
  if (
    thresholds.nearRemainingRatio !== undefined &&
    options.entitlementQuantity > 0 &&
    options.currentQuantity / options.entitlementQuantity <= thresholds.nearRemainingRatio
  ) {
    return "near";
  }
  return null;
}

function getOwnedProductIds(ownedProducts: Record<string, PaymentsItemQuotaOwnedProduct>) {
  return Object.keys(ownedProducts).filter((productId) => productId !== "__null__");
}

function getActiveSubscriptionIds(subscriptionMap: Record<string, PaymentsItemQuotaSubscription>) {
  return Object.entries(subscriptionMap)
    .filter(([, subscription]) => subscription.status === "active" || subscription.status === "trialing")
    .map(([subscriptionId]) => subscriptionId);
}
