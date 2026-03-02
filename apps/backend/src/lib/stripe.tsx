import { CustomerType } from "@/generated/prisma/client";
import { getProductVersion } from "@/lib/product-versions";
import { getTenancy, Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { InputJsonValue } from "@prisma/client/runtime/client";
import { typedIncludes } from "@stackframe/stack-shared/dist/utils/arrays";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";
import { createStripeProxy, type StripeOverridesMap } from "./stripe-proxy";

const stripeSecretKey = getEnvVariable("STACK_STRIPE_SECRET_KEY", "");
const useStripeMock = stripeSecretKey === "sk_test_mockstripekey" && ["development", "test"].includes(getNodeEnvironment());
const stackPortPrefix = getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81");
const stripeConfig: Stripe.StripeConfig = useStripeMock ? {
  protocol: "http",
  host: "localhost",
  port: Number(`${stackPortPrefix}23`),
} : {};

/**
 * Sanitizes subscription period dates from Stripe.
 *
 * The Stripe mock returns hardcoded fixture dates that are invalid (e.g., start in 2030, end in 2000).
 * This function detects invalid dates and replaces them with sensible defaults.
 *
 * @param startTimestamp - Unix timestamp in seconds for period start
 * @param endTimestamp - Unix timestamp in seconds for period end
 * @param intervalMonths - Billing interval in months (default: 1)
 * @returns Sanitized Date objects for start and end
 */
export function sanitizeStripePeriodDates(
  startTimestamp: number,
  endTimestamp: number,
  intervalMonths: number = 1
): { start: Date, end: Date } {
  const now = new Date();
  const startDate = new Date(startTimestamp * 1000);
  const endDate = new Date(endTimestamp * 1000);

  const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
  const isStartValid = startDate.getTime() > 0 && Math.abs(startDate.getTime() - now.getTime()) < tenYearsMs;
  const isEndValid = endDate.getTime() > 0 && Math.abs(endDate.getTime() - now.getTime()) < tenYearsMs;
  const isOrderValid = startDate < endDate;

  if (isStartValid && isEndValid && isOrderValid) {
    return { start: startDate, end: endDate };
  }

  // Dates are invalid (likely from Stripe mock), use sensible defaults
  const defaultStart = now;
  const defaultEnd = new Date(now);
  defaultEnd.setMonth(defaultEnd.getMonth() + intervalMonths);

  return { start: defaultStart, end: defaultEnd };
}

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
    const sanitizedDates = sanitizeStripePeriodDates(item.current_period_start, item.current_period_end);
    const priceId = subscription.metadata.priceId as string | undefined;

    let productJson: InputJsonValue;
    const productVersionId = subscription.metadata.productVersionId as string | undefined;
    if (productVersionId) {
      const version = await getProductVersion({
        prisma,
        tenancyId: tenancy.id,
        productVersionId,
      });
      productJson = version.productJson as InputJsonValue;
    } else {
      // Backward compat: old subscriptions have product JSON directly in metadata or even older subscriptions were created with offer metadata
      const productString = subscription.metadata.product as string | undefined ?? subscription.metadata.offer as string | undefined;
      if (!productString) {
        throw new StackAssertionError("Stripe subscription metadata missing productVersionId, product, or offer", {
          subscriptionId: subscription.id,
          tenancyId: tenancy.id,
        });
      }
      try {
        productJson = JSON.parse(productString);
      } catch (error) {
        throw new StackAssertionError("Invalid JSON in Stripe subscription metadata", { subscriptionId: subscription.id, productString, error });
      }
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
        currentPeriodEnd: sanitizedDates.end,
        currentPeriodStart: sanitizedDates.start,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000) : null,
        billingCycleAnchor: subscription.billing_cycle_anchor ? new Date(subscription.billing_cycle_anchor * 1000) : null,
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
        currentPeriodEnd: sanitizedDates.end,
        currentPeriodStart: sanitizedDates.start,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000) : null,
        billingCycleAnchor: subscription.billing_cycle_anchor ? new Date(subscription.billing_cycle_anchor * 1000) : null,
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
