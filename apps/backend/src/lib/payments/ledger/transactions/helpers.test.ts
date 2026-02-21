import type { Currency } from '@stackframe/stack-shared/dist/utils/currency-constants';
import { describe, expect, it } from 'vitest';
import {
  buildChargedAmount,
  compareTransactions,
  createActiveSubscriptionChangeEntry,
  createActiveSubscriptionStartEntry,
  createActiveSubscriptionStopEntry,
  createItemQuantityChangeEntry,
  createItemQuantityChangeEntriesForProduct,
  createItemQuantityExpireEntry,
  createItemQuantityExpireEntriesForProduct,
  createMoneyTransferEntry,
  createProductGrantEntry,
  createProductRevocationEntry,
  multiplyMoneyAmount,
  resolveSelectedPriceFromProduct,
} from './helpers';

const USD: Currency = { code: 'USD', decimals: 2, stripeDecimals: 2 };
const JPY: Currency = { code: 'JPY', decimals: 0, stripeDecimals: 0 };

const mockProduct = {
  display_name: 'Test',
  customer_type: 'user' as const,
  server_only: false,
  stackable: false,
  prices: {},
  included_items: {
    seats: { quantity: 4, repeat: 'never' as const, expires: 'when-purchase-expires' as const },
    credits: { quantity: 100 },
  },
  client_metadata: null,
  client_read_only_metadata: null,
  server_metadata: null,
};

describe('multiplyMoneyAmount', () => {
  it('multiplies a simple amount by 1', () => {
    expect(multiplyMoneyAmount('10', 1, USD)).toBe('10');
  });

  it('multiplies a decimal amount', () => {
    expect(multiplyMoneyAmount('9.99', 3, USD)).toBe('29.97');
  });

  it('returns "0" for quantity 0', () => {
    expect(multiplyMoneyAmount('100', 0, USD)).toBe('0');
  });

  it('handles negative quantity', () => {
    expect(multiplyMoneyAmount('5', -2, USD)).toBe('-10');
  });

  it('handles negative amount', () => {
    expect(multiplyMoneyAmount('-5', 2, USD)).toBe('-10');
  });

  it('negative amount and negative quantity produce positive result', () => {
    expect(multiplyMoneyAmount('-5', -2, USD)).toBe('10');
  });

  it('handles zero-decimal currencies (JPY)', () => {
    expect(multiplyMoneyAmount('100', 3, JPY)).toBe('300');
  });

  it('handles large amounts', () => {
    expect(multiplyMoneyAmount('999999.99', 100, USD)).toBe('99999999');
  });

  it('trims trailing zeros from fractional part', () => {
    expect(multiplyMoneyAmount('1.50', 2, USD)).toBe('3');
  });

  it('throws for non-integer quantity', () => {
    expect(() => multiplyMoneyAmount('10', 1.5, USD)).toThrow('integer');
  });

  it('handles amount with no fractional part', () => {
    expect(multiplyMoneyAmount('42', 2, USD)).toBe('84');
  });

  it('preserves fractional precision', () => {
    expect(multiplyMoneyAmount('0.01', 1, USD)).toBe('0.01');
  });

  it('handles small fractional with large multiplier', () => {
    expect(multiplyMoneyAmount('0.01', 100, USD)).toBe('1');
  });
});

