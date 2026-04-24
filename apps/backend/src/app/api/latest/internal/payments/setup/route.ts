import { getStackStripe } from "@/lib/stripe";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      url: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const stripe = getStackStripe();
    const dashboardBaseUrl = getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL");

    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.project.id },
      select: { onboardingStatus: true, stripeAccountId: true },
    });

    let stripeAccountId = project?.stripeAccountId || null;
    const returnToUrl = project?.onboardingStatus === "payments_setup"
      ? (() => {
        const onboardingUrl = new URL("/new-project", dashboardBaseUrl);
          onboardingUrl.searchParams.set("project_id", auth.project.id);
          return onboardingUrl.toString();
      })()
      : new URL(`/projects/${encodeURIComponent(auth.project.id)}/payments`, dashboardBaseUrl).toString();

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        controller: {
          stripe_dashboard: { type: "none" },
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        country: "US",
        // `debit_negative_balances` lets Stripe ACH-debit the merchant's
        // linked bank when their Stripe balance goes negative due to payouts,
        // chargebacks, or other settlement events. It does NOT let our
        // `stripe.transfers.create` push a connected account into a negative
        // balance on its own — transfers hard-fail on insufficient balance
        // and land in the PlatformFeeEvent ledger with status=FAILED for
        // manual reconciliation. We still enable this setting so that merchant
        // balances that *would* go negative for other reasons (e.g. their own
        // refunds running ahead of incoming payments) are covered automatically.
        // Refs: https://docs.stripe.com/connect/account-debits
        //       https://docs.stripe.com/connect/account-balances#negative-balances
        settings: {
          payouts: {
            debit_negative_balances: true,
          },
        },
        metadata: {
          tenancyId: auth.tenancy.id,
        }
      });
      stripeAccountId = account.id;

      await globalPrismaClient.project.update({
        where: { id: auth.project.id },
        data: { stripeAccountId },
      });
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: returnToUrl,
      return_url: returnToUrl,
      type: "account_onboarding",
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { url: accountLink.url },
    };
  },
});
