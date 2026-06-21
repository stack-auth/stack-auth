import { getHexclaveStripe } from "@/lib/stripe";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { paymentSupportedCountries } from "@hexclave/shared/dist/payments/payment-countries";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

function throwSetupError(): never {
  throw new StatusError(400, "A supported country of residence is required to set up payments.");
}

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
    // The country of residence selected during payments setup. Used as the
    // Stripe Connect account country, which is immutable once the account is
    // created, so it only matters on first setup (see handler).
    body: yupObject({
      country: yupString().oneOf(paymentSupportedCountries).optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      url: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const stripe = getHexclaveStripe();
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
      // Country is required to create the Stripe account. The dashboard always
      // sends it now; reject rather than silently defaulting so we never create
      // an account in the wrong (immutable) country.
      const country = body?.country ?? throwSetupError();
      const account = await stripe.accounts.create({
        controller: {
          stripe_dashboard: { type: "none" },
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        country,
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
