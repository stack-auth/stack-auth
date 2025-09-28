import { ensureOfferIdOrInlineOffer } from "@/lib/payments";
import { getStripeForAccount } from "@/lib/stripe";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { CustomerType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, clientOrHigherAuthTypeSchema, inlineOfferSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

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
      customer_type: yupString().oneOf(["user", "team", "custom"]).defined(),
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
    const stripe = await getStripeForAccount({ tenancy });
    const offerConfig = await ensureOfferIdOrInlineOffer(tenancy, req.auth.type, req.body.offer_id, req.body.offer_inline);
    const customerType = offerConfig.customerType;
    if (req.body.customer_type !== customerType) {
      throw new KnownErrors.OfferCustomerTypeDoesNotMatch(req.body.offer_id, req.body.customer_id, customerType, req.body.customer_type);
    }

    const stripeCustomerSearch = await stripe.customers.search({
      query: `metadata['customerId']:'${req.body.customer_id}'`,
    });
    let stripeCustomer = stripeCustomerSearch.data.length ? stripeCustomerSearch.data[0] : undefined;
    if (!stripeCustomer) {
      stripeCustomer = await stripe.customers.create({
        metadata: {
          customerId: req.body.customer_id,
          customerType: customerType === "user" ? CustomerType.USER : CustomerType.TEAM,
        }
      });
    }

    const project = await globalPrismaClient.project.findUnique({
      where: { id: tenancy.project.id },
      select: { stripeAccountId: true },
    });

    const { code } = await purchaseUrlVerificationCodeHandler.createCode({
      tenancy,
      expiresInMs: 1000 * 60 * 60 * 24,
      data: {
        tenancyId: tenancy.id,
        customerId: req.body.customer_id,
        offerId: req.body.offer_id,
        offer: offerConfig,
        stripeCustomerId: stripeCustomer.id,
        stripeAccountId: project?.stripeAccountId ?? throwErr("Stripe account not configured"),
      },
      method: {},
      callbackUrl: undefined,
    });

    const fullCode = `${tenancy.id}_${code}`;
    const url = new URL(`/purchase/${fullCode}`, getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL"));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        url: url.toString(),
      },
    };
  },
});
