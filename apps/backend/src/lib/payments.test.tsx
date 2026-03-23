import type { PrismaClientTransaction } from '@/prisma-client';
import { KnownErrors } from '@stackframe/stack-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCustomerPurchaseContext, getItemQuantityForCustomer, getSubscriptions, validatePurchaseSession } from './payments';
import type { Tenancy } from './tenancies';

function createMockPrisma(overrides: Partial<PrismaClientTransaction> = {}): PrismaClientTransaction {
  return {
    subscription: {
      findMany: async () => [],
    },
    itemQuantityChange: {
      findMany: async () => [],
      findFirst: async () => null,
    },
    oneTimePurchase: {
      findMany: async () => [],
    },
    projectUser: {
      findUnique: async () => null,
    },
    team: {
      findUnique: async () => null,
    },
    ...(overrides as any),
  } as any;
}

function createMockTenancy(config: Partial<Tenancy['config']['payments']>, id: string = 'tenancy-1'): Tenancy {
  return {
    id,
    config: {
      payments: {
        ...config,
      },
    } as any,
    branchId: 'main',
    organization: null,
    project: { id: 'project-1' },
  } as any;
}

describe('getItemQuantityForCustomer - manual changes (no subscription)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('manual changes: expired positives ignored; negatives applied', async () => {
    const now = new Date('2025-02-01T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'manualA';

    const tenancy = createMockTenancy({
      items: {
        [itemId]: {
          displayName: 'Manual',
          customerType: 'custom',
        },
      },
      products: {},
      productLines: {},
    });

    const prisma = createMockPrisma({
      itemQuantityChange: {
        findMany: async () => [
          // +10 expired
          { quantity: 10, createdAt: new Date('2025-01-27T00:00:00.000Z'), expiresAt: new Date('2025-01-31T23:59:59.000Z') },
          // +11 active
          { quantity: 11, createdAt: new Date('2025-01-29T12:00:00.000Z'), expiresAt: null },
          // -3 active
          { quantity: -3, createdAt: new Date('2025-01-30T00:00:00.000Z'), expiresAt: null },
          // -2 expired (should be ignored)
          { quantity: -2, createdAt: new Date('2025-01-25T00:00:00.000Z'), expiresAt: new Date('2025-01-26T00:00:00.000Z') },
        ],
        findFirst: async () => null,
      },
    } as any);

    const qty = await getItemQuantityForCustomer({
      prisma,
      tenancy,
      itemId,
      customerId: 'custom-1',
      customerType: 'custom',
    });
    // Expired +10 absorbs earlier -3; active +11 remains => 11
    expect(qty).toBe(11);
    vi.useRealTimers();
  });

  it('manual changes: multiple active negatives reduce to zero', async () => {
    const now = new Date('2025-02-01T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'manualB';

    const tenancy = createMockTenancy({
      items: {
        [itemId]: {
          displayName: 'Manual',
          customerType: 'custom',
        },
      },
      products: {},
      productLines: {},
    });

    const prisma = createMockPrisma({
      itemQuantityChange: {
        findMany: async () => [
          // +5 active
          { quantity: 5, createdAt: new Date('2025-01-29T12:00:00.000Z'), expiresAt: null },
          // -3 active
          { quantity: -3, createdAt: new Date('2025-01-30T00:00:00.000Z'), expiresAt: null },
          // -2 active
          { quantity: -2, createdAt: new Date('2025-01-25T00:00:00.000Z'), expiresAt: null },
        ],
        findFirst: async () => null,
      },
    } as any);

    const qty = await getItemQuantityForCustomer({
      prisma,
      tenancy,
      itemId,
      customerId: 'custom-1',
      customerType: 'custom',
    });
    // Active +5 minus active -3 and -2 => 0
    expect(qty).toBe(0);
    vi.useRealTimers();
  });
});


