import { getAllTransactionsForCustomer, getItemQuantityForCustomer, getOwnedProductsForCustomer } from "@/lib/payments/ledger";
import { getTenancy, Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, PrismaClientTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

function ensureInternalProject(projectId: string) {
  if (projectId !== "internal") {
    throw new KnownErrors.ExpectedInternalProject();
  }
}

function sortDesc(arr: any[]) {
  return [...arr].sort((a: any, b: any) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));
}

function filterByWhere(arr: any[], where: any) {
  return arr.filter((item: any) => {
    if (where?.refundedAt?.not === null && !item.refundedAt) return false;
    if (where?.endedAt?.not === null && !item.endedAt) return false;
    if (where?.cancelAtPeriodEnd === true && !item.cancelAtPeriodEnd) return false;
    if (where?.endedAt === null && item.endedAt) return false;
    if (where?.isSubscriptionCreationInvoice === false && item.isSubscriptionCreationInvoice) return false;
    return true;
  });
}

function buildMockPrisma(mockDb: any): PrismaClientTransaction {
  const snapshots = sortDesc(mockDb.defaultProductsSnapshots ?? []);
  return {
    subscription: {
      findMany: async (opts: any) => sortDesc(filterByWhere(mockDb.subscriptions ?? [], opts?.where)),
      findUnique: async () => null,
    },
    oneTimePurchase: {
      findMany: async (opts: any) => sortDesc(filterByWhere(mockDb.oneTimePurchases ?? [], opts?.where)),
      findUnique: async () => null,
    },
    itemQuantityChange: {
      findMany: async (opts: any) => sortDesc(filterByWhere(mockDb.itemQuantityChanges ?? [], opts?.where)),
      findUnique: async () => null,
    },
    subscriptionInvoice: {
      findMany: async (opts: any) => sortDesc(filterByWhere(mockDb.subscriptionInvoices ?? [], opts?.where).map((si: any) => ({
        ...si,
        subscription: (mockDb.subscriptions ?? []).find((s: any) => s.stripeSubscriptionId === si.stripeSubscriptionId) ?? si.subscription,
      }))),
      findUnique: async () => null,
    },
    defaultProductsSnapshot: {
      findFirst: async () => snapshots[0] ?? null,
      findMany: async () => snapshots,
      findUnique: async () => null,
      create: async (args: any) => {
        const row = { id: `snap-${Date.now()}`, tenancyId: args.data.tenancyId, snapshot: args.data.snapshot, createdAt: new Date() };
        snapshots.unshift(row);
        return row;
      },
    },
    projectUser: { findUnique: async () => ({ id: 'mock-user' }) },
    team: { findUnique: async () => ({ id: 'mock-team' }) },
  } as any;
}

function parseDateFields(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string' && /^\d{4}-\d{2}-\d{2}/.test(obj)) {
    const d = new Date(obj);
    if (!isNaN(d.getTime())) return d;
  }
  if (Array.isArray(obj)) return obj.map(parseDateFields);
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = parseDateFields(value);
    }
    return result;
  }
  return obj;
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Ledger playground",
    description: "Runs ledger functions against live or mock data and returns timeline snapshots.",
    tags: ["Payments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      mode: yupString().oneOf(["live", "mock"]).defined(),
      tenancy_id: yupString().optional(),
      customer_type: yupString().oneOf(["user", "team", "custom"]).defined(),
      customer_id: yupString().defined(),
      start_millis: yupNumber().defined(),
      end_millis: yupNumber().defined(),
      mock_tenancy_config: yupObject({}).noUnknown(false).optional(),
      mock_db: yupObject({}).noUnknown(false).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      transactions: yupArray(yupObject({}).noUnknown(false)).defined(),
      snapshots: yupArray(yupObject({
        at_millis: yupNumber().defined(),
        owned_products: yupArray(yupObject({}).noUnknown(false)).defined(),
        item_quantities: yupObject({}).noUnknown(false).defined(),
      }).noUnknown(false)).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    ensureInternalProject(auth.tenancy.project.id);

    const customerType = body.customer_type as "user" | "team" | "custom";
    const customerId = body.customer_id;

    let tenancy: Tenancy;
    let prisma: PrismaClientTransaction;

    if (body.mode === "live") {
      if (!body.tenancy_id) {
        throw new StackAssertionError("tenancy_id is required for live mode");
      }
      const t = await getTenancy(body.tenancy_id);
      if (!t) {
        throw new StackAssertionError("Tenancy not found");
      }
      tenancy = t;
      prisma = await getPrismaClientForTenancy(tenancy);
    } else {
      const mockConfig = parseDateFields(body.mock_tenancy_config ?? {});
      const mockDb = parseDateFields(body.mock_db ?? {});
      tenancy = {
        id: "mock-tenancy",
        config: { payments: { products: {}, productLines: {}, items: {}, ...mockConfig } },
        branchId: "main",
        organization: null,
        project: { id: "mock-project" },
      } as any;
      prisma = buildMockPrisma(mockDb);
    }

    const allTransactions = await getAllTransactionsForCustomer(prisma, tenancy, customerType, customerId);

    const txTimestamps = allTransactions
      .map((tx) => tx.effective_at_millis)
      .filter((ms) => ms >= body.start_millis && ms <= body.end_millis);
    txTimestamps.push(body.end_millis);
    const uniqueTimestamps = [...new Set(txTimestamps)].sort((a, b) => a - b);

    const allItemIds = new Set<string>();
    for (const tx of allTransactions) {
      for (const entry of tx.entries) {
        if ((entry.type === "item-quantity-change" || entry.type === "item-quantity-expire") && 'item_id' in entry) {
          allItemIds.add(entry.item_id);
        }
        if (entry.type === "product-grant" && 'product' in entry) {
          for (const itemId of Object.keys((entry.product as any).included_items ?? {})) {
            allItemIds.add(itemId);
          }
        }
      }
    }

    const snapshots: Array<{
      at_millis: number,
      owned_products: any[],
      item_quantities: Record<string, number>,
    }> = [];

    for (const timestamp of uniqueTimestamps) {
      const now = new Date(timestamp);

      const ownedProducts = await getOwnedProductsForCustomer({
        prisma, tenancy, customerType, customerId, now,
      });

      const itemQuantities: Record<string, number> = {};
      for (const itemId of allItemIds) {
        itemQuantities[itemId] = await getItemQuantityForCustomer({
          prisma, tenancy, itemId, customerId, customerType, now,
        });
      }

      snapshots.push({
        at_millis: timestamp,
        owned_products: ownedProducts.map((p) => ({
          id: p.id,
          type: p.type,
          quantity: p.quantity,
          product: p.product,
          created_at_millis: p.createdAt.getTime(),
          source_id: p.sourceId,
        })),
        item_quantities: itemQuantities,
      });
    }

    const filteredTransactions = allTransactions.filter(
      (tx) => tx.effective_at_millis >= body.start_millis && tx.effective_at_millis <= body.end_millis
    );

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        transactions: filteredTransactions as any,
        snapshots,
      },
    };
  },
});