describe('resolveSelectedPriceFromProduct', () => {
  it('returns null for null product', () => {
    expect(resolveSelectedPriceFromProduct(null)).toBeNull();
  });

  it('returns null for undefined product', () => {
    expect(resolveSelectedPriceFromProduct(undefined)).toBeNull();
  });

  it('returns null when priceId is not provided', () => {
    expect(resolveSelectedPriceFromProduct({ prices: { p1: { USD: '10', serverOnly: false } } })).toBeNull();
  });

  it('returns null for include-by-default prices', () => {
    expect(resolveSelectedPriceFromProduct({ prices: 'include-by-default' }, 'p1')).toBeNull();
  });

  it('returns null for missing priceId', () => {
    expect(resolveSelectedPriceFromProduct({ prices: { p1: { USD: '10', serverOnly: false } } }, 'nonexistent')).toBeNull();
  });

  it('resolves a valid price, stripping serverOnly and freeTrial', () => {
    const product = {
      prices: {
        monthly: { USD: '9.99', interval: [1, 'month'], serverOnly: true, freeTrial: [7, 'day'] },
      },
    };
    const result = resolveSelectedPriceFromProduct(product as any, 'monthly');
    expect(result).toEqual({ USD: '9.99', interval: [1, 'month'] });
    expect(result).not.toHaveProperty('serverOnly');
    expect(result).not.toHaveProperty('freeTrial');
  });

  it('returns null when prices is undefined', () => {
    expect(resolveSelectedPriceFromProduct({}, 'p1')).toBeNull();
  });
});

describe('buildChargedAmount', () => {
  it('returns empty object for null price', () => {
    expect(buildChargedAmount(null, 1)).toEqual({});
  });

  it('computes USD amount', () => {
    expect(buildChargedAmount({ USD: '10' }, 2)).toEqual({ USD: '20' });
  });

  it('filters out zero amounts', () => {
    expect(buildChargedAmount({ USD: '0' }, 5)).toEqual({});
  });

  it('handles multi-currency prices', () => {
    const result = buildChargedAmount({ USD: '10', EUR: '8.50' }, 2);
    expect(result.USD).toBe('20');
    expect(result.EUR).toBe('17');
  });

  it('ignores non-string price values', () => {
    expect(buildChargedAmount({ USD: 10 as any, EUR: '5' }, 1)).toEqual({ EUR: '5' });
  });
});

describe('createMoneyTransferEntry', () => {
  it('returns null when skip is true', () => {
    expect(createMoneyTransferEntry({ customerType: 'user', customerId: 'u1', chargedAmount: { USD: '10' }, skip: true })).toBeNull();
  });

  it('returns null when chargedAmount is empty', () => {
    expect(createMoneyTransferEntry({ customerType: 'user', customerId: 'u1', chargedAmount: {}, skip: false })).toBeNull();
  });

  it('creates entry with correct structure', () => {
    const entry = createMoneyTransferEntry({ customerType: 'user', customerId: 'u1', chargedAmount: { USD: '10' }, skip: false });
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe('money_transfer');
    if (entry!.type !== 'money_transfer') throw new Error('unreachable');
    expect(entry!.customer_type).toBe('user');
    expect(entry!.customer_id).toBe('u1');
    expect(entry!.charged_amount).toEqual({ USD: '10' });
    expect(entry!.net_amount).toEqual({ USD: '10' });
  });

  it('defaults net_amount USD to "0" when USD is not in chargedAmount', () => {
    const entry = createMoneyTransferEntry({ customerType: 'user', customerId: 'u1', chargedAmount: { EUR: '5' }, skip: false });
    expect(entry).not.toBeNull();
    if (entry!.type !== 'money_transfer') throw new Error('unreachable');
    expect(entry!.net_amount).toEqual({ USD: '0' });
  });
});

describe('createProductGrantEntry', () => {
  it('creates entry with all fields', () => {
    const entry = createProductGrantEntry({
      customerType: 'user', customerId: 'u1', productId: 'p1', product: mockProduct,
      priceId: 'monthly', quantity: 2, cycleAnchor: 1000, subscriptionId: 's1',
    });
    expect(entry.type).toBe('product_grant');
    if (entry.type !== 'product_grant') throw new Error('unreachable');
    expect(entry.product_id).toBe('p1');
    expect(entry.quantity).toBe(2);
    expect(entry.cycle_anchor).toBe(1000);
    expect(entry.subscription_id).toBe('s1');
    expect(entry.one_time_purchase_id).toBeUndefined();
  });

  it('sets one_time_purchase_id for OTP', () => {
    const entry = createProductGrantEntry({
      customerType: 'user', customerId: 'u1', productId: 'p1', product: mockProduct,
      priceId: null, quantity: 1, cycleAnchor: 2000, oneTimePurchaseId: 'otp1',
    });
    if (entry.type !== 'product_grant') throw new Error('unreachable');
    expect(entry.one_time_purchase_id).toBe('otp1');
    expect(entry.subscription_id).toBeUndefined();
  });
});

