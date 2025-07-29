import { ensureOfferCustomerTypeMatches, ensureOfferIdOrInlineOffer } from "@/lib/payments";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, inlineOfferSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";

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

    let offerConfig = await ensureOfferIdOrInlineOffer(tenancy, req.auth.type, req.body.offer_id, req.body.offer_inline);
    await ensureOfferCustomerTypeMatches(req.body.offer_id, offerConfig.customerType, req.body.customer_id, tenancy);

    // TODO implement
    const url = throwErr(new StackAssertionError("unimplemented"));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        url,
      },
    };
  },
});
