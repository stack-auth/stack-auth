import { CustomerType, PurchaseCreationSource, SubscriptionStatus } from "@/generated/prisma/client";
import { ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getPrismaClientForTenancy, PrismaClientTransaction } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import type { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import type { inlineProductSchema, productSchema, productSchemaWithMetadata } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { addInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, getOrUndefined, has, typedEntries, typedFromEntries, typedKeys, typedValues } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import Stripe from "stripe";
import * as yup from "yup";
import { getStripeForAccount } from "../stripe";
import { Tenancy } from "../tenancies";
import { getOwnedProductsForCustomer } from "./ledger";

const stripeSecretKey = getEnvVariable("STACK_STRIPE_SECRET_KEY", "");
const useStripeMock = stripeSecretKey === "sk_test_mockstripekey" && ["development", "test"].includes(getNodeEnvironment());

type Product = yup.InferType<typeof productSchema>;
type ProductWithMetadata = yup.InferType<typeof productSchemaWithMetadata>;
type SelectedPrice = Exclude<Product["prices"], "include-by-default">[string];

export async function ensureClientCanAccessCustomer(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  user: UsersCrud["Admin"]["Read"] | undefined,
  tenancy: Tenancy,
  forbiddenMessage: string,
}): Promise<void> {
  const currentUser = options.user;
  if (!currentUser) {
    throw new KnownErrors.UserAuthenticationRequired();
  }
  if (options.customerType === "custom") {
    throw new StatusError(StatusError.Forbidden, options.forbiddenMessage);
  }
  if (options.customerType === "user") {
    if (options.customerId !== currentUser.id) {
      throw new StatusError(StatusError.Forbidden, options.forbiddenMessage);
    }
    return;
  }

  const prisma = await getPrismaClientForTenancy(options.tenancy);
  await ensureUserTeamPermissionExists(prisma, {
    tenancy: options.tenancy,
    teamId: options.customerId,
    userId: currentUser.id,
    permissionId: "team_admin",
    errorType: "required",
    recursive: true,
  });
}

export async function ensureProductIdOrInlineProduct(
  tenancy: Tenancy,
  accessType: "client" | "server" | "admin",
  productId: string | undefined,
  inlineProduct: yup.InferType<typeof inlineProductSchema> | undefined
): Promise<ProductWithMetadata> {
  if (productId && inlineProduct) {
    throw new StatusError(400, "Cannot specify both product_id and product_inline!");
  }
  if (inlineProduct && accessType === "client") {
    throw new StatusError(400, "Cannot specify product_inline when calling from client! Please call with a server API key, or use the product_id parameter.");
  }
  if (!productId && !inlineProduct) {
    throw new StatusError(400, "Must specify either product_id or product_inline!");
  }
  if (productId) {
    const product = getOrUndefined(tenancy.config.payments.products, productId);
    if (!product) {
      const itemExists = has(tenancy.config.payments.items, productId);
      throw new KnownErrors.ProductDoesNotExist(productId, itemExists ? "item_exists" : null);
    }
    if (product.serverOnly && accessType === "client") {
      throw new KnownErrors.ProductDoesNotExist(productId, "server_only");
    }
    return product;
  } else {
    if (!inlineProduct) {
      throw new StackAssertionError("Inline product does not exist, this should never happen", { inlineProduct, productId });
    }
    return {
      productLineId: undefined,
      isAddOnTo: false,
      displayName: inlineProduct.display_name,
      customerType: inlineProduct.customer_type,
      freeTrial: inlineProduct.free_trial,
      serverOnly: inlineProduct.server_only,
      stackable: false,
      prices: Object.fromEntries(Object.entries(inlineProduct.prices).map(([key, value]) => [key, {
        ...typedFromEntries(SUPPORTED_CURRENCIES.map(c => [c.code, getOrUndefined(value, c.code)])),
        interval: value.interval,
        freeTrial: value.free_trial,
        serverOnly: true,
      }])),
      clientMetadata: inlineProduct.client_metadata ?? undefined,
      clientReadOnlyMetadata: inlineProduct.client_read_only_metadata ?? undefined,
      serverMetadata: inlineProduct.server_metadata ?? undefined,
      includedItems: typedFromEntries(Object.entries(inlineProduct.included_items).map(([key, value]) => [key, {
        repeat: value.repeat ?? "never",
        quantity: value.quantity ?? 0,
        expires: value.expires ?? "never",
      }])),
    };
  }
}

