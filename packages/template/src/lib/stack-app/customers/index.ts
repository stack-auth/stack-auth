import { SupportedCurrency } from "@stackframe/stack-shared/dist/utils/currencies";
import { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { AsyncStoreProperty } from "../common";

export type InlineOffer = {
  displayName: string,
  freeTrial?: undefined | DayInterval,
  prices: Record<string,
    & Partial<Record<SupportedCurrency["code"], number>>
    & {
      interval?: undefined | DayInterval,
      freeTrial?: undefined | DayInterval,
    }
  >,
  includedItems: Record<string, {
    quantity: number,
    repeat?: "never" | DayInterval | undefined,
    expires?: "never" | "when-repeated" | "when-purchase-expires" | undefined,
  }>,
};

export type Item = {
  displayName: string,

  /**
   * May be negative.
   */
  quantity: number,
  /**
   * Equal to Math.max(0, quantity).
   */
  nonNegativeQuantity: number,

  increaseQuantity(amount: number): void,
  /**
   * Decreases the quantity by the given amount.
   *
   * Note that you may want to use tryDecreaseQuantity instead, as it will prevent the quantity from going below 0 in a race-condition-free way.
   */
  decreaseQuantity(amount: number): void,
  /**
   * Decreases the quantity by the given amount and returns true if the result is non-negative; returns false and does nothing if the result would be negative.
   *
   * Most useful for pre-paid credits.
   */
  tryDecreaseQuantity(amount: number): boolean,
};

export type Customer =
  & {
    readonly id: string,

    createCheckoutUrl(offerIdOrInline: string | InlineOffer): Promise<void>,
  }
  & AsyncStoreProperty<"item", [itemId: string], Item, false>
