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
