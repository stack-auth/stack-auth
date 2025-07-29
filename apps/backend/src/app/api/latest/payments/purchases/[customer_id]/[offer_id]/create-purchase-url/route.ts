import { ensureOfferCustomerTypeMatches } from "@/lib/payments";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";

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
    params: yupObject({
      customer_id: yupString().defined(),
      offer_id: yupString().defined(),
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
    const { project, tenancy } = req.auth;

    const offerConfig = getOrUndefined(tenancy.completeConfig.payments.offers, req.params.offer_id);
    if (!offerConfig || (offerConfig.serverOnly && req.auth.type === "client")) {
      throw new KnownErrors.OfferDoesNotExist(req.params.offer_id, req.auth.type);
    }

    await ensureOfferCustomerTypeMatches(req.params.offer_id, offerConfig.customerType, req.params.customer_id, tenancy);

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
