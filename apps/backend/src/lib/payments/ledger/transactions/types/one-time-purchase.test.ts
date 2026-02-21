import { describe, expect, it, vi } from 'vitest';
import { createMockOneTimePurchase, baseProduct } from './test-utils';
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

async function getTransactionsFromList(purchases: any[]): Promise<Transaction[]> {
  _mockPrisma = {
    oneTimePurchase: {
      findMany: async () => purchases,
      findUnique: async () => null,
    },
  };

  const { getOneTimePurchaseTransactions } = await import('./one-time-purchase');
  const list = getOneTimePurchaseTransactions({ id: 'tenancy-1', config: {} as any, branchId: 'main', organization: null, project: { id: 'p1' } } as any);
  const result = await list.next({ after: list.getFirstCursor(), limit: 100, filter: {}, orderBy: 'createdAt-desc', limitPrecision: 'exact' });
  return result.items.map((i) => i.item);
}

describe('one-time-purchase transactions', () => {
  it('produces a one-time-purchase transaction with correct type', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase()]);
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('one-time-purchase');
  });

  it('does NOT include active_subscription_start entry', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase()]);
    const subStart = txs[0].entries.find((e) => e.type === 'active_subscription_start');
    expect(subStart).toBeUndefined();
  });

  it('includes product_grant with one_time_purchase_id', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase()]);
    const grant = txs[0].entries.find((e) => e.type === 'product_grant');
    if (grant?.type !== 'product_grant') throw new Error('unreachable');
    expect(grant.one_time_purchase_id).toBe('otp-1');
    expect(grant.subscription_id).toBeUndefined();
  });

  it('uses createdAt as cycle_anchor', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase()]);
    const grant = txs[0].entries.find((e) => e.type === 'product_grant');
    if (grant?.type !== 'product_grant') throw new Error('unreachable');
    expect(grant.cycle_anchor).toBe(new Date('2025-01-15').getTime());
  });

  it('includes money_transfer for paid purchase', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase()]);
    const transfer = txs[0].entries.find((e) => e.type === 'money_transfer');
    expect(transfer).toBeDefined();
    if (transfer?.type !== 'money_transfer') throw new Error('unreachable');
    expect(transfer.charged_amount.USD).toBe('9.99');
  });

  it('skips money_transfer for test mode', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase({ creationSource: 'TEST_MODE' })]);
    const transfer = txs[0].entries.find((e) => e.type === 'money_transfer');
    expect(transfer).toBeUndefined();
    expect(txs[0].test_mode).toBe(true);
  });

  it('includes item_quantity_change entries', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase()]);
    const changes = txs[0].entries.filter((e) => e.type === 'item_quantity_change');
    expect(changes.length).toBe(2);
  });

  it('multiplies item quantities by purchase quantity', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase({ quantity: 5 })]);
    const seats = txs[0].entries.find((e) => e.type === 'item_quantity_change' && e.item_id === 'seats');
    if (seats?.type !== 'item_quantity_change') throw new Error('unreachable');
    expect(seats.quantity).toBe(20);
  });

  it('produces empty adjusted_by', async () => {
    const txs = await getTransactionsFromList([createMockOneTimePurchase()]);
    expect(txs[0].adjusted_by).toEqual([]);
  });

  it('handles empty purchase list', async () => {
    const txs = await getTransactionsFromList([]);
    expect(txs.length).toBe(0);
  });
});
