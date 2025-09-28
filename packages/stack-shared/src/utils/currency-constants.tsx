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
