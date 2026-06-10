/**
 * Stripe API limits shared by backend and frontend.
 * See https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts.
 */

/**
 * Per-currency minimum for one-time PaymentIntents, in the major unit.
 * Recurring subs have no minimum ($0 subs are allowed).
 */
export const STRIPE_ONE_TIME_MIN_AMOUNT_BY_CURRENCY = {
  USD: 0.50,
} as const;

export type StripeSupportedCurrency = keyof typeof STRIPE_ONE_TIME_MIN_AMOUNT_BY_CURRENCY;

export function getStripeOneTimeMinAmount(currency: StripeSupportedCurrency): number {
  return STRIPE_ONE_TIME_MIN_AMOUNT_BY_CURRENCY[currency];
}
