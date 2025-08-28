import { getStackStripe } from "@/lib/stripe";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
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
      account_id: yupString().defined(),
      charges_enabled: yupBoolean().defined(),
      details_submitted: yupBoolean().defined(),
      payouts_enabled: yupBoolean().defined(),
    }).nullable(),
  }),
  handler: async ({ auth }) => {
    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.project.id },
      select: { stripeAccountId: true },
    });

    if (!project?.stripeAccountId) {
      throw new KnownErrors.StripeAccountInfoNotFound();
    }

    const stripe = getStackStripe();
    const account = await stripe.accounts.retrieve(project.stripeAccountId);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        account_id: account.id,
        charges_enabled: account.charges_enabled || false,
        details_submitted: account.details_submitted || false,
        payouts_enabled: account.payouts_enabled || false,
      },
    };
  },
});
