import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, adminAuthTypeSchema, moneyAmountSchema, productSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { SubscriptionStatus } from "@/generated/prisma/client";
import { SUPPORTED_CURRENCIES, type MoneyAmount } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { moneyAmountToStripeUnits } from "@stackframe/stack-shared/dist/utils/currencies";
import { resolveSelectedPriceFromProduct } from "@/app/api/latest/internal/payments/transactions/transaction-builder";
import { InferType } from "yup";

const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD")
  ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

function getTotalUsdStripeUnits(options: { product: InferType<typeof productSchema>, priceId: string | null, quantity: number }) {
  const selectedPrice = resolveSelectedPriceFromProduct(options.product, options.priceId ?? null);
  const usdPrice = selectedPrice?.USD;
  if (typeof usdPrice !== "string") {
    throw new KnownErrors.SchemaError("Refund amounts can only be specified for USD-priced purchases.");
  }
  if (!Number.isFinite(options.quantity) || Math.trunc(options.quantity) !== options.quantity) {
    throw new StackAssertionError("Purchase quantity is not an integer", { quantity: options.quantity });
  }
  return moneyAmountToStripeUnits(usdPrice as MoneyAmount, USD_CURRENCY) * options.quantity;
}

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
      amount_usd: moneyAmountSchema(USD_CURRENCY).optional(),
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
    const refundAmountUsd = body.amount_usd ?? null;
    if (body.type === "subscription") {
      const subscription = await prisma.subscription.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
        select: {
          refundedAt: true,
          product: true,
          priceId: true,
          quantity: true,
        },
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
      let refundAmountStripeUnits: number | null = null;
      if (refundAmountUsd) {
        const totalStripeUnits = getTotalUsdStripeUnits({
          product: subscription.product as InferType<typeof productSchema>,
          priceId: subscription.priceId ?? null,
          quantity: subscription.quantity,
        });
        refundAmountStripeUnits = moneyAmountToStripeUnits(refundAmountUsd as MoneyAmount, USD_CURRENCY);
        if (refundAmountStripeUnits <= 0) {
          throw new KnownErrors.SchemaError("Refund amount must be greater than zero.");
        }
        if (refundAmountStripeUnits > totalStripeUnits) {
          throw new KnownErrors.SchemaError("Refund amount cannot exceed the charged amount.");
        }
      }
      await stripe.refunds.create({
        payment_intent: paymentIntentId,
        ...(refundAmountStripeUnits !== null ? { amount: refundAmountStripeUnits } : {}),
      });
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
      let refundAmountStripeUnits: number | null = null;
      if (refundAmountUsd) {
        const totalStripeUnits = getTotalUsdStripeUnits({
          product: purchase.product as InferType<typeof productSchema>,
          priceId: purchase.priceId ?? null,
          quantity: purchase.quantity,
        });
        refundAmountStripeUnits = moneyAmountToStripeUnits(refundAmountUsd as MoneyAmount, USD_CURRENCY);
        if (refundAmountStripeUnits <= 0) {
          throw new KnownErrors.SchemaError("Refund amount must be greater than zero.");
        }
        if (refundAmountStripeUnits > totalStripeUnits) {
          throw new KnownErrors.SchemaError("Refund amount cannot exceed the charged amount.");
        }
      }
      await stripe.refunds.create({
        payment_intent: purchase.stripePaymentIntentId,
        ...(refundAmountStripeUnits !== null ? { amount: refundAmountStripeUnits } : {}),
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
