import { getStackStripe } from "@/lib/stripe";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

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
      client_secret: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const stripe = getStackStripe();
    if (!auth.tenancy.config.payments.stripeAccountId) {
      throw new StatusError(400, "Stripe account ID is not set");
    }

    const accountSession = await stripe.accountSessions.create({
      account: auth.tenancy.config.payments.stripeAccountId,
      components: {
        payments: {
          enabled: true,
          features: {
            refund_management: true,
            dispute_management: true,
            capture_payments: true,
          },
        },
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        client_secret: accountSession.client_secret,
      },
    };
  },
});
