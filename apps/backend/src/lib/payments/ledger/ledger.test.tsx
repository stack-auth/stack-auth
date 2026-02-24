/* eslint-disable max-statements-per-line */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tenancy } from '../../tenancies';
import { productToInlineProduct } from '@/lib/payments/index';
import { getAllTransactionsForCustomer, getItemQuantityForCustomer, getOwnedProductsForCustomer } from './index';

let _currentMockPrisma: any = null;
vi.mock('@/prisma-client', () => ({
  getPrismaClientForTenancy: async () => _currentMockPrisma,
}));

function createMockTenancy(config: Partial<Tenancy['config']['payments']> = {}, id: string = 'tenancy-1'): Tenancy {
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

function createSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    tenancyId: 'tenancy-1',
    customerId: 'custom-1',
    customerType: 'CUSTOM',
    productId: null,
    priceId: null,
    product: { displayName: 'P', customerType: 'custom', includedItems: {}, prices: 'include-by-default', isAddOnTo: false },
    quantity: 1,
    stripeSubscriptionId: null,
    status: 'active',
    currentPeriodStart: new Date('2025-02-01'),
    currentPeriodEnd: new Date('2025-03-01'),
    cancelAtPeriodEnd: false,
    endedAt: null,
    refundedAt: null,
    billingCycleAnchor: null,
    creationSource: 'PURCHASE_PAGE',
    createdAt: new Date('2025-02-01'),
    updatedAt: new Date('2025-02-01'),
    ...overrides,
  };
}

function createOtp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    tenancyId: 'tenancy-1',
    customerId: 'custom-1',
    customerType: 'CUSTOM',
    productId: null,
    priceId: null,
    product: { displayName: 'P', customerType: 'custom', includedItems: {}, prices: 'include-by-default', isAddOnTo: false },
    quantity: 1,
    stripePaymentIntentId: null,
    refundedAt: null,
    creationSource: 'PURCHASE_PAGE',
    createdAt: new Date('2025-02-01'),
    updatedAt: new Date('2025-02-01'),
    ...overrides,
  };
}

function createIqc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'iqc-1',
    tenancyId: 'tenancy-1',
    customerId: 'custom-1',
    customerType: 'CUSTOM',
    itemId: 'itemA',
    quantity: 10,
    description: null,
    expiresAt: null,
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

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

