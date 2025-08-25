import { getTenancy } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { inlineOfferSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, getOrUndefined, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import * as yup from "yup";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

const offerDataSchema = inlineOfferSchema
  .omit(["server_only", "included_items"])
  .concat(yupObject({
    stackable: yupBoolean().defined(),
  }));

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
      project_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ body }) {
    const verificationCode = await purchaseUrlVerificationCodeHandler.validateCode(body.full_code);
    const tenancy = await getTenancy(verificationCode.data.tenancyId);
    if (!tenancy) {
      throw new StackAssertionError(`No tenancy found for given tenancyId`);
    }
    const offer = verificationCode.data.offer;
    const offerData: yup.InferType<typeof offerDataSchema> = {
      display_name: offer.displayName ?? "Offer",
      customer_type: offer.customerType,
      stackable: offer.stackable === true,
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
        project_id: tenancy.project.id,
      },
    };
  },
});
