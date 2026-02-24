import { KnownErrors } from '@stackframe/stack-shared';
import { describe, expect, it, vi } from 'vitest';
import type { Tenancy } from '../tenancies';
import { getPurchaseContext, validatePurchaseSession } from './implementation';

let _currentMockPrisma: any = null;
vi.mock('@/prisma-client', () => ({
  getPrismaClientForTenancy: async () => _currentMockPrisma,
}));

function sortDesc(arr: any[]) {
  return [...arr].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function filterByWhere(arr: any[], where: any) {
  return arr.filter((item) => {
    if (where?.refundedAt?.not === null && !item.refundedAt) return false;
    if (where?.endedAt?.not === null && !item.endedAt) return false;
    if (where?.cancelAtPeriodEnd === true && !item.cancelAtPeriodEnd) return false;
    if (where?.endedAt === null && item.endedAt) return false;
    if (where?.isSubscriptionCreationInvoice === false && item.isSubscriptionCreationInvoice) return false;
    return true;
  });
}

function createMockPrisma(data: {
  subscriptions?: any[],
  oneTimePurchases?: any[],
  itemQuantityChanges?: any[],
  subscriptionInvoices?: any[],
} = {}) {
  const snapshots: any[] = [];
  const mock = {
    subscription: {
      findMany: async (opts: any) => sortDesc(filterByWhere(data.subscriptions ?? [], opts?.where)),
      findUnique: async () => null,
    },
    oneTimePurchase: {
      findMany: async (opts: any) => sortDesc(filterByWhere(data.oneTimePurchases ?? [], opts?.where)),
      findUnique: async () => null,
    },
    itemQuantityChange: {
      findMany: async (opts: any) => sortDesc(filterByWhere(data.itemQuantityChanges ?? [], opts?.where)),
      findUnique: async () => null,
    },
    subscriptionInvoice: {
      findMany: async (opts: any) => sortDesc(filterByWhere(data.subscriptionInvoices ?? [], opts?.where)),
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
    projectUser: {
      findUnique: async () => ({ id: 'user-1' }),
    },
    team: {
      findUnique: async () => ({ id: 'team-1' }),
    },
  };
  _currentMockPrisma = mock;
  return mock as any;
}

function createMockTenancy(config: Partial<Tenancy['config']['payments']>, id: string = 'tenancy-1'): Tenancy {
  return {
    id,
    config: {
      payments: {
        products: {},
        productLines: {},
        items: {},
        ...config,
      },
    } as any,
    branchId: 'main',
    organization: null,
    project: { id: 'project-1' },
  } as any;
}

function createSubRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    tenancyId: 'tenancy-1',
    customerId: 'cust-1',
    customerType: 'CUSTOM',
    productId: null,
    priceId: null,
    product: { displayName: 'X', customerType: 'custom', includedItems: {}, prices: 'include-by-default', isAddOnTo: false },
    quantity: 1,
    stripeSubscriptionId: null,
    status: 'active',
    currentPeriodStart: new Date('2025-01-01'),
    currentPeriodEnd: new Date('2025-02-01'),
    cancelAtPeriodEnd: false,
    endedAt: null,
    refundedAt: null,
    billingCycleAnchor: null,
    creationSource: 'PURCHASE_PAGE',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function createOtpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    tenancyId: 'tenancy-1',
    customerId: 'cust-1',
    customerType: 'CUSTOM',
    productId: null,
    priceId: null,
    product: { displayName: 'X', customerType: 'custom', includedItems: {}, prices: 'include-by-default', isAddOnTo: false },
    quantity: 1,
    stripePaymentIntentId: null,
    refundedAt: null,
    creationSource: 'PURCHASE_PAGE',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

describe('validatePurchaseSession - one-time purchase rules', () => {
  it('blocks duplicate one-time purchase for same productId', async () => {
    const tenancy = createMockTenancy({ items: {}, products: {}, productLines: {} });
    const prisma = createMockPrisma({
      oneTimePurchases: [createOtpRow({ productId: 'product-dup', product: { displayName: 'X', customerType: 'custom', productLineId: undefined, includedItems: {}, prices: 'include-by-default', isAddOnTo: false } })],
    });

    await expect(validatePurchaseSession({
      prisma, tenancy,
      codeData: { tenancyId: tenancy.id, customerId: 'cust-1', productId: 'product-dup',
        product: { displayName: 'X', productLineId: undefined, customerType: 'custom', freeTrial: undefined, serverOnly: false, stackable: false, prices: 'include-by-default', includedItems: {}, isAddOnTo: false },
      },
      priceId: 'price-any', quantity: 1,
    })).rejects.toThrowError(new KnownErrors.ProductAlreadyGranted('product-dup', 'cust-1'));
  });

  it('blocks one-time purchase when another one exists in the same product line', async () => {
    const tenancy = createMockTenancy({ items: {}, products: {}, productLines: { g1: { displayName: 'G1', customerType: 'custom' } } });
    const prisma = createMockPrisma({
      oneTimePurchases: [createOtpRow({ productId: 'other-product', product: { displayName: 'O', customerType: 'custom', productLineId: 'g1', includedItems: {}, prices: 'include-by-default', isAddOnTo: false } })],
    });

    await expect(validatePurchaseSession({
      prisma, tenancy,
      codeData: { tenancyId: tenancy.id, customerId: 'cust-1', productId: 'product-y',
        product: { displayName: 'Y', productLineId: 'g1', customerType: 'custom', freeTrial: undefined, serverOnly: false, stackable: false, prices: 'include-by-default', includedItems: {}, isAddOnTo: false },
      },
      priceId: 'price-any', quantity: 1,
    })).rejects.toThrowError('Customer already has a one-time purchase in this product line');
  });

  it('allows purchase when existing one-time is in a different product line', async () => {
    const tenancy = createMockTenancy({ items: {}, products: {}, productLines: { g1: { displayName: 'G1', customerType: 'custom' }, g2: { displayName: 'G2', customerType: 'custom' } } });
    const prisma = createMockPrisma({
      oneTimePurchases: [createOtpRow({ productId: 'other-product', product: { displayName: 'O', customerType: 'custom', productLineId: 'g2', includedItems: {}, prices: 'include-by-default', isAddOnTo: false } })],
    });

    const res = await validatePurchaseSession({
      prisma, tenancy,
      codeData: { tenancyId: tenancy.id, customerId: 'cust-1', productId: 'product-z',
        product: { displayName: 'Z', productLineId: 'g1', customerType: 'custom', freeTrial: undefined, serverOnly: false, stackable: false, prices: 'include-by-default', includedItems: {}, isAddOnTo: false },
      },
      priceId: 'price-any', quantity: 1,
    });
    expect(res.purchaseContext.productLineId).toBe('g1');
    expect(res.purchaseContext.conflictingProducts.length).toBe(0);
  });

  it('allows stackable duplicate one-time purchase', async () => {
    const tenancy = createMockTenancy({ items: {}, products: {}, productLines: {} });
    const prisma = createMockPrisma({
      oneTimePurchases: [createOtpRow({ productId: 'product-stackable', product: { displayName: 'S', customerType: 'custom', productLineId: undefined, includedItems: {}, prices: 'include-by-default', isAddOnTo: false } })],
    });

    const res = await validatePurchaseSession({
      prisma, tenancy,
      codeData: { tenancyId: tenancy.id, customerId: 'cust-1', productId: 'product-stackable',
        product: { displayName: 'S', productLineId: undefined, customerType: 'custom', freeTrial: undefined, serverOnly: false, stackable: true, prices: 'include-by-default', includedItems: {}, isAddOnTo: false },
      },
      priceId: 'price-any', quantity: 2,
    });
    expect(res.purchaseContext.productLineId).toBeUndefined();
    expect(res.purchaseContext.conflictingProducts.length).toBe(0);
  });

  it('blocks when subscription for same product exists and product is not stackable', async () => {
    const tenancy = createMockTenancy({ items: {}, productLines: {}, products: {} });
    const prisma = createMockPrisma({
      subscriptions: [createSubRow({ productId: 'product-sub', product: { displayName: 'Sub', customerType: 'custom', productLineId: undefined, includedItems: {}, prices: {}, isAddOnTo: false } })],
    });

    await expect(validatePurchaseSession({
      prisma, tenancy,
      codeData: { tenancyId: tenancy.id, customerId: 'cust-1', productId: 'product-sub',
        product: { displayName: 'Sub', productLineId: undefined, customerType: 'custom', freeTrial: undefined, serverOnly: false, stackable: false, prices: 'include-by-default', includedItems: {}, isAddOnTo: false },
      },
      priceId: 'price-any', quantity: 1,
    })).rejects.toThrowError(new KnownErrors.ProductAlreadyGranted('product-sub', 'cust-1'));
  });

  it('allows when subscription for same product exists and product is stackable', async () => {
    const tenancy = createMockTenancy({ items: {}, productLines: {}, products: {} });
    const prisma = createMockPrisma({
      subscriptions: [createSubRow({ productId: 'product-sub-stackable', product: { displayName: 'S', customerType: 'custom', productLineId: undefined, includedItems: {}, prices: {}, isAddOnTo: false } })],
    });

    const res = await validatePurchaseSession({
      prisma, tenancy,
      codeData: { tenancyId: tenancy.id, customerId: 'cust-1', productId: 'product-sub-stackable',
        product: { displayName: 'S', productLineId: undefined, customerType: 'custom', freeTrial: undefined, serverOnly: false, stackable: true, prices: 'include-by-default', includedItems: {}, isAddOnTo: false },
      },
      priceId: 'price-any', quantity: 2,
    });
    expect(res.purchaseContext.productLineId).toBeUndefined();
    expect(res.purchaseContext.conflictingProducts.length).toBe(0);
  });
});

describe('getPurchaseContext', () => {
  const teamPlanProduct = {
    displayName: 'Team Plan',
    productLineId: 'plans',
    customerType: 'custom' as const,
    freeTrial: undefined,
    serverOnly: false,
    stackable: false,
    prices: { monthly: { USD: '49', serverOnly: false } },
    includedItems: {},
    isAddOnTo: false as const,
  };

  it('alreadyOwnsProduct should be true for active subscriptions', async () => {
    const tenancy = createMockTenancy({
      items: {}, products: { 'team-plan': teamPlanProduct },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const prisma = createMockPrisma({
      subscriptions: [createSubRow({ id: 'sub-1', productId: 'team-plan', product: teamPlanProduct, status: 'active' })],
    });

    const result = await getPurchaseContext({
      prisma, tenancy, customerType: 'custom', customerId: 'cust-1', product: teamPlanProduct, productId: 'team-plan',
    });
    expect(result.alreadyOwnsProduct).toBe(true);
  });

  it('alreadyOwnsProduct should be false when no products owned', async () => {
    const tenancy = createMockTenancy({
      items: {}, products: { 'team-plan': teamPlanProduct },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const prisma = createMockPrisma({});

    const result = await getPurchaseContext({
      prisma, tenancy, customerType: 'custom', customerId: 'cust-1', product: teamPlanProduct, productId: 'team-plan',
    });
    expect(result.alreadyOwnsProduct).toBe(false);
  });

  it('alreadyOwnsProduct should be false for ended subscriptions', async () => {
    const tenancy = createMockTenancy({
      items: {}, products: { 'team-plan': teamPlanProduct },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const prisma = createMockPrisma({
      subscriptions: [createSubRow({
        id: 'sub-1', productId: 'team-plan', product: teamPlanProduct,
        status: 'canceled', endedAt: new Date('2025-01-20'),
      })],
    });

    const result = await getPurchaseContext({
      prisma, tenancy, customerType: 'custom', customerId: 'cust-1', product: teamPlanProduct, productId: 'team-plan',
    });
    expect(result.alreadyOwnsProduct).toBe(false);
  });

  it('alreadyOwnsProduct should be true for canceled-but-not-ended subscriptions (still owns until period ends)', async () => {
    const tenancy = createMockTenancy({
      items: {}, products: { 'team-plan': teamPlanProduct },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const prisma = createMockPrisma({
      subscriptions: [createSubRow({
        id: 'sub-1', productId: 'team-plan', product: teamPlanProduct,
        cancelAtPeriodEnd: true, endedAt: null,
      })],
    });

    const result = await getPurchaseContext({
      prisma, tenancy, customerType: 'custom', customerId: 'cust-1', product: teamPlanProduct, productId: 'team-plan',
    });
    // cancelAtPeriodEnd=true but endedAt=null means the sub hasn't ended yet, product is still owned
    expect(result.alreadyOwnsProduct).toBe(true);
  });

  it('conflicting products detected in same product line', async () => {
    const tenancy = createMockTenancy({
      items: {},
      products: { 'plan-a': { ...teamPlanProduct }, 'plan-b': { ...teamPlanProduct } },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const prisma = createMockPrisma({
      subscriptions: [createSubRow({
        id: 'sub-a', productId: 'plan-a', product: teamPlanProduct,
      })],
    });

    const result = await getPurchaseContext({
      prisma, tenancy, customerType: 'custom', customerId: 'cust-1', product: teamPlanProduct, productId: 'plan-b',
    });
    expect(result.conflictingProducts.length).toBe(1);
    expect(result.conflictingProducts[0].id).toBe('plan-a');
  });
});