function setupMockPrisma(data: {
  subscriptions?: any[],
  oneTimePurchases?: any[],
  itemQuantityChanges?: any[],
  subscriptionInvoices?: any[],
  defaultProductsSnapshots?: any[],
}) {
  const snapshots = sortDesc(data.defaultProductsSnapshots ?? []);
  _currentMockPrisma = {
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
      findMany: async (opts: any) => sortDesc(filterByWhere(data.subscriptionInvoices ?? [], opts?.where).map((si: any) => ({
        ...si,
        subscription: (data.subscriptions ?? []).find((s: any) => s.stripeSubscriptionId === si.stripeSubscriptionId) ?? si.subscription,
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
    projectUser: { findUnique: async () => ({ id: 'custom-1' }) },
    team: { findUnique: async () => ({ id: 'custom-1' }) },
  };
}

// ===== getItemQuantityForCustomer =====

describe('getItemQuantityForCustomer - manual item quantity changes', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('sums manual positive quantity changes', async () => {
    vi.setSystemTime(new Date('2025-02-01'));
    setupMockPrisma({
      itemQuantityChanges: [
        createIqc({ id: 'iqc-1', quantity: 10, createdAt: new Date('2025-01-01') }),
        createIqc({ id: 'iqc-2', quantity: 5, createdAt: new Date('2025-01-02') }),
      ],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'itemA', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(15);
    vi.useRealTimers();
  });

  it('subtracts negative quantity changes', async () => {
    vi.setSystemTime(new Date('2025-02-01'));
    setupMockPrisma({
      itemQuantityChanges: [
        createIqc({ id: 'iqc-1', quantity: 10, createdAt: new Date('2025-01-01') }),
        createIqc({ id: 'iqc-2', quantity: -3, createdAt: new Date('2025-01-02') }),
      ],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'itemA', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(7);
    vi.useRealTimers();
  });

  it('multiple negatives reduce to zero', async () => {
    vi.setSystemTime(new Date('2025-02-01'));
    setupMockPrisma({
      itemQuantityChanges: [
        createIqc({ id: 'iqc-1', quantity: 5, createdAt: new Date('2025-01-01') }),
        createIqc({ id: 'iqc-2', quantity: -3, createdAt: new Date('2025-01-02') }),
        createIqc({ id: 'iqc-3', quantity: -2, createdAt: new Date('2025-01-03') }),
      ],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'itemA', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(0);
    vi.useRealTimers();
  });

  it('ignores changes for other items', async () => {
    vi.setSystemTime(new Date('2025-02-01'));
    setupMockPrisma({
      itemQuantityChanges: [
        createIqc({ id: 'iqc-1', quantity: 10, itemId: 'itemA', createdAt: new Date('2025-01-01') }),
        createIqc({ id: 'iqc-2', quantity: 99, itemId: 'itemB', createdAt: new Date('2025-01-02') }),
      ],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'itemA', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(10);
    vi.useRealTimers();
  });

  it('returns 0 for no changes', async () => {
    vi.setSystemTime(new Date('2025-02-01'));
    setupMockPrisma({});
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'itemA', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(0);
    vi.useRealTimers();
  });
});

describe('getItemQuantityForCustomer - subscription items', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('grants items from subscription included_items', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        product: { displayName: 'Plan', customerType: 'custom', includedItems: { seats: { quantity: 4 } }, prices: { monthly: { USD: '10' } }, isAddOnTo: false },
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(4);
    vi.useRealTimers();
  });

  it('multiplies items by subscription quantity', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        quantity: 3,
        product: { displayName: 'Plan', customerType: 'custom', includedItems: { seats: { quantity: 2 } }, prices: { monthly: { USD: '10' } }, isAddOnTo: false },
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(6);
    vi.useRealTimers();
  });

  it('aggregates items from multiple subscriptions', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [
        createSub({ id: 'sub-1', product: { displayName: 'A', customerType: 'custom', includedItems: { seats: { quantity: 2 } }, prices: {}, isAddOnTo: false }, createdAt: new Date('2025-02-01') }),
        createSub({ id: 'sub-2', product: { displayName: 'B', customerType: 'custom', includedItems: { seats: { quantity: 3 } }, prices: {}, isAddOnTo: false }, createdAt: new Date('2025-01-15') }),
      ],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(5);
    vi.useRealTimers();
  });

  it('ignores items not in product', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        product: { displayName: 'P', customerType: 'custom', includedItems: { other: { quantity: 10 } }, prices: {}, isAddOnTo: false },
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(0);
    vi.useRealTimers();
  });

  it('one subscription with two items works for both items', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        quantity: 2,
        product: {
          displayName: 'Bundle', customerType: 'custom', isAddOnTo: false, prices: {},
          includedItems: { itemA: { quantity: 2 }, itemB: { quantity: 4 } },
        },
      })],
    });
    const qtyA = await getItemQuantityForCustomer({ prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'itemA', customerId: 'custom-1', customerType: 'custom' });
    const qtyB = await getItemQuantityForCustomer({ prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'itemB', customerId: 'custom-1', customerType: 'custom' });
    expect(qtyA).toBe(4);
    expect(qtyB).toBe(8);
    vi.useRealTimers();
  });

  it('ended subscription with when-purchase-expires items has zero quantity', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        endedAt: new Date('2025-02-05'),
        product: {
          displayName: 'Plan', customerType: 'custom', isAddOnTo: false, prices: {},
          includedItems: { seats: { quantity: 9, expires: 'when-purchase-expires' } },
        },
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    // subscription-start grants +9, subscription-end expires -9 => 0
    expect(qty).toBe(0);
    vi.useRealTimers();
  });

  it('ended subscription with expires=never items retains quantity', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        endedAt: new Date('2025-02-05'),
        product: {
          displayName: 'Plan', customerType: 'custom', isAddOnTo: false, prices: {},
          includedItems: { tokens: { quantity: 100, expires: 'never' } },
        },
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'tokens', customerId: 'custom-1', customerType: 'custom',
    });
    // subscription-start grants +100, subscription-end does NOT expire (expires != when-purchase-expires) => 100
    expect(qty).toBe(100);
    vi.useRealTimers();
  });

  it('add-on items count when base plan is active', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [
        createSub({
          id: 'sub-base',
          product: { displayName: 'Team', customerType: 'custom', productLineId: 'plans', isAddOnTo: false, prices: { m: { USD: '49' } }, includedItems: { seats: { quantity: 4 } } },
          createdAt: new Date('2025-02-01'),
        }),
        createSub({
          id: 'sub-addon',
          product: { displayName: 'Extra', customerType: 'custom', isAddOnTo: { 'sub-base': true }, prices: { m: { USD: '10' } }, includedItems: { seats: { quantity: 1 } } },
          createdAt: new Date('2025-02-01T01:00:00Z'),
        }),
      ],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(5);
    vi.useRealTimers();
  });

  it('weekly repeat with expires=when-repeated yields constant base within a billing period', async () => {
    vi.setSystemTime(new Date('2025-02-15'));
    setupMockPrisma({
      subscriptions: [createSub({
        billingCycleAnchor: new Date('2025-02-01'),
        product: {
          displayName: 'P', customerType: 'custom', isAddOnTo: false, prices: {},
          includedItems: { tokens: { quantity: 7, repeat: [1, 'week'], expires: 'when-repeated' } },
        },
      })],
    });
    // cycle_anchor=Feb 1, now=Feb 15. Intervals elapsed: 2 weeks.
    // subscription-start: +7 item-quantity-change
    // renewal at week 1 (Feb 8): -7 expire + +7 change
    // renewal at week 2 (Feb 15): -7 expire + +7 change
    // Net: 7 + (-7+7) + (-7+7) = 7
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'tokens', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(7);
    vi.useRealTimers();
  });

  it('weekly repeat with expires=never accumulates items over time', async () => {
    vi.setSystemTime(new Date('2025-02-15'));
    setupMockPrisma({
      subscriptions: [createSub({
        billingCycleAnchor: new Date('2025-02-01'),
        product: {
          displayName: 'P', customerType: 'custom', isAddOnTo: false, prices: {},
          includedItems: { tokens: { quantity: 4, repeat: [1, 'week'], expires: 'never' } },
        },
      })],
    });
    // cycle_anchor=Feb 1, now=Feb 15. 2 renewals (no expire since expires=never).
    // subscription-start: +4
    // renewal week 1: +4
    // renewal week 2: +4
    // Net: 12
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'tokens', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(12);
    vi.useRealTimers();
  });
});

