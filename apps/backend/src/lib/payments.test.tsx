import { KnownErrors } from '@stackframe/stack-shared';
import { describe, expect, it } from 'vitest';
import { validatePurchaseSession } from './payments';
import { bulldozerWriteOneTimePurchase, bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { globalPrismaClient } from "@/prisma-client";

// Uses globalPrismaClient which connects to the real dev DB (with BulldozerStorageEngine).
// customerType: 'custom' avoids needing a real ProjectUser/Team in the DB.
// Each test writes data to Bulldozer stored tables via the dual-write functions,
// then calls validatePurchaseSession which reads from the owned products LFold.
describe.sequential('validatePurchaseSession - purchase guards (real DB)', () => {
  const prisma = globalPrismaClient;
  const testId = Math.random().toString(36).slice(2, 8);
  const tenancyId = `test-tenancy-${testId}`;
  const customerId = `test-customer-${testId}`;

  const makeProduct = (overrides: Record<string, unknown> = {}) => ({
    displayName: 'Test Product',
    productLineId: null as string | null,
    customerType: 'custom' as const,
    prices: { p1: { USD: '10' } },
    includedItems: {},
    isAddOnTo: false as false | Record<string, true>,
    stackable: false,
    ...overrides,
  });

  const grantOtp = async (id: string, productId: string, product: ReturnType<typeof makeProduct>) => {
    await bulldozerWriteOneTimePurchase(prisma as any, {
      id, tenancyId, customerId, customerType: 'CUSTOM',
      productId, priceId: null, product: product as any, quantity: 1,
      stripePaymentIntentId: null, revokedAt: null, refundedAt: null,
      creationSource: 'TEST_MODE', createdAt: new Date(),
    });
  };

  const grantSub = async (id: string, productId: string, product: ReturnType<typeof makeProduct>) => {
    await bulldozerWriteSubscription(prisma as any, {
      id, tenancyId, customerId, customerType: 'CUSTOM',
      productId, priceId: null, product: product as any, quantity: 1,
      stripeSubscriptionId: `stripe-${id}`, status: 'active',
      currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, refundedAt: null,
      creationSource: 'TEST_MODE', createdAt: new Date(),
    });
  };

  const callValidate = (product: ReturnType<typeof makeProduct>, overrides: Record<string, unknown> = {}) =>
    validatePurchaseSession({
      prisma: prisma as any,
      tenancyId,
      customerType: 'custom',
      customerId,
      product: product as any,
      productId: `prod-new-${testId}`,
      priceId: undefined,
      quantity: 1,
      ...overrides,
    });

  it('blocks non-stackable product if customer already owns it', async () => {
    const prodId = `prod-dup-${testId}`;
    await grantOtp(`otp-dup-${testId}`, prodId, makeProduct());
    await expect(callValidate(makeProduct(), { productId: prodId })).rejects.toThrowError(/already owns/);
  });

  it('allows stackable product even if customer already owns it', async () => {
    const prodId = `prod-stack-${testId}`;
    await grantOtp(`otp-stack-${testId}`, prodId, makeProduct({ stackable: true }));
    const res = await callValidate(makeProduct({ stackable: true }), { productId: prodId });
    expect(res.selectedPrice).toBeDefined();
  });

  it('blocks non-stackable quantity > 1', async () => {
    await expect(callValidate(makeProduct(), { quantity: 3 }))
      .rejects.toThrowError('not stackable');
  });

  it('blocks purchase when OTP exists in same product line (no sub to cancel)', async () => {
    const lineId = `line-block-${testId}`;
    await grantOtp(`otp-line-${testId}`, `prod-in-line-${testId}`, makeProduct({ productLineId: lineId }));
    await expect(callValidate(makeProduct({ productLineId: lineId }), { productId: `prod-other-${testId}` }))
      .rejects.toThrowError('one-time purchase in this product line');
  });

  it('allows purchase when existing product is in different product line', async () => {
    const res = await callValidate(
      makeProduct({ productLineId: `line-different-${testId}` }),
      { productId: `prod-diff-${testId}` },
    );
    expect(res.conflictingSubscriptions).toHaveLength(0);
  });

  it('finds conflicting subscription in same product line', async () => {
    const lineId = `line-conflict-${testId}`;
    const subId = `sub-conflict-${testId}`;
    await grantSub(subId, `prod-sub-${testId}`, makeProduct({ productLineId: lineId }));
    const res = await callValidate(
      makeProduct({ productLineId: lineId }),
      { productId: `prod-replace-${testId}` },
    );
    expect(res.conflictingSubscriptions).toHaveLength(1);
    expect(res.conflictingSubscriptions[0].id).toBe(subId);
  });

  it('blocks add-on if base product not owned', async () => {
    await expect(callValidate(makeProduct({ isAddOnTo: { [`base-${testId}`]: true } })))
      .rejects.toThrowError('add-on');
  });

  it('allows add-on if base product is owned', async () => {
    const baseId = `base-addon-${testId}`;
    await grantOtp(`otp-base-${testId}`, baseId, makeProduct());
    const res = await callValidate(makeProduct({ isAddOnTo: { [baseId]: true } }));
    expect(res.selectedPrice).toBeDefined();
  });

  it('allows add-on in same product line as its base product', async () => {
    const lineId = `line-addon-${testId}`;
    const baseId = `base-sameline-${testId}`;
    await grantOtp(`otp-sameline-${testId}`, baseId, makeProduct({ productLineId: lineId }));
    const res = await callValidate(
      makeProduct({ productLineId: lineId, isAddOnTo: { [baseId]: true } }),
      { productId: `addon-sameline-${testId}` },
    );
    expect(res.selectedPrice).toBeDefined();
    expect(res.conflictingSubscriptions).toHaveLength(0);
  });

  // TODO: reconsider coupling — product-line blocking infers OTP vs subscription
  // ownership. OTPs can be refunded, so "blocked because OTP" is debatable.

  it('resolves first price when no priceId given', async () => {
    const res = await callValidate(makeProduct({ prices: { p1: { USD: '10' }, p2: { USD: '20' } } }));
    expect(res.selectedPrice).toBeDefined();
    expect((res.selectedPrice as any).USD).toBe('10');
  });

  it('resolves specific priceId when given', async () => {
    const res = await callValidate(
      makeProduct({ prices: { p1: { USD: '10' }, p2: { USD: '20' } } }),
      { priceId: 'p2' },
    );
    expect(res.selectedPrice).toBeDefined();
    expect((res.selectedPrice as any).USD).toBe('20');
  });

  it('rejects invalid priceId', async () => {
    await expect(callValidate(
      makeProduct({ prices: { p1: { USD: '10' } } }),
      { priceId: 'nonexistent' },
    )).rejects.toThrowError('Price not found');
  });
});

