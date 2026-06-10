/**
 * A decimal string representing a monetary amount, e.g. `"9.99"`, `"0.01"`, or `"1000"`.
 *
 * This is NOT an integer in cents/minor units — it is always a human-readable decimal string.
 * For example, nine dollars and ninety-nine cents is `"9.99"`, not `999`.
 */
export type MoneyAmount = `${number}` | `${number}.${number}`;

export type Currency = {
  code: Uppercase<string>,
  decimals: number,
  stripeDecimals: number,
};

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
