import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";
import { dayIntervalSchema, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";

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
      offer: yupObject({
        display_name: yupString(),
        customer_type: yupString(),
        prices: yupRecord(
          yupString(),
          yupObject({
            USD: yupString(),
            interval: dayIntervalSchema
          }).defined(),
        ).defined(),
      }).defined(),
      stripe_account_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ body }) {
    const verificationCode = await purchaseUrlVerificationCodeHandler.validateCode(body.full_code);
    const offer = verificationCode.data.offer;
    const offerData = {
      display_name: offer.displayName,
      customer_type: offer.customerType,
      prices: Object.fromEntries(Object.entries(offer.prices).map(([key, value]) => [key, filterUndefined({
        ...value,
        free_trial: value.freeTrial,
        freeTrial: undefined,
        serverOnly: undefined,
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
