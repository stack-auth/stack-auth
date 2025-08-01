import { ensureOfferCustomerTypeMatches, ensureOfferIdOrInlineOffer } from "@/lib/payments";
import { getStripeForAccount } from "@/lib/stripe";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, inlineOfferSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { CustomerType } from "@prisma/client";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      customer_id: yupString().defined(),
      offer_id: yupString().optional(),
      offer_inline: inlineOfferSchema.optional(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      url: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const { tenancy } = req.auth;
    const stripe = getStripeForAccount({ tenancy });
    const offerConfig = await ensureOfferIdOrInlineOffer(tenancy, req.auth.type, req.body.offer_id, req.body.offer_inline);
    await ensureOfferCustomerTypeMatches(req.body.offer_id, offerConfig.customerType, req.body.customer_id, tenancy);
    const customerType = offerConfig.customerType ?? throwErr(500, "Customer type not found");
    const prisma = await getPrismaClientForTenancy(tenancy);

    let dbCustomer = await prisma.customer.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: tenancy.id,
          id: req.body.customer_id,
        },
      },
    });
    if (!dbCustomer) {
      const stripeCustomer = await stripe.customers.create({
        metadata: {
          customerId: req.body.customer_id,
          customerType,
        }
      });
      dbCustomer = await prisma.customer.create({
        data: {
          tenancyId: tenancy.id,
          id: req.body.customer_id,
          stripeCustomerId: stripeCustomer.id,
          customerType: customerType === "user" ? CustomerType.USER : CustomerType.TEAM,
        },
      });
    }
    // const price = await stripe.prices.create({
    //   currency: "usd",
    //   unit_amount: 1,
    //   product_data: {
    //     name: offerConfig.displayName,
    //   },
    //   recurring: { interval: 'month' },
    // });
    // const subscription = await stripe.subscriptions.create({
    //   customer: dbCustomer.stripeCustomerId,
    //   items: [{
    //     price: price.id,
    //   }],
    //   payment_behavior: 'default_incomplete',
    //   payment_settings: { save_default_payment_method: 'on_subscription' },
    //   expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
    // });

    const { code } = await purchaseUrlVerificationCodeHandler.createCode({
      tenancy,
      expiresInMs: 1000 * 60 * 60 * 24,
      data: {
        tenancyId: tenancy.id,
        customerId: req.body.customer_id,
        offer: offerConfig,
        stripeCustomerId: dbCustomer.stripeCustomerId,
        stripeAccountId: tenancy.completeConfig.payments.stripeAccountId ?? throwErr(500, "Stripe account not configured"),
      },
      method: {},
      callbackUrl: undefined,
    });

    const url = new URL(`/purchase/${code}`, getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL"));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        url: url.toString(),
      },
    };
  },
});
