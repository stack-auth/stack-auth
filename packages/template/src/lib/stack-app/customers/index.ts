import { inlineProductSchema } from "@stackframe/stack-shared/dist/schema-fields";
import * as yup from "yup";
import { AsyncStoreProperty } from "../common";

export type InlineProduct = yup.InferType<typeof inlineProductSchema>;

/**
 * Represents a quantifiable resource (credits, API calls, storage, etc.).
 */
export type Item = {
  /**
   * The human-readable name of the item.
   */
  displayName: string,

  /**
   * The current quantity of the item. Can be negative for overdrafts.
   */
  quantity: number,

  /**
   * The quantity clamped to minimum 0. Useful for UI display where negative values don't make sense.
   */
  nonNegativeQuantity: number,
};

/**
 * Server-side item with quantity management methods.
 */
export type ServerItem = Item & {
  /**
   * Increases the item quantity by the specified amount.
   */
  increaseQuantity(amount: number): Promise<void>,

  /**
   * Decreases the item quantity by the specified amount.
   *
   * Note: Consider using tryDecreaseQuantity instead to prevent race conditions when going below 0.
   */
  decreaseQuantity(amount: number): Promise<void>,

  /**
   * Decreases the quantity by the specified amount only if the result would be non-negative.
   * Returns true if successful, false if it would result in negative quantity.
   *
   * Most useful for pre-paid credits to prevent overdrafts.
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

/**
 * Payment and item management functionality shared between users and teams.
 */
export type Customer<IsServer extends boolean = false> =
  & {
    /**
     * The unique identifier for the customer (user ID or team ID).
     */
    readonly id: string,

    /**
     * Creates a secure checkout URL for purchasing a product via Stripe.
     */
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
  } : {});
