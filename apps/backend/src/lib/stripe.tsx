import { getTenancy, Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { CustomerType } from "@/generated/prisma/client";
import { typedIncludes } from "@stackframe/stack-shared/dist/utils/arrays";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";
import { createStripeProxy, type StripeOverridesMap } from "./stripe-proxy";
import { InputJsonValue } from "@prisma/client/runtime/client";

const stripeSecretKey = getEnvVariable("STACK_STRIPE_SECRET_KEY", "");
const useStripeMock = stripeSecretKey === "sk_test_mockstripekey" && ["development", "test"].includes(getNodeEnvironment());
const stackPortPrefix = getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81");
const stripeConfig: Stripe.StripeConfig = useStripeMock ? {
  protocol: "http",
  host: "localhost",
  port: Number(`${stackPortPrefix}23`),
} : {};

export const getStackStripe = (overrides?: StripeOverridesMap) => {
  if (!stripeSecretKey) {
    throw new StackAssertionError("STACK_STRIPE_SECRET_KEY environment variable is not set");
  }
  if (overrides && !useStripeMock) {
    throw new StackAssertionError("Stripe overrides are not supported in production");
  }
  return createStripeProxy(new Stripe(stripeSecretKey, stripeConfig), overrides);
};

export const getStripeForAccount = async (options: { tenancy?: Tenancy, accountId?: string }, overrides?: StripeOverridesMap) => {
  if (!stripeSecretKey) {
    throw new StackAssertionError("STACK_STRIPE_SECRET_KEY environment variable is not set");
  }
  if (overrides && !useStripeMock) {
    throw new StackAssertionError("Stripe overrides are not supported in production");
  }
  if (!options.tenancy && !options.accountId) {
    throwErr(400, "Either tenancy or stripeAccountId must be provided");
  }

  let accountId = options.accountId;

  if (!accountId && options.tenancy) {
    const project = await globalPrismaClient.project.findUnique({
      where: { id: options.tenancy.project.id },
      select: { stripeAccountId: true },
    });
    accountId = project?.stripeAccountId || undefined;
  }

  if (!accountId) {
    throwErr(400, "Payments are not set up in this Stack Auth project. Please go to the Stack Auth dashboard and complete the Payments onboarding.");
  }
  return createStripeProxy(new Stripe(stripeSecretKey, { stripeAccount: accountId, ...stripeConfig }), overrides);
};

const getTenancyFromStripeAccountIdOrThrow = async (stripe: Stripe, stripeAccountId: string) => {
  const account = await stripe.accounts.retrieve(stripeAccountId);
  if (!account.metadata?.tenancyId || typeof account.metadata.tenancyId !== "string") {
    throw new StackAssertionError("Stripe account metadata missing tenancyId", { accountId: stripeAccountId });
  }
  const tenancy = await getTenancy(account.metadata.tenancyId);
  if (!tenancy) {
    throw new StackAssertionError("Tenancy not found", { accountId: stripeAccountId });
  }
  return tenancy;
};

export async function syncStripeSubscriptions(stripe: Stripe, stripeAccountId: string, stripeCustomerId: string) {
  const tenancy = await getTenancyFromStripeAccountIdOrThrow(stripe, stripeAccountId);
  const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId);
  if (stripeCustomer.deleted) {
    return;
  }
  const customerId = stripeCustomer.metadata.customerId;
  const customerType = stripeCustomer.metadata.customerType;
  if (!customerId || !customerType) {
    throw new StackAssertionError("Stripe customer metadata missing customerId or customerType");
  }
  if (!typedIncludes(Object.values(CustomerType), customerType)) {
    throw new StackAssertionError("Stripe customer metadata has invalid customerType");
  }
  const prisma = await getPrismaClientForTenancy(tenancy);
  const subscriptions = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
  });

  // TODO: handle in parallel, store payment method?
  for (const subscription of subscriptions.data) {
    if (subscription.items.data.length === 0) {
      continue;
    }
    const item = subscription.items.data[0];
    const priceId = subscription.metadata.priceId as string | undefined;
    // old subscriptions were created with offer metadata instead of product metadata
    const productString = subscription.metadata.product as string | undefined ?? subscription.metadata.offer as string | undefined;
    if (!productString) {
      throw new StackAssertionError("Stripe subscription metadata missing product or offer", { subscriptionId: subscription.id });
    }
    let productJson: InputJsonValue;
    try {
      productJson = JSON.parse(productString);
    } catch (error) {
      throw new StackAssertionError("Invalid JSON in Stripe subscription metadata", { subscriptionId: subscription.id, productString, error });
    }

    await prisma.subscription.upsert({
      where: {
        tenancyId_stripeSubscriptionId: {
          tenancyId: tenancy.id,
          stripeSubscriptionId: subscription.id,
        },
      },
      update: {
        status: subscription.status,
        product: productJson,
        quantity: item.quantity ?? 1,
        currentPeriodEnd: new Date(item.current_period_end * 1000),
        currentPeriodStart: new Date(item.current_period_start * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        priceId: priceId ?? null,
      },
      create: {
        tenancyId: tenancy.id,
        customerId,
        customerType,
        productId: subscription.metadata.productId as string | undefined ?? subscription.metadata.offerId,
        priceId: priceId ?? null,
        product: productJson,
        quantity: item.quantity ?? 1,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(item.current_period_end * 1000),
        currentPeriodStart: new Date(item.current_period_start * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        creationSource: "PURCHASE_PAGE"
      },
    });
  }
}

export async function upsertStripeInvoice(stripe: Stripe, stripeAccountId: string, invoice: Stripe.Invoice) {
  const invoiceLines = (invoice as { lines?: { data?: Stripe.InvoiceLineItem[] } }).lines?.data ?? [];
  const invoiceSubscriptionIds = invoiceLines
    .map((line) => line.parent?.subscription_item_details?.subscription)
    .filter((subscription): subscription is string => !!subscription);
  if (invoiceSubscriptionIds.length === 0 || !invoice.id) {
    return;
  }
  if (invoiceSubscriptionIds.length > 1) {
    throw new StackAssertionError(
      "Multiple subscription line items found in single invoice",
      { stripeAccountId, invoiceId: invoice.id }
    );
  }

  const stripeSubscriptionId = invoiceSubscriptionIds[0];
  const isSubscriptionCreationInvoice = invoice.billing_reason === "subscription_create";
  const tenancy = await getTenancyFromStripeAccountIdOrThrow(stripe, stripeAccountId);
  const prisma = await getPrismaClientForTenancy(tenancy);

  await prisma.subscriptionInvoice.upsert({
    where: {
      tenancyId_stripeInvoiceId: {
        tenancyId: tenancy.id,
        stripeInvoiceId: invoice.id,
      },
    },
    update: {
      stripeSubscriptionId,
      isSubscriptionCreationInvoice,
      status: invoice.status,
      amountTotal: invoice.total,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
    },
    create: {
      tenancyId: tenancy.id,
      stripeSubscriptionId,
      stripeInvoiceId: invoice.id,
      isSubscriptionCreationInvoice,
      status: invoice.status,
      amountTotal: invoice.total,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
    },
  });
}