describe('createActiveSubscriptionStartEntry', () => {
  it('creates entry with correct structure', () => {
    const entry = createActiveSubscriptionStartEntry({
      customerType: 'team', customerId: 't1', subscriptionId: 's1',
      productId: 'p1', product: mockProduct,
    });
    expect(entry.type).toBe('active_subscription_start');
    if (entry.type !== 'active_subscription_start') throw new Error('unreachable');
    expect(entry.subscription_id).toBe('s1');
    expect(entry.product_id).toBe('p1');
  });
});

describe('createActiveSubscriptionStopEntry', () => {
  it('creates entry with correct structure', () => {
    const entry = createActiveSubscriptionStopEntry({ customerType: 'user', customerId: 'u1', subscriptionId: 's1' });
    expect(entry.type).toBe('active_subscription_stop');
    if (entry.type !== 'active_subscription_stop') throw new Error('unreachable');
    expect(entry.subscription_id).toBe('s1');
  });
});

describe('createActiveSubscriptionChangeEntry', () => {
  it('creates cancel change entry', () => {
    const entry = createActiveSubscriptionChangeEntry({
      customerType: 'user', customerId: 'u1', subscriptionId: 's1', changeType: 'cancel',
    });
    expect(entry.type).toBe('active_subscription_change');
    if (entry.type !== 'active_subscription_change') throw new Error('unreachable');
    expect(entry.change_type).toBe('cancel');
    expect(entry.product_id).toBeUndefined();
  });

  it('creates switch change entry with product info', () => {
    const entry = createActiveSubscriptionChangeEntry({
      customerType: 'user', customerId: 'u1', subscriptionId: 's1', changeType: 'switch',
      productId: 'p2', product: mockProduct,
    });
    if (entry.type !== 'active_subscription_change') throw new Error('unreachable');
    expect(entry.change_type).toBe('switch');
    expect(entry.product_id).toBe('p2');
    expect(entry.product).toBeDefined();
  });
});

describe('createItemQuantityChangeEntry', () => {
  it('creates entry with correct fields', () => {
    const entry = createItemQuantityChangeEntry({ customerType: 'user', customerId: 'u1', itemId: 'seats', quantity: 5 });
    expect(entry.type).toBe('item_quantity_change');
    if (entry.type !== 'item_quantity_change') throw new Error('unreachable');
    expect(entry.item_id).toBe('seats');
    expect(entry.quantity).toBe(5);
  });
});

describe('createItemQuantityExpireEntry', () => {
  it('creates entry with correct fields', () => {
    const entry = createItemQuantityExpireEntry({ customerType: 'user', customerId: 'u1', itemId: 'credits', quantity: 50 });
    expect(entry.type).toBe('item_quantity_expire');
    if (entry.type !== 'item_quantity_expire') throw new Error('unreachable');
    expect(entry.item_id).toBe('credits');
    expect(entry.quantity).toBe(50);
  });
});

