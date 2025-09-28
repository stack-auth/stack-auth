import { getTenancy, Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { CustomerType } from "@prisma/client";
import { typedIncludes } from "@stackframe/stack-shared/dist/utils/arrays";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";
import { createStripeProxy, type StripeOverridesMap } from "./stripe-proxy";

const stripeSecretKey = getEnvVariable("STACK_STRIPE_SECRET_KEY");
const useStripeMock = stripeSecretKey === "sk_test_mockstripekey" && ["development", "test"].includes(getNodeEnvironment());
const stripeConfig: Stripe.StripeConfig = useStripeMock ? {
  protocol: "http",
  host: "localhost",
  port: 8123,
} : {};

export const getStackStripe = (overrides?: StripeOverridesMap) => {
  if (overrides && !useStripeMock) {
    throw new StackAssertionError("Stripe overrides are not supported in production");
  }
  return createStripeProxy(new Stripe(stripeSecretKey, stripeConfig), overrides);
};

export const getStripeForAccount = async (options: { tenancy?: Tenancy, accountId?: string }, overrides?: StripeOverridesMap) => {
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

export async function syncStripeSubscriptions(stripe: Stripe, stripeAccountId: string, stripeCustomerId: string) {
  const account = await stripe.accounts.retrieve(stripeAccountId);
  if (!account.metadata?.tenancyId) {
    throwErr(500, "Stripe account metadata missing tenancyId");
  }
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
  const tenancy = await getTenancy(account.metadata.tenancyId);
  if (!tenancy) {
    throw new StackAssertionError("Tenancy not found");
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
    await prisma.subscription.upsert({
      where: {
        tenancyId_stripeSubscriptionId: {
          tenancyId: tenancy.id,
          stripeSubscriptionId: subscription.id,
        },
      },
      update: {
        status: subscription.status,
        offer: JSON.parse(subscription.metadata.offer),
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
        offerId: subscription.metadata.offerId,
        priceId: priceId ?? null,
        offer: JSON.parse(subscription.metadata.offer),
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
