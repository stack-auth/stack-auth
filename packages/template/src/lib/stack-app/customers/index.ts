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
  type: "one_time" | "subscription",
  subscription: null | {
    subscriptionId: string | null,
    currentPeriodEnd: Date | null,
    cancelAtPeriodEnd: boolean,
    isCancelable: boolean,
  },
  switchOptions?: Array<{
    productId: string,
    displayName: string,
    prices: InlineProduct["prices"],
  }>,
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

export type CustomerInvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void" | null;

export type CustomerInvoice = {
  createdAt: Date,
  status: CustomerInvoiceStatus,
  amountTotal: number,
  hostedInvoiceUrl: string | null,
};

export type CustomerInvoicesList = CustomerInvoice[] & {
  nextCursor: string | null,
};

export type CustomerInvoicesListOptions = {
  cursor?: string,
  limit?: number,
};

export type CustomerInvoicesRequestOptions =
  | ({ userId: string } & CustomerInvoicesListOptions)
  | ({ teamId: string } & CustomerInvoicesListOptions);

export type CustomerDefaultPaymentMethod = {
  id: string,
  brand: string | null,
  last4: string | null,
  exp_month: number | null,
  exp_year: number | null,
} | null;

export type CustomerBilling = {
  hasCustomer: boolean,
  defaultPaymentMethod: CustomerDefaultPaymentMethod,
};

export type CustomerPaymentMethodSetupIntent = {
  clientSecret: string,
  stripeAccountId: string,
};

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

    createPaymentMethodSetupIntent(): Promise<CustomerPaymentMethodSetupIntent>,

    setDefaultPaymentMethodFromSetupIntent(setupIntentId: string): Promise<CustomerDefaultPaymentMethod>,

    switchSubscription(options: { fromProductId: string, toProductId: string, priceId?: string, quantity?: number }): Promise<void>,
  }
  & AsyncStoreProperty<
    "billing",
    [],
    CustomerBilling,
    false
  >
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
  & AsyncStoreProperty<
    "invoices",
    [options?: CustomerInvoicesListOptions],
    CustomerInvoicesList,
    true
  >
  & (IsServer extends true ? {
    grantProduct(
      product: { productId: string, quantity?: number } | { product: InlineProduct, quantity?: number },
    ): Promise<void>,
  } : {});
