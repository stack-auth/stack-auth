/**
 * Shared mock factories for transaction type tests.
 */

export const baseProduct = {
  displayName: 'Test Product',
  customerType: 'user' as const,
  freeTrial: undefined,
  serverOnly: false,
  stackable: false,
  isAddOnTo: false as const,
  prices: {
    monthly: { USD: '9.99', interval: [1, 'month'], serverOnly: false },
  },
  includedItems: {
    seats: { quantity: 4, repeat: 'never' as const, expires: 'when-purchase-expires' as const },
    credits: { quantity: 100, repeat: [1, 'week'] as [number, 'week'], expires: 'when-repeated' as const },
  },
};

export const freeProduct = {
  displayName: 'Free Plan',
  customerType: 'user' as const,
  freeTrial: undefined,
  serverOnly: false,
  stackable: false,
  isAddOnTo: false as const,
  prices: 'include-by-default' as const,
  includedItems: {
    seats: { quantity: 1, repeat: 'never' as const, expires: 'when-purchase-expires' as const },
  },
};

export function createMockSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    tenancyId: 'tenancy-1',
    customerId: 'user-1',
    customerType: 'USER' as const,
    productId: 'prod-1',
    priceId: 'monthly',
    product: baseProduct,
    quantity: 1,
    stripeSubscriptionId: 'stripe-sub-1',
    status: 'active' as const,
    currentPeriodStart: new Date('2025-01-01'),
    currentPeriodEnd: new Date('2025-02-01'),
    cancelAtPeriodEnd: false,
    endedAt: null,
    refundedAt: null,
    billingCycleAnchor: new Date('2025-01-01'),
    creationSource: 'PURCHASE_PAGE' as const,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

export function createMockOneTimePurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    tenancyId: 'tenancy-1',
    customerId: 'user-1',
    customerType: 'USER' as const,
    productId: 'prod-1',
    priceId: 'monthly',
    product: baseProduct,
    quantity: 1,
    stripePaymentIntentId: 'pi-1',
    refundedAt: null,
    creationSource: 'PURCHASE_PAGE' as const,
    createdAt: new Date('2025-01-15'),
    updatedAt: new Date('2025-01-15'),
    ...overrides,
  };
}

export function createMockSubscriptionInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'si-1',
    tenancyId: 'tenancy-1',
    stripeSubscriptionId: 'stripe-sub-1',
    stripeInvoiceId: 'inv-1',
    isSubscriptionCreationInvoice: false,
    status: 'paid',
    amountTotal: 999,
    hostedInvoiceUrl: null,
    createdAt: new Date('2025-02-01'),
    updatedAt: new Date('2025-02-01'),
    ...overrides,
  };
}
