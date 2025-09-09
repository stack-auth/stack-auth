import { purchaseUrlVerificationCodeHandler } from "@/app/api/latest/payments/purchases/verification-code-handler";
import { isActiveSubscription, validatePurchaseSession } from "@/lib/payments";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { SubscriptionCreationSource, SubscriptionStatus } from "@prisma/client";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { addInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedKeys } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";

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
    body: yupObject({
      full_code: yupString().defined(),
      price_id: yupString().defined(),
      quantity: yupNumber().integer().min(1).default(1),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async ({ auth, body }) => {
    const { full_code, price_id, quantity } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);
    if (auth.tenancy.id !== data.tenancyId) {
      throw new StatusError(400, "Tenancy id does not match value from code data");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const { selectedPrice, groupId, subscriptions } = await validatePurchaseSession({
      prisma,
      tenancy: auth.tenancy,
      codeData: data,
      priceId: price_id,
      quantity,
    });
    if (groupId) {
      for (const subscription of subscriptions) {
        if (
          subscription.id &&
          subscription.offerId &&
          subscription.offer.groupId === groupId &&
          isActiveSubscription(subscription) &&
          subscription.offer.prices !== "include-by-default" &&
          (!data.offer.isAddOnTo || !typedKeys(data.offer.isAddOnTo).includes(subscription.offerId))
        ) {
          if (!selectedPrice?.interval) {
            continue;
          }
          if (subscription.stripeSubscriptionId) {
            const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
            await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
          }
          await retryTransaction(prisma, async (tx) => {
            if (!subscription.stripeSubscriptionId && subscription.id) {
              await tx.subscription.update({
                where: {
                  tenancyId_id: {
                    tenancyId: auth.tenancy.id,
                    id: subscription.id,
                  },
                },
                data: {
                  status: SubscriptionStatus.canceled,
                },
              });
            }
            await tx.subscription.create({
              data: {
                tenancyId: auth.tenancy.id,
                customerId: data.customerId,
                customerType: typedToUppercase(data.offer.customerType),
                status: SubscriptionStatus.active,
                offerId: data.offerId,
                offer: data.offer,
                quantity,
                currentPeriodStart: new Date(),
                currentPeriodEnd: addInterval(new Date(), selectedPrice.interval!),
                cancelAtPeriodEnd: false,
                creationSource: SubscriptionCreationSource.TEST_MODE,
              },
            });
          });
        }
      }
    }

    if (selectedPrice?.interval) {
      await prisma.subscription.create({
        data: {
          tenancyId: auth.tenancy.id,
          customerId: data.customerId,
          customerType: typedToUppercase(data.offer.customerType),
          status: "active",
          offerId: data.offerId,
          offer: data.offer,
          quantity,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addInterval(new Date(), selectedPrice.interval),
          cancelAtPeriodEnd: false,
          creationSource: SubscriptionCreationSource.TEST_MODE,
        },
      });
    }
    await purchaseUrlVerificationCodeHandler.revokeCode({
      tenancy: auth.tenancy,
      id: codeId,
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
