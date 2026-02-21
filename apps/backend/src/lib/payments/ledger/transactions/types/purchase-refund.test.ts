import { describe, expect, it, vi } from 'vitest';
import { createMockSubscription, createMockOneTimePurchase, baseProduct } from './test-utils';
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

async function getRefundTransactions(subscriptions: any[], purchases: any[]): Promise<Transaction[]> {
  _mockPrisma = {
    subscription: {
      findMany: async () => subscriptions,
      findUnique: async () => null,
    },
    oneTimePurchase: {
      findMany: async () => purchases,
      findUnique: async () => null,
    },
  };

  const { getPurchaseRefundTransactions } = await import('./purchase-refund');
  const list = getPurchaseRefundTransactions({ id: 'tenancy-1', config: {} as any, branchId: 'main', organization: null, project: { id: 'p1' } } as any);
  const result = await list.next({ after: list.getFirstCursor(), limit: 100, filter: {}, orderBy: 'createdAt-desc', limitPrecision: 'exact' });
  return result.items.map((i) => i.item);
}

describe('purchase-refund transactions - subscription refunds', () => {
  const refundedSub = createMockSubscription({ refundedAt: new Date('2025-01-20') });

  it('produces a purchase-refund transaction for refunded subscription', async () => {
    const txs = await getRefundTransactions([refundedSub], []);
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('purchase-refund');
  });

  it('transaction id has :refund suffix', async () => {
    const txs = await getRefundTransactions([refundedSub], []);
    expect(txs[0].id).toBe('sub-1:refund');
  });

  it('uses refundedAt as timestamp', async () => {
    const txs = await getRefundTransactions([refundedSub], []);
    expect(txs[0].created_at_millis).toBe(new Date('2025-01-20').getTime());
  });

  it('includes negated money_transfer', async () => {
    const txs = await getRefundTransactions([refundedSub], []);
    const transfer = txs[0].entries.find((e) => e.type === 'money_transfer');
    expect(transfer).toBeDefined();
    if (transfer?.type !== 'money_transfer') throw new Error('unreachable');
    expect(transfer.charged_amount.USD).toBe('-9.99');
  });

  it('includes product_revocation referencing original subscription', async () => {
    const txs = await getRefundTransactions([refundedSub], []);
    const revocation = txs[0].entries.find((e) => e.type === 'product_revocation');
    expect(revocation).toBeDefined();
    if (revocation?.type !== 'product_revocation') throw new Error('unreachable');
    expect(revocation.adjusted_transaction_id).toBe('sub-1');
    expect(revocation.quantity).toBe(1);
  });

  it('includes item_quantity_expire for when-purchase-expires items', async () => {
    const txs = await getRefundTransactions([refundedSub], []);
    const expires = txs[0].entries.filter((e) => e.type === 'item_quantity_expire');
    expect(expires.length).toBe(1);
    if (expires[0]?.type !== 'item_quantity_expire') throw new Error('unreachable');
    expect(expires[0].item_id).toBe('seats');
  });

  it('includes active_subscription_stop', async () => {
    const txs = await getRefundTransactions([refundedSub], []);
    const stop = txs[0].entries.find((e) => e.type === 'active_subscription_stop');
    expect(stop).toBeDefined();
    if (stop?.type !== 'active_subscription_stop') throw new Error('unreachable');
    expect(stop.subscription_id).toBe('sub-1');
  });
});

describe('purchase-refund transactions - OTP refunds', () => {
  const refundedOtp = createMockOneTimePurchase({ refundedAt: new Date('2025-02-01') });

  it('produces a purchase-refund transaction for refunded OTP', async () => {
    const txs = await getRefundTransactions([], [refundedOtp]);
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('purchase-refund');
    expect(txs[0].id).toBe('otp-1:refund');
  });

  it('includes negated money_transfer', async () => {
    const txs = await getRefundTransactions([], [refundedOtp]);
    const transfer = txs[0].entries.find((e) => e.type === 'money_transfer');
    if (transfer?.type !== 'money_transfer') throw new Error('unreachable');
    expect(transfer.charged_amount.USD).toBe('-9.99');
  });

  it('includes product_revocation referencing OTP', async () => {
    const txs = await getRefundTransactions([], [refundedOtp]);
    const revocation = txs[0].entries.find((e) => e.type === 'product_revocation');
    if (revocation?.type !== 'product_revocation') throw new Error('unreachable');
    expect(revocation.adjusted_transaction_id).toBe('otp-1');
  });

  it('does NOT include active_subscription_stop for OTP', async () => {
    const txs = await getRefundTransactions([], [refundedOtp]);
    const stop = txs[0].entries.find((e) => e.type === 'active_subscription_stop');
    expect(stop).toBeUndefined();
  });
});

describe('purchase-refund transactions - mixed', () => {
  it('handles both subscription and OTP refunds', async () => {
    const txs = await getRefundTransactions(
      [createMockSubscription({ refundedAt: new Date('2025-01-20') })],
      [createMockOneTimePurchase({ refundedAt: new Date('2025-02-01') })],
    );
    expect(txs.length).toBe(2);
    const types = txs.map((t) => t.id);
    expect(types).toContain('sub-1:refund');
    expect(types).toContain('otp-1:refund');
  });

  it('returns empty for no refunds', async () => {
    const txs = await getRefundTransactions([], []);
    expect(txs.length).toBe(0);
  });
});
