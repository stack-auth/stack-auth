import type { PrismaClientTransaction } from '@/prisma-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getItemQuantityForCustomer, validatePurchaseSession } from './payments';
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
      offers: {},
      groups: {},
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
      offers: {},
      groups: {},
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        off1: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 3, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'off1',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offW: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 4, repeat: [1, 'week'], expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offW',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offW: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 4, repeat: [1, 'week'], expires: 'never' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offW',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offR: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 7, repeat: [1, 'week'], expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offR',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offN: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 2, repeat: 'never', expires: 'never' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offN',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offRC: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 7, repeat: [1, 'week'], expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offRC',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offRR: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
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
            offerId: 'offRR',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offMD: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 10, repeat: [1, 'week'], expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offMD',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offBF: {
          displayName: 'O', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 5, repeat: 'never', expires: 'when-repeated' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offBF',
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
      groups: { g1: { displayName: 'G1' }, g2: { displayName: 'G2' } },
      offers: {
        off1: {
          displayName: 'O1', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 2, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
        off2: {
          displayName: 'O2', groupId: 'g2', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
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
            offerId: 'off1',
            currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
            quantity: 3,
            status: 'active',
          },
          {
            offerId: 'off2',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offBundle: {
          displayName: 'OB', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
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
          offerId: 'offBundle',
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
      groups: { g1: { displayName: 'G' } },
      offers: {
        offT: {
          displayName: 'OT', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 5, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offT',
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

  it('canceled subscription contributes only expired transactions (no active quantity)', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'canceledItem';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'C', customerType: 'user' } },
      groups: { g1: { displayName: 'G' } },
      offers: {
        offC: {
          displayName: 'OC', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
          prices: {},
          includedItems: { [itemId]: { quantity: 9, repeat: 'never', expires: 'when-purchase-expires' } },
          isAddOnTo: false,
        },
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          offerId: 'offC',
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

  it('ungrouped offer works without tenancy groups', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'ungroupedItem';

    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'U', customerType: 'user' } },
      groups: {},
      offers: {
        offU: {
          displayName: 'OU',
          groupId: undefined,
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
          offerId: 'offU',
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
});


describe('getItemQuantityForCustomer - one-time purchases', () => {
  it('adds included item quantity multiplied by purchase quantity', async () => {
    const itemId = 'otpItemA';
    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'I', customerType: 'custom' } },
      offers: {},
      groups: {},
    });

    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [{
          offerId: 'off-otp',
          offer: { includedItems: { [itemId]: { quantity: 5 } } },
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

  it('aggregates multiple one-time purchases across different offers', async () => {
    const itemId = 'otpItemB';
    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'I', customerType: 'custom' } },
      offers: {},
      groups: {},
    });

    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [
          { offerId: 'off-1', offer: { includedItems: { [itemId]: { quantity: 3 } } }, quantity: 1, createdAt: new Date('2025-02-10T00:00:00.000Z') },
          { offerId: 'off-2', offer: { includedItems: { [itemId]: { quantity: 5 } } }, quantity: 2, createdAt: new Date('2025-02-11T00:00:00.000Z') },
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
  it('blocks duplicate one-time purchase for same offerId', async () => {
    const tenancy = createMockTenancy({ items: {}, offers: {}, groups: {} });
    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [{ offerId: 'offer-dup', offer: { groupId: undefined }, quantity: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') }],
      },
      subscription: { findMany: async () => [] },
    } as any);

    await expect(validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        offerId: 'offer-dup',
        offer: {
          displayName: 'X',
          groupId: undefined,
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
    })).rejects.toThrowError('Customer already has a one-time purchase for this offer');
  });

  it('blocks one-time purchase when another one exists in the same group', async () => {
    const tenancy = createMockTenancy({ items: {}, offers: {}, groups: { g1: { displayName: 'G1' } } });
    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [{ offerId: 'other-offer', offer: { groupId: 'g1' }, quantity: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') }],
      },
      subscription: { findMany: async () => [] },
    } as any);

    await expect(validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        offerId: 'offer-y',
        offer: {
          displayName: 'Y',
          groupId: 'g1',
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
    })).rejects.toThrowError('Customer already has a one-time purchase in this offer group');
  });

  it('allows purchase when existing one-time is in a different group', async () => {
    const tenancy = createMockTenancy({ items: {}, offers: {}, groups: { g1: { displayName: 'G1' }, g2: { displayName: 'G2' } } });
    const prisma = createMockPrisma({
      oneTimePurchase: {
        findMany: async () => [{ offerId: 'other-offer', offer: { groupId: 'g2' }, quantity: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') }],
      },
      subscription: { findMany: async () => [] },
    } as any);

    const res = await validatePurchaseSession({
      prisma,
      tenancy,
      codeData: {
        tenancyId: tenancy.id,
        customerId: 'cust-1',
        offerId: 'offer-z',
        offer: {
          displayName: 'Z',
          groupId: 'g1',
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
    expect(res.groupId).toBe('g1');
    expect(res.conflictingGroupSubscriptions.length).toBe(0);
  });
});

describe('combined sources - one-time purchases + manual changes + subscriptions', () => {
  it('computes correct balance with all sources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-02-15T00:00:00.000Z'));

    const itemId = 'comboItem';
    const tenancy = createMockTenancy({
      items: { [itemId]: { displayName: 'Combo', customerType: 'user' } },
      groups: { g1: { displayName: 'G' } },
      offers: {
        offSub: {
          displayName: 'Sub', groupId: 'g1', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
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
          { offerId: 'offA', offer: { includedItems: { [itemId]: { quantity: 4 } } }, quantity: 1, createdAt: new Date('2025-02-09T00:00:00.000Z') },
          { offerId: 'offB', offer: { includedItems: { [itemId]: { quantity: 2 } } }, quantity: 3, createdAt: new Date('2025-02-11T00:00:00.000Z') },
        ],
      },
      subscription: {
        findMany: async () => [{
          offerId: 'offSub',
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

