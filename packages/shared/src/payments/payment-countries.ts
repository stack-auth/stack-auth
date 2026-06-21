/**
 * Payment Countries Configuration
 *
 * Single source of truth for the "country of residence" options shown during
 * payments setup, shared by the backend (Stripe account creation + route
 * validation) and the frontend (onboarding wizard + payments dialog).
 *
 * - `paymentSupportedCountries` are the countries where Hexclave Payments is
 *   actually available; selecting one of these starts the Stripe Connect flow.
 *   These values are passed straight to `stripe.accounts.create({ country })`,
 *   so they must be valid ISO 3166-1 alpha-2 codes that Stripe supports.
 * - `onboardingPaymentsCountryValues` additionally includes the `"OTHER"`
 *   sentinel, which represents "my country is not yet supported" (a dead-end in
 *   the UI). `"OTHER"` is never sent to Stripe.
 */

export const paymentSupportedCountries = ["US", "DE"] as const;
export type PaymentSupportedCountry = (typeof paymentSupportedCountries)[number];

export function isPaymentSupportedCountry(value: unknown): value is PaymentSupportedCountry {
  return typeof value === "string" && paymentSupportedCountries.some((country) => country === value);
}

export const onboardingPaymentsCountryValues = [...paymentSupportedCountries, "OTHER"] as const;
export type OnboardingPaymentsCountry = (typeof onboardingPaymentsCountryValues)[number];

export function isOnboardingPaymentsCountry(value: unknown): value is OnboardingPaymentsCountry {
  return typeof value === "string" && onboardingPaymentsCountryValues.some((country) => country === value);
}

/** Human-readable names for supported countries, keyed by ISO code. */
export const paymentSupportedCountryDisplayNames: Record<PaymentSupportedCountry, string> = {
  US: "United States",
  DE: "Germany",
};

import.meta.vitest?.test("payment countries", ({ expect }) => {
  expect(isPaymentSupportedCountry("US")).toBe(true);
  expect(isPaymentSupportedCountry("DE")).toBe(true);
  expect(isPaymentSupportedCountry("OTHER")).toBe(false);
  expect(isPaymentSupportedCountry("FR")).toBe(false);
  expect(isPaymentSupportedCountry(null)).toBe(false);

  expect(isOnboardingPaymentsCountry("US")).toBe(true);
  expect(isOnboardingPaymentsCountry("DE")).toBe(true);
  expect(isOnboardingPaymentsCountry("OTHER")).toBe(true);
  expect(isOnboardingPaymentsCountry("FR")).toBe(false);
});