describe('getItemQuantityForCustomer - subscriptions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('repeat=never, expires=when-purchase-expires → one grant within period', async () => {
    const now = new Date('2025-02-05T12:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemA';

    const tenancy = createMockTenancy({
      items: {
        [itemId]: { displayName: 'S', customerType: 'user' },
      },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        off1: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 3, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'off1',
          product: tenancy.config.payments.products['off1'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-02-28T23:59:59.000Z'),
          quantity: 2,
          status: 'active',
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // 3 per period * subscription quantity 2 => 6 within period
    expect(qty).toBe(6);
    vi.useRealTimers();
  });

  it('repeat=weekly, expires=when-purchase-expires → accumulate within period until now', async () => {
    const now = new Date('2025-02-15T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemWeekly';

    const tenancy = createMockTenancy({
      items: {
        [itemId]: { displayName: 'S', customerType: 'user' },
      },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offW: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 4, repeat: [1, 'week'], expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offW',
          product: tenancy.config.payments.products['offW'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
        }],
      },
    } as any);

    // From 2025-02-01 to 2025-02-15: elapsed weeks = 2 → occurrences = 3 → 3 * 4 = 12
    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // Accumulate 3 occurrences * 4 each within current period => 12
    expect(qty).toBe(12);
    vi.useRealTimers();
  });

  it('repeat=weekly, expires=never → accumulate items until now', async () => {
    const now = new Date('2025-02-15T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemWeekly';

    const tenancy = createMockTenancy({
      items: {
        [itemId]: { displayName: 'S', customerType: 'user' },
      },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offW: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 4, repeat: [1, 'week'], expires: 'never' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offW',
          product: tenancy.config.payments.products['offW'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
        }],
      },
    } as any);

    // From 2025-02-01 to 2025-02-15: elapsed weeks = 2 → occurrences = 3 → 3 * 4 = 12
    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // Accumulate 3 occurrences * 4 each within current period => 12
    expect(qty).toBe(12);
    vi.useRealTimers();
  });

  it('repeat=weekly, expires=when-repeated → one grant per billing period', async () => {
    const now = new Date('2025-02-15T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemWeeklyWindow';

    const tenancy = createMockTenancy({
      items: {
        [itemId]: { displayName: 'S', customerType: 'user' },
      },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offR: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 7, repeat: [1, 'week'], expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offR',
          product: tenancy.config.payments.products['offR'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
          createdAt: new Date('2025-02-01T00:00:00.000Z'),
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // when-repeated: single grant per billing period regardless of repeat windows => 7
    expect(qty).toBe(7);
    vi.useRealTimers();
  });

  it('repeat=never, expires=never → one persistent grant from period start', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemPersistent';

    const tenancy = createMockTenancy({
      items: {
        [itemId]: { displayName: 'S', customerType: 'user' },
      },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offN: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 2, repeat: 'never', expires: 'never' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offN',
          product: tenancy.config.payments.products['offN'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 3,
          status: 'active',
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // Persistent grant: 2 per period * subscription quantity 3 => 6
    expect(qty).toBe(6);
    vi.useRealTimers();
  });

  it('when-repeated yields constant base within a billing period at different times', async () => {
    const itemId = 'subItemWeeklyWindowConst';
    const tenancy = createMockTenancy({
      items: {
        [itemId]: { displayName: 'S', customerType: 'user' },
      },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offRC: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 7, repeat: [1, 'week'], expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offRC',
          product: tenancy.config.payments.products['offRC'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
          createdAt: new Date('2025-02-01T00:00:00.000Z'),
        }],
      },
    } as any);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-02-02T00:00:00.000Z'));
    const qtyEarly = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // when-repeated: within the period, base stays constant at any instant => 7
    expect(qtyEarly).toBe(7);

    vi.setSystemTime(new Date('2025-02-23T00:00:00.000Z'));
    const qtyLate = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // Still within the same period; remains 7 (new weekly window, same base)
    expect(qtyLate).toBe(7);
    vi.useRealTimers();
  });

  it('when-repeated grants again on renewal period boundary', async () => {
    const itemId = 'subItemWeeklyWindowRenew';
    const tenancy = createMockTenancy({
      items: {
        [itemId]: { displayName: 'S', customerType: 'user' },
      },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offRR: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 7, repeat: [1, 'week'], expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => {
          const now = new Date();
          const inFirstPeriod = now < new Date('2025-03-01T00:00:00.000Z');
          const start = inFirstPeriod ? new Date('2025-02-01T00:00:00.000Z') : new Date('2025-03-01T00:00:00.000Z');
          const end = inFirstPeriod ? new Date('2025-03-01T00:00:00.000Z') : new Date('2025-04-01T00:00:00.000Z');
          return [{
            productId: 'offRR',
            product: tenancy.config.payments.products['offRR'],
            currentPeriodStart: start,
            currentPeriodEnd: end,
            quantity: 1,
            status: 'active',
            createdAt: start,
          }];
        },
      },
    } as any);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-02-15T00:00:00.000Z'));
    const qtyFirst = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // First billing period grant => 7
    expect(qtyFirst).toBe(7);

    vi.setSystemTime(new Date('2025-03-15T00:00:00.000Z'));
    const qtySecond = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // Renewal grants again for next period => 7
    expect(qtySecond).toBe(7);
    vi.useRealTimers();
  });

  it('when-repeated (weekly): manual negative reduces within window and resets at next window without renewal', async () => {
    const itemId = 'subItemManualDebits';
    const tenancy = createMockTenancy({
      items: {
        [itemId]: { displayName: 'S', customerType: 'user' },
      },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offMD: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 10, repeat: [1, 'week'], expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offMD',
          product: tenancy.config.payments.products['offMD'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
          createdAt: new Date('2025-02-01T00:00:00.000Z'),
        }],
      },
      itemQuantityChange: {
        findMany: async () => [
          // Negative within the week of Feb 9-15, expires at end of that week
          { quantity: -3, createdAt: new Date('2025-02-10T00:00:00.000Z'), expiresAt: new Date('2025-02-16T00:00:00.000Z') },
        ],
        findFirst: async () => null,
      },
    } as any);

    vi.useFakeTimers();
    // During week with negative active: 10 - 3 = 7
    vi.setSystemTime(new Date('2025-02-12T00:00:00.000Z'));
    const qtyDuring = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qtyDuring).toBe(7);

    // Next week (negative expired): resets without renewal => 10
    vi.setSystemTime(new Date('2025-02-20T00:00:00.000Z'));
    const qtyNextWeek = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qtyNextWeek).toBe(10);
    vi.useRealTimers();
  });

  it('repeat=never with expires=when-repeated → treated as persistent (no expiry)', async () => {
    const itemId = 'subPersistentWhenRepeated';
    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'S', customerType: 'user' } },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offBF: {
          displayName: 'O', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 5, repeat: 'never', expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offBF',
          product: tenancy.config.payments.products['offBF'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
        }],
      },
      itemQuantityChange: {
        findMany: async () => [
          // Manual positive persists
          { quantity: 3, createdAt: new Date('2025-01-10T00:00:00.000Z'), expiresAt: null },
          // Manual negative persists
          { quantity: -6, createdAt: new Date('2025-01-15T00:00:00.000Z'), expiresAt: null },
        ],
        findFirst: async () => null,
      },
    } as any);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-02-15T00:00:00.000Z'));
    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    // Persistent: 5 (grant) + 3 (manual +) - 6 (manual -) => 2
    expect(qty).toBe(2);
    vi.useRealTimers();
  });

  it('aggregates multiple subscriptions with different quantities', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemAggregate';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'S', customerType: 'user' } },
      productLines: { g1: { displayName: 'G1', customerType: 'user' }, g2: { displayName: 'G2', customerType: 'user' } },
      products: {
        off1: {
          displayName: 'O1', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 2, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
        off2: {
          displayName: 'O2', productLineId: 'g2', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 1, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [
          {
            productId: 'off1',
            product: tenancy.config.payments.products['off1'],
            currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
            quantity: 3,
            status: 'active',
          },
          {
            productId: 'off2',
            product: tenancy.config.payments.products['off2'],
            currentPeriodStart: new Date('2025-01-15T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-03-15T00:00:00.000Z'),
            quantity: 5,
            status: 'active',
          },
        ],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(11);
    vi.useRealTimers();
  });

  it('one subscription with two items works for both items', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemA = 'bundleItemA';
    const itemB = 'bundleItemB';

    const tenancy = createMockTenancy({
      items: { [itemA]: { displayName: 'A', customerType: 'user' }, [itemB]: { displayName: 'B', customerType: 'user' } },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offBundle: {
          displayName: 'OB', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: {
            [itemA]: { quantity: 2, repeat: 'never', expires: 'when-purchase-expires' },
            [itemB]: { quantity: 4, repeat: 'never', expires: 'when-purchase-expires' },
          },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offBundle',
          product: tenancy.config.payments.products['offBundle'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 2,
          status: 'active',
        }],
      },
    } as any);

    const qtyA = await getItemQuantityForCustomer({ prisma, tenancy, itemId: itemA, customerId: 'u1', customerType: 'user' });
    const qtyB = await getItemQuantityForCustomer({ prisma, tenancy, itemId: itemB, customerId: 'u1', customerType: 'user' });
    expect(qtyA).toBe(4);
    expect(qtyB).toBe(8);
    vi.useRealTimers();
  });

  it('trialing subscription behaves like active', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'trialItem';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'T', customerType: 'user' } },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offT: {
          displayName: 'OT', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 5, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offT',
          product: tenancy.config.payments.products['offT'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 3,
          status: 'trialing',
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(15);
    vi.useRealTimers();
  });

  it('cancelAtPeriodEnd=true with active status still provides items until period ends', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'scheduledCancelItem';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'S', customerType: 'team' } },
      productLines: { plans: { displayName: 'Plans', customerType: 'team' } },
      products: {
        teamPlan: {
          displayName: 'Team',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: '49', serverOnly: false } },
          includedItems: { [itemId]: { quantity: 4, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          id: 'sub-1',
          productId: 'teamPlan',
          product: tenancy.config.payments.products['teamPlan'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          cancelAtPeriodEnd: true,
          status: 'active',
          stripeSubscriptionId: 'stripe-sub-1',
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'team-1', customerType: 'team' });
    // User scheduled cancellation but period hasn't ended - should still have 4 seats
    expect(qty).toBe(4);
    vi.useRealTimers();
  });

  it('subscription with ended period contributes no quantity (items expired via when-purchase-expires)', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'canceledItem';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'C', customerType: 'user' } },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offC: {
          displayName: 'OC', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 9, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offC',
          product: tenancy.config.payments.products['offC'],
          currentPeriodStart: new Date('2024-12-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-01-01T00:00:00.000Z'),
          quantity: 1,
          status: 'canceled',
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(0);
    vi.useRealTimers();
  });

  /**
   * BUG: canceled-but-not-expired subscription should still provide items
   *
   * When a subscription is canceled but currentPeriodEnd is still in the future,
   * the user paid for that period and should still receive the items.
   * The default (free) plan should NOT be injected until the period actually ends.
   *
   * Current behavior: The default plan gets injected immediately on cancellation,
   * causing both the canceled subscription's items AND the default plan's items
   * to be counted together (e.g., 4 + 1 = 5 seats instead of just 4).
   */
  it.fails('BUG: canceled-but-not-expired subscription should provide items without default plan injection', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'seats';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'Seats', customerType: 'team' } },
      productLines: { plans: { displayName: 'Plans', customerType: 'team' } },
      products: {
        freePlan: {
          displayName: 'Free',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: { [itemId]: { quantity: 1, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
        teamPlan: {
          displayName: 'Team',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: '49', serverOnly: false } },
          includedItems: { [itemId]: { quantity: 4, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [
          {
            id: 'sub-1',
            productId: 'teamPlan',
            product: tenancy.config.payments.products['teamPlan'],
            currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
            quantity: 1,
            status: 'canceled',
            stripeSubscriptionId: 'stripe-sub-1',
          },
        ],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'team-1', customerType: 'team' });
    // Should be 4 (from canceled-but-not-expired Team plan), NOT 5 (4 + 1 from injected Free plan)
    expect(qty).toBe(4);
    vi.useRealTimers();
  });

  it('ungrouped product works without tenancy groups', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'ungroupedItem';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'U', customerType: 'user' } },
      productLines: {},
      products: {
        offU: {
          displayName: 'OU',
          productLineId: undefined,
          customerType: 'user',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 4, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          productId: 'offU',
          product: tenancy.config.payments.products['offU'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 2,
          status: 'active',
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(8);
    vi.useRealTimers();
  });

  it('ungrouped include-by-default provides item quantity without db subscription', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'defaultItemUngrouped';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'UDF', customerType: 'user' } },
      productLines: {},
      products: {
        offFreeUngrouped: {
          displayName: 'Free Ungrouped',
          productLineId: undefined,
          customerType: 'user',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: { [itemId]: { quantity: 5, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: { findMany: async () => [] },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(5);
    vi.useRealTimers();
  });
});