describe('createItemQuantityChangeEntriesForProduct', () => {
  it('creates one entry per included item', () => {
    const entries = createItemQuantityChangeEntriesForProduct({
      product: mockProduct, purchaseQuantity: 1, customerType: 'user', customerId: 'u1',
    });
    expect(entries.length).toBe(2);
    const itemIds = entries.map((e) => e.type === 'item_quantity_change' ? e.item_id : null);
    expect(itemIds).toContain('seats');
    expect(itemIds).toContain('credits');
  });

  it('multiplies by purchase quantity', () => {
    const entries = createItemQuantityChangeEntriesForProduct({
      product: mockProduct, purchaseQuantity: 3, customerType: 'user', customerId: 'u1',
    });
    for (const e of entries) {
      if (e.type !== 'item_quantity_change') throw new Error('unreachable');
      if (e.item_id === 'seats') expect(e.quantity).toBe(12);
      if (e.item_id === 'credits') expect(e.quantity).toBe(300);
    }
  });

  it('skips items with zero or negative quantity', () => {
    const product = { ...mockProduct, included_items: { seats: { quantity: 0 } } };
    const entries = createItemQuantityChangeEntriesForProduct({
      product, purchaseQuantity: 1, customerType: 'user', customerId: 'u1',
    });
    expect(entries.length).toBe(0);
  });

  it('returns empty for product with no included items', () => {
    const product = { ...mockProduct, included_items: {} };
    const entries = createItemQuantityChangeEntriesForProduct({
      product, purchaseQuantity: 1, customerType: 'user', customerId: 'u1',
    });
    expect(entries.length).toBe(0);
  });
});

describe('createItemQuantityExpireEntriesForProduct', () => {
  it('only creates entries for items with expires=when-purchase-expires', () => {
    const entries = createItemQuantityExpireEntriesForProduct({
      product: mockProduct, purchaseQuantity: 1, customerType: 'user', customerId: 'u1',
    });
    expect(entries.length).toBe(1);
    if (entries[0].type !== 'item_quantity_expire') throw new Error('unreachable');
    expect(entries[0].item_id).toBe('seats');
    expect(entries[0].quantity).toBe(4);
  });

  it('skips items without expires or with different expires value', () => {
    const product = {
      ...mockProduct,
      included_items: {
        a: { quantity: 5, expires: 'never' as const },
        b: { quantity: 3, expires: 'when-repeated' as const },
      },
    };
    const entries = createItemQuantityExpireEntriesForProduct({
      product, purchaseQuantity: 1, customerType: 'user', customerId: 'u1',
    });
    expect(entries.length).toBe(0);
  });

  it('multiplies by purchase quantity', () => {
    const entries = createItemQuantityExpireEntriesForProduct({
      product: mockProduct, purchaseQuantity: 2, customerType: 'user', customerId: 'u1',
    });
    expect(entries.length).toBe(1);
    if (entries[0].type !== 'item_quantity_expire') throw new Error('unreachable');
    expect(entries[0].quantity).toBe(8);
  });
});

describe('createProductRevocationEntry', () => {
  it('creates entry with correct fields', () => {
    const entry = createProductRevocationEntry({
      customerType: 'user', customerId: 'u1',
      adjustedTransactionId: 'tx1', adjustedEntryIndex: 2, quantity: 3,
    });
    expect(entry.type).toBe('product_revocation');
    if (entry.type !== 'product_revocation') throw new Error('unreachable');
    expect(entry.adjusted_transaction_id).toBe('tx1');
    expect(entry.adjusted_entry_index).toBe(2);
    expect(entry.quantity).toBe(3);
  });
});

describe('compareTransactions', () => {
  it('sorts by created_at_millis descending', () => {
    const a = { id: 'a', created_at_millis: 1000, effective_at_millis: 1000, type: null, entries: [], adjusted_by: [], test_mode: false } as any;
    const b = { id: 'b', created_at_millis: 2000, effective_at_millis: 2000, type: null, entries: [], adjusted_by: [], test_mode: false } as any;
    expect(compareTransactions('createdAt-desc', a, b)).toBeGreaterThan(0);
    expect(compareTransactions('createdAt-desc', b, a)).toBeLessThan(0);
  });

  it('breaks ties by id descending', () => {
    const a = { id: 'a', created_at_millis: 1000, effective_at_millis: 1000, type: null, entries: [], adjusted_by: [], test_mode: false } as any;
    const b = { id: 'b', created_at_millis: 1000, effective_at_millis: 1000, type: null, entries: [], adjusted_by: [], test_mode: false } as any;
    expect(compareTransactions('createdAt-desc', a, b)).toBeGreaterThan(0);
    expect(compareTransactions('createdAt-desc', b, a)).toBeLessThan(0);
  });
});
