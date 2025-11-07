import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";


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
      type: yupString().oneOf(["subscription", "one-time-purchase"]).defined(),
      id: yupString().defined(),
    }).defined()
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    if (body.type === "subscription") {
      const subscription = await prisma.subscription.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
      });
      if (!subscription) {
        throw new KnownErrors.SubscriptionNotFound(body.id);
      }
      if (subscription.status !== "active" && subscription.status !== "trialing") {
        throw new StackAssertionError("Subscription is not active or trialing");
      }
      if (!subscription.stripeSubscriptionId) {
        await prisma.subscription.update({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
          data: { status: "canceled" }
        })
      } else {
        if (!subscription.stripeSubscriptionId) {
          console.error("Subscription has no stripe subscription ID", subscription);
          throw new KnownErrors.SubscriptionNotFound(body.id);
        }
        const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      }
    } else if (body.type === "one-time-purchase") {
      const purchase = await prisma.oneTimePurchase.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
      });
      if (!purchase) {
        throw new KnownErrors.OneTimePurchaseNotFound(body.id);
      }
      if (purchase.creationSource === "TEST_MODE") {
        await prisma.oneTimePurchase.update({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
          data: { refundedAt: new Date() }
        })
      } else {
        const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
        if (!purchase.stripePaymentIntentId) {
          throw new KnownErrors.OneTimePurchaseNotFound(body.id);
        }
        await stripe.refunds.create({ payment_intent: purchase.stripePaymentIntentId });
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
