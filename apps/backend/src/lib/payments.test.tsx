import type { PrismaClientTransaction } from '@/prisma-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getItemQuantityForCustomer } from './payments';
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
    projectUser: {
      findUnique: async () => null,
    },
    team: {
      findUnique: async () => null,
    },
    ...(overrides as any),
  } as any;
}

function createMockTenancy(config: any, id: string = 'tenancy-1'): Tenancy {
  return {
    id,
    config: {
      ...config,
    } as any,
    branchId: 'main',
    organization: null,
    project: { id: 'project-1' } as any,
  } as any;
}

describe('getItemQuantityForCustomer - defaults and manual changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns default quantity for non-repeating item', async () => {
    const now = new Date('2025-01-01T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'itemA';

    const tenancy = createMockTenancy({
      payments: {
        items: {
          [itemId]: {
            displayName: 'Item A',
            customerType: 'team',
            default: { quantity: 2, repeat: 'never', expires: 'never' },
          },
        },
        offers: {},
      },
    });

    const prisma = createMockPrisma({
      team: {
        findUnique: async () => ({ createdAt: new Date('2024-12-01T00:00:00.000Z') }),
      },
    } as any);

    const qty = await getItemQuantityForCustomer({
      prisma,
      tenancy,
      itemId,
      customerId: 'team-1',
      customerType: 'team',
    });
    expect(qty).toBe(2);
    vi.useRealTimers();
  });

  it('weekly default with expires="when-repeated" yields only current window amount', async () => {
    const now = new Date('2025-01-29T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'weeklyItem';

    const tenancy = createMockTenancy({
      payments: {
        items: {
          [itemId]: {
            displayName: 'Weekly',
            customerType: 'user',
            default: { quantity: 10, repeat: [1, 'week'], expires: 'when-repeated' },
          },
        },
        offers: {},
      },
    });

    const prisma = createMockPrisma({
      projectUser: {
        findUnique: async () => ({ createdAt: new Date('2025-01-01T00:00:00.000Z') }),
      },
    } as any);

    const qty = await getItemQuantityForCustomer({
      prisma,
      tenancy,
      itemId,
      customerId: 'user-1',
      customerType: 'user',
    });
    expect(qty).toBe(10);
    vi.useRealTimers();
  });

  it('weekly default with expires="never" accumulates across elapsed intervals', async () => {
    const now = new Date('2025-01-29T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'accumItem';

    const tenancy = createMockTenancy({
      payments: {
        items: {
          [itemId]: {
            displayName: 'Accum',
            customerType: 'user',
            default: { quantity: 10, repeat: [1, 'week'], expires: 'never' },
          },
        },
        offers: {},
      },
    });

    const prisma = createMockPrisma({
      projectUser: {
        findUnique: async () => ({ createdAt: new Date('2025-01-01T00:00:00.000Z') }),
      },
    } as any);

    const qty = await getItemQuantityForCustomer({
      prisma,
      tenancy,
      itemId,
      customerId: 'user-1',
      customerType: 'user',
    });
    // From 2025-01-01 to 2025-01-29 is exactly 4 weeks; occurrences = 4 + 1 = 5 → 50
    expect(qty).toBe(50);
    vi.useRealTimers();
  });

  it('manual changes: expired positives ignored; negatives applied', async () => {
    const now = new Date('2025-02-01T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'manualA';

    const tenancy = createMockTenancy({
      payments: {
        items: {
          [itemId]: {
            displayName: 'Manual',
            customerType: 'custom',
            default: { quantity: 0, repeat: 'never', expires: 'never' },
          },
        },
        offers: {},
      },
    });

    const prisma = createMockPrisma({
      itemQuantityChange: {
        findMany: async () => [
          // +10 expired
          { quantity: 10, createdAt: new Date('2025-01-27T00:00:00.000Z'), expiresAt: new Date('2025-01-31T23:59:59.000Z') },
          // +5 active
          { quantity: 5, createdAt: new Date('2025-01-29T12:00:00.000Z'), expiresAt: null },
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
    expect(qty).toBe(5);
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
      payments: {
        items: {
          [itemId]: { displayName: 'S', customerType: 'user', default: { quantity: 0, repeat: 'never', expires: 'never' } },
        },
        offers: {},
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-02-28T23:59:59.000Z'),
          quantity: 2,
          status: 'active',
          offer: {
            displayName: 'O', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
            prices: {},
            includedItems: {
              [itemId]: { quantity: 3, repeat: 'never', expires: 'when-purchase-expires' },
            },
          },
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(6);
    vi.useRealTimers();
  });

  it('repeat=weekly, expires=when-purchase-expires → accumulate within period until now', async () => {
    const now = new Date('2025-02-15T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemWeekly';

    const tenancy = createMockTenancy({
      payments: {
        items: {
          [itemId]: { displayName: 'S', customerType: 'user', default: { quantity: 0, repeat: 'never', expires: 'never' } },
        },
        offers: {},
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
          offer: {
            displayName: 'O', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
            prices: {},
            includedItems: {
              [itemId]: { quantity: 4, repeat: [1, 'week'], expires: 'when-purchase-expires' },
            },
          },
        }],
      },
    } as any);

    // From 2025-02-01 to 2025-02-15: elapsed weeks = 2 → occurrences = 3 → 3 * 4 = 12
    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(12);
    vi.useRealTimers();
  });

  it('repeat=weekly, expires=when-repeated → only current repeat window amount', async () => {
    const now = new Date('2025-02-15T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemWeeklyWindow';

    const tenancy = createMockTenancy({
      payments: {
        items: {
          [itemId]: { displayName: 'S', customerType: 'user', default: { quantity: 0, repeat: 'never', expires: 'never' } },
        },
        offers: {},
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 1,
          status: 'active',
          offer: {
            displayName: 'O', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
            prices: {},
            includedItems: {
              [itemId]: { quantity: 7, repeat: [1, 'week'], expires: 'when-repeated' },
            },
          },
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(7);
    vi.useRealTimers();
  });

  it('repeat=never, expires=never → one persistent grant from period start', async () => {
    const now = new Date('2025-02-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const itemId = 'subItemPersistent';

    const tenancy = createMockTenancy({
      payments: {
        items: {
          [itemId]: { displayName: 'S', customerType: 'user', default: { quantity: 0, repeat: 'never', expires: 'never' } },
        },
        offers: {},
      },
    });

    const prisma = createMockPrisma({
      subscription: {
        findMany: async () => [{
          currentPeriodStart: new Date('2025-02-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2025-03-01T00:00:00.000Z'),
          quantity: 3,
          status: 'active',
          offer: {
            displayName: 'O', customerType: 'user', freeTrial: undefined, serverOnly: false, stackable: false,
            prices: {},
            includedItems: {
              [itemId]: { quantity: 2, repeat: 'never', expires: 'never' },
            },
          },
        }],
      },
    } as any);

    const qty = await getItemQuantityForCustomer({ prisma, tenancy, itemId, customerId: 'u1', customerType: 'user' });
    expect(qty).toBe(6);
    vi.useRealTimers();
  });
});


