import { getTenancy, Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";

export const stackStripe = new Stripe(getEnvVariable("STACK_STRIPE_SECRET_KEY"));

export const getStripeForAccount = (options: { tenancy?: Tenancy, accountId?: string }) => {
  if (!options.tenancy && !options.accountId) {
    throwErr(400, "Either tenancy or stripeAccountId must be provided");
  }
  const accountId = options.accountId ?? options.tenancy?.completeConfig.payments.stripeAccountId;
  if (!accountId) {
    throwErr(400, "Stripe account not configured");
  }
  return new Stripe(getEnvVariable("STACK_STRIPE_SECRET_KEY"), {
    stripeAccount: accountId,
  });
};

export async function syncStripeDataToDB(stripeAccountId: string, stripeCustomerId: string) {
  const stripe = getStripeForAccount({ accountId: stripeAccountId });
  const account = await stripe.accounts.retrieve(stripeAccountId);
  if (!account.metadata?.tenancyId) {
    throwErr(500, "Stripe account metadata missing tenancyId");
  }
  const tenancy = await getTenancy(account.metadata.tenancyId);
  if (!tenancy) {
    throwErr(500, "Tenancy not found");
  }
  const prisma = await getPrismaClientForTenancy(tenancy);
  const customer = await prisma.customer.findUnique({
    where: {
      tenancyId_stripeCustomerId: {
        tenancyId: tenancy.id,
        stripeCustomerId,
      },
    },
  });
  if (!customer) {
    throwErr(500, "Customer not found in DB");
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
  });

  // TODO: handle in parallel, store payment method?
  for (const subscription of subscriptions.data) {
    await prisma.subscription.upsert({
      where: {
        tenancyId_stripeSubscriptionId: {
          tenancyId: tenancy.id,
          stripeSubscriptionId: subscription.id,
        },
      },
      update: {
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.items.data[0].current_period_end * 1000),
        currentPeriodStart: new Date(subscription.items.data[0].current_period_start * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
      create: {
        tenancyId: tenancy.id,
        customerId: customer.id,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.items.data[0].current_period_end * 1000),
        currentPeriodStart: new Date(subscription.items.data[0].current_period_start * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  }
}
