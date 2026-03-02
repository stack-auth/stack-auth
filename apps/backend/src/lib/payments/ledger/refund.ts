import { Tenancy } from "@/lib/tenancies";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { moneyAmountToStripeUnits } from "@stackframe/stack-shared/dist/utils/currencies";
import { SUPPORTED_CURRENCIES, type MoneyAmount } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { InferType } from "yup";
import { resolveSelectedPriceFromProduct } from "./transaction-helpers";

const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD")
  ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

type RefundEntrySelection = {
  entry_index: number,
  quantity: number,
  amount_usd: MoneyAmount,
};

function getTotalUsdStripeUnits(product: InferType<typeof productSchema>, priceId: string | null, quantity: number) {
  const selectedPrice = resolveSelectedPriceFromProduct(product, priceId);
  const usdPrice = selectedPrice?.USD;
  if (typeof usdPrice !== "string") {
    throw new KnownErrors.SchemaError("Refund amounts can only be specified for USD-priced purchases.");
  }
  if (!Number.isFinite(quantity) || Math.trunc(quantity) !== quantity) {
    throw new StackAssertionError("Purchase quantity is not an integer", { quantity });
  }
  return moneyAmountToStripeUnits(usdPrice as MoneyAmount, USD_CURRENCY) * quantity;
}

function getRefundedQuantity(refundEntries: RefundEntrySelection[]) {
  let total = 0;
  for (const entry of refundEntries) total += entry.quantity;
  return total;
}

function getRefundAmountStripeUnits(refundEntries: RefundEntrySelection[]) {
  let total = 0;
  for (const entry of refundEntries) {
    total += moneyAmountToStripeUnits(entry.amount_usd, USD_CURRENCY);
  }
  return total;
}

function validateRefundAmount(refundAmountStripeUnits: number, totalStripeUnits: number) {
  if (refundAmountStripeUnits < 0) {
    throw new KnownErrors.SchemaError("Refund amount cannot be negative.");
  }
  if (refundAmountStripeUnits > totalStripeUnits) {
    throw new KnownErrors.SchemaError("Refund amount cannot exceed the charged amount.");
  }
}

function validateRefundEntries(refundEntries: RefundEntrySelection[], purchaseQuantity: number, productGrantEntryIndex: number, totalEntries: number) {
  const seenEntryIndexes = new Set<number>();
  for (const refundEntry of refundEntries) {
    if (!Number.isFinite(refundEntry.entry_index) || refundEntry.entry_index < 0 || refundEntry.entry_index >= totalEntries) {
      throw new KnownErrors.SchemaError("Refund entry index is invalid.");
    }
    if (refundEntry.entry_index !== productGrantEntryIndex) {
      throw new KnownErrors.SchemaError("Refund entries must reference product grant entries.");
    }
    if (!Number.isFinite(refundEntry.quantity) || Math.trunc(refundEntry.quantity) !== refundEntry.quantity) {
      throw new KnownErrors.SchemaError("Refund quantity must be an integer.");
    }
    if (refundEntry.quantity < 0) {
      throw new KnownErrors.SchemaError("Refund quantity cannot be negative.");
    }
    if (seenEntryIndexes.has(refundEntry.entry_index)) {
      throw new KnownErrors.SchemaError("Refund entries cannot contain duplicate entry indexes.");
    }
    seenEntryIndexes.add(refundEntry.entry_index);
    if (refundEntry.quantity > purchaseQuantity) {
      throw new KnownErrors.SchemaError("Refund quantity cannot exceed purchased quantity.");
    }
  }
}

export async function refundTransaction(options: {
  tenancy: Tenancy,
  type: "subscription" | "one-time-purchase",
  id: string,
  refundEntries: RefundEntrySelection[],
}): Promise<void> {
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  if (options.type === "subscription") {
    await refundSubscription(prisma, options.tenancy, options.id, options.refundEntries);
    return;
  }
  await refundOneTimePurchase(prisma, options.tenancy, options.id, options.refundEntries);
}

