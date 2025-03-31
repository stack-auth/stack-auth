import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getStripeClient } from "@/utils/stripe";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a Stripe Connect account or account link",
    description: "Create a Stripe Connect account if one doesn't exist, or create an account link for an existing account",
    tags: ["Stripe Integration"],
  },
  request: yupObject({
    auth: yupObject({
      project: adaptSchema.defined(),
      user: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      type: yupString().oneOf(["standard", "express", "custom"]).default("standard"),
      return_url: yupString().defined(),
      refresh_url: yupString().defined(),
      team_id: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200, 201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().defined(),
      account_id: yupString().optional(),
      account_link_url: yupString().optional(),
    }).defined(),
  }),
  async handler({ body, auth: { project } }) {
    const stripe = getStripeClient();
    let accountId: string;

    // Check if the project already has a Stripe account ID
    const stripeConfig = await prismaClient.stripeConfig.findUnique({
      where: {
        projectConfigId: project.config.id,
      },
    });

    if (stripeConfig?.stripeAccountId) {
      // Project already has a Stripe account ID, use that
      accountId = stripeConfig.stripeAccountId;
    } else {
      // Project doesn't have a Stripe account ID, create a new account
      const account = await stripe.accounts.create({
        type: body.type,
        metadata: {
          stack_project_id: project.id,
        },
      });
      accountId = account.id;

      // Save the account ID to the project
      if (stripeConfig) {
        // Update existing stripe config
        await prismaClient.stripeConfig.update({
          where: {
            id: stripeConfig.id,
          },
          data: {
            stripeAccountId: accountId,
          },
        });
      } else {
        // Create new stripe config
        await prismaClient.stripeConfig.create({
          data: {
            projectConfigId: project.config.id,
            stripeAccountId: accountId,
          },
        });
      }
    }

    // Create an account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: body.refresh_url,
      return_url: body.return_url,
      type: 'account_onboarding',
    });

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        status: 'success',
        account_id: accountId,
        account_link_url: accountLink.url,
      },
    };
  },
});
