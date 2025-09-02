import { moneyAmountSchema } from "../schema-fields";
import { SUPPORTED_CURRENCIES, type Currency, type MoneyAmount } from "./currency-constants";
import { StackAssertionError } from "./errors";

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function moneyAmountToStripeUnits(amount: MoneyAmount, currency: Currency): number {
  const validated = moneyAmountSchema(currency).defined().validateSync(amount);
  if (currency.stripeDecimals !== currency.decimals) {
    throw new StackAssertionError("unimplemented: TODO support different decimal configurations");
  }

  return Number.parseInt(validated.replace('.', ''), 10);
}