describe('getItemQuantityForCustomer - one-time purchases', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('grants items from OTP included_items', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      oneTimePurchases: [createOtp({
        product: { displayName: 'Pack', customerType: 'custom', includedItems: { credits: { quantity: 100 } }, prices: {}, isAddOnTo: false },
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'credits', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(100);
    vi.useRealTimers();
  });

  it('multiplies by purchase quantity', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      oneTimePurchases: [createOtp({
        quantity: 3,
        product: { displayName: 'Pack', customerType: 'custom', includedItems: { credits: { quantity: 50 } }, prices: {}, isAddOnTo: false },
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'credits', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(150);
    vi.useRealTimers();
  });

  it('aggregates multiple OTPs', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      oneTimePurchases: [
        createOtp({ id: 'otp-1', product: { displayName: 'A', customerType: 'custom', includedItems: { credits: { quantity: 10 } }, prices: {}, isAddOnTo: false }, createdAt: new Date('2025-02-01') }),
        createOtp({ id: 'otp-2', product: { displayName: 'B', customerType: 'custom', includedItems: { credits: { quantity: 20 } }, prices: {}, isAddOnTo: false }, createdAt: new Date('2025-01-15') }),
      ],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'credits', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(30);
    vi.useRealTimers();
  });
});

describe('getItemQuantityForCustomer - combined sources', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('sums items from subscriptions, OTPs, and manual changes', async () => {
    vi.setSystemTime(new Date('2025-02-15'));
    setupMockPrisma({
      subscriptions: [createSub({
        product: { displayName: 'Sub', customerType: 'custom', includedItems: { coins: { quantity: 5 } }, prices: {}, isAddOnTo: false },
        createdAt: new Date('2025-02-01'),
      })],
      oneTimePurchases: [createOtp({
        product: { displayName: 'Pack', customerType: 'custom', includedItems: { coins: { quantity: 10 } }, prices: {}, isAddOnTo: false },
        createdAt: new Date('2025-01-15'),
      })],
      itemQuantityChanges: [
        createIqc({ itemId: 'coins', quantity: 3, createdAt: new Date('2025-01-10') }),
      ],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'coins', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(18);
    vi.useRealTimers();
  });

  it('refunded subscription expires when-purchase-expires items', async () => {
    vi.setSystemTime(new Date('2025-02-15'));
    setupMockPrisma({
      subscriptions: [createSub({
        product: {
          displayName: 'Sub', customerType: 'custom', isAddOnTo: false, prices: {},
          includedItems: { seats: { quantity: 4, expires: 'when-purchase-expires' } },
        },
        refundedAt: new Date('2025-02-10'),
        createdAt: new Date('2025-02-01'),
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    // subscription-start: +4, purchase-refund: -4 => 0
    expect(qty).toBe(0);
    vi.useRealTimers();
  });

  it('refunded subscription retains expires=never items', async () => {
    vi.setSystemTime(new Date('2025-02-15'));
    setupMockPrisma({
      subscriptions: [createSub({
        product: {
          displayName: 'Sub', customerType: 'custom', isAddOnTo: false, prices: {},
          includedItems: { tokens: { quantity: 100, expires: 'never' } },
        },
        refundedAt: new Date('2025-02-10'),
        createdAt: new Date('2025-02-01'),
      })],
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), itemId: 'tokens', customerId: 'custom-1', customerType: 'custom',
    });
    // subscription-start: +100, purchase-refund doesn't expire (expires != when-purchase-expires) => 100
    expect(qty).toBe(100);
    vi.useRealTimers();
  });
});

// ===== getOwnedProductsForCustomer =====

describe('getOwnedProductsForCustomer', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('returns subscription products as owned', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'prod-1',
        product: { displayName: 'Plan', customerType: 'custom', includedItems: {}, prices: {}, isAddOnTo: false },
      })],
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), customerType: 'custom', customerId: 'custom-1',
    });
    expect(owned.length).toBe(1);
    expect(owned[0].id).toBe('prod-1');
    expect(owned[0].type).toBe('subscription');
    vi.useRealTimers();
  });

  it('returns one-time purchase products as owned', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      oneTimePurchases: [createOtp({
        productId: 'otp-prod',
        product: { displayName: 'Pack', customerType: 'custom', includedItems: {}, prices: {}, isAddOnTo: false },
      })],
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), customerType: 'custom', customerId: 'custom-1',
    });
    expect(owned.length).toBe(1);
    expect(owned[0].id).toBe('otp-prod');
    expect(owned[0].type).toBe('one_time');
    vi.useRealTimers();
  });

  it('refunded subscription is not owned (product revoked)', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'prod-1',
        product: { displayName: 'Plan', customerType: 'custom', includedItems: { seats: { quantity: 1, expires: 'when-purchase-expires' } }, prices: {}, isAddOnTo: false },
        refundedAt: new Date('2025-02-05'),
      })],
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), customerType: 'custom', customerId: 'custom-1',
    });
    // purchase-refund contains product-revocation, so effective quantity = 0
    expect(owned.length).toBe(0);
    vi.useRealTimers();
  });

  it('ended subscription is not owned (product revoked)', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'prod-1',
        product: { displayName: 'Plan', customerType: 'custom', includedItems: { seats: { quantity: 1, expires: 'when-purchase-expires' } }, prices: {}, isAddOnTo: false },
        endedAt: new Date('2025-02-05'),
      })],
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), customerType: 'custom', customerId: 'custom-1',
    });
    expect(owned.length).toBe(0);
    vi.useRealTimers();
  });

  it('canceled-but-not-ended subscription is still owned', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'prod-1',
        product: { displayName: 'Plan', customerType: 'custom', includedItems: {}, prices: {}, isAddOnTo: false },
        cancelAtPeriodEnd: true,
        endedAt: null,
      })],
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), customerType: 'custom', customerId: 'custom-1',
    });
    // subscription-cancel has no product-revocation, so product is still owned
    expect(owned.length).toBe(1);
    expect(owned[0].id).toBe('prod-1');
    vi.useRealTimers();
  });

  it('returns both subscription and OTP products', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        id: 'sub-1', productId: 'sub-prod',
        product: { displayName: 'Sub', customerType: 'custom', includedItems: {}, prices: {}, isAddOnTo: false },
        createdAt: new Date('2025-02-01'),
      })],
      oneTimePurchases: [createOtp({
        id: 'otp-1', productId: 'otp-prod',
        product: { displayName: 'OTP', customerType: 'custom', includedItems: {}, prices: {}, isAddOnTo: false },
        createdAt: new Date('2025-01-15'),
      })],
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), customerType: 'custom', customerId: 'custom-1',
    });
    expect(owned.length).toBe(2);
    const ids = owned.map((p) => p.id);
    expect(ids).toContain('sub-prod');
    expect(ids).toContain('otp-prod');
    vi.useRealTimers();
  });

  it('product line conflict detection: multiple products in same line', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    const product = { displayName: 'Plan', customerType: 'custom', productLineId: 'plans', includedItems: {}, prices: {}, isAddOnTo: false };
    setupMockPrisma({
      subscriptions: [
        createSub({ id: 'sub-1', productId: 'plan-a', product, createdAt: new Date('2025-02-01') }),
        createSub({ id: 'sub-2', productId: 'plan-b', product, createdAt: new Date('2025-01-15') }),
      ],
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy: createMockTenancy(), customerType: 'custom', customerId: 'custom-1',
    });
    // Both are owned (product line conflict is handled at purchase validation, not ownership)
    expect(owned.length).toBe(2);
    vi.useRealTimers();
  });
});