export type Subscription = {
  /**
   * `null` for default subscriptions
   */
  id: string | null,
  /**
   * `null` for inline products
   */
  productId: string | null,
  /**
   * `null` for test mode purchases and product line default products
   */
  stripeSubscriptionId: string | null,
  product: yup.InferType<typeof productSchema>,
  quantity: number,
  currentPeriodStart: Date,
  currentPeriodEnd: Date | null,
  cancelAtPeriodEnd: boolean,
  status: SubscriptionStatus,
  /**
   * When the subscription truly ended (from Stripe's `ended_at`).
   * `null` means the subscription has not ended yet.
   */
  endedAt: Date | null,
  createdAt: Date,
};

export type PurchaseContext = {
  ownedProducts: OwnedProduct[],
  alreadyOwnsProduct: boolean,
  productLineId: string | undefined,
  conflictingProducts: OwnedProduct[],
};

/**
 * Analyzes a customer's current product ownership and identifies conflicts for a
 * potential new purchase. This is the shared analysis layer:
 *
 * - `validate-code` uses it to return soft info to the UI (no throwing).
 * - `validatePurchaseSession` uses it to enforce rules (throws on violations).
 */
export async function getPurchaseContext(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  customerType: "user" | "team" | "custom",
  customerId: string,
  product: Product,
  productId?: string,
}): Promise<PurchaseContext> {
  const ownedProducts = await getOwnedProductsForCustomer({
    prisma: options.prisma,
    tenancy: options.tenancy,
    customerType: options.customerType,
    customerId: options.customerId,
  });

  const alreadyOwnsProduct = options.productId
    ? ownedProducts.some((p) => p.id !== null && p.id === options.productId)
    : false;

  const productLines = options.tenancy.config.payments.productLines;
  const productLineId = typedKeys(productLines).find((g) => options.product.productLineId === g);
  const addOnProductIds = options.product.isAddOnTo ? typedKeys(options.product.isAddOnTo) : [];

  let conflictingProducts: OwnedProduct[] = [];
  if (productLineId) {
    conflictingProducts = ownedProducts.filter((owned) => (
      owned.id &&
      owned.product.product_line_id === productLineId &&
      owned.type !== "include-by-default" &&
      (!options.product.isAddOnTo || !addOnProductIds.includes(owned.id))
    ));
  }

  return { ownedProducts, alreadyOwnsProduct, productLineId, conflictingProducts };
}

export async function ensureCustomerExists(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
}) {
  if (options.customerType === "user") {
    if (!isUuid(options.customerId)) {
      throw new KnownErrors.UserNotFound();
    }
    const user = await options.prisma.projectUser.findUnique({
      where: {
        tenancyId_projectUserId: {
          tenancyId: options.tenancyId,
          projectUserId: options.customerId,
        },
      },
    });
    if (!user) {
      throw new KnownErrors.UserNotFound();
    }
  } else if (options.customerType === "team") {
    if (!isUuid(options.customerId)) {
      throw new KnownErrors.TeamNotFound(options.customerId);
    }
    const team = await options.prisma.team.findUnique({
      where: {
        tenancyId_teamId: {
          tenancyId: options.tenancyId,
          teamId: options.customerId,
        },
      },
    });
    if (!team) {
      throw new KnownErrors.TeamNotFound(options.customerId);
    }
  }
}

function customerTypeToStripeCustomerType(customerType: "user" | "team") {
  return customerType === "user" ? CustomerType.USER : CustomerType.TEAM;
}

export async function getStripeCustomerForCustomerOrNull(options: {
  stripe: Stripe,
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: "user" | "team",
  customerId: string,
}): Promise<Stripe.Customer | null> {
  await ensureCustomerExists({
    prisma: options.prisma,
    tenancyId: options.tenancyId,
    customerType: options.customerType,
    customerId: options.customerId,
  });

  const stripeCustomerType = customerTypeToStripeCustomerType(options.customerType);
  const matchesCustomer = (customer: Stripe.Customer) => {
    const storedType = customer.metadata.customerType;
    if (!storedType) return true;
    return storedType === stripeCustomerType;
  };

  const stripeCustomerSearch = await options.stripe.customers.search({
    query: `metadata['customerId']:'${options.customerId}'`,
  });
  let matches = stripeCustomerSearch.data.filter(matchesCustomer);

  if (matches.length === 0) {
    // Stripe's search is eventually consistent; fall back to listing to ensure we can find a newly created customer.
    let startingAfter: string | undefined = undefined;
    for (let i = 0; i < 10; i++) {
      const page: Stripe.ApiList<Stripe.Customer> = await options.stripe.customers.list({
        limit: 100,
        ...startingAfter ? { starting_after: startingAfter } : {},
      });
      const exactMatches = page.data.filter((customer) => (
        customer.metadata.customerId === options.customerId && matchesCustomer(customer)
      ));
      if (exactMatches.length > 0) {
        matches = exactMatches;
        break;
      }
      if (useStripeMock && page.data.length > 0) {
        matches = [page.data[0]];
        break;
      }
      if (!page.has_more || page.data.length === 0) {
        break;
      }
      startingAfter = page.data[page.data.length - 1].id;
    }
  }

  if (matches.length > 1) {
    throw new StackAssertionError("Multiple Stripe customers found for customerId; customerType filtering was ambiguous", {
      customerId: options.customerId,
      customerType: options.customerType,
      stripeCustomerIds: matches.map((c) => c.id),
    });
  }
  return matches[0] ?? null;
}

