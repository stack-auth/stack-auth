import { describe, expect, it, vi } from 'vitest';
import { createMockSubscription, baseProduct } from './test-utils';
import type { Transaction } from '@stackframe/stack-shared/dist/interface/crud/transactions';

let _mockPrisma: any = null;
vi.mock('@/prisma-client', () => ({
  getPrismaClientForTenancy: async () => _mockPrisma,
}));

vi.mock('@/lib/payments/index', () => ({
  productToInlineProduct: (product: any) => ({
    display_name: product.displayName ?? 'Product',
    customer_type: product.customerType,
    server_only: product.serverOnly ?? false,
    stackable: product.stackable ?? false,
    prices: product.prices === 'include-by-default' ? {} : (product.prices ?? {}),
    included_items: product.includedItems ?? {},
    client_metadata: null,
    client_read_only_metadata: null,
    server_metadata: null,
  }),
}));

async function getTransactionsFromList(subscriptions: any[]): Promise<Transaction[]> {
  _mockPrisma = {
    subscription: {
      findMany: async () => subscriptions,
      findUnique: async () => null,
    },
  };

  const { getSubscriptionEndTransactions } = await import('./subscription-end');
  const list = getSubscriptionEndTransactions({ id: 'tenancy-1', config: {} as any, branchId: 'main', organization: null, project: { id: 'p1' } } as any);
  const result = await list.next({ after: list.getFirstCursor(), limit: 100, filter: {}, orderBy: 'createdAt-desc', limitPrecision: 'exact' });
  return result.items.map((i) => i.item);
}

describe('subscription-end transactions', () => {
  const endedSub = createMockSubscription({ endedAt: new Date('2025-02-01') });

  it('produces a subscription-end transaction', async () => {
    const txs = await getTransactionsFromList([endedSub]);
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('subscription-end');
  });

  it('transaction id is subscription id with :end suffix', async () => {
    const txs = await getTransactionsFromList([endedSub]);
    expect(txs[0].id).toBe('sub-1:end');
  });

  it('uses endedAt as timestamp', async () => {
    const txs = await getTransactionsFromList([endedSub]);
    expect(txs[0].created_at_millis).toBe(new Date('2025-02-01').getTime());
    expect(txs[0].effective_at_millis).toBe(new Date('2025-02-01').getTime());
  });

  it('includes active_subscription_stop entry', async () => {
    const txs = await getTransactionsFromList([endedSub]);
    const stop = txs[0].entries.find((e) => e.type === 'active_subscription_stop');
    expect(stop).toBeDefined();
    if (stop?.type !== 'active_subscription_stop') throw new Error('unreachable');
    expect(stop.subscription_id).toBe('sub-1');
  });

  it('includes product_revocation entry referencing original subscription', async () => {
    const txs = await getTransactionsFromList([endedSub]);
    const revocation = txs[0].entries.find((e) => e.type === 'product_revocation');
    expect(revocation).toBeDefined();
    if (revocation?.type !== 'product_revocation') throw new Error('unreachable');
    expect(revocation.adjusted_transaction_id).toBe('sub-1');
    expect(revocation.adjusted_entry_index).toBe(0);
    expect(revocation.quantity).toBe(1);
  });

  it('includes item_quantity_expire for items with expires=when-purchase-expires', async () => {
    const txs = await getTransactionsFromList([endedSub]);
    const expires = txs[0].entries.filter((e) => e.type === 'item_quantity_expire');
    expect(expires.length).toBe(1);
    if (expires[0]?.type !== 'item_quantity_expire') throw new Error('unreachable');
    expect(expires[0].item_id).toBe('seats');
    expect(expires[0].quantity).toBe(4);
  });

  it('does NOT include item_quantity_expire for items with expires=when-repeated', async () => {
    const txs = await getTransactionsFromList([endedSub]);
    const expires = txs[0].entries.filter((e) => e.type === 'item_quantity_expire');
    const creditsExpire = expires.find((e) => e.type === 'item_quantity_expire' && e.item_id === 'credits');
    expect(creditsExpire).toBeUndefined();
  });

  it('revocation quantity matches subscription quantity', async () => {
    const sub = createMockSubscription({ endedAt: new Date('2025-02-01'), quantity: 5 });
    const txs = await getTransactionsFromList([sub]);
    const revocation = txs[0].entries.find((e) => e.type === 'product_revocation');
    if (revocation?.type !== 'product_revocation') throw new Error('unreachable');
    expect(revocation.quantity).toBe(5);
  });

  it('item_quantity_expire multiplied by purchase quantity', async () => {
    const sub = createMockSubscription({ endedAt: new Date('2025-02-01'), quantity: 3 });
    const txs = await getTransactionsFromList([sub]);
    const seatsExpire = txs[0].entries.find((e) => e.type === 'item_quantity_expire' && e.item_id === 'seats');
    if (seatsExpire?.type !== 'item_quantity_expire') throw new Error('unreachable');
    expect(seatsExpire.quantity).toBe(12);
  });

  it('handles empty list', async () => {
    const txs = await getTransactionsFromList([]);
    expect(txs.length).toBe(0);
  });
});