// ===== Include-by-default products =====

describe('getOwnedProductsForCustomer - include-by-default', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  const freeProduct = {
    displayName: 'Free Plan',
    customerType: 'custom' as const,
    productLineId: 'plans',
    includedItems: { seats: { quantity: 1 } },
    prices: 'include-by-default' as const,
    isAddOnTo: false,
    serverOnly: false,
    stackable: false,
  };
  const freeProductSnapshot = { 'free-plan': productToInlineProduct(freeProduct as any) };

  it('adds include-by-default product when no other product in line is owned', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      defaultProductsSnapshots: [{
        id: 'snap-1',
        tenancyId: 'tenancy-1',
        snapshot: freeProductSnapshot,
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-plan': freeProduct as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy, customerType: 'custom', customerId: 'custom-1',
    });
    expect(owned.length).toBe(1);
    expect(owned[0].id).toBe('free-plan');
    expect(owned[0].type).toBe('include-by-default');
    vi.useRealTimers();
  });

  it('does NOT add default product when a non-default product in same line is owned', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    const paidProduct = {
      displayName: 'Paid Plan',
      customerType: 'custom',
      productLineId: 'plans',
      includedItems: { seats: { quantity: 4 } },
      prices: { monthly: { USD: '49' } },
      isAddOnTo: false,
    };
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'paid-plan',
        product: paidProduct,
      })],
      defaultProductsSnapshots: [{
        id: 'snap-1',
        tenancyId: 'tenancy-1',
        snapshot: freeProductSnapshot,
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-plan': freeProduct as any, 'paid-plan': paidProduct as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy, customerType: 'custom', customerId: 'custom-1',
    });
    expect(owned.length).toBe(1);
    expect(owned[0].id).toBe('paid-plan');
    expect(owned[0].type).toBe('subscription');
    vi.useRealTimers();
  });

  it('adds default product back after subscription ends', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'paid-plan',
        product: {
          displayName: 'Paid',
          customerType: 'custom',
          productLineId: 'plans',
          includedItems: { seats: { quantity: 4, expires: 'when-purchase-expires' } },
          prices: { monthly: { USD: '49' } },
          isAddOnTo: false,
        },
        endedAt: new Date('2025-02-05'),
      })],
      defaultProductsSnapshots: [{
        id: 'snap-1',
        tenancyId: 'tenancy-1',
        snapshot: freeProductSnapshot,
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: {
        'free-plan': freeProduct as any,
        'paid-plan': { displayName: 'Paid', customerType: 'custom', productLineId: 'plans', includedItems: {}, prices: {}, isAddOnTo: false } as any,
      },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy, customerType: 'custom', customerId: 'custom-1',
    });
    const defaultOwned = owned.filter((p) => p.type === 'include-by-default');
    expect(defaultOwned.length).toBe(1);
    expect(defaultOwned[0].id).toBe('free-plan');
    vi.useRealTimers();
  });

  it('ungrouped default product is always included if not already owned by ID', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    const ungroupedDefault = {
      display_name: 'Free Ungrouped',
      customer_type: 'custom',
      included_items: { tokens: { quantity: 5 } },
      prices: {},
      server_only: false,
      stackable: false,
      client_metadata: null,
      client_read_only_metadata: null,
      server_metadata: null,
    };
    setupMockPrisma({
      defaultProductsSnapshots: [{
        id: 'snap-1',
        tenancyId: 'tenancy-1',
        snapshot: { 'free-ungrouped': ungroupedDefault },
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-ungrouped': { displayName: 'Free Ungrouped', customerType: 'custom', includedItems: { tokens: { quantity: 5 } }, prices: 'include-by-default', isAddOnTo: false } as any },
      productLines: {},
    });
    const owned = await getOwnedProductsForCustomer({
      prisma: _currentMockPrisma, tenancy, customerType: 'custom', customerId: 'custom-1',
    });
    expect(owned.length).toBe(1);
    expect(owned[0].id).toBe('free-ungrouped');
    expect(owned[0].type).toBe('include-by-default');
    vi.useRealTimers();
  });
});