describe('getItemQuantityForCustomer - add-ons', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('add-on items count when base plan is active', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'seats';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'Seats', customerType: 'team' } },
      productLines: { plans: { displayName: 'Plans', customerType: 'team' } },
      products: {
        teamPlan: {
          displayName: 'Team',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: '49', serverOnly: false } },
          includedItems: { [itemId]: { quantity: 4, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
        extraSeat: {
          displayName: 'Extra Seat',
          productLineId: undefined,
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: true,
          prices: { monthly: { USD: '10', serverOnly: false } },
          includedItems: { [itemId]: { quantity: 1, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: { teamPlan: true },
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [
          {
            id: 'sub-1',
            productId: 'teamPlan',
            product: tenancy.config.payments.products['teamPlan'],
            currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
            quantity: 1,
            status: 'active',
            stripeSubscriptionId: 'stripe-sub-1',
          },
          {
            id: 'sub-2',
            productId: 'extraSeat',
            product: tenancy.config.payments.products['extraSeat'],
            currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
            quantity: 1,
            status: 'active',
            stripeSubscriptionId: 'stripe-sub-2',
          },
        ],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'team-1', customerType: 'team' });
    // 4 from Team plan + 1 from add-on = 5
    expect(qty).toBe(5);
    vi.useRealTimers();
  });

  it('add-on with expires=never persists after base plan expires', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'seats';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'Seats', customerType: 'team' } },
      productLines: { plans: { displayName: 'Plans', customerType: 'team' } },
      products: {
        freePlan: {
          displayName: 'Free',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: { [itemId]: { quantity: 1, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
        teamPlan: {
          displayName: 'Team',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: '49', serverOnly: false } },
          includedItems: { [itemId]: { quantity: 4, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
        extraSeat: {
          displayName: 'Extra Seat',
          productLineId: undefined,
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: true,
          prices: { monthly: { USD: '10', serverOnly: false } },
          includedItems: { [itemId]: { quantity: 1, repeat: 'never', expires: 'never' } },
          isAddOnTo: { teamPlan: true },
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [
          {
            id: 'sub-1',
            productId: 'teamPlan',
            product: tenancy.config.payments.products['teamPlan'],
            currentPeriodStart: new Date('2025-01-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-02-01T00:00:00.000Z'),
            quantity: 1,
            status: 'canceled',
            stripeSubscriptionId: 'stripe-sub-1',
          },
          {
            id: 'sub-2',
            productId: 'extraSeat',
            product: tenancy.config.payments.products['extraSeat'],
            currentPeriodStart: new Date('2025-01-15T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-02-15T00:00:00.000Z'),
            quantity: 1,
            status: 'active',
            stripeSubscriptionId: 'stripe-sub-2',
          },
        ],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'team-1', customerType: 'team' });
    // Team plan expired (0 seats) + Free plan injected (1 seat) + add-on with expires=never (1 seat) = 2
    expect(qty).toBe(2);
    vi.useRealTimers();
  });

  it('add-on with expires=when-purchase-expires loses items when add-on subscription expires', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'seats';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'Seats', customerType: 'team' } },
      productLines: { plans: { displayName: 'Plans', customerType: 'team' } },
      products: {
        freePlan: {
          displayName: 'Free',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: { [itemId]: { quantity: 1, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
        teamPlan: {
          displayName: 'Team',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: '49', serverOnly: false } },
          includedItems: { [itemId]: { quantity: 4, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
        extraSeat: {
          displayName: 'Extra Seat',
          productLineId: undefined,
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: true,
          prices: { monthly: { USD: '10', serverOnly: false } },
          includedItems: { [itemId]: { quantity: 1, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: { teamPlan: true },
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [
          {
            id: 'sub-1',
            productId: 'teamPlan',
            product: tenancy.config.payments.products['teamPlan'],
            currentPeriodStart: new Date('2025-01-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-02-01T00:00:00.000Z'),
            quantity: 1,
            status: 'canceled',
            stripeSubscriptionId: 'stripe-sub-1',
          },
          {
            id: 'sub-2',
            productId: 'extraSeat',
            product: tenancy.config.payments.products['extraSeat'],
            currentPeriodStart: new Date('2025-01-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-02-01T00:00:00.000Z'),
            quantity: 1,
            status: 'canceled',
            stripeSubscriptionId: 'stripe-sub-2',
          },
        ],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'team-1', customerType: 'team' });
    // Team plan expired (0) + add-on expired (0) + Free plan injected (1) = 1
    expect(qty).toBe(1);
    vi.useRealTimers();
  });
});


describe('getItemQuantityForCustomer - one-time purchases', () => {
  it('adds included item quantity multiplied by purchase quantity', async () => {
    const itemId = 'otpItemA';
    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'I', customerType: 'custom' } },
      products: {},
      productLines: {},
    });

    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [{
          productId: 'off-otp',
          product: { includedItems: { [itemId]: { quantity: 5 } } },
          quantity: 2,
          createdAt: new Date('2025-02-10T00:00:00.000Z'),
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({
      prisma,
      tenancy,
      itemId,
      customerId: 'custom-1',
      customerType: 'custom',
    });
    expect(qty).toBe(10);
  });

  it('aggregates multiple one-time purchases across different products', async () => {
    const itemId = 'otpItemB';
    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'I', customerType: 'custom' } },
      products: {},
      productLines: {},
    });

    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [
          { productId: 'off-1', product: { includedItems: { [itemId]: { quantity: 3 } } }, quantity: 1, createdAt: new Date('2025-02-10T00:00:00.000Z') },
          { productId: 'off-2', product: { includedItems: { [itemId]: { quantity: 5 } } }, quantity: 2, createdAt: new Date('2025-02-11T00:00:00.000Z') },
        ],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({
      prisma,
      tenancy,
      itemId,
      customerId: 'custom-1',
      customerType: 'custom',
    });
    expect(qty).toBe(13);
  });
});


