import { buildOneTimePurchaseTransaction, buildSubscriptionTransaction, resolveSelectedPriceFromProduct } from "@/app/api/latest/internal/payments/transactions/transaction-builder";
import { bulldozerWriteManualTransaction, bulldozerWriteOneTimePurchase, bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import type { ManualTransactionRow } from "@/lib/payments/schema/types";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, adminAuthTypeSchema, moneyAmountSchema, productSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { moneyAmountToStripeUnits } from "@stackframe/stack-shared/dist/utils/currencies";
import { SUPPORTED_CURRENCIES, type MoneyAmount } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
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

type RefundEntrySelection = {
  entry_index: number,
  quantity: number,
  amount_usd: MoneyAmount,
};

function validateRefundEntries(options: { entries: TransactionEntry[], refundEntries: RefundEntrySelection[] }) {
  const seenEntryIndexes = new Set<number>();
  const entryByIndex = new Map<number, TransactionEntry>(
    options.entries.map((entry, index) => [index, entry]),
  );

  for (const refundEntry of options.refundEntries) {
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
    const entry = entryByIndex.get(refundEntry.entry_index);
    if (!entry) {
      throw new KnownErrors.SchemaError("Refund entry index is invalid.");
    }
    if (entry.type !== "product_grant") {
      throw new KnownErrors.SchemaError("Refund entries must reference product grant entries.");
    }
    if (refundEntry.quantity > entry.quantity) {
      throw new KnownErrors.SchemaError("Refund quantity cannot exceed purchased quantity.");
    }
  }
}

function getRefundedQuantity(refundEntries: RefundEntrySelection[]) {
  let total = 0;
  for (const refundEntry of refundEntries) {
    total += refundEntry.quantity;
  }
  return total;
}

function getRefundAmountStripeUnits(refundEntries: RefundEntrySelection[]) {
  let total = 0;
  for (const refundEntry of refundEntries) {
    total += moneyAmountToStripeUnits(refundEntry.amount_usd, USD_CURRENCY);
  }
  return total;
}

function stripeUnitsToMoneyAmount(stripeUnits: number): string {
  if (!Number.isFinite(stripeUnits) || Math.trunc(stripeUnits) !== stripeUnits) {
    throw new StackAssertionError("Stripe units must be an integer", { stripeUnits });
  }
  const absolute = Math.abs(stripeUnits);
  const decimals = USD_CURRENCY.decimals;
  const units = absolute.toString().padStart(decimals + 1, "0");
  const integerPart = units.slice(0, -decimals) || "0";
  const fractionalPart = units.slice(-decimals).replace(/0+$/, "");
  return fractionalPart.length > 0 ? `${integerPart}.${fractionalPart}` : integerPart;
}

function negateMoneyAmount(amount: string): string {
  if (amount === "0") {
    return "0";
  }
  return `-${amount}`;
}

function readProductLineId(product: InferType<typeof productSchema>): string | null {
  const productLineId = Reflect.get(product, "productLineId");
  return typeof productLineId === "string" ? productLineId : null;
}

function getProductGrantEntry(options: { entries: TransactionEntry[], entryIndex: number }): Extract<TransactionEntry, { type: "product_grant" }> {
  const entry = options.entries[options.entryIndex];
  if (entry.type !== "product_grant") {
    throw new StackAssertionError("Refund entry must reference a product grant entry", { entryIndex: options.entryIndex, entry });
  }
  return entry;
}

function buildRefundManualTransaction(options: {
  sourceKind: "subscription" | "one-time-purchase",
  sourceId: string,
  sourceTransactionId: string,
  tenancyId: string,
  sourceEntries: TransactionEntry[],
  refundEntries: RefundEntrySelection[],
  refundAmountStripeUnits: number,
  productLineId: string | null,
  paymentProvider: "test_mode" | "stripe",
  refundedAt: Date,
}): { rowId: string, rowData: ManualTransactionRow } {
  const productGrantEntry = getProductGrantEntry({ entries: options.sourceEntries, entryIndex: 0 });
  const revocationEntries = options.refundEntries.map((refundEntry) => {
    const adjustedEntry = getProductGrantEntry({
      entries: options.sourceEntries,
      entryIndex: refundEntry.entry_index,
    });
    return {
      type: "product-revocation" as const,
      customerType: adjustedEntry.customer_type,
      customerId: adjustedEntry.customer_id,
      adjustedTransactionId: options.sourceTransactionId,
      adjustedEntryIndex: refundEntry.entry_index,
      quantity: refundEntry.quantity,
      productId: adjustedEntry.product_id,
      productLineId: options.productLineId,
    };
  });
  const refundAmount = negateMoneyAmount(stripeUnitsToMoneyAmount(options.refundAmountStripeUnits));
  const createdAtMillis = options.refundedAt.getTime();
  return {
    rowId: `refund:${options.sourceKind}:${options.sourceId}`,
    rowData: {
      txnId: `${options.sourceId}:refund`,
      tenancyId: options.tenancyId,
      effectiveAtMillis: createdAtMillis,
      type: "refund",
      entries: [
        ...revocationEntries,
        {
          type: "money-transfer",
          customerType: productGrantEntry.customer_type,
          customerId: productGrantEntry.customer_id,
          chargedAmount: {
            USD: refundAmount,
          },
        },
      ],
      customerType: productGrantEntry.customer_type,
      customerId: productGrantEntry.customer_id,
      paymentProvider: options.paymentProvider,
      createdAtMillis,
    },
  };
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
      refund_entries: yupArray(
        yupObject({
          entry_index: yupNumber().integer().defined(),
          quantity: yupNumber().integer().defined(),
          amount_usd: moneyAmountSchema(USD_CURRENCY).defined(),
        }).defined(),
      ).defined(),
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
    const refundEntries = body.refund_entries.map((entry) => ({
      ...entry,
      amount_usd: entry.amount_usd as MoneyAmount,
    }));
    if (body.type === "subscription") {
      const subscription = await prisma.subscription.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
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
      const transaction = buildSubscriptionTransaction({ subscription });
      validateRefundEntries({
        entries: transaction.entries,
        refundEntries,
      });
      const refundedQuantity = getRefundedQuantity(refundEntries);
      const totalStripeUnits = getTotalUsdStripeUnits({
        product: subscription.product as InferType<typeof productSchema>,
        priceId: subscription.priceId ?? null,
        quantity: subscription.quantity,
      });
      const refundAmountStripeUnits = getRefundAmountStripeUnits(refundEntries);
      if (refundAmountStripeUnits < 0) {
        throw new KnownErrors.SchemaError("Refund amount cannot be negative.");
      }
      if (refundAmountStripeUnits > totalStripeUnits) {
        throw new KnownErrors.SchemaError("Refund amount cannot exceed the charged amount.");
      }
      await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: refundAmountStripeUnits,
      });
      const refundedAt = new Date();
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
          items: [{
            id: subscriptionItem.id,
            quantity: newQuantity,
          }],
        });
        await prisma.subscription.update({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
          data: {
            cancelAtPeriodEnd: newQuantity === 0,
            refundedAt,
          },
        });
      } else {
        await prisma.subscription.update({
          where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
          data: { refundedAt },
        });
      }
      // dual write - prisma and bulldozer
      const updatedSub = await prisma.subscription.findUniqueOrThrow({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
      });
      await bulldozerWriteSubscription(prisma, updatedSub);
      const manualRefund = buildRefundManualTransaction({
        sourceKind: "subscription",
        sourceId: subscription.id,
        sourceTransactionId: `sub-start:${subscription.id}`,
        tenancyId: auth.tenancy.id,
        sourceEntries: transaction.entries,
        refundEntries,
        refundAmountStripeUnits,
        productLineId: readProductLineId(subscription.product as InferType<typeof productSchema>),
        paymentProvider: subscription.creationSource === "TEST_MODE" ? "test_mode" : "stripe",
        refundedAt,
      });
      await bulldozerWriteManualTransaction(prisma, manualRefund.rowId, manualRefund.rowData);
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
      const transaction = buildOneTimePurchaseTransaction({ purchase });
      validateRefundEntries({
        entries: transaction.entries,
        refundEntries,
      });
      const totalStripeUnits = getTotalUsdStripeUnits({
        product: purchase.product as InferType<typeof productSchema>,
        priceId: purchase.priceId ?? null,
        quantity: purchase.quantity,
      });
      const refundAmountStripeUnits = getRefundAmountStripeUnits(refundEntries);
      if (refundAmountStripeUnits < 0) {
        throw new KnownErrors.SchemaError("Refund amount cannot be negative.");
      }
      if (refundAmountStripeUnits > totalStripeUnits) {
        throw new KnownErrors.SchemaError("Refund amount cannot exceed the charged amount.");
      }
      await stripe.refunds.create({
        payment_intent: purchase.stripePaymentIntentId,
        amount: refundAmountStripeUnits,
        metadata: {
          tenancyId: auth.tenancy.id,
          purchaseId: purchase.id,
        },
      });
      const refundedAt = new Date();
      await prisma.oneTimePurchase.update({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
        data: { refundedAt },
      });
      // dual write - prisma and bulldozer
      const updatedPurchase = await prisma.oneTimePurchase.findUniqueOrThrow({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.id } },
      });
      await bulldozerWriteOneTimePurchase(prisma, updatedPurchase);
      const manualRefund = buildRefundManualTransaction({
        sourceKind: "one-time-purchase",
        sourceId: purchase.id,
        sourceTransactionId: `otp:${purchase.id}`,
        tenancyId: auth.tenancy.id,
        sourceEntries: transaction.entries,
        refundEntries,
        refundAmountStripeUnits,
        productLineId: readProductLineId(purchase.product as InferType<typeof productSchema>),
        paymentProvider: "stripe",
        refundedAt,
      });
      await bulldozerWriteManualTransaction(prisma, manualRefund.rowId, manualRefund.rowData);
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
