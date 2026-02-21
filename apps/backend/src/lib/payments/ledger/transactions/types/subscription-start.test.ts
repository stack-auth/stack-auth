import { describe, expect, it, vi, beforeEach } from 'vitest';
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

  const { getSubscriptionStartTransactions } = await import('./subscription-start');
  const list = getSubscriptionStartTransactions({ id: 'tenancy-1', config: {} as any, branchId: 'main', organization: null, project: { id: 'p1' } } as any);
  const result = await list.next({ after: list.getFirstCursor(), limit: 100, filter: {}, orderBy: 'createdAt-desc', limitPrecision: 'exact' });
  return result.items.map((i) => i.item);
}

describe('subscription-start transactions', () => {
  it('produces a subscription-start transaction with correct type', async () => {
    const txs = await getTransactionsFromList([createMockSubscription()]);
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('subscription-start');
  });

  it('includes active_subscription_start entry', async () => {
    const txs = await getTransactionsFromList([createMockSubscription()]);
    const entries = txs[0].entries;
    const subStart = entries.find((e) => e.type === 'active_subscription_start');
    expect(subStart).toBeDefined();
    if (subStart?.type !== 'active_subscription_start') throw new Error('unreachable');
    expect(subStart.subscription_id).toBe('sub-1');
  });

  it('includes product_grant entry with cycle_anchor', async () => {
    const txs = await getTransactionsFromList([createMockSubscription()]);
    const grant = txs[0].entries.find((e) => e.type === 'product_grant');
    expect(grant).toBeDefined();
    if (grant?.type !== 'product_grant') throw new Error('unreachable');
    expect(grant.cycle_anchor).toBe(new Date('2025-01-01').getTime());
    expect(grant.subscription_id).toBe('sub-1');
    expect(grant.quantity).toBe(1);
  });

  it('uses billingCycleAnchor for cycle_anchor when available', async () => {
    const txs = await getTransactionsFromList([createMockSubscription({ billingCycleAnchor: new Date('2025-01-15') })]);
    const grant = txs[0].entries.find((e) => e.type === 'product_grant');
    if (grant?.type !== 'product_grant') throw new Error('unreachable');
    expect(grant.cycle_anchor).toBe(new Date('2025-01-15').getTime());
  });

  it('falls back to createdAt when billingCycleAnchor is null', async () => {
    const txs = await getTransactionsFromList([createMockSubscription({ billingCycleAnchor: null })]);
    const grant = txs[0].entries.find((e) => e.type === 'product_grant');
    if (grant?.type !== 'product_grant') throw new Error('unreachable');
    expect(grant.cycle_anchor).toBe(new Date('2025-01-01').getTime());
  });

  it('includes money_transfer for paid subscription', async () => {
    const txs = await getTransactionsFromList([createMockSubscription()]);
    const transfer = txs[0].entries.find((e) => e.type === 'money_transfer');
    expect(transfer).toBeDefined();
    if (transfer?.type !== 'money_transfer') throw new Error('unreachable');
    expect(transfer.charged_amount.USD).toBe('9.99');
  });

  it('skips money_transfer for test mode', async () => {
    const txs = await getTransactionsFromList([createMockSubscription({ creationSource: 'TEST_MODE' })]);
    const transfer = txs[0].entries.find((e) => e.type === 'money_transfer');
    expect(transfer).toBeUndefined();
    expect(txs[0].test_mode).toBe(true);
  });

  it('skips money_transfer for include-by-default pricing', async () => {
    const txs = await getTransactionsFromList([createMockSubscription({
      product: { ...baseProduct, prices: 'include-by-default' },
      priceId: null,
    })]);
    const transfer = txs[0].entries.find((e) => e.type === 'money_transfer');
    expect(transfer).toBeUndefined();
  });

  it('includes item_quantity_change entries for each included item', async () => {
    const txs = await getTransactionsFromList([createMockSubscription()]);
    const itemChanges = txs[0].entries.filter((e) => e.type === 'item_quantity_change');
    expect(itemChanges.length).toBe(2);
    const seatsChange = itemChanges.find((e) => e.type === 'item_quantity_change' && e.item_id === 'seats');
    const creditsChange = itemChanges.find((e) => e.type === 'item_quantity_change' && e.item_id === 'credits');
    expect(seatsChange).toBeDefined();
    expect(creditsChange).toBeDefined();
    if (seatsChange?.type !== 'item_quantity_change') throw new Error('unreachable');
    if (creditsChange?.type !== 'item_quantity_change') throw new Error('unreachable');
    expect(seatsChange.quantity).toBe(4);
    expect(creditsChange.quantity).toBe(100);
  });

  it('multiplies item quantities by purchase quantity', async () => {
    const txs = await getTransactionsFromList([createMockSubscription({ quantity: 3 })]);
    const seatsChange = txs[0].entries.find((e) => e.type === 'item_quantity_change' && e.item_id === 'seats');
    if (seatsChange?.type !== 'item_quantity_change') throw new Error('unreachable');
    expect(seatsChange.quantity).toBe(12);
  });

  it('multiplies charged amount by quantity', async () => {
    const txs = await getTransactionsFromList([createMockSubscription({ quantity: 3 })]);
    const transfer = txs[0].entries.find((e) => e.type === 'money_transfer');
    if (transfer?.type !== 'money_transfer') throw new Error('unreachable');
    expect(transfer.charged_amount.USD).toBe('29.97');
  });

  it('transaction id matches subscription id', async () => {
    const txs = await getTransactionsFromList([createMockSubscription({ id: 'my-sub-id' })]);
    expect(txs[0].id).toBe('my-sub-id');
  });

  it('handles multiple subscriptions', async () => {
    const txs = await getTransactionsFromList([
      createMockSubscription({ id: 'sub-2', createdAt: new Date('2025-02-01') }),
      createMockSubscription({ id: 'sub-1', createdAt: new Date('2025-01-01') }),
    ]);
    expect(txs.length).toBe(2);
    expect(txs.map((t) => t.id)).toContain('sub-1');
    expect(txs.map((t) => t.id)).toContain('sub-2');
  });

  it('produces empty adjusted_by', async () => {
    const txs = await getTransactionsFromList([createMockSubscription()]);
    expect(txs[0].adjusted_by).toEqual([]);
  });

  it('sets correct timestamps', async () => {
    const created = new Date('2025-03-15T10:30:00Z');
    const txs = await getTransactionsFromList([createMockSubscription({ createdAt: created })]);
    expect(txs[0].created_at_millis).toBe(created.getTime());
    expect(txs[0].effective_at_millis).toBe(created.getTime());
  });

  it('product with no included items produces no item_quantity_change entries', async () => {
    const txs = await getTransactionsFromList([createMockSubscription({
      product: { ...baseProduct, includedItems: {} },
    })]);
    const itemChanges = txs[0].entries.filter((e) => e.type === 'item_quantity_change');
    expect(itemChanges.length).toBe(0);
  });

  it('returns empty list for no subscriptions', async () => {
    const txs = await getTransactionsFromList([]);
    expect(txs.length).toBe(0);
  });
});
