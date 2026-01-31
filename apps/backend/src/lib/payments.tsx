import { getPrismaClientForTenancy, PrismaClientTransaction } from "@/prisma-client";
import { ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { PurchaseCreationSource, SubscriptionStatus } from "@/generated/prisma/client";
import { CustomerType } from "@/generated/prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import type { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import type { inlineProductSchema, productSchema, productSchemaWithMetadata } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { FAR_FUTURE_DATE, addInterval, getIntervalsElapsed } from "@stackframe/stack-shared/dist/utils/dates";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, getOrUndefined, has, typedEntries, typedFromEntries, typedKeys, typedValues } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import Stripe from "stripe";
import * as yup from "yup";
import { Tenancy } from "./tenancies";
import { getStripeForAccount } from "./stripe";

const DEFAULT_PRODUCT_START_DATE = new Date("1973-01-01T12:00:00.000Z"); // monday
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

type LedgerTransaction = {
  amount: number,
  grantTime: Date,
  expirationTime: Date,
};


function computeLedgerBalanceAtNow(transactions: LedgerTransaction[], now: Date): number {
  const grantedAt = new Map<number, number>();
  const expiredAt = new Map<number, number>();
  const usedAt = new Map<number, number>();
  const timeSet = new Set<number>();

  for (const t of transactions) {
    const grantTime = t.grantTime.getTime();
    if (t.grantTime <= now && t.amount < 0 && t.expirationTime > now) {
      usedAt.set(grantTime, (-1 * t.amount) + (usedAt.get(grantTime) ?? 0));
    }
    if (t.grantTime <= now && t.amount > 0) {
      grantedAt.set(grantTime, (grantedAt.get(grantTime) ?? 0) + t.amount);
    }
    if (t.expirationTime <= now && t.amount > 0) {
      const time2 = t.expirationTime.getTime();
      expiredAt.set(time2, (expiredAt.get(time2) ?? 0) + t.amount);
      timeSet.add(time2);
    }
    timeSet.add(grantTime);
  }
  const times = Array.from(timeSet.values()).sort((a, b) => a - b);
  if (times.length === 0) {
    return 0;
  }

  let grantedSum = 0;
  let expiredSum = 0;
  let usedSum = 0;
  let usedOrExpiredSum = 0;
  for (const t of times) {
    const g = grantedAt.get(t) ?? 0;
    const e = expiredAt.get(t) ?? 0;
    const u = usedAt.get(t) ?? 0;
    grantedSum += g;
    expiredSum += e;
    usedSum += u;
    usedOrExpiredSum = Math.max(usedOrExpiredSum + u, expiredSum);
  }
  return grantedSum - usedOrExpiredSum;
}

function addWhenRepeatedItemWindowTransactions(options: {
  baseQty: number,
  repeat: [number, 'day' | 'week' | 'month' | 'year'],
  anchor: Date,
  nowClamped: Date,
  hardEnd: Date | null,
}): LedgerTransaction[] {
  const { baseQty, repeat, anchor, nowClamped } = options;
  const endLimit = options.hardEnd ?? FAR_FUTURE_DATE;
  const finalNow = nowClamped < endLimit ? nowClamped : endLimit;
  if (finalNow < anchor) return [];

  const entries: LedgerTransaction[] = [];
  const elapsed = getIntervalsElapsed(anchor, finalNow, repeat);

  for (let i = 0; i <= elapsed; i++) {
    const windowStart = addInterval(new Date(anchor), [repeat[0] * i, repeat[1]]);
    const windowEnd = addInterval(new Date(windowStart), repeat);
    entries.push({ amount: baseQty, grantTime: windowStart, expirationTime: windowEnd });
  }

  return entries;
}

export async function getItemQuantityForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  itemId: string,
  customerId: string,
  customerType: "user" | "team" | "custom",
}) {
  const now = new Date();
  const transactions: LedgerTransaction[] = [];

  // Quantity changes → ledger entries
  const changes = await options.prisma.itemQuantityChange.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerId: options.customerId,
      itemId: options.itemId,
    },
    orderBy: { createdAt: "asc" },
  });
  for (const c of changes) {
    transactions.push({
      amount: c.quantity,
      grantTime: c.createdAt,
      expirationTime: c.expiresAt ?? FAR_FUTURE_DATE,
    });
  }
  const oneTimePurchases = await options.prisma.oneTimePurchase.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerId: options.customerId,
      customerType: typedToUppercase(options.customerType),
    },
  });
  for (const p of oneTimePurchases) {
    const product = p.product as yup.InferType<typeof productSchema>;
    const inc = getOrUndefined(product.includedItems, options.itemId);
    if (!inc) continue;
    const baseQty = inc.quantity * p.quantity;
    if (baseQty <= 0) continue;
    transactions.push({
      amount: baseQty,
      grantTime: p.createdAt,
      expirationTime: FAR_FUTURE_DATE,
    });
  }

  // Subscriptions → ledger entries
  const subscriptions = await getSubscriptions({
    prisma: options.prisma,
    tenancy: options.tenancy,
    customerType: options.customerType,
    customerId: options.customerId,
  });
  for (const s of subscriptions) {
    const product = s.product;
    const inc = getOrUndefined(product.includedItems, options.itemId);
    if (!inc) continue;
    const baseQty = inc.quantity * s.quantity;
    if (baseQty <= 0) continue;
    const pStart = s.currentPeriodStart;
    const pEnd = s.currentPeriodEnd ?? FAR_FUTURE_DATE;
    const nowClamped = now < pEnd ? now : pEnd;
    if (nowClamped < pStart) continue;

    if (!inc.repeat || inc.repeat === "never") {
      if (inc.expires === "when-purchase-expires") {
        transactions.push({ amount: baseQty, grantTime: pStart, expirationTime: pEnd });
      } else if (inc.expires === "when-repeated") {
        // repeat=never + expires=when-repeated → treat as no expiry
        transactions.push({ amount: baseQty, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
      } else {
        transactions.push({ amount: baseQty, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
      }
    } else {
      const repeat = inc.repeat;
      if (inc.expires === "when-purchase-expires") {
        const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
        const occurrences = elapsed + 1;
        const amount = occurrences * baseQty;
        transactions.push({ amount, grantTime: pStart, expirationTime: pEnd });
      } else if (inc.expires === "when-repeated") {
        const entries = addWhenRepeatedItemWindowTransactions({
          baseQty,
          repeat,
          anchor: s.createdAt,
          nowClamped,
          hardEnd: s.currentPeriodEnd,
        });
        transactions.push(...entries);
      } else {
        const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
        const occurrences = elapsed + 1;
        const amount = occurrences * baseQty;
        transactions.push({ amount, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
      }
    }
  }

  return computeLedgerBalanceAtNow(transactions, now);
}

type Subscription = {
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
  createdAt: Date,
};

export function isActiveSubscription(subscription: Subscription): boolean {
  return subscription.status === SubscriptionStatus.active || subscription.status === SubscriptionStatus.trialing;
}

export async function getSubscriptions(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  customerType: "user" | "team" | "custom",
  customerId: string,
}) {
  const productLines = options.tenancy.config.payments.productLines;
  const products = options.tenancy.config.payments.products;
  const subscriptions: Subscription[] = [];
  const dbSubscriptions = await options.prisma.subscription.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerType: typedToUppercase(options.customerType),
      customerId: options.customerId,
    },
  });

  const productLinesWithDbSubscriptions = new Set<string>();
  for (const s of dbSubscriptions) {
    const product = s.product as yup.InferType<typeof productSchema>;
    const subscription: Subscription = {
      id: s.id,
      productId: s.productId,
      product,
      quantity: s.quantity,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      status: s.status,
      createdAt: s.createdAt,
      stripeSubscriptionId: s.stripeSubscriptionId,
    };
    subscriptions.push(subscription);
    if (product.productLineId !== undefined && isActiveSubscription(subscription)) {
      productLinesWithDbSubscriptions.add(product.productLineId);
    }
  }

  for (const productLineId of Object.keys(productLines)) {
    if (productLinesWithDbSubscriptions.has(productLineId)) continue;
    const productsInProductLine = typedEntries(products).filter(([_, product]) => (
      product.productLineId === productLineId && product.customerType === options.customerType
    ));
    const defaultProductLineProducts = productsInProductLine.filter(([_, product]) => product.prices === "include-by-default");
    if (defaultProductLineProducts.length > 1) {
      throw new StackAssertionError(
        "Multiple include-by-default products configured in the same product line",
        { productLineId, productIds: defaultProductLineProducts.map(([id]) => id) },
      );
    }
    if (defaultProductLineProducts.length > 0) {
      const product = defaultProductLineProducts[0];
      subscriptions.push({
        id: null,
        productId: product[0],
        product: product[1],
        quantity: 1,
        currentPeriodStart: DEFAULT_PRODUCT_START_DATE,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        status: SubscriptionStatus.active,
        createdAt: DEFAULT_PRODUCT_START_DATE,
        stripeSubscriptionId: null,
      });
    }
  }

  const ungroupedDefaults = typedEntries(products).filter(([id, product]) => (
    product.productLineId === undefined &&
    product.prices === "include-by-default" &&
    product.customerType === options.customerType &&
    !subscriptions.some((s) => s.productId === id)
  ));
  for (const [productId, product] of ungroupedDefaults) {
    subscriptions.push({
      id: null,
      productId,
      product,
      quantity: 1,
      currentPeriodStart: DEFAULT_PRODUCT_START_DATE,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      status: SubscriptionStatus.active,
      createdAt: DEFAULT_PRODUCT_START_DATE,
      stripeSubscriptionId: null,
    });
  }

  return subscriptions;
}

export async function getCustomerPurchaseContext(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  customerType: "user" | "team" | "custom",
  customerId: string,
  productId?: string,
}) {
  const existingOneTimePurchases = await options.prisma.oneTimePurchase.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerId: options.customerId,
      customerType: typedToUppercase(options.customerType),
    },
  });

  const subscriptions = await getSubscriptions({
    prisma: options.prisma,
    tenancy: options.tenancy,
    customerType: options.customerType,
    customerId: options.customerId,
  });

  const alreadyOwnsProduct = options.productId
    ? [...subscriptions, ...existingOneTimePurchases].some((p) => p.productId === options.productId)
    : false;

  return { existingOneTimePurchases, subscriptions, alreadyOwnsProduct };
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
  productLineId: string | undefined,
  subscriptions: Subscription[],
  conflictingProductLineSubscriptions: Subscription[],
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

  const { existingOneTimePurchases, subscriptions, alreadyOwnsProduct } = await getCustomerPurchaseContext({
    prisma,
    tenancy,
    customerType: product.customerType,
    customerId: codeData.customerId,
    productId: codeData.productId,
  });

  if (codeData.productId && product.stackable !== true && alreadyOwnsProduct) {
    throw new KnownErrors.ProductAlreadyGranted(codeData.productId, codeData.customerId);
  }
  const addOnProductIds = product.isAddOnTo ? typedKeys(product.isAddOnTo) : [];
  if (product.isAddOnTo && !subscriptions.some((s) => s.productId && addOnProductIds.includes(s.productId))) {
    throw new StatusError(400, "This product is an add-on to a product that the customer does not have");
  }

  const productLines = tenancy.config.payments.productLines;
  const productLineId = typedKeys(productLines).find((g) => product.productLineId === g);

  // Block purchasing any product in the same product line if a one-time purchase exists in that product line
  if (productLineId) {
    const hasOneTimeInProductLine = existingOneTimePurchases.some((p) => {
      const product = p.product as yup.InferType<typeof productSchema>;
      return product.productLineId === productLineId;
    });
    if (hasOneTimeInProductLine) {
      throw new StatusError(400, "Customer already has a one-time purchase in this product line");
    }
  }

  let conflictingProductLineSubscriptions: Subscription[] = [];
  if (productLineId) {
    conflictingProductLineSubscriptions = subscriptions.filter((subscription) => (
      subscription.id &&
      subscription.productId &&
      subscription.product.productLineId === productLineId &&
      isActiveSubscription(subscription) &&
      subscription.product.prices !== "include-by-default" &&
      (!product.isAddOnTo || !addOnProductIds.includes(subscription.productId))
    ));
  }

  return { selectedPrice, productLineId, subscriptions, conflictingProductLineSubscriptions };
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
  const { selectedPrice, conflictingProductLineSubscriptions } = await validatePurchaseSession({
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

  if (conflictingProductLineSubscriptions.length > 0) {
    const conflicting = conflictingProductLineSubscriptions[0];
    if (conflicting.stripeSubscriptionId) {
      const stripe = await getStripeForAccount({ tenancy });
      await stripe.subscriptions.cancel(conflicting.stripeSubscriptionId);
    } else if (conflicting.id) {
      await prisma.subscription.update({
        where: {
          tenancyId_id: {
            tenancyId: tenancy.id,
            id: conflicting.id,
          },
        },
        data: {
          status: SubscriptionStatus.canceled,
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: true,
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
  type: "one_time" | "subscription",
  quantity: number,
  product: Product,
  createdAt: Date,
  sourceId: string,
  subscription: null | {
    currentPeriodEnd: Date | null,
    cancelAtPeriodEnd: boolean,
    isCancelable: boolean,
  },
};

export async function getOwnedProductsForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  customerType: "user" | "team" | "custom",
  customerId: string,
}): Promise<OwnedProduct[]> {
  await ensureCustomerExists({
    prisma: options.prisma,
    tenancyId: options.tenancy.id,
    customerType: options.customerType,
    customerId: options.customerId,
  });

  const [subscriptions, oneTimePurchases] = await Promise.all([
    getSubscriptions({
      prisma: options.prisma,
      tenancy: options.tenancy,
      customerType: options.customerType,
      customerId: options.customerId,
    }),
    options.prisma.oneTimePurchase.findMany({
      where: {
        tenancyId: options.tenancy.id,
        customerId: options.customerId,
        customerType: typedToUppercase(options.customerType),
        refundedAt: null,
      },
    }),
  ]);

  const ownedProducts: OwnedProduct[] = [];

  for (const subscription of subscriptions) {
    if (!isActiveSubscription(subscription)) continue;
    const sourceId = subscription.id ?? subscription.productId;
    if (!sourceId) {
      throw new StackAssertionError("Subscription is missing both id and productId", { subscription });
    }
    ownedProducts.push({
      id: subscription.productId,
      type: "subscription",
      quantity: subscription.quantity,
      product: subscription.product,
      createdAt: subscription.createdAt,
      sourceId,
      subscription: {
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        isCancelable: subscription.id !== null && subscription.productId !== null,
      },
    });
  }

  for (const purchase of oneTimePurchases) {
    const product = purchase.product as ProductWithMetadata;
    ownedProducts.push({
      id: purchase.productId ?? null,
      type: "one_time",
      quantity: purchase.quantity,
      product,
      createdAt: purchase.createdAt,
      sourceId: purchase.id,
      subscription: null,
    });
  }

  return ownedProducts;
}
