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

    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.project.id },
      select: { stripeAccountId: true },
    });

    let stripeAccountId = project?.stripeAccountId || null;
    const returnToUrl = new URL(`/projects/${auth.project.id}/payments`, getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL")).toString();

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
