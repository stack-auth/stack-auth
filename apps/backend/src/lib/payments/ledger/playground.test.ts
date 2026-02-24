/* eslint-disable max-statements-per-line */
import { describe, expect, it, vi } from 'vitest';
import type { Tenancy } from '../../tenancies';
import { productToInlineProduct } from '@/lib/payments/index';
import { getAllTransactionsForCustomer, getItemQuantityForCustomer, getOwnedProductsForCustomer } from './index';

let _mockPrisma: any = null;
vi.mock('@/prisma-client', () => ({
  getPrismaClientForTenancy: async () => _mockPrisma,
}));

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

function setupMock(mockDb: any) {
  const snapshots = sortDesc(mockDb.defaultProductsSnapshots ?? []);
  _mockPrisma = {
    subscription: { findMany: async (opts: any) => sortDesc(filterByWhere(mockDb.subscriptions ?? [], opts?.where)), findUnique: async () => null },
    oneTimePurchase: { findMany: async (opts: any) => sortDesc(filterByWhere(mockDb.oneTimePurchases ?? [], opts?.where)), findUnique: async () => null },
    itemQuantityChange: { findMany: async (opts: any) => sortDesc(filterByWhere(mockDb.itemQuantityChanges ?? [], opts?.where)), findUnique: async () => null },
    subscriptionInvoice: { findMany: async () => [], findUnique: async () => null },
    defaultProductsSnapshot: {
      findFirst: async () => snapshots[0] ?? null, findMany: async () => snapshots, findUnique: async () => null,
      create: async (args: any) => { const row = { id: 'snap-new', tenancyId: args.data.tenancyId, snapshot: args.data.snapshot, createdAt: new Date() }; snapshots.unshift(row); return row; },
    },
    projectUser: { findUnique: async () => ({ id: 'cust-1' }) },
    team: { findUnique: async () => ({ id: 'cust-1' }) },
  };
}

const product1 = {
  displayName: 'Pro Plan', customerType: 'custom', productLineId: 'plans',
  includedItems: { seats: { quantity: 4, repeat: 'never', expires: 'when-purchase-expires' }, credits: { quantity: 100, repeat: [1, 'week'], expires: 'when-repeated' } },
  prices: { monthly: { USD: '49' } }, isAddOnTo: false, serverOnly: false, stackable: false,
};

const freeProduct = {
  displayName: 'Free Plan', customerType: 'custom' as const, productLineId: 'plans',
  includedItems: { seats: { quantity: 1 } }, prices: 'include-by-default' as const,
  isAddOnTo: false, serverOnly: false, stackable: false,
};

function makeTenancy(config: any): Tenancy {
  return { id: 'tenancy-1', config: { payments: { products: {}, productLines: {}, items: {}, ...config } } as any, branchId: 'main', organization: null, project: { id: 'p1' } } as any;
}

