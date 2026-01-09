import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { SubscriptionStatus } from "@/generated/prisma/client";

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
        select: { refundedAt: true },
      });
      if (!subscription) {
        throw new KnownErrors.SubscriptionInvoiceNotFound(body.id);
      }
      if (subscription.refundedAt) {
        throw new KnownErrors.SubscriptionAlreadyRefunded(body.id);
      }
      const subscriptionInvoices = await prisma.subscriptionInvoice.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          isSubscriptionCreationInvoice: true,
          subscription: {
            tenancyId: auth.tenancy.id,
            id: body.id,
          }
        }
      });
      if (subscriptionInvoices.length === 0) {
        throw new KnownErrors.SubscriptionInvoiceNotFound(body.id);
      }
      if (subscriptionInvoices.length > 1) {
        throw new StackAssertionError("Multiple subscription creation invoices found for subscription", { subscriptionId: body.id });
      }
      const subscriptionInvoice = subscriptionInvoices[0];
      const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
      const invoice = await stripe.invoices.retrieve(subscriptionInvoice.stripeInvoiceId, { expand: ["payments"] });
      const payments = invoice.payments?.data;
      if (!payments || payments.length === 0) {
        throw new StackAssertionError("Invoice has no payments", { invoiceId: subscriptionInvoice.stripeInvoiceId });
      }
      const paidPayment = payments.find((payment) => payment.status === "paid");
      if (!paidPayment) {
        throw new StackAssertionError("Invoice has no paid payment", { invoiceId: subscriptionInvoice.stripeInvoiceId });
      }
      const paymentIntentId = paidPayment.payment.payment_intent;
      if (!paymentIntentId || typeof paymentIntentId !== "string") {
        throw new StackAssertionError("Payment has no payment intent", { invoiceId: subscriptionInvoice.stripeInvoiceId });
      }
      await stripe.refunds.create({ payment_intent: paymentIntentId });
      await prisma.subscription.update({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
        data: {
          status: SubscriptionStatus.canceled,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(),
          refundedAt: new Date(),
        },
      });
    } else {
      const purchase = await prisma.oneTimePurchase.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
      });
      if (!purchase) {
        throw new KnownErrors.OneTimePurchaseNotFound(body.id);
      }
      if (purchase.refundedAt) {
        throw new KnownErrors.OneTimePurchaseAlreadyRefunded(body.id);
      }
      if (purchase.creationSource === "TEST_MODE") {
        throw new KnownErrors.TestModePurchaseNonRefundable();
      }
      const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
      if (!purchase.stripePaymentIntentId) {
        throw new KnownErrors.OneTimePurchaseNotFound(body.id);
      }
      await stripe.refunds.create({
        payment_intent: purchase.stripePaymentIntentId,
        metadata: {
          tenancyId: auth.tenancy.id,
          purchaseId: purchase.id,
        },
      });
      await prisma.oneTimePurchase.update({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
        data: { refundedAt: new Date() },
      });
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
