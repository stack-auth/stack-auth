import { getSubscriptions, isActiveSubscription } from "@/lib/payments";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { inlineOfferSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, getOrUndefined, typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
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
      already_bought_non_stackable: yupBoolean().defined(),
      conflicting_group_offers: yupArray(yupObject({
        offer_id: yupString().defined(),
        display_name: yupString().defined(),
      }).defined()).defined(),
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
      prices: offer.prices === "include-by-default" ? {} : typedFromEntries(typedEntries(offer.prices).map(([key, value]) => [key, filterUndefined({
        ...typedFromEntries(SUPPORTED_CURRENCIES.map(c => [c.code, getOrUndefined(value, c.code)])),
        interval: value.interval,
        free_trial: value.freeTrial,
      })])),
    };

    // Compute purchase context info
    const prisma = await getPrismaClientForTenancy(tenancy);
    const subscriptions = await getSubscriptions({
      prisma,
      tenancy,
      customerType: offer.customerType,
      customerId: verificationCode.data.customerId,
    });

    const alreadyBoughtNonStackable = !!(subscriptions.find((s) => s.offerId === verificationCode.data.offerId) && offer.stackable !== true);

    const groups = tenancy.config.payments.groups;
    const groupId = Object.keys(groups).find((g) => offer.groupId === g);
    let conflictingGroupOffers: { offer_id: string, display_name: string }[] = [];
    if (groupId) {
      const isSubscribable = offer.prices !== "include-by-default" && Object.values(offer.prices).some((p: any) => p && p.interval);
      if (isSubscribable) {
        const conflicts = subscriptions.filter((subscription) => (
          subscription.offerId &&
          subscription.offer.groupId === groupId &&
          isActiveSubscription(subscription) &&
          subscription.offer.prices !== "include-by-default" &&
          (!offer.isAddOnTo || !Object.keys(offer.isAddOnTo).includes(subscription.offerId))
        ));
        conflictingGroupOffers = conflicts.map((s) => ({
          offer_id: s.offerId!,
          display_name: s.offer.displayName ?? s.offerId!,
        }));
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        offer: offerData,
        stripe_account_id: verificationCode.data.stripeAccountId,
        project_id: tenancy.project.id,
        already_bought_non_stackable: alreadyBoughtNonStackable,
        conflicting_group_offers: conflictingGroupOffers,
      },
    };
  },
});