describe('playground - pre-defined scenario: active subscription', () => {
  it('customer with active subscription has correct products and items', async () => {
    const db = {
      subscriptions: [{
        id: 'sub-1', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'pro', priceId: 'monthly', product: product1, quantity: 1,
        stripeSubscriptionId: 'stripe-1', status: 'active',
        currentPeriodStart: new Date('2025-01-01'), currentPeriodEnd: new Date('2025-02-01'),
        cancelAtPeriodEnd: false, endedAt: null, refundedAt: null,
        billingCycleAnchor: new Date('2025-01-01'), creationSource: 'PURCHASE_PAGE',
        createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'),
      }],
    };
    setupMock(db);
    const tenancy = makeTenancy({ products: { pro: product1 }, productLines: { plans: { displayName: 'Plans', customerType: 'custom' } } });

    const owned = await getOwnedProductsForCustomer({ prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1' });
    expect(owned.length).toBe(1);
    expect(owned[0].id).toBe('pro');
    expect(owned[0].type).toBe('subscription');

    const seats = await getItemQuantityForCustomer({ prisma: _mockPrisma, tenancy, itemId: 'seats', customerId: 'cust-1', customerType: 'custom' });
    expect(seats).toBe(4);

    const credits = await getItemQuantityForCustomer({ prisma: _mockPrisma, tenancy, itemId: 'credits', customerId: 'cust-1', customerType: 'custom' });
    expect(credits).toBe(100);
  });
});

describe('playground - pre-defined scenario: ended subscription with default fallback', () => {
  it('customer falls back to free plan after subscription ends', async () => {
    const db = {
      subscriptions: [{
        id: 'sub-1', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'pro', priceId: 'monthly', product: product1, quantity: 1,
        stripeSubscriptionId: 'stripe-1', status: 'canceled',
        currentPeriodStart: new Date('2025-01-01'), currentPeriodEnd: new Date('2025-02-01'),
        cancelAtPeriodEnd: false, endedAt: new Date('2025-02-01'), refundedAt: null,
        billingCycleAnchor: new Date('2025-01-01'), creationSource: 'PURCHASE_PAGE',
        createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-02-01'),
      }],
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: { free: productToInlineProduct(freeProduct as any) },
        createdAt: new Date('2024-12-01'),
      }],
    };
    setupMock(db);
    const tenancy = makeTenancy({
      products: { pro: product1, free: freeProduct },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });

    const owned = await getOwnedProductsForCustomer({ prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1' });
    const ownedIds = owned.map((p) => p.id);
    expect(ownedIds).toContain('free');
    expect(owned.find((p) => p.id === 'free')?.type).toBe('include-by-default');

    const seats = await getItemQuantityForCustomer({ prisma: _mockPrisma, tenancy, itemId: 'seats', customerId: 'cust-1', customerType: 'custom' });
    // Default item quantity reflects active ownership at query time.
    expect(seats).toBe(1);
  });
});

describe('playground - pre-defined scenario: refunded subscription', () => {
  it('refunded subscription removes items with when-purchase-expires', async () => {
    const db = {
      subscriptions: [{
        id: 'sub-1', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'pro', priceId: 'monthly', product: product1, quantity: 1,
        stripeSubscriptionId: 'stripe-1', status: 'active',
        currentPeriodStart: new Date('2025-01-01'), currentPeriodEnd: new Date('2025-02-01'),
        cancelAtPeriodEnd: false, endedAt: null, refundedAt: new Date('2025-01-15'),
        billingCycleAnchor: new Date('2025-01-01'), creationSource: 'PURCHASE_PAGE',
        createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'),
      }],
    };
    setupMock(db);
    const tenancy = makeTenancy({ products: { pro: product1 }, productLines: { plans: { displayName: 'Plans', customerType: 'custom' } } });

    const owned = await getOwnedProductsForCustomer({ prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1' });
    expect(owned.length).toBe(0);

    const seats = await getItemQuantityForCustomer({ prisma: _mockPrisma, tenancy, itemId: 'seats', customerId: 'cust-1', customerType: 'custom' });
    expect(seats).toBe(0);
  });
});

describe('playground - pre-defined scenario: mixed sources', () => {
  it('combines subscription + OTP + manual changes correctly', async () => {
    const otpProduct = {
      displayName: 'Credit Pack', customerType: 'custom',
      includedItems: { credits: { quantity: 50 } },
      prices: { once: { USD: '10' } }, isAddOnTo: false, serverOnly: false, stackable: true,
    };
    const db = {
      subscriptions: [{
        id: 'sub-1', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'pro', priceId: 'monthly', product: product1, quantity: 1,
        stripeSubscriptionId: 'stripe-1', status: 'active',
        currentPeriodStart: new Date('2025-01-01'), currentPeriodEnd: new Date('2025-02-01'),
        cancelAtPeriodEnd: false, endedAt: null, refundedAt: null,
        billingCycleAnchor: new Date('2025-01-01'), creationSource: 'PURCHASE_PAGE',
        createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'),
      }],
      oneTimePurchases: [{
        id: 'otp-1', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'credit-pack', priceId: 'once', product: otpProduct, quantity: 2,
        stripePaymentIntentId: 'pi-1', refundedAt: null,
        creationSource: 'PURCHASE_PAGE', createdAt: new Date('2025-01-10'), updatedAt: new Date('2025-01-10'),
      }],
      itemQuantityChanges: [{
        id: 'iqc-1', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        itemId: 'credits', quantity: 25, description: null, expiresAt: null, createdAt: new Date('2025-01-05'),
      }],
    };
    setupMock(db);
    const tenancy = makeTenancy({
      products: { pro: product1, 'credit-pack': otpProduct },
      productLines: { plans: { displayName: 'Plans', customerType: 'custom' } },
    });

    const owned = await getOwnedProductsForCustomer({ prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1' });
    expect(owned.length).toBe(2);

    const txs = await getAllTransactionsForCustomer(_mockPrisma, tenancy, 'custom', 'cust-1');
    expect(txs.length).toBeGreaterThan(2);

    const credits = await getItemQuantityForCustomer({ prisma: _mockPrisma, tenancy, itemId: 'credits', customerId: 'cust-1', customerType: 'custom' });
    // sub: 100 + otp: 50*2=100 + manual: 25 = 225
    expect(credits).toBe(225);

    const seats = await getItemQuantityForCustomer({ prisma: _mockPrisma, tenancy, itemId: 'seats', customerId: 'cust-1', customerType: 'custom' });
    expect(seats).toBe(4);
  });
});

describe('playground - pre-defined scenario: time-travel snapshots', () => {
  it('produces different results at different timestamps', async () => {
    const db = {
      subscriptions: [{
        id: 'sub-1', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'pro', priceId: 'monthly', product: product1, quantity: 1,
        stripeSubscriptionId: 'stripe-1', status: 'canceled',
        currentPeriodStart: new Date('2025-01-01'), currentPeriodEnd: new Date('2025-02-01'),
        cancelAtPeriodEnd: false, endedAt: new Date('2025-02-01'), refundedAt: null,
        billingCycleAnchor: new Date('2025-01-01'), creationSource: 'PURCHASE_PAGE',
        createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-02-01'),
      }],
    };
    setupMock(db);
    const tenancy = makeTenancy({ products: { pro: product1 }, productLines: { plans: { displayName: 'Plans', customerType: 'custom' } } });

    // Before subscription starts
    const beforeOwned = await getOwnedProductsForCustomer({ prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2024-12-01') });
    expect(beforeOwned.length).toBe(0);

    // During subscription
    const duringOwned = await getOwnedProductsForCustomer({ prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2025-01-15') });
    expect(duringOwned.length).toBe(1);
    expect(duringOwned[0].id).toBe('pro');

    const duringSeats = await getItemQuantityForCustomer({ prisma: _mockPrisma, tenancy, itemId: 'seats', customerId: 'cust-1', customerType: 'custom', now: new Date('2025-01-15') });
    expect(duringSeats).toBe(4);

    // After subscription ends
    const afterOwned = await getOwnedProductsForCustomer({ prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2025-03-01') });
    expect(afterOwned.length).toBe(0);

    const afterSeats = await getItemQuantityForCustomer({ prisma: _mockPrisma, tenancy, itemId: 'seats', customerId: 'cust-1', customerType: 'custom', now: new Date('2025-03-01') });
    expect(afterSeats).toBe(0);
  });
});

describe('playground - regression: subscription-end removes product', () => {
  it('ended subscription is not owned after endedAt', async () => {
    const sub = {
      id: '616b44cc-55eb-411b-9684-c0fc13b3a76a',
      tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
      productId: 'prod-1', priceId: 'default',
      product: {
        displayName: 'Product 1', customerType: 'custom', productLineId: 'line-1',
        includedItems: { seats: { quantity: 1, repeat: [1, 'week'], expires: 'when-repeated' }, credits: { quantity: 2, repeat: [1, 'week'], expires: 'when-purchase-expires' } },
        prices: { default: { USD: '75', serverOnly: false } }, isAddOnTo: false, serverOnly: false, stackable: false,
      },
      quantity: 1, stripeSubscriptionId: 'stripe-9be1a5af', status: 'canceled',
      currentPeriodStart: new Date('2026-01-22'), currentPeriodEnd: new Date('2026-02-21'),
      cancelAtPeriodEnd: false, endedAt: new Date('2026-02-11'), refundedAt: null,
      billingCycleAnchor: new Date('2026-01-22'), creationSource: 'PURCHASE_PAGE',
      createdAt: new Date('2026-01-22'), updatedAt: new Date('2026-02-05'),
    };
    setupMock({ subscriptions: [sub] });
    const tenancy = makeTenancy({
      products: { 'prod-1': sub.product },
      productLines: { 'line-1': { displayName: 'Line 1', customerType: 'custom' } },
    });

    // Before subscription ends: product is owned
    const ownedDuring = await getOwnedProductsForCustomer({
      prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2026-02-05'),
    });
    expect(ownedDuring.some((p) => p.id === 'prod-1')).toBe(true);

    // After subscription ends: product is NOT owned
    const ownedAfter = await getOwnedProductsForCustomer({
      prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2026-02-15'),
    });
    expect(ownedAfter.some((p) => p.id === 'prod-1')).toBe(false);
  });
});

describe('playground - regression: stackable sub-end with multiple subscriptions', () => {
  const prod2 = {
    displayName: 'Product 2', customerType: 'custom', productLineId: 'line-1',
    includedItems: {
      seats: { quantity: 4, repeat: [1, 'month'], expires: 'when-purchase-expires' },
      credits: { quantity: 6, repeat: [1, 'week'], expires: 'when-purchase-expires' },
      'api-calls': { quantity: 15, repeat: [1, 'week'], expires: 'when-repeated' },
    },
    prices: { default: { USD: '60', serverOnly: false, interval: [1, 'month'] } },
    isAddOnTo: false, serverOnly: false, stackable: true,
  };
  const prod3 = {
    displayName: 'Product 3', customerType: 'custom', productLineId: 'line-2',
    includedItems: {
      seats: { quantity: 11, repeat: [1, 'week'], expires: 'when-repeated' },
      credits: { quantity: 10, repeat: 'never', expires: 'when-purchase-expires' },
    },
    prices: { default: { USD: '70', serverOnly: false, interval: [1, 'month'] } },
    isAddOnTo: false, serverOnly: false, stackable: false,
  };
  const prod1 = {
    displayName: 'Product 1', customerType: 'custom', productLineId: 'line-1',
    includedItems: {
      seats: { quantity: 1, repeat: [1, 'week'], expires: 'when-repeated' },
      credits: { quantity: 2, repeat: [1, 'week'], expires: 'when-purchase-expires' },
    },
    prices: { default: { USD: '75', serverOnly: false, interval: [1, 'month'] } },
    isAddOnTo: false, serverOnly: false, stackable: false,
  };
  const defaultProd = {
    displayName: 'Default 1', customerType: 'custom', productLineId: 'line-1',
    includedItems: { seats: { quantity: 3 } },
    prices: 'include-by-default' as const,
    isAddOnTo: false, serverOnly: false, stackable: false,
  };

  const allSubs = [
    {
      id: '863ab1db', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
      productId: 'prod-3', priceId: 'default', product: prod3, quantity: 3,
      stripeSubscriptionId: 'stripe-1', status: 'active',
      currentPeriodStart: new Date('2026-02-02'), currentPeriodEnd: new Date('2026-03-04'),
      cancelAtPeriodEnd: false, endedAt: null, refundedAt: null,
      billingCycleAnchor: new Date('2026-02-02'), creationSource: 'PURCHASE_PAGE',
      createdAt: new Date('2026-02-02'), updatedAt: new Date('2026-02-02'),
    },
    {
      id: '616b44cc', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
      productId: 'prod-1', priceId: 'default', product: prod1, quantity: 1,
      stripeSubscriptionId: 'stripe-2', status: 'canceled',
      currentPeriodStart: new Date('2026-01-22'), currentPeriodEnd: new Date('2026-02-21'),
      cancelAtPeriodEnd: false, endedAt: new Date('2026-02-11'), refundedAt: null,
      billingCycleAnchor: new Date('2026-01-22'), creationSource: 'PURCHASE_PAGE',
      createdAt: new Date('2026-01-22'), updatedAt: new Date('2026-02-05'),
    },
    {
      id: '5d7d3d98', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
      productId: 'prod-1', priceId: 'default', product: prod1, quantity: 2,
      stripeSubscriptionId: 'stripe-3', status: 'canceled',
      currentPeriodStart: new Date('2026-01-25'), currentPeriodEnd: new Date('2026-02-24'),
      cancelAtPeriodEnd: false, endedAt: null, refundedAt: new Date('2026-02-06'),
      billingCycleAnchor: new Date('2026-01-25'), creationSource: 'PURCHASE_PAGE',
      createdAt: new Date('2026-01-25'), updatedAt: new Date('2026-01-25'),
    },
    {
      id: '3501d94e', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
      productId: 'prod-2', priceId: 'default', product: prod2, quantity: 1,
      stripeSubscriptionId: 'stripe-4', status: 'active',
      currentPeriodStart: new Date('2026-02-12'), currentPeriodEnd: new Date('2026-03-14'),
      cancelAtPeriodEnd: false, endedAt: null, refundedAt: null,
      billingCycleAnchor: new Date('2026-02-12'), creationSource: 'PURCHASE_PAGE',
      createdAt: new Date('2026-02-12'), updatedAt: new Date('2026-02-12'),
    },
    {
      id: '84bcd3bf', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
      productId: 'prod-2', priceId: 'default', product: prod2, quantity: 1,
      stripeSubscriptionId: 'stripe-5', status: 'canceled',
      currentPeriodStart: new Date('2026-01-30'), currentPeriodEnd: new Date('2026-03-01'),
      cancelAtPeriodEnd: false, endedAt: new Date('2026-02-18'), refundedAt: null,
      billingCycleAnchor: new Date('2026-01-30'), creationSource: 'PURCHASE_PAGE',
      createdAt: new Date('2026-01-30'), updatedAt: new Date('2026-02-12'),
    },
  ];

  const tenancy = makeTenancy({
    products: { 'prod-1': prod1, 'prod-2': prod2, 'prod-3': prod3, 'default-1': defaultProd },
    productLines: {
      'line-1': { displayName: 'line-1', customerType: 'custom' },
      'line-2': { displayName: 'line-2', customerType: 'custom' },
    },
    items: {
      seats: { displayName: 'seats', customerType: 'custom' },
      credits: { displayName: 'credits', customerType: 'custom' },
      'api-calls': { displayName: 'api-calls', customerType: 'custom' },
    },
  });

  it('prod-2 from ended sub 84bcd3bf is NOT owned after endedAt, but still owned from 3501d94e', async () => {
    setupMock({
      subscriptions: allSubs,
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: { 'default-1': { display_name: 'Default 1', customer_type: 'custom', product_line_id: 'line-1', included_items: { seats: { quantity: 3 } }, prices: {}, server_only: false, stackable: false, client_metadata: null, client_read_only_metadata: null, server_metadata: null } },
        createdAt: new Date('2026-01-20'),
      }],
    });

    // Before sub 84bcd3bf ends (Feb 15): prod-2 owned from BOTH subs
    const ownedFeb15 = await getOwnedProductsForCustomer({
      prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2026-02-15'),
    });
    const prod2sFeb15 = ownedFeb15.filter((p) => p.id === 'prod-2');
    expect(prod2sFeb15.length).toBe(2);
    expect(prod2sFeb15.reduce((sum, p) => sum + p.quantity, 0)).toBe(2);

    // After sub 84bcd3bf ends (Feb 19): prod-2 owned from ONLY 3501d94e
    const ownedFeb19 = await getOwnedProductsForCustomer({
      prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2026-02-19'),
    });
    const prod2sFeb19 = ownedFeb19.filter((p) => p.id === 'prod-2');
    expect(prod2sFeb19.length).toBe(1);
    expect(prod2sFeb19[0].quantity).toBe(1);
    expect(prod2sFeb19[0].sourceId).toBe('3501d94e');
  });

  it('full transaction list includes both subscription-end transactions', async () => {
    setupMock({
      subscriptions: allSubs,
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: { 'default-1': { display_name: 'Default 1', customer_type: 'custom', product_line_id: 'line-1', included_items: { seats: { quantity: 3 } }, prices: {}, server_only: false, stackable: false, client_metadata: null, client_read_only_metadata: null, server_metadata: null } },
        createdAt: new Date('2026-01-20'),
      }],
    });

    const allTx = await getAllTransactionsForCustomer(_mockPrisma, tenancy, 'custom', 'cust-1');
    const subEndTxs = allTx.filter((tx) => tx.type === 'subscription-end');
    expect(subEndTxs.length).toBe(2);
    expect(subEndTxs.some((tx) => tx.id === '84bcd3bf:end')).toBe(true);
    expect(subEndTxs.some((tx) => tx.id === '616b44cc:end')).toBe(true);

    // Verify the revocation entries point to correct transaction IDs
    for (const tx of subEndTxs) {
      const revocation = tx.entries.find((e) => (e as any).type === 'product-revocation') as any;
      expect(revocation).toBeDefined();
      if (revocation) {
        // The adjusted_transaction_id should be the subscription ID (without :end)
        expect(revocation.adjusted_transaction_id).toBe(tx.id.replace(':end', ''));
      }
    }
  });
});

describe('playground - regression: default product not granted while same-line product owned', () => {
  const prod1 = {
    displayName: 'Product 1', customerType: 'custom', productLineId: 'line-1',
    includedItems: { seats: { quantity: 6, repeat: [1, 'week'], expires: 'when-repeated' } },
    prices: { default: { USD: '48', serverOnly: false, interval: [1, 'month'] } },
    isAddOnTo: false, serverOnly: false, stackable: false,
  };
  const defaultProd = {
    displayName: 'Default 1', customerType: 'custom', productLineId: 'line-1',
    includedItems: { seats: { quantity: 1 } },
    prices: 'include-by-default' as const,
    isAddOnTo: false, serverOnly: false, stackable: false,
  };

  it('default product should NOT be owned while a paid product in same line is owned', async () => {
    setupMock({
      subscriptions: [{
        id: 'sub-active', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'prod-1', priceId: 'default', product: prod1, quantity: 1,
        stripeSubscriptionId: 'stripe-1', status: 'active',
        currentPeriodStart: new Date('2025-11-01'), currentPeriodEnd: new Date('2025-12-01'),
        cancelAtPeriodEnd: false, endedAt: null, refundedAt: null,
        billingCycleAnchor: new Date('2025-11-01'), creationSource: 'PURCHASE_PAGE',
        createdAt: new Date('2025-11-01'), updatedAt: new Date('2025-11-01'),
      }],
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: {
          'default-1': {
            display_name: 'Default 1', customer_type: 'custom', product_line_id: 'line-1',
            included_items: { seats: { quantity: 1 } }, prices: {},
            server_only: false, stackable: false,
            client_metadata: null, client_read_only_metadata: null, server_metadata: null,
          },
        },
        createdAt: new Date('2025-10-01'),
      }],
    });

    const tenancy = makeTenancy({
      products: { 'prod-1': prod1, 'default-1': defaultProd },
      productLines: { 'line-1': { displayName: 'line-1', customerType: 'custom' } },
      items: { seats: { displayName: 'seats', customerType: 'custom' } },
    });

    const owned = await getOwnedProductsForCustomer({
      prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2025-11-15'),
    });

    // prod-1 should be owned
    expect(owned.some((p) => p.id === 'prod-1')).toBe(true);
    // default-1 should NOT be owned (same product line, conflict)
    expect(owned.some((p) => p.id === 'default-1')).toBe(false);
  });

  it('default product should be owned when no paid product in same line is owned', async () => {
    setupMock({
      subscriptions: [{
        id: 'sub-ended', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'prod-1', priceId: 'default', product: prod1, quantity: 1,
        stripeSubscriptionId: 'stripe-1', status: 'canceled',
        currentPeriodStart: new Date('2025-11-01'), currentPeriodEnd: new Date('2025-12-01'),
        cancelAtPeriodEnd: false, endedAt: new Date('2025-11-20'), refundedAt: null,
        billingCycleAnchor: new Date('2025-11-01'), creationSource: 'PURCHASE_PAGE',
        createdAt: new Date('2025-11-01'), updatedAt: new Date('2025-11-20'),
      }],
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: {
          'default-1': {
            display_name: 'Default 1', customer_type: 'custom', product_line_id: 'line-1',
            included_items: { seats: { quantity: 1 } }, prices: {},
            server_only: false, stackable: false,
            client_metadata: null, client_read_only_metadata: null, server_metadata: null,
          },
        },
        createdAt: new Date('2025-10-01'),
      }],
    });

    const tenancy = makeTenancy({
      products: { 'prod-1': prod1, 'default-1': defaultProd },
      productLines: { 'line-1': { displayName: 'line-1', customerType: 'custom' } },
      items: { seats: { displayName: 'seats', customerType: 'custom' } },
    });

    // After sub ends: default product should be owned
    const ownedAfter = await getOwnedProductsForCustomer({
      prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now: new Date('2025-12-01'),
    });
    expect(ownedAfter.some((p) => p.id === 'default-1')).toBe(true);
    expect(ownedAfter.some((p) => p.id === 'prod-1')).toBe(false);
  });

  it('does not apply defaults from legacy productLineId snapshots while paid product in same line is owned', async () => {
    setupMock({
      subscriptions: [{
        id: 'sub-active', tenancyId: 'tenancy-1', customerId: 'cust-1', customerType: 'CUSTOM',
        productId: 'prod-1', priceId: 'default', product: {
          displayName: 'Product 1', customerType: 'custom', productLineId: 'line-1',
          includedItems: {
            seats: { quantity: 2, repeat: [1, 'week'], expires: 'when-repeated' },
            credits: { quantity: 3, repeat: [1, 'week'], expires: 'never' },
          },
          prices: { default: { USD: '73', serverOnly: false, interval: [1, 'month'] } },
          isAddOnTo: false, serverOnly: false, stackable: false,
        }, quantity: 2,
        stripeSubscriptionId: 'stripe-1', status: 'active',
        currentPeriodStart: new Date('2025-11-18T14:54:58.500Z'), currentPeriodEnd: new Date('2025-12-18T14:54:58.500Z'),
        cancelAtPeriodEnd: false, endedAt: null, refundedAt: null,
        billingCycleAnchor: new Date('2025-11-18T14:54:58.500Z'), creationSource: 'PURCHASE_PAGE',
        createdAt: new Date('2025-11-18T14:54:58.500Z'), updatedAt: new Date('2025-11-18T14:54:58.500Z'),
      }],
      defaultProductsSnapshots: [{
        id: 'snap-1', tenancyId: 'tenancy-1',
        snapshot: {
          'default-1': {
            display_name: 'Default 1', customer_type: 'custom', productLineId: 'line-1',
            included_items: { seats: { quantity: 3, repeat: [1, 'day'] } }, prices: {},
            server_only: false, stackable: false, client_metadata: null, client_read_only_metadata: null, server_metadata: null,
          },
          'default-2': {
            display_name: 'Default 2', customer_type: 'custom', productLineId: 'line-1',
            included_items: { credits: { quantity: 2 } }, prices: {},
            server_only: false, stackable: false, client_metadata: null, client_read_only_metadata: null, server_metadata: null,
          },
        },
        createdAt: new Date('2025-11-09T22:05:00.000Z'),
      }],
    });

    const tenancy = makeTenancy({
      products: {
        'prod-1': {
          displayName: 'Product 1', customerType: 'custom', productLineId: 'line-1',
          includedItems: {
            seats: { quantity: 2, repeat: [1, 'week'], expires: 'when-repeated' },
            credits: { quantity: 3, repeat: [1, 'week'], expires: 'never' },
          },
          prices: { default: { USD: '73', serverOnly: false, interval: [1, 'month'] } },
          isAddOnTo: false, serverOnly: false, stackable: false,
        },
        'default-1': {
          displayName: 'Default 1', customerType: 'custom', productLineId: 'line-1',
          includedItems: { seats: { quantity: 3, repeat: [1, 'day'] } },
          prices: 'include-by-default', isAddOnTo: false, serverOnly: false, stackable: false,
        },
        'default-2': {
          displayName: 'Default 2', customerType: 'custom', productLineId: 'line-1',
          includedItems: { credits: { quantity: 2 } },
          prices: 'include-by-default', isAddOnTo: false, serverOnly: false, stackable: false,
        },
      },
      productLines: { 'line-1': { displayName: 'line-1', customerType: 'custom' } },
      items: {
        seats: { displayName: 'seats', customerType: 'custom' },
        credits: { displayName: 'credits', customerType: 'custom' },
      },
    });

    const now = new Date('2025-11-20T00:00:00.000Z');
    const owned = await getOwnedProductsForCustomer({
      prisma: _mockPrisma, tenancy, customerType: 'custom', customerId: 'cust-1', now,
    });
    expect(owned.some((p) => p.id === 'prod-1')).toBe(true);
    expect(owned.some((p) => p.id === 'default-1')).toBe(false);
    expect(owned.some((p) => p.id === 'default-2')).toBe(false);

    const seats = await getItemQuantityForCustomer({
      prisma: _mockPrisma, tenancy, itemId: 'seats', customerId: 'cust-1', customerType: 'custom', now,
    });
    const credits = await getItemQuantityForCustomer({
      prisma: _mockPrisma, tenancy, itemId: 'credits', customerId: 'cust-1', customerType: 'custom', now,
    });
    expect(seats).toBe(4);
    expect(credits).toBe(6);
  });
});
