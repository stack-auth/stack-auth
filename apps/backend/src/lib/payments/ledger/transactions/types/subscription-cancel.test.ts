import { describe, expect, it, vi } from 'vitest';
import { createMockSubscription } from './test-utils';
import type { Transaction } from '@stackframe/stack-shared/dist/interface/crud/transactions';

let _mockPrisma: any = null;
vi.mock('@/prisma-client', () => ({
  getPrismaClientForTenancy: async () => _mockPrisma,
}));

async function getTransactionsFromList(subscriptions: any[]): Promise<Transaction[]> {
  _mockPrisma = {
    subscription: {
      findMany: async () => subscriptions,
      findUnique: async () => null,
    },
  };

  const { getSubscriptionCancelTransactions } = await import('./subscription-cancel');
  const list = getSubscriptionCancelTransactions({ id: 'tenancy-1', config: {} as any, branchId: 'main', organization: null, project: { id: 'p1' } } as any);
  const result = await list.next({ after: list.getFirstCursor(), limit: 100, filter: {}, orderBy: 'createdAt-desc', limitPrecision: 'exact' });
  return result.items.map((i) => i.item);
}

describe('subscription-cancel transactions', () => {
  const canceledSub = createMockSubscription({
    cancelAtPeriodEnd: true,
    endedAt: null,
    updatedAt: new Date('2025-01-20'),
  });

  it('produces a subscription-cancel transaction', async () => {
    const txs = await getTransactionsFromList([canceledSub]);
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('subscription-cancel');
  });

  it('transaction id has :cancel suffix', async () => {
    const txs = await getTransactionsFromList([canceledSub]);
    expect(txs[0].id).toBe('sub-1:cancel');
  });

  it('uses updatedAt as timestamp', async () => {
    const txs = await getTransactionsFromList([canceledSub]);
    expect(txs[0].created_at_millis).toBe(new Date('2025-01-20').getTime());
  });

  it('includes active_subscription_change with cancel type', async () => {
    const txs = await getTransactionsFromList([canceledSub]);
    const change = txs[0].entries.find((e) => e.type === 'active_subscription_change');
    expect(change).toBeDefined();
    if (change?.type !== 'active_subscription_change') throw new Error('unreachable');
    expect(change.change_type).toBe('cancel');
    expect(change.subscription_id).toBe('sub-1');
  });

  it('does NOT include product_revocation (product still owned)', async () => {
    const txs = await getTransactionsFromList([canceledSub]);
    const revocation = txs[0].entries.find((e) => e.type === 'product_revocation');
    expect(revocation).toBeUndefined();
  });

  it('does NOT include item_quantity_expire (items still active)', async () => {
    const txs = await getTransactionsFromList([canceledSub]);
    const expire = txs[0].entries.find((e) => e.type === 'item_quantity_expire');
    expect(expire).toBeUndefined();
  });

  it('does NOT include active_subscription_stop', async () => {
    const txs = await getTransactionsFromList([canceledSub]);
    const stop = txs[0].entries.find((e) => e.type === 'active_subscription_stop');
    expect(stop).toBeUndefined();
  });

  it('has exactly one entry (the change)', async () => {
    const txs = await getTransactionsFromList([canceledSub]);
    expect(txs[0].entries.length).toBe(1);
  });

  it('returns empty for no canceled subscriptions', async () => {
    const txs = await getTransactionsFromList([]);
    expect(txs.length).toBe(0);
  });
});
