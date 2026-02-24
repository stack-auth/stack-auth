import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@stackframe/stack-shared/dist/interface/crud/transactions';

let _mockPrisma: any = null;
vi.mock('@/prisma-client', () => ({
  getPrismaClientForTenancy: async () => _mockPrisma,
}));

function createMockItemQuantityChange(overrides: Record<string, unknown> = {}) {
  return {
    id: 'iqc-1',
    tenancyId: 'tenancy-1',
    customerId: 'user-1',
    customerType: 'USER' as const,
    itemId: 'credits',
    quantity: 50,
    description: null,
    expiresAt: null,
    createdAt: new Date('2025-01-10'),
    ...overrides,
  };
}

async function getTransactionsFromList(changes: any[]): Promise<Transaction[]> {
  _mockPrisma = {
    itemQuantityChange: {
      findMany: async () => changes,
      findUnique: async () => null,
    },
  };

  const { getManualItemQuantityChangeTransactions } = await import('./manual-item-quantity-change');
  const list = getManualItemQuantityChangeTransactions(_mockPrisma, 'tenancy-1');
  const result = await list.next({ after: list.getFirstCursor(), limit: 100, filter: {}, orderBy: 'createdAt-desc', limitPrecision: 'exact' });
  return result.items.map((i) => i.item);
}

describe('manual-item-quantity-change transactions', () => {
  it('produces a manual-item-quantity-change transaction', async () => {
    const txs = await getTransactionsFromList([createMockItemQuantityChange()]);
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('manual-item-quantity-change');
  });

  it('has exactly one item_quantity_change entry', async () => {
    const txs = await getTransactionsFromList([createMockItemQuantityChange()]);
    expect(txs[0].entries.length).toBe(1);
    expect(txs[0].entries[0].type).toBe('item_quantity_change');
  });

  it('sets correct item_id and quantity', async () => {
    const txs = await getTransactionsFromList([createMockItemQuantityChange()]);
    const entry = txs[0].entries[0];
    if (entry.type !== 'item_quantity_change') throw new Error('unreachable');
    expect(entry.item_id).toBe('credits');
    expect(entry.quantity).toBe(50);
  });

  it('handles negative quantity (deduction)', async () => {
    const txs = await getTransactionsFromList([createMockItemQuantityChange({ quantity: -10 })]);
    const entry = txs[0].entries[0];
    if (entry.type !== 'item_quantity_change') throw new Error('unreachable');
    expect(entry.quantity).toBe(-10);
  });

  it('lowercases customerType', async () => {
    const txs = await getTransactionsFromList([createMockItemQuantityChange()]);
    const entry = txs[0].entries[0];
    if (entry.type !== 'item_quantity_change') throw new Error('unreachable');
    expect(entry.customer_type).toBe('user');
  });

  it('test_mode is always false', async () => {
    const txs = await getTransactionsFromList([createMockItemQuantityChange()]);
    expect(txs[0].test_mode).toBe(false);
  });

  it('adjusted_by is empty', async () => {
    const txs = await getTransactionsFromList([createMockItemQuantityChange()]);
    expect(txs[0].adjusted_by).toEqual([]);
  });

  it('handles multiple changes', async () => {
    const txs = await getTransactionsFromList([
      createMockItemQuantityChange({ id: 'iqc-2', quantity: -20, itemId: 'seats', createdAt: new Date('2025-01-11') }),
      createMockItemQuantityChange({ id: 'iqc-1', quantity: 50 }),
    ]);
    expect(txs.length).toBe(2);
  });

  it('returns empty for no changes', async () => {
    const txs = await getTransactionsFromList([]);
    expect(txs.length).toBe(0);
  });
});