describe('getItemQuantityForCustomer - include-by-default items', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  const freeProductForItems = {
    displayName: 'Free Plan',
    customerType: 'custom' as const,
    productLineId: 'plans',
    includedItems: { seats: { quantity: 1 } },
    prices: 'include-by-default' as const,
    isAddOnTo: false,
    serverOnly: false,
    stackable: false,
  };
  const freeProductSnapshot = { 'free-plan': productToInlineProduct(freeProductForItems as any) };

  it('grants items from default product when no subscription active', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1', snapshot: freeProductSnapshot, createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-plan': { displayName: 'Free Plan', customerType: 'custom', productLineId: 'plans', includedItems: { seats: { quantity: 1 } }, prices: 'include-by-default', isAddOnTo: false } as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(1);
    vi.useRealTimers();
  });

  it('does NOT grant default items while subscription in same line is active', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'paid-plan',
        product: {
          displayName: 'Paid',
          customerType: 'custom',
          productLineId: 'plans',
          includedItems: { seats: { quantity: 4 } },
          prices: { monthly: { USD: '49' } },
          isAddOnTo: false,
        },
      })],
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1', snapshot: freeProductSnapshot, createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: {
        'free-plan': { displayName: 'Free Plan', customerType: 'custom', productLineId: 'plans', includedItems: { seats: { quantity: 1 } }, prices: 'include-by-default', isAddOnTo: false } as any,
        'paid-plan': { displayName: 'Paid', customerType: 'custom', productLineId: 'plans', includedItems: { seats: { quantity: 4 } }, prices: {}, isAddOnTo: false } as any,
      },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    // Default grants are suppressed while paid ownership in the same line is active.
    expect(qty).toBe(4);
    vi.useRealTimers();
  });

  it('grants default items after subscription ends', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'paid-plan',
        product: {
          displayName: 'Paid',
          customerType: 'custom',
          productLineId: 'plans',
          includedItems: { seats: { quantity: 4, expires: 'when-purchase-expires' } },
          prices: { monthly: { USD: '49' } },
          isAddOnTo: false,
        },
        endedAt: new Date('2025-02-05'),
      })],
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1', snapshot: freeProductSnapshot, createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: {
        'free-plan': { displayName: 'Free Plan', customerType: 'custom', productLineId: 'plans', includedItems: { seats: { quantity: 1 } }, prices: 'include-by-default', isAddOnTo: false } as any,
        'paid-plan': { displayName: 'Paid', customerType: 'custom', productLineId: 'plans', includedItems: {}, prices: {}, isAddOnTo: false } as any,
      },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    // With default-product-item transactions, default seats are active at query time
    // but do not accumulate as multiple historical grants.
    expect(qty).toBe(1);
    vi.useRealTimers();
  });

  it('ungrouped default product provides items when not conflicting', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    const bonusProduct = {
      displayName: 'Bonus',
      customerType: 'custom' as const,
      includedItems: { tokens: { quantity: 5 } },
      prices: 'include-by-default' as const,
      isAddOnTo: false,
      serverOnly: false,
      stackable: false,
    };
    const ungroupedSnapshot = { 'bonus': productToInlineProduct(bonusProduct as any) };
    setupMockPrisma({
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1', snapshot: ungroupedSnapshot, createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { bonus: { displayName: 'Bonus', customerType: 'custom', includedItems: { tokens: { quantity: 5 } }, prices: 'include-by-default', isAddOnTo: false } as any },
      productLines: {},
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'tokens', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(5);
    vi.useRealTimers();
  });

  it('returns 0 for items not in default product', async () => {
    vi.setSystemTime(new Date('2025-02-10'));
    setupMockPrisma({
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1', snapshot: freeProductSnapshot, createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-plan': { displayName: 'Free Plan', customerType: 'custom', productLineId: 'plans', includedItems: { seats: { quantity: 1 } }, prices: 'include-by-default', isAddOnTo: false } as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'nonexistent', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(0);
    vi.useRealTimers();
  });
});

describe('item-grant-renewal: default product repeating items', () => {
  const defaultProductWithRepeat = {
    displayName: 'Free Plan',
    customerType: 'custom',
    productLineId: 'plans',
    includedItems: {
      seats: { quantity: 3, repeat: [1, 'day'] as const },
    },
    prices: 'include-by-default' as const,
    isAddOnTo: false,
    serverOnly: false,
    stackable: false,
  };

  it('generates repeating item grants for default product with repeat interval', async () => {
    vi.setSystemTime(new Date('2025-01-08T00:00:00Z'));
    setupMockPrisma({
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: { 'free-plan': productToInlineProduct(defaultProductWithRepeat as any) },
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-plan': defaultProductWithRepeat as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // 7 days elapsed, so initial grant + 7 renewals = 8 * 3 = 24 seats
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(24);
    vi.useRealTimers();
  });

  it('when-repeated items expire on each renewal for default products', async () => {
    vi.setSystemTime(new Date('2025-01-08T00:00:00Z'));
    const defaultWithExpire = {
      ...defaultProductWithRepeat,
      includedItems: {
        seats: { quantity: 3, repeat: [1, 'day'] as const, expires: 'when-repeated' as const },
      },
    };
    setupMockPrisma({
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: { 'free-plan': productToInlineProduct(defaultWithExpire as any) },
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-plan': defaultWithExpire as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // when-repeated: each renewal expires the previous grant, so only 3 seats active
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(3);
    vi.useRealTimers();
  });

  it('stops default item grants when a paid product covers the product line', async () => {
    vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
    const paidProduct = {
      displayName: 'Pro', customerType: 'custom', productLineId: 'plans',
      includedItems: { seats: { quantity: 10 } },
      prices: { monthly: { USD: '49' } },
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'pro', product: paidProduct,
        createdAt: new Date('2025-01-05'), billingCycleAnchor: new Date('2025-01-05'),
      })],
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: { 'free-plan': productToInlineProduct(defaultProductWithRepeat as any) },
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-plan': defaultProductWithRepeat as any, 'pro': paidProduct as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // Default items are suppressed while a paid product in the same line is active.
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(10);
    vi.useRealTimers();
  });

  it('resumes default item grants after paid product is revoked', async () => {
    vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
    const paidProduct = {
      displayName: 'Pro', customerType: 'custom', productLineId: 'plans',
      includedItems: { seats: { quantity: 10 } },
      prices: { monthly: { USD: '49' } },
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    const defaultWithExpire = {
      ...defaultProductWithRepeat,
      includedItems: {
        seats: { quantity: 3, repeat: [1, 'day'] as const, expires: 'when-repeated' as const },
      },
    };
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'pro', product: paidProduct,
        createdAt: new Date('2025-01-05'), billingCycleAnchor: new Date('2025-01-05'),
        status: 'canceled', endedAt: new Date('2025-01-10'),
        updatedAt: new Date('2025-01-10'),
      })],
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: { 'free-plan': productToInlineProduct(defaultWithExpire as any) },
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free-plan': defaultWithExpire as any, 'pro': paidProduct as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // Defaults are suppressed while paid is active, then restored when paid ownership ends.
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(16);
    vi.useRealTimers();
  });
});

describe('item-grant-renewal: when-repeated expiry for non-default products', () => {
  it('expires items on each repeat cycle for subscription with when-repeated', async () => {
    vi.setSystemTime(new Date('2025-02-22T00:00:00Z'));
    const product = {
      displayName: 'Pro', customerType: 'custom', productLineId: 'plans',
      includedItems: {
        seats: { quantity: 5, repeat: [1, 'week'] as const, expires: 'when-repeated' as const },
      },
      prices: { monthly: { USD: '49' } },
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'pro', product,
        createdAt: new Date('2025-02-01'), billingCycleAnchor: new Date('2025-02-01'),
      })],
    });
    const tenancy = createMockTenancy({
      products: { 'pro': product as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // 3 weeks elapsed: initial 5, then 3 renewals each expiring prev = always 5
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(5);
    vi.useRealTimers();
  });

  it('accumulates items with repeat but expires=never', async () => {
    vi.setSystemTime(new Date('2025-02-22T00:00:00Z'));
    const product = {
      displayName: 'Pro', customerType: 'custom', productLineId: 'plans',
      includedItems: {
        credits: { quantity: 10, repeat: [1, 'week'] as const, expires: 'never' as const },
      },
      prices: { monthly: { USD: '49' } },
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'pro', product,
        createdAt: new Date('2025-02-01'), billingCycleAnchor: new Date('2025-02-01'),
      })],
    });
    const tenancy = createMockTenancy({
      products: { 'pro': product as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // 3 weeks: initial 10 + 3 renewals * 10 = 40
    const qty = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'credits', customerId: 'custom-1', customerType: 'custom',
    });
    expect(qty).toBe(40);
    vi.useRealTimers();
  });
});

