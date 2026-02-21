import { describe, expect, it, vi } from 'vitest';
import { createMockSubscription, createMockSubscriptionInvoice, baseProduct } from './test-utils';
import type { Transaction } from '@stackframe/stack-shared/dist/interface/crud/transactions';

let _mockPrisma: any = null;
vi.mock('@/prisma-client', () => ({
  getPrismaClientForTenancy: async () => _mockPrisma,
}));

vi.mock('@/lib/payments/index', () => ({
  productToInlineProduct: (product: any) => ({
    display_name: product.displayName ?? 'Product',
    customer_type: product.customerType,
    server_only: false,
    stackable: false,
    prices: product.prices === 'include-by-default' ? {} : (product.prices ?? {}),
    included_items: product.includedItems ?? {},
    client_metadata: null,
    client_read_only_metadata: null,
    server_metadata: null,
  }),
}));

async function getTransactionsFromList(invoices: any[]): Promise<Transaction[]> {
  _mockPrisma = {
    subscriptionInvoice: {
      findMany: async () => invoices,
      findUnique: async () => null,
    },
  };

  const { getSubscriptionRenewalTransactions } = await import('./subscription-renewal');
  const list = getSubscriptionRenewalTransactions({ id: 'tenancy-1', config: {} as any, branchId: 'main', organization: null, project: { id: 'p1' } } as any);
  const result = await list.next({ after: list.getFirstCursor(), limit: 100, filter: {}, orderBy: 'createdAt-desc', limitPrecision: 'exact' });
  return result.items.map((i) => i.item);
}

describe('subscription-renewal transactions', () => {
  const invoice = {
    ...createMockSubscriptionInvoice(),
    subscription: createMockSubscription(),
  };

  it('produces a subscription-renewal transaction', async () => {
    const txs = await getTransactionsFromList([invoice]);
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('subscription-renewal');
  });

  it('transaction id is the invoice id', async () => {
    const txs = await getTransactionsFromList([invoice]);
    expect(txs[0].id).toBe('si-1');
  });

  it('includes money_transfer entry only', async () => {
    const txs = await getTransactionsFromList([invoice]);
    expect(txs[0].entries.length).toBe(1);
    expect(txs[0].entries[0].type).toBe('money_transfer');
  });

  it('does NOT include item_quantity_change entries', async () => {
    const txs = await getTransactionsFromList([invoice]);
    const itemChanges = txs[0].entries.filter((e) => e.type === 'item_quantity_change');
    expect(itemChanges.length).toBe(0);
  });

  it('does NOT include item_quantity_expire entries', async () => {
    const txs = await getTransactionsFromList([invoice]);
    const expires = txs[0].entries.filter((e) => e.type === 'item_quantity_expire');
    expect(expires.length).toBe(0);
  });

  it('does NOT include product_grant entries', async () => {
    const txs = await getTransactionsFromList([invoice]);
    const grants = txs[0].entries.filter((e) => e.type === 'product_grant');
    expect(grants.length).toBe(0);
  });

  it('charged amount matches subscription price', async () => {
    const txs = await getTransactionsFromList([invoice]);
    const transfer = txs[0].entries[0];
    if (transfer.type !== 'money_transfer') throw new Error('unreachable');
    expect(transfer.charged_amount.USD).toBe('9.99');
  });

  it('test_mode is always false for renewals', async () => {
    const txs = await getTransactionsFromList([invoice]);
    expect(txs[0].test_mode).toBe(false);
  });

  it('handles multiple invoices', async () => {
    const txs = await getTransactionsFromList([
      { ...createMockSubscriptionInvoice({ id: 'si-2', createdAt: new Date('2025-03-01') }), subscription: createMockSubscription() },
      { ...createMockSubscriptionInvoice({ id: 'si-1' }), subscription: createMockSubscription() },
    ]);
    expect(txs.length).toBe(2);
  });

  it('returns empty for no invoices', async () => {
    const txs = await getTransactionsFromList([]);
    expect(txs.length).toBe(0);
  });
});