describe('validatePurchaseSession - one-time purchase rules', () => {
  it('blocks duplicate one-time purchase for same productId', async () => {
    const tenancy = createMockTenancy({ items: {}, products: {}, productLines: {} });
    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [{ productId: 'product-dup', product: { productLineId: undefined }, quantity: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') }],
      },
      subscription: { findMany: async () => [] },
    } as any);

    await expect(validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        productId: 'product-dup',
        product: {
          displayName: 'X',
          productLineId: undefined,
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
      },
      priceId: 'price-any',
      quantity: 1,
    })).rejects.toThrowError(new KnownErrors.ProductAlreadyGranted('product-dup', 'cust-1'));
  });

  it('blocks one-time purchase when another one exists in the same group', async () => {
    const tenancy = createMockTenancy({ items: {}, products: {}, productLines: { g1: { displayName: 'G1', customerType: 'user' } } });
    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [{ productId: 'other-product', product: { productLineId: 'g1' }, quantity: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') }],
      },
      subscription: { findMany: async () => [] },
    } as any);

    await expect(validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        productId: 'product-y',
        product: {
          displayName: 'Y',
          productLineId: 'g1',
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
      },
      priceId: 'price-any',
      quantity: 1,
    })).rejects.toThrowError('Customer already has a one-time purchase in this product line');
  });

  it('allows purchase when existing one-time is in a different group', async () => {
    const tenancy = createMockTenancy({ items: {}, products: {}, productLines: { g1: { displayName: 'G1', customerType: 'user' }, g2: { displayName: 'G2', customerType: 'user' } } });
    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [{ productId: 'other-product', product: { productLineId: 'g2' }, quantity: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') }],
      },
      subscription: { findMany: async () => [] },
    } as any);

    const res = await validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        productId: 'product-z',
        product: {
          displayName: 'Z',
          productLineId: 'g1',
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
      },
      priceId: 'price-any',
      quantity: 1,
    });
    expect(res.productLineId).toBe('g1');
    expect(res.conflictingProductLineSubscriptions.length).toBe(0);
  });

  it('allows duplicate one-time purchase for same productId when product is stackable', async () => {
    const tenancy = createMockTenancy({ items: {}, products: {}, productLines: {} });
    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [
          { productId: 'product-stackable', product: { productLineId: undefined }, quantity: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') },
        ],
      },
      subscription: { findMany: async () => [] },
    } as any);

    const res = await validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        productId: 'product-stackable',
        product: {
          displayName: 'Stackable Product',
          productLineId: undefined,
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: true,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
      },
      priceId: 'price-any',
      quantity: 2,
    });

    expect(res.productLineId).toBeUndefined();
    expect(res.conflictingProductLineSubscriptions.length).toBe(0);
  });

  it('blocks when subscription for same product exists and product is not stackable', async () => {
    const tenancy = createMockTenancy({
      items: {},
      productLines: {},
      products: {
        'product-sub': {
          displayName: 'Non-stackable Offer',
          productLineId: undefined,
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: {},
          includedItems: {},
          isAddOnTo: false,
        },
      },
    });
    const prisma = createMockPrisma({
      oneTimePurchase: { findMany: async () => [] },
      subscription: {
        findMany: async () => [{
          productId: 'product-sub',
          product: tenancy.config.payments.products['product-sub'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
        }],
      },
    } as any);

    await expect(validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        productId: 'product-sub',
        product: {
          displayName: 'Non-stackable Offer',
          productLineId: undefined,
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
      },
      priceId: 'price-any',
      quantity: 1,
    })).rejects.toThrowError(new KnownErrors.ProductAlreadyGranted('product-sub', 'cust-1'));
  });

  it('allows when subscription for same product exists and product is stackable', async () => {
    const tenancy = createMockTenancy({
      items: {},
      productLines: {},
      products: {
        'product-sub-stackable': {
          displayName: 'Stackable Product',
          productLineId: undefined,
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: true,
          prices: {},
          includedItems: {},
          isAddOnTo: false,
        },
      },
    });
    const prisma = createMockPrisma({
      oneTimePurchase: { findMany: async () => [] },
      subscription: {
        findMany: async () => [{
          productId: 'product-sub-stackable',
          product: tenancy.config.payments.products['product-sub-stackable'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
        }],
      },
    } as any);

    const res = await validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        productId: 'product-sub-stackable',
        product: {
          displayName: 'Stackable Product',
          productLineId: undefined,
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: true,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
      },
      priceId: 'price-any',
      quantity: 2,
    });

    expect(res.productLineId).toBeUndefined();
    expect(res.conflictingProductLineSubscriptions.length).toBe(0);
  });
});

