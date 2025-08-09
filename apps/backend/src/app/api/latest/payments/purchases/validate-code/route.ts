import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";
import { inlineOfferSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { filterUndefined, typedFromEntries, getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currencies";
import * as yup from "yup";

const offerDataSchema = inlineOfferSchema.omit(["server_only", "included_items"]);

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    body: yupObject({
      full_code: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      offer: offerDataSchema,
      stripe_account_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ body }) {
    const verificationCode = await purchaseUrlVerificationCodeHandler.validateCode(body.full_code);
    const offer = verificationCode.data.offer;
    const offerData: yup.InferType<typeof offerDataSchema> = {
      display_name: offer.displayName ?? "Offer",
      customer_type: offer.customerType ?? "user",
      prices: Object.fromEntries(Object.entries(offer.prices).map(([key, value]) => [key, filterUndefined({
        ...typedFromEntries(SUPPORTED_CURRENCIES.map(c => [c.code, getOrUndefined(value, c.code)])),
        interval: value.interval,
        free_trial: value.freeTrial,
      })])),
    };

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        offer: offerData,
        stripe_account_id: verificationCode.data.stripeAccountId,
      },
    };
  },
});
