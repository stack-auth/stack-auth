import { inlineProductSchema } from "@stackframe/stack-shared/dist/schema-fields";
import * as yup from "yup";
import { AsyncStoreProperty } from "../common";

export type InlineProduct = yup.InferType<typeof inlineProductSchema>;

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
};

export type ServerItem = Item & {
  increaseQuantity(amount: number): Promise<void>,
  /**
   * Decreases the quantity by the given amount.
   *
   * Note that you may want to use tryDecreaseQuantity instead, as it will prevent the quantity from going below 0 in a race-condition-free way.
   */
  decreaseQuantity(amount: number): Promise<void>,
  /**
   * Decreases the quantity by the given amount and returns true if the result is non-negative; returns false and does nothing if the result would be negative.
   *
   * Most useful for pre-paid credits.
   */
  tryDecreaseQuantity(amount: number): Promise<boolean>,
};

export type CustomerProduct = {
  id: string | null,
  quantity: number,
  displayName: string,
  customerType: "user" | "team" | "custom",
  isServerOnly: boolean,
  stackable: boolean,
};

export type CustomerProductsList = CustomerProduct[] & {
  nextCursor: string | null,
};

export type CustomerProductsListOptions = {
  cursor?: string,
  limit?: number,
};

export type CustomerProductsRequestOptions =
  | ({ userId: string } & CustomerProductsListOptions)
  | ({ teamId: string } & CustomerProductsListOptions)
  | ({ customCustomerId: string } & CustomerProductsListOptions);

export type Customer<IsServer extends boolean = false> =
  & {
    readonly id: string,

    createCheckoutUrl(options: (
      | { productId: string, returnUrl?: string }
      | (IsServer extends true ? { product: InlineProduct, returnUrl?: string } : never)
    )): Promise<string>,
  }
  & AsyncStoreProperty<
    "item",
    [itemId: string],
    IsServer extends true ? ServerItem : Item,
    false
  >
  & AsyncStoreProperty<
    "products",
    [options?: CustomerProductsListOptions],
    CustomerProductsList,
    true
  >
  & (IsServer extends true ? {
    grantProduct(
      product: { productId: string, quantity?: number } | { product: InlineProduct, quantity?: number },
    ): Promise<void>,
    revokeProduct(options: { productId: string }): Promise<void>,
  } : {});