describe('combined sources - one-time purchases + manual changes + subscriptions', () => {
  it('computes correct balance with all sources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-02-15T00:00:00.000Z'));

    const itemId = 'comboItem';
    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'Combo', customerType: 'user' } },
      productLines: { g1: { displayName: 'G', customerType: 'user' } },
      products: {
        offSub: {
          displayName: 'Sub', productLineId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 5, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      itemQuantityChange: {
        findMany: async () => [
          { quantity: 3, createdAt: new Date('2025-02-10T00:00:00.000Z'), expiresAt: null },
          { quantity: -1, createdAt: new Date('2025-02-12T00:00:00.000Z'), expiresAt: null },
        ],
        findFirst: async () => null,
      },
      oneTimePurchase: {
        findMany: async () => [
          { productId: 'offA', product: { includedItems: { [itemId]: { quantity: 4 } } }, quantity: 1, createdAt: new Date('2025-02-09T00:00:00.000Z') },
          { productId: 'offB', product: { includedItems: { [itemId]: { quantity: 2 } } }, quantity: 3, createdAt: new Date('2025-02-11T00:00:00.000Z') },
        ],
      },
      subscription: {
        findMany: async () => [{
          productId: 'offSub',
          product: tenancy.config.payments.products['offSub'],
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 2,
          status: 'active',
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'user-1', customerType: 'user' });
    // OTP: 4 + (2*3)=6 => 10; Manual: +3 -1 => +2; Subscription: 5 * 2 => 10; Total => 22
    expect(qty).toBe(22);
    vi.useRealTimers();
  });
});


