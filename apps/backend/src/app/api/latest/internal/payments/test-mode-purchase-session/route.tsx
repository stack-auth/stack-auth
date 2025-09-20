import { purchaseUrlVerificationCodeHandler } from "@/app/api/latest/payments/purchases/verification-code-handler";
import { validatePurchaseSession } from "@/lib/payments";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { SubscriptionStatus } from "@prisma/client";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { addInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
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

    const { selectedPrice, conflictingGroupSubscriptions } = await validatePurchaseSession({
      prisma,
      tenancy: auth.tenancy,
      codeData: data,
      priceId: price_id,
      quantity,
    });
    if (!selectedPrice) {
      throw new StackAssertionError("Price not resolved for test mode purchase session");
    }

    if (!selectedPrice.interval) {
      await prisma.oneTimePurchase.create({
        data: {
          tenancyId: auth.tenancy.id,
          customerId: data.customerId,
          customerType: typedToUppercase(data.offer.customerType),
          offerId: data.offerId,
          priceId: price_id,
          offer: data.offer,
          quantity,
          creationSource: "TEST_MODE",
        },
      });
    } else {
      // Cancel conflicting subscriptions for TEST_MODE as well, then create new TEST_MODE subscription
      if (conflictingGroupSubscriptions.length > 0) {
        const conflicting = conflictingGroupSubscriptions[0];
        if (conflicting.stripeSubscriptionId) {
          const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
          await stripe.subscriptions.cancel(conflicting.stripeSubscriptionId);
        } else if (conflicting.id) {
          await prisma.subscription.update({
            where: {
              tenancyId_id: {
                tenancyId: auth.tenancy.id,
                id: conflicting.id,
              },
            },
            data: { status: SubscriptionStatus.canceled },
          });
        }
      }

      await prisma.subscription.create({
        data: {
          tenancyId: auth.tenancy.id,
          customerId: data.customerId,
          customerType: typedToUppercase(data.offer.customerType),
          status: "active",
          offerId: data.offerId,
          priceId: price_id,
          offer: data.offer,
          quantity,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addInterval(new Date(), selectedPrice.interval!),
          cancelAtPeriodEnd: false,
          creationSource: "TEST_MODE",
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
