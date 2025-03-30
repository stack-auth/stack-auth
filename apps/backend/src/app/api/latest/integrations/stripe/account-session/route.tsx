import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getStripeClient } from "@/utils/stripe";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a Stripe account session",
    description: "Create a Stripe account session for connected accounts to manage their settings",
    tags: ["Stripe Integration"],
  },
  request: yupObject({
    auth: yupObject({
      project: adaptSchema.defined(),
      user: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      components: yupObject({
        account_onboarding: yupObject({
          enabled: yupBoolean().default(true),
        }).optional(),
        payment_details: yupObject({
          enabled: yupBoolean().default(true),
        }).optional(),
      }).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().defined(),
      client_secret: yupString().defined(),
    }).defined(),
  }),
  async handler({ body, auth: { project } }) {
    // Get the Stripe account ID from the database directly.
    const projectWithStripeAccount = await prismaClient.project.findUnique({
      where: { id: project.id },
      select: { stripeAccountId: true }
    });

    // Make sure the project has a connected Stripe account
    if (!projectWithStripeAccount?.stripeAccountId) {
      throw new StackAssertionError("Project has no connected Stripe account");
    }

    const stripe = getStripeClient();

    // Transform the components from Yup validation format to Stripe API format
    const components = {
      account_onboarding: body.components.account_onboarding ? {
        enabled: !!body.components.account_onboarding.enabled
      } : undefined,
      payment_details: body.components.payment_details ? {
        enabled: !!body.components.payment_details.enabled
      } : undefined
    };

    // Create an account session for the connected account using the project's Stripe account ID
    const accountSession = await stripe.accountSessions.create({
      account: projectWithStripeAccount.stripeAccountId,
      components,
    });

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        status: 'success',
        client_secret: accountSession.client_secret,
      },
    };
  },
});