export async function ensureStripeCustomerForCustomer(options: {
  stripe: Stripe,
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: "user" | "team",
  customerId: string,
}): Promise<Stripe.Customer> {
  const existing = await getStripeCustomerForCustomerOrNull(options);
  if (existing) {
    return existing;
  }
  const stripeCustomerType = customerTypeToStripeCustomerType(options.customerType);
  return await options.stripe.customers.create({
    metadata: {
      customerId: options.customerId,
      customerType: stripeCustomerType,
    },
  });
}

export type StripeCardPaymentMethodSummary = {
  id: string,
  brand: string | null,
  last4: string | null,
  exp_month: number | null,
  exp_year: number | null,
};

export async function getDefaultCardPaymentMethodSummary(options: {
  stripe: Stripe,
  stripeCustomer: Stripe.Customer,
}): Promise<StripeCardPaymentMethodSummary | null> {
  const paymentMethods = await options.stripe.customers.listPaymentMethods(
    options.stripeCustomer.id,
    { type: "card", limit: 1 }
  );
  if (paymentMethods.data.length === 0) {
    return null;
  }
  return {
    id: paymentMethods.data[0].id,
    brand: paymentMethods.data[0].card?.brand ?? null,
    last4: paymentMethods.data[0].card?.last4 ?? null,
    exp_month: paymentMethods.data[0].card?.exp_month ?? null,
    exp_year: paymentMethods.data[0].card?.exp_year ?? null,
  };
}

export function productToInlineProduct(product: ProductWithMetadata): yup.InferType<typeof inlineProductSchema> {
  return {
    display_name: product.displayName ?? "Product",
    customer_type: product.customerType,
    product_line_id: product.productLineId,
    stackable: product.stackable === true,
    server_only: product.serverOnly === true,
    included_items: product.includedItems,
    client_metadata: product.clientMetadata ?? null,
    client_read_only_metadata: product.clientReadOnlyMetadata ?? null,
    server_metadata: product.serverMetadata ?? null,
    prices: product.prices === "include-by-default" ? {} : typedFromEntries(typedEntries(product.prices).map(([key, value]) => [key, filterUndefined({
      ...typedFromEntries(SUPPORTED_CURRENCIES.map(c => [c.code, getOrUndefined(value, c.code)])),
      interval: value.interval,
      free_trial: value.freeTrial,
    })])),
  };
}

/**
 * Validates a purchase attempt: resolves prices, enforces business rules (throws
 * on violations), and returns the purchase context for the caller to act on.
 *
 * Called by `purchase-session` and `grantProductToCustomer` before creating
 * Stripe sessions or DB records. For a non-throwing version that just returns
 * info for the UI, use `getPurchaseContext` directly.
 */
export async function validatePurchaseSession(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  codeData: {
    tenancyId: string,
    customerId: string,
    productId?: string,
    product: Product,
  },
  priceId: string | undefined,
  quantity: number,
}): Promise<{
  selectedPrice: SelectedPrice | undefined,
  purchaseContext: PurchaseContext,
}> {
  const { prisma, tenancy, codeData, priceId, quantity } = options;
  const product = codeData.product;
  await ensureCustomerExists({
    prisma,
    tenancyId: tenancy.id,
    customerType: product.customerType,
    customerId: codeData.customerId,
  });

  let selectedPrice: SelectedPrice | undefined = undefined;
  if (!priceId && product.prices !== "include-by-default") {
    selectedPrice = typedValues(product.prices)[0];
  }
  if (priceId && product.prices !== "include-by-default") {
    const pricesMap = new Map(typedEntries(product.prices));
    selectedPrice = pricesMap.get(priceId);
    if (!selectedPrice) {
      throw new StatusError(400, "Price not found on product associated with this purchase code");
    }
  }
  if (quantity !== 1 && product.stackable !== true) {
    throw new StatusError(400, "This product is not stackable; quantity must be 1");
  }

  const purchaseContext = await getPurchaseContext({
    prisma,
    tenancy,
    customerType: product.customerType,
    customerId: codeData.customerId,
    product,
    productId: codeData.productId,
  });

  if (codeData.productId && product.stackable !== true && purchaseContext.alreadyOwnsProduct) {
    throw new KnownErrors.ProductAlreadyGranted(codeData.productId, codeData.customerId);
  }
  const addOnProductIds = product.isAddOnTo ? typedKeys(product.isAddOnTo) : [];
  if (product.isAddOnTo && !purchaseContext.ownedProducts.some((p) => p.id !== null && addOnProductIds.includes(p.id))) {
    throw new StatusError(400, "This product is an add-on to a product that the customer does not have");
  }

  if (purchaseContext.productLineId) {
    const hasOneTimeInProductLine = purchaseContext.conflictingProducts.some((p) => p.type === "one_time");
    if (hasOneTimeInProductLine) {
      throw new StatusError(400, "Customer already has a one-time purchase in this product line");
    }
  }

  return { selectedPrice, purchaseContext };
}