describe('item-grant-renewal: default products change transitions', () => {
  it('expires items from old default and grants items from new default on snapshot change', async () => {
    vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
    const defaultA = {
      displayName: 'Free A', customerType: 'custom', productLineId: 'plans',
      includedItems: { seats: { quantity: 2 } },
      prices: 'include-by-default' as const,
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    const defaultB = {
      displayName: 'Free B', customerType: 'custom', productLineId: 'plans',
      includedItems: { credits: { quantity: 5 } },
      prices: 'include-by-default' as const,
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    setupMockPrisma({
      defaultProductsSnapshots: [
        { id: 'snap-1', tenancyId: 'tenancy-1', snapshot: { 'free-a': productToInlineProduct(defaultA as any) }, createdAt: new Date('2025-01-01') },
        { id: 'snap-2', tenancyId: 'tenancy-1', snapshot: { 'free-b': productToInlineProduct(defaultB as any) }, createdAt: new Date('2025-01-10') },
      ],
    });
    const tenancy = createMockTenancy({
      products: { 'free-b': defaultB as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // Seats were granted from snap-1 (Jan 1-10), then expired at snap-2 transition
    const seats = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(seats).toBe(0);
    // Credits granted from snap-2 (Jan 10 onwards)
    const credits = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'credits', customerId: 'custom-1', customerType: 'custom',
    });
    expect(credits).toBe(5);
    vi.useRealTimers();
  });
});

describe('item-grant-renewal: combined items in single renewal transaction', () => {
  it('includes both when-repeated and never-expiring items in same renewal', async () => {
    vi.setSystemTime(new Date('2025-02-15T00:00:00Z'));
    const product = {
      displayName: 'Pro', customerType: 'custom', productLineId: 'plans',
      includedItems: {
        seats: { quantity: 2, repeat: [1, 'week'] as const, expires: 'when-repeated' as const },
        credits: { quantity: 3, repeat: [1, 'week'] as const, expires: 'never' as const },
      },
      prices: { default: { USD: '73' } },
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'pro', product, quantity: 2,
        createdAt: new Date('2025-02-01'), billingCycleAnchor: new Date('2025-02-01'),
      })],
    });
    const tenancy = createMockTenancy({
      products: { 'pro': product as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // seats: qty=2*2=4, when-repeated: always 4 (expire+grant each week)
    const seats = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(seats).toBe(4);
    // credits: qty=3*2=6, never-expiring: initial 6 + 2 weeks * 6 = 18
    const credits = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'credits', customerId: 'custom-1', customerType: 'custom',
    });
    expect(credits).toBe(18);
    vi.useRealTimers();
  });

  it('igr-renewal transactions contain entries for all items with same repeat', async () => {
    vi.setSystemTime(new Date('2025-02-09T00:00:00Z'));
    const product = {
      displayName: 'Pro', customerType: 'custom', productLineId: 'plans',
      includedItems: {
        seats: { quantity: 2, repeat: [1, 'week'] as const, expires: 'when-repeated' as const },
        credits: { quantity: 3, repeat: [1, 'week'] as const, expires: 'never' as const },
      },
      prices: { default: { USD: '73' } },
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    setupMockPrisma({
      subscriptions: [createSub({
        productId: 'pro', product,
        createdAt: new Date('2025-02-01'), billingCycleAnchor: new Date('2025-02-01'),
      })],
    });
    const tenancy = createMockTenancy({
      products: { 'pro': product as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const allTx = await getAllTransactionsForCustomer(_currentMockPrisma, tenancy, 'custom', 'custom-1');
    const renewals = allTx.filter((tx) => tx.type === 'item-grant-renewal');
    // 1 week elapsed: 1 renewal transaction
    expect(renewals.length).toBe(1);
    const renewal = renewals[0];
    // Should have 3 entries: expire seats, grant seats, grant credits
    expect(renewal.entries.length).toBe(3);
    const entryTypes = renewal.entries.map((e) => `${e.type}:${(e as any).item_id}`);
    expect(entryTypes).toContain('item-quantity-expire:seats');
    expect(entryTypes).toContain('item-quantity-change:seats');
    expect(entryTypes).toContain('item-quantity-change:credits');
    vi.useRealTimers();
  });
});

describe('item-grant-renewal: default product igr-renewal includes source details', () => {
  it('default product renewal has source_transaction_id pointing to default-products-change tx', async () => {
    vi.setSystemTime(new Date('2025-01-05T00:00:00Z'));
    const defaultProd = {
      displayName: 'Free', customerType: 'custom', productLineId: 'plans',
      includedItems: { seats: { quantity: 1, repeat: [1, 'day'] as const } },
      prices: 'include-by-default' as const,
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    setupMockPrisma({
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: { 'free': productToInlineProduct(defaultProd as any) },
        createdAt: new Date('2025-01-01'),
      }],
    });
    const tenancy = createMockTenancy({
      products: { 'free': defaultProd as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    const allTx = await getAllTransactionsForCustomer(_currentMockPrisma, tenancy, 'custom', 'custom-1');
    const renewals = allTx.filter((tx) => tx.type === 'default-product-item-grant-repeat');
    expect(renewals.length).toBeGreaterThan(0);
    for (const r of renewals) {
      expect((r.details as any)?.source_transaction_id).toBeDefined();
    }
    vi.useRealTimers();
  });
});

describe('ledger: default products snapshot transition handled by ledger function', () => {
  it('reduces item quantity when default product snapshot removes an item', async () => {
    vi.setSystemTime(new Date('2025-01-20T00:00:00Z'));
    const defaultV1 = {
      displayName: 'Free v1', customerType: 'custom', productLineId: 'plans',
      includedItems: { seats: { quantity: 5 }, credits: { quantity: 3 } },
      prices: 'include-by-default' as const,
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    const defaultV2 = {
      displayName: 'Free v2', customerType: 'custom', productLineId: 'plans',
      includedItems: { seats: { quantity: 2 } },
      prices: 'include-by-default' as const,
      isAddOnTo: false, serverOnly: false, stackable: false,
    };
    setupMockPrisma({
      defaultProductsSnapshots: [
        { id: 'snap-1', tenancyId: 'tenancy-1', snapshot: { 'free': productToInlineProduct(defaultV1 as any) }, createdAt: new Date('2025-01-01') },
        { id: 'snap-2', tenancyId: 'tenancy-1', snapshot: { 'free': productToInlineProduct(defaultV2 as any) }, createdAt: new Date('2025-01-10') },
      ],
    });
    const tenancy = createMockTenancy({
      products: { 'free': defaultV2 as any },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });
    // Current defaults come from the latest snapshot and are reflected as active amount.
    const seats = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'seats', customerId: 'custom-1', customerType: 'custom',
    });
    expect(seats).toBe(2);
    // Credits: v1 granted 3 at Jan 1, v2 has none, ledger expires -3 at Jan 10
    // Total credits: 3 - 3 = 0
    const credits = await getItemQuantityForCustomer({
      prisma: _currentMockPrisma, tenancy, itemId: 'credits', customerId: 'custom-1', customerType: 'custom',
    });
    expect(credits).toBe(0);
    vi.useRealTimers();
  });
});