describe('getSubscriptions - defaults behavior', () => {
  it('includes ungrouped include-by-default products in subscriptions', async () => {
    const tenancy = createMockTenancy({
      items: {},
      productLines: {},
      products: {
        freeUngrouped: {
          displayName: 'Free',
          productLineId: undefined,
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
        paidUngrouped: {
          displayName: 'Paid',
          productLineId: undefined,
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: {},
          includedItems: {},
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: { findMany: async () => [] },
    } as any);

    const subs = await getSubscriptions({
      prisma,
      tenancy,
      customerType: 'custom',
      customerId: 'c-1',
    });

    const ids = subs.map(s => s.productId);
    expect(ids).toContain('freeUngrouped');
  });

  it('includes include-by-default product when only inactive subscription exists in line', async () => {
    const tenancy = createMockTenancy({
      items: {},
      productLines: { g1: { displayName: 'G1', customerType: 'user' } },
      products: {
        freeG1: {
          displayName: 'Free',
          productLineId: 'g1',
          customerType: 'user',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
        paidG1: {
          displayName: 'Paid',
          productLineId: 'g1',
          customerType: 'user',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: {},
          includedItems: {},
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          id: 'sub-1',
          productId: 'paidG1',
          product: tenancy.config.payments.products['paidG1'],
          quantity: 1,
          currentPeriodStart: new Date('2025-01-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-02-01T00:00:00.000Z'),
          cancelAtPeriodEnd: false,
          status: 'canceled',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          stripeSubscriptionId: null,
        }],
      },
    } as any);

    const subs = await getSubscriptions({
      prisma,
      tenancy,
      customerType: 'user',
      customerId: 'user-1',
    });

    const ids = subs.map(s => s.productId);
    expect(ids).toContain('freeG1');
  });

  it('throws error when multiple include-by-default products exist in same line', async () => {
    const tenancy = createMockTenancy({
      items: {},
      productLines: { g1: { displayName: 'G1', customerType: 'user' } },
      products: {
        g1FreeA: {
          displayName: 'Free A',
          productLineId: 'g1',
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
        g1FreeB: {
          displayName: 'Free B',
          productLineId: 'g1',
          customerType: 'custom',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: 'include-by-default',
          includedItems: {},
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: { findMany: async () => [] },
    } as any);

    await expect(getSubscriptions({
      prisma,
      tenancy,
      customerType: 'custom',
      customerId: 'c-1',
    })).rejects.toThrowError('Multiple include-by-default products configured in the same product line');
  });
});

describe('getCustomerPurchaseContext', () => {
  /**
   * BUG: canceled subscriptions should not block re-purchase
   *
   * When a user cancels their subscription, they should be able to re-purchase
   * the same product (or upgrade to a different one) without being blocked by
   * the "already owns product" check.
   *
   * Current behavior: canceled subscriptions are included in the alreadyOwnsProduct
   * check, preventing users from re-purchasing after cancellation.
   */
  it.fails('BUG: alreadyOwnsProduct should be false for canceled subscriptions', async () => {
    const tenancy = createMockTenancy({
      items: {},
      products: {
        'team-plan': {
          displayName: 'Team Plan',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: '49', serverOnly: false } },
          includedItems: {},
          isAddOnTo: false,
        },
      },
      productLines: {
        plans: { displayName: 'Plans', customerType: 'team' },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          id: 'sub-1',
          productId: 'team-plan',
          product: {
            displayName: 'Team Plan',
            productLineId: 'plans',
            customerType: 'team',
            prices: { monthly: { USD: '49', serverOnly: false } },
            includedItems: {},
          },
          quantity: 1,
          currentPeriodStart: new Date('2025-01-01'),
          currentPeriodEnd: new Date('2025-02-01'),
          cancelAtPeriodEnd: false,
          status: 'canceled',
          createdAt: new Date('2025-01-01'),
          stripeSubscriptionId: 'stripe-sub-1',
        }],
      },
      oneTimePurchase: {
        findMany: async () => [],
      },
    } as any);

    const result = await getCustomerPurchaseContext({
      prisma,
      tenancy,
      customerType: 'team',
      customerId: 'team-1',
      productId: 'team-plan',
    });

    expect(result.alreadyOwnsProduct).toBe(false);
  });

  /**
   * BUG: canceled-but-not-expired subscriptions should allow re-purchase
   *
   * When a subscription is canceled but currentPeriodEnd is still in the future,
   * the user should be able to re-purchase/renew. The purchase flow should then
   * reactivate the existing subscription rather than creating a new one.
   *
   * Current behavior: alreadyOwnsProduct = true, blocking re-purchase entirely.
   */
  it.fails('BUG: alreadyOwnsProduct should be false for canceled-but-not-expired subscriptions (to allow renewal)', async () => {
    vi.useFakeTimers();
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);

    const tenancy = createMockTenancy({
      items: {},
      products: {
        'team-plan': {
          displayName: 'Team Plan',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: '49', serverOnly: false } },
          includedItems: {},
          isAddOnTo: false,
        },
      },
      productLines: {
        plans: { displayName: 'Plans', customerType: 'team' },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          id: 'sub-1',
          productId: 'team-plan',
          product: {
            displayName: 'Team Plan',
            productLineId: 'plans',
            customerType: 'team',
            prices: { monthly: { USD: '49', serverOnly: false } },
            includedItems: {},
          },
          quantity: 1,
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          cancelAtPeriodEnd: false,
          status: 'canceled',
          createdAt: new Date('2025-02-01T00:00:00.000Z'),
          stripeSubscriptionId: 'stripe-sub-1',
        }],
      },
      oneTimePurchase: {
        findMany: async () => [],
      },
    } as any);

    const result = await getCustomerPurchaseContext({
      prisma,
      tenancy,
      customerType: 'team',
      customerId: 'team-1',
      productId: 'team-plan',
    });

    // Should be false so user can re-purchase/renew (purchase flow should then reactivate, not create new)
    expect(result.alreadyOwnsProduct).toBe(false);
    vi.useRealTimers();
  });

  it('alreadyOwnsProduct should be true for active subscriptions', async () => {
    const tenancy = createMockTenancy({
      items: {},
      products: {
        'team-plan': {
          displayName: 'Team Plan',
          productLineId: 'plans',
          customerType: 'team',
          freeTrial: undefined,
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: '49', serverOnly: false } },
          includedItems: {},
          isAddOnTo: false,
        },
      },
      productLines: {
        plans: { displayName: 'Plans', customerType: 'team' },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          id: 'sub-1',
          productId: 'team-plan',
          product: {
            displayName: 'Team Plan',
            productLineId: 'plans',
            customerType: 'team',
            prices: { monthly: { USD: '49', serverOnly: false } },
            includedItems: {},
          },
          quantity: 1,
          currentPeriodStart: new Date('2025-01-01'),
          currentPeriodEnd: new Date('2025-02-01'),
          cancelAtPeriodEnd: false,
          status: 'active',
          createdAt: new Date('2025-01-01'),
          stripeSubscriptionId: 'stripe-sub-1',
        }],
      },
      oneTimePurchase: {
        findMany: async () => [],
      },
    } as any);

    const result = await getCustomerPurchaseContext({
      prisma,
      tenancy,
      customerType: 'team',
      customerId: 'team-1',
      productId: 'team-plan',
    });

    expect(result.alreadyOwnsProduct).toBe(true);
  });
});
