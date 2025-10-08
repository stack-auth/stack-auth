import { purchaseUrlVerificationCodeHandler } from "@/app/api/latest/payments/purchases/verification-code-handler";
import { validatePurchaseSession } from "@/lib/payments";
import { getTenancy } from "@/lib/tenancies";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { SubscriptionStatus } from "@prisma/client";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { addInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
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
  handler: async ({ body }) => {
    const { full_code, price_id, quantity } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);

    const tenancy = await getTenancy(data.tenancyId);
    if (!tenancy) {
      throw new StackAssertionError("Tenancy not found for test mode purchase session");
    }
    if (tenancy.config.payments.testMode !== true) {
      throw new StatusError(403, "Test mode is not enabled for this project");
    }
    const prisma = await getPrismaClientForTenancy(tenancy);

    const { selectedPrice, conflictingCatalogSubscriptions } = await validatePurchaseSession({
      prisma,
      tenancy,
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
          tenancyId: tenancy.id,
          customerId: data.customerId,
          customerType: typedToUppercase(data.product.customerType),
          productId: data.productId,
          priceId: price_id,
          product: data.product,
          quantity,
          creationSource: "TEST_MODE",
        },
      });
    } else {
      // Cancel conflicting subscriptions for TEST_MODE as well, then create new TEST_MODE subscription
      if (conflictingCatalogSubscriptions.length > 0) {
        const conflicting = conflictingCatalogSubscriptions[0];
        if (conflicting.stripeSubscriptionId) {
          const stripe = await getStripeForAccount({ tenancy });
          await stripe.subscriptions.cancel(conflicting.stripeSubscriptionId);
        } else if (conflicting.id) {
          await prisma.subscription.update({
            where: {
              tenancyId_id: {
                tenancyId: tenancy.id,
                id: conflicting.id,
              },
            },
            data: { status: SubscriptionStatus.canceled },
          });
        }
      }

      await prisma.subscription.create({
        data: {
          tenancyId: tenancy.id,
          customerId: data.customerId,
          customerType: typedToUppercase(data.product.customerType),
          status: "active",
          productId: data.productId,
          priceId: price_id,
          product: data.product,
          quantity,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addInterval(new Date(), selectedPrice.interval!),
          cancelAtPeriodEnd: false,
          creationSource: "TEST_MODE",
        },
      });
    }
    await purchaseUrlVerificationCodeHandler.revokeCode({
      tenancy,
      id: codeId,
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