async function refundSubscription(
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancy: Tenancy,
  subscriptionId: string,
  refundEntries: RefundEntrySelection[],
) {
  const subscription = await prisma.subscription.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: subscriptionId } },
  });
  if (!subscription) throw new KnownErrors.SubscriptionInvoiceNotFound(subscriptionId);
  if (subscription.refundedAt) throw new KnownErrors.SubscriptionAlreadyRefunded(subscriptionId);

  const product = subscription.product as InferType<typeof productSchema>;
  const includedItemCount = Object.keys(product.includedItems).length;
  const subProductGrantIndex = 2;
  const subTotalEntries = 3 + includedItemCount;
  validateRefundEntries(refundEntries, subscription.quantity, subProductGrantIndex, subTotalEntries);

  const subscriptionInvoices = await prisma.subscriptionInvoice.findMany({
    where: {
      tenancyId: tenancy.id,
      isSubscriptionCreationInvoice: true,
      subscription: { tenancyId: tenancy.id, id: subscriptionId },
    },
  });
  if (subscriptionInvoices.length === 0) throw new KnownErrors.SubscriptionInvoiceNotFound(subscriptionId);
  if (subscriptionInvoices.length > 1) {
    throw new StackAssertionError("Multiple subscription creation invoices found for subscription", { subscriptionId });
  }

  const stripe = await getStripeForAccount({ tenancy });
  const invoice = await stripe.invoices.retrieve(subscriptionInvoices[0].stripeInvoiceId, { expand: ["payments"] });
  const payments = invoice.payments?.data;
  if (!payments || payments.length === 0) {
    throw new StackAssertionError("Invoice has no payments", { invoiceId: subscriptionInvoices[0].stripeInvoiceId });
  }
  const paidPayment = payments.find((payment) => payment.status === "paid");
  if (!paidPayment) {
    throw new StackAssertionError("Invoice has no paid payment", { invoiceId: subscriptionInvoices[0].stripeInvoiceId });
  }
  const paymentIntentId = paidPayment.payment.payment_intent;
  if (!paymentIntentId || typeof paymentIntentId !== "string") {
    throw new StackAssertionError("Payment has no payment intent", { invoiceId: subscriptionInvoices[0].stripeInvoiceId });
  }

  const totalStripeUnits = getTotalUsdStripeUnits(product, subscription.priceId ?? null, subscription.quantity);
  const refundAmountStripeUnits = getRefundAmountStripeUnits(refundEntries);
  validateRefundAmount(refundAmountStripeUnits, totalStripeUnits);
  await stripe.refunds.create({ payment_intent: paymentIntentId, amount: refundAmountStripeUnits });

  const refundedQuantity = getRefundedQuantity(refundEntries);
  if (refundedQuantity > 0) {
    if (!subscription.stripeSubscriptionId) {
      throw new StackAssertionError("Stripe subscription id missing for refund", { subscriptionId: subscription.id });
    }
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    if (stripeSubscription.items.data.length === 0) {
      throw new StackAssertionError("Stripe subscription has no items", { subscriptionId: subscription.id });
    }
    const subscriptionItem = stripeSubscription.items.data[0];
    if (!Number.isFinite(subscriptionItem.quantity) || Math.trunc(subscriptionItem.quantity ?? 0) !== subscriptionItem.quantity) {
      throw new StackAssertionError("Stripe subscription item quantity is not an integer", {
        subscriptionId: subscription.id,
        itemQuantity: subscriptionItem.quantity,
      });
    }
    const currentQuantity = subscriptionItem.quantity ?? 0;
    const newQuantity = currentQuantity - refundedQuantity;
    if (newQuantity < 0) {
      throw new StackAssertionError("Refund quantity exceeds Stripe subscription item quantity", {
        subscriptionId: subscription.id,
        currentQuantity,
        refundedQuantity,
      });
    }
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: newQuantity === 0,
      items: [{ id: subscriptionItem.id, quantity: newQuantity }],
    });
    await prisma.subscription.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: subscriptionId } },
      data: { cancelAtPeriodEnd: newQuantity === 0, refundedAt: new Date() },
    });
    return;
  }

  await prisma.subscription.update({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: subscriptionId } },
    data: { refundedAt: new Date() },
  });
}

async function refundOneTimePurchase(
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancy: Tenancy,
  purchaseId: string,
  refundEntries: RefundEntrySelection[],
) {
  const purchase = await prisma.oneTimePurchase.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: purchaseId } },
  });
  if (!purchase) throw new KnownErrors.OneTimePurchaseNotFound(purchaseId);
  if (purchase.refundedAt) throw new KnownErrors.OneTimePurchaseAlreadyRefunded(purchaseId);
  if (purchase.creationSource === "TEST_MODE") throw new KnownErrors.TestModePurchaseNonRefundable();
  if (!purchase.stripePaymentIntentId) throw new KnownErrors.OneTimePurchaseNotFound(purchaseId);

  const product = purchase.product as InferType<typeof productSchema>;
  const includedItemCount = Object.keys(product.includedItems).length;
  const otpProductGrantIndex = 1;
  const otpTotalEntries = 2 + includedItemCount;
  validateRefundEntries(refundEntries, purchase.quantity, otpProductGrantIndex, otpTotalEntries);
  const totalStripeUnits = getTotalUsdStripeUnits(product, purchase.priceId ?? null, purchase.quantity);
  const refundAmountStripeUnits = getRefundAmountStripeUnits(refundEntries);
  validateRefundAmount(refundAmountStripeUnits, totalStripeUnits);

  const stripe = await getStripeForAccount({ tenancy });
  await stripe.refunds.create({
    payment_intent: purchase.stripePaymentIntentId,
    amount: refundAmountStripeUnits,
    metadata: { tenancyId: tenancy.id, purchaseId: purchase.id },
  });
  await prisma.oneTimePurchase.update({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: purchaseId } },
    data: { refundedAt: new Date() },
  });
}
