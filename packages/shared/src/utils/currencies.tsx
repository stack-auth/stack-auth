import { moneyAmountSchema } from "../schema-fields";
import { SUPPORTED_CURRENCIES, type Currency, type MoneyAmount } from "./currency-constants";
import { HexclaveAssertionError } from "./errors";

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function moneyAmountToStripeUnits(amount: MoneyAmount, currency: Currency): number {
  const validated = moneyAmountSchema(currency).defined().validateSync(amount);
  if (currency.stripeDecimals !== currency.decimals) {
    throw new HexclaveAssertionError("unimplemented: TODO support different decimal configurations");
  }
  // `moneyAmountSchema` accepts strings with 0..currency.decimals fractional
  // digits, so we must right-pad the fractional part before stripping the dot.
  // A naïve `replace('.', '')` underweights inputs like "5" → 5 (should be 500
  // for USD) and "0.5" → 5 (should be 50).
  const [whole, fractional = ""] = validated.split(".");
  const paddedFractional = fractional.padEnd(currency.decimals, "0");
  return Number.parseInt(whole + paddedFractional, 10);
}

/**
 * Inverse of `moneyAmountToStripeUnits`: formats an integer minor-unit amount
 * (e.g. cents) back into the canonical decimal money string for the currency.
 * E.g. for USD (2 decimals): 5000 → "50.00", 1 → "0.01"; for JPY (0 decimals):
 * 500 → "500".
 *
 * Prefer this over `String(number)` whenever an amount is scaled: money math
 * must happen in integer minor units, because float multiplication like
 * `19.99 * 3` yields `59.97000000000001`, which `moneyAmountSchema` then rejects
 * for having more than the currency's allowed decimals.
 *
 * Money amounts are non-negative (see `MoneyAmount`), so a negative input is a
 * programming error and throws rather than silently dropping the sign.
 */
export function stripeUnitsToMoneyAmount(stripeUnits: number, currency: Currency): MoneyAmount {
  if (!Number.isFinite(stripeUnits) || Math.trunc(stripeUnits) !== stripeUnits) {
    throw new HexclaveAssertionError("Stripe units must be an integer", { stripeUnits });
  }
  if (stripeUnits < 0) {
    throw new HexclaveAssertionError("Money amounts are non-negative; cannot represent negative stripe units", { stripeUnits });
  }
  if (currency.stripeDecimals !== currency.decimals) {
    throw new HexclaveAssertionError("unimplemented: TODO support different decimal configurations");
  }
  const decimals = currency.decimals;
  if (decimals === 0) return `${stripeUnits}` as MoneyAmount;
  // Pad so there's always at least one integer digit plus `decimals` fractional
  // digits, then split at the dot position.
  const padded = stripeUnits.toString().padStart(decimals + 1, "0");
  const integerPart = padded.slice(0, padded.length - decimals);
  const fractionalPart = padded.slice(padded.length - decimals);
  return `${integerPart}.${fractionalPart}` as MoneyAmount;
}

import.meta.vitest?.describe("moneyAmountToStripeUnits", (test) => {
  const USD = SUPPORTED_CURRENCIES.find((c) => c.code === "USD")!;

  test("converts fully-padded USD amounts", ({ expect }) => {
    expect(moneyAmountToStripeUnits("5.00" as MoneyAmount, USD)).toBe(500);
    expect(moneyAmountToStripeUnits("0.01" as MoneyAmount, USD)).toBe(1);
    expect(moneyAmountToStripeUnits("12.34" as MoneyAmount, USD)).toBe(1234);
  });

  test("converts whole-number USD amounts (no decimals)", ({ expect }) => {
    expect(moneyAmountToStripeUnits("5" as MoneyAmount, USD)).toBe(500);
    expect(moneyAmountToStripeUnits("10" as MoneyAmount, USD)).toBe(1000);
    expect(moneyAmountToStripeUnits("0" as MoneyAmount, USD)).toBe(0);
  });

  test("converts USD amounts with one decimal digit", ({ expect }) => {
    expect(moneyAmountToStripeUnits("5.5" as MoneyAmount, USD)).toBe(550);
    expect(moneyAmountToStripeUnits("0.5" as MoneyAmount, USD)).toBe(50);
  });

  test("matches stripeUnitsToMoneyAmount round-trip", ({ expect }) => {
    for (const cents of [0, 1, 5, 50, 99, 100, 1234, 100000]) {
      const padded = `${Math.floor(cents / 100)}.${(cents % 100).toString().padStart(2, "0")}` as MoneyAmount;
      expect(moneyAmountToStripeUnits(padded, USD)).toBe(cents);
    }
  });

  test("rejects invalid money strings via schema", ({ expect }) => {
    expect(() => moneyAmountToStripeUnits("abc" as MoneyAmount, USD)).toThrow();
    expect(() => moneyAmountToStripeUnits("5.555" as MoneyAmount, USD)).toThrow();
    expect(() => moneyAmountToStripeUnits("05" as MoneyAmount, USD)).toThrow();
  });
});

import.meta.vitest?.describe("stripeUnitsToMoneyAmount", (test) => {
  const USD = SUPPORTED_CURRENCIES.find((c) => c.code === "USD")!;
  const JPY = SUPPORTED_CURRENCIES.find((c) => c.code === "JPY")!;

  test("formats USD minor units as a 2-decimal string", ({ expect }) => {
    expect(stripeUnitsToMoneyAmount(5000, USD)).toBe("50.00");
    expect(stripeUnitsToMoneyAmount(1, USD)).toBe("0.01");
    expect(stripeUnitsToMoneyAmount(100, USD)).toBe("1.00");
    expect(stripeUnitsToMoneyAmount(0, USD)).toBe("0.00");
  });

  test("formats 0-decimal currencies without a dot", ({ expect }) => {
    expect(stripeUnitsToMoneyAmount(500, JPY)).toBe("500");
    expect(stripeUnitsToMoneyAmount(0, JPY)).toBe("0");
  });

  test("round-trips with moneyAmountToStripeUnits", ({ expect }) => {
    for (const cents of [0, 1, 5, 50, 99, 100, 1234, 100000]) {
      expect(moneyAmountToStripeUnits(stripeUnitsToMoneyAmount(cents, USD), USD)).toBe(cents);
    }
  });

  test("scaling in minor units avoids float artifacts", ({ expect }) => {
    // 19.99 * 3 in float is 59.97000000000001; via minor units it is exact.
    const scaled = moneyAmountToStripeUnits("19.99" as MoneyAmount, USD) * 3;
    expect(stripeUnitsToMoneyAmount(scaled, USD)).toBe("59.97");
  });

  test("rejects non-integer and negative inputs", ({ expect }) => {
    expect(() => stripeUnitsToMoneyAmount(1.5, USD)).toThrow();
    expect(() => stripeUnitsToMoneyAmount(-1, USD)).toThrow();
    expect(() => stripeUnitsToMoneyAmount(Number.NaN, USD)).toThrow();
  });
});
