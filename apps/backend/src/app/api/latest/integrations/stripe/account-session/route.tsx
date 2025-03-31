import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getStripeClient } from "@/utils/stripe";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a Stripe account session",
    description: "Create a Stripe account session for connected accounts to manage their settings",
    tags: ["Stripe Integration"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
    }).defined(),
    body: yupObject({}).defined(),
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
    // Get the project config with Stripe config
    const projectWithStripeConfig = await prismaClient.project.findUnique({
      where: { id: project.id },
      select: {
        config: {
          select: {
            stripeConfig: true
          }
        }
      }
    });

    // Make sure the project has a Stripe config
    if (!projectWithStripeConfig?.config.stripeConfig) {
      throw new KnownErrors.StripeConfigurationNotFound();
    }

    // Make sure the project is using Stripe Connect
    if (!projectWithStripeConfig.config.stripeConfig.stripeAccountId) {
      throw new KnownErrors.StripeConfigurationNotFound();
    }

    const stripe = getStripeClient();

    // Create an account session for the connected account using the project's Stripe account ID
    const accountSession = await stripe.accountSessions.create({
      account: projectWithStripeConfig.config.stripeConfig.stripeAccountId,
      components: {
        payments: {
          enabled: true,
        }
      },
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