export function getClientSecretFromStripeSubscription(subscription: Stripe.Subscription): string {
  const latestInvoice = subscription.latest_invoice;
  if (latestInvoice && typeof latestInvoice !== "string") {
    type InvoiceWithExtras = Stripe.Invoice & {
      confirmation_secret?: { client_secret?: string },
      payment_intent?: string | (Stripe.PaymentIntent & { client_secret?: string }) | null,
    };
    const invoice = latestInvoice as InvoiceWithExtras;
    const confirmationSecret = invoice.confirmation_secret?.client_secret;
    const piSecret = typeof invoice.payment_intent !== "string" ? invoice.payment_intent?.client_secret : undefined;
    if (typeof confirmationSecret === "string") return confirmationSecret;
    if (typeof piSecret === "string") return piSecret;
  }
  throwErr(500, "No client secret returned from Stripe for subscription");
}

type GrantProductResult =
  | {
    type: "one_time",
    purchaseId: string | null,
  }
  | {
    type: "subscription",
    subscriptionId: string,
  };

export async function grantProductToCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  customerType: "user" | "team" | "custom",
  customerId: string,
  product: ProductWithMetadata,
  quantity: number,
  productId: string | undefined,
  priceId: string | undefined,
  creationSource: PurchaseCreationSource,
}): Promise<GrantProductResult> {
  const { prisma, tenancy, customerId, customerType, product, productId, priceId, quantity, creationSource } = options;
  const { selectedPrice, purchaseContext } = await validatePurchaseSession({
    prisma,
    tenancy,
    codeData: {
      tenancyId: tenancy.id,
      customerId,
      productId,
      product,
    },
    priceId,
    quantity,
  });

  const conflictingSubscriptions = purchaseContext.conflictingProducts.filter((p) => p.type === "subscription");
  if (conflictingSubscriptions.length > 0) {
    const conflicting = conflictingSubscriptions[0];
    if (conflicting.subscription?.stripeSubscriptionId) {
      const stripe = await getStripeForAccount({ tenancy });
      await stripe.subscriptions.cancel(conflicting.subscription.stripeSubscriptionId);
    } else {
      await prisma.subscription.update({
        where: {
          tenancyId_id: {
            tenancyId: tenancy.id,
            id: conflicting.sourceId,
          },
        },
        data: {
          status: SubscriptionStatus.canceled,
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: true,
          endedAt: new Date(),
        },
      });
    }
  }

  if (!selectedPrice) {
    return { type: "one_time", purchaseId: null };
  }

  if (!selectedPrice.interval) {
    const purchase = await prisma.oneTimePurchase.create({
      data: {
        tenancyId: tenancy.id,
        customerId,
        customerType: typedToUppercase(customerType),
        productId,
        priceId,
        product,
        quantity,
        creationSource,
      },
    });
    return { type: "one_time", purchaseId: purchase.id };
  }

  const subscription = await prisma.subscription.create({
    data: {
      tenancyId: tenancy.id,
      customerId,
      customerType: typedToUppercase(customerType),
      status: "active",
      productId,
      priceId,
      product,
      quantity,
      currentPeriodStart: new Date(),
      currentPeriodEnd: addInterval(new Date(), selectedPrice.interval!),
      cancelAtPeriodEnd: false,
      creationSource,
    },
  });

  return { type: "subscription", subscriptionId: subscription.id };
}

export type OwnedProduct = {
  id: string | null,
  type: "one_time" | "subscription" | "include-by-default",
  quantity: number,
  product: yup.InferType<typeof inlineProductSchema>,
  createdAt: Date,
  sourceId: string,
  subscription: null | {
    stripeSubscriptionId: string | null,
    currentPeriodEnd: Date | null,
    cancelAtPeriodEnd: boolean,
    isCancelable: boolean,
  },
};
