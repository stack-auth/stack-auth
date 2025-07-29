import { moneyAmountSchema } from "../schema-fields";
import { StackAssertionError } from "./errors";

export type Currency = {
  code: Uppercase<string>,
  decimals: number,
  stripeDecimals: number,
};

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export const SUPPORTED_CURRENCIES = [
  {
    code: 'USD',
    decimals: 2,
    stripeDecimals: 2,
  },
  {
    code: 'EUR',
    decimals: 2,
    stripeDecimals: 2,
  },
  {
    code: 'GBP',
    decimals: 2,
    stripeDecimals: 2,
  },
  {
    code: 'JPY',
    decimals: 0,
    stripeDecimals: 0,
  },
  {
    code: 'INR',
    decimals: 2,
    stripeDecimals: 2,
  },
  {
    code: 'AUD',
    decimals: 2,
    stripeDecimals: 2,
  },
  {
    code: 'CAD',
    decimals: 2,
    stripeDecimals: 2,
  },
] as const satisfies Currency[];

export type MoneyAmount = `${number}` | `${number}.${number}`;

export function moneyAmountToStripeUnits(amount: MoneyAmount, currency: Currency): number {
  const validated = moneyAmountSchema(currency).defined().validateSync(amount);
  if (currency.stripeDecimals !== currency.decimals) {
    throw new StackAssertionError("unimplemented: TODO support different decimal configurations");
  }

  return Number.parseInt(validated.replace('.', ''), 10);
}
