import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getStripeClient } from "@/utils/stripe";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a Stripe Connect account",
    description: "Create a Stripe Connect account for the current user or team",
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

    const account = await stripe.accounts.create({
      type: body.type,
      metadata: {
        stack_project_id: project.id,
      },
    });

    // Create an account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: body.refresh_url,
      return_url: body.return_url,
      type: 'account_onboarding',
    });

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        status: 'success',
        account_id: account.id,
        account_link_url: accountLink.url,
      },
    };
  },
});
