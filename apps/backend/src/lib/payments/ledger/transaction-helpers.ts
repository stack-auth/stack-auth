import { SUPPORTED_CURRENCIES, type Currency } from "@stackframe/stack-shared/dist/utils/currency-constants";

type SelectedPriceMetadata = {
  interval?: unknown,
};

type SelectedPrice = Record<string, unknown> & SelectedPriceMetadata;

type ProductPriceEntryExtras = {
  serverOnly?: unknown,
  freeTrial?: unknown,
};

type ProductPriceEntry = SelectedPrice & ProductPriceEntryExtras;

export type ProductWithPrices = {
  displayName?: string,
  prices?: Record<string, ProductPriceEntry> | "include-by-default",
} | null | undefined;

export function resolveSelectedPriceFromProduct(product: ProductWithPrices, priceId?: string | null): SelectedPrice | null {
  if (!product || !priceId) return null;
  const prices = product.prices;
  if (!prices || prices === "include-by-default") return null;
  const selected = prices[priceId as keyof typeof prices] as ProductPriceEntry | undefined;
  if (!selected) return null;
  const { serverOnly: _serverOnly, freeTrial: _freeTrial, ...rest } = selected as any;
  return rest as SelectedPrice;
}

function multiplyMoneyAmount(amount: string, quantity: number, currency: Currency): string {
  if (!Number.isFinite(quantity) || Math.trunc(quantity) !== quantity) {
    throw new Error("Quantity must be an integer when multiplying money amounts");
  }
  if (quantity === 0) return "0";

  const multiplierNegative = quantity < 0;
  const safeQuantity = BigInt(Math.abs(quantity));
  const isNegative = amount.startsWith("-");
  const normalized = isNegative ? amount.slice(1) : amount;
  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const paddedFractional = fractionalPart.padEnd(currency.decimals, "0");
  const smallestUnit = BigInt(`${wholePart || "0"}${paddedFractional.padEnd(currency.decimals, "0")}`);
  const multiplied = smallestUnit * safeQuantity;

  const totalDecimals = currency.decimals;
  let multipliedStr = multiplied.toString();
  if (totalDecimals > 0 && multipliedStr.length <= totalDecimals) {
    multipliedStr = multipliedStr.padStart(totalDecimals + 1, "0");
  }

  let integerPart: string;
  let fractionalResult: string | null = null;
  if (totalDecimals === 0) {
    integerPart = multipliedStr;
  } else {
    integerPart = multipliedStr.slice(0, -totalDecimals) || "0";
    const rawFraction = multipliedStr.slice(-totalDecimals);
    const trimmedFraction = rawFraction.replace(/0+$/, "");
    fractionalResult = trimmedFraction.length > 0 ? trimmedFraction : null;
  }

  integerPart = integerPart.replace(/^0+(?=\d)/, "") || "0";
  let result = fractionalResult ? `${integerPart}.${fractionalResult}` : integerPart;
  const shouldBeNegative = (isNegative ? -1 : 1) * (multiplierNegative ? -1 : 1) === -1;
  if (shouldBeNegative && result !== "0") {
    result = `-${result}`;
  }
  return result;
}

export function buildChargedAmount(price: SelectedPrice | null, quantity: number): Record<string, string> {
  if (!price) return {};
  const result: Record<string, string> = {};
  for (const currency of SUPPORTED_CURRENCIES) {
    const rawAmount = price[currency.code as keyof typeof price];
    if (typeof rawAmount !== "string") continue;
    const multiplied = multiplyMoneyAmount(rawAmount, quantity, currency);
    if (multiplied === "0") continue;
    result[currency.code] = multiplied;
  }
  return result;
}
