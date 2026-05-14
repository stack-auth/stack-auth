import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { createBulldozerExecutionContext, toQueryableSqlQuery } from "@/lib/bulldozer/db/index";
import { quoteSqlStringLiteral } from "@/lib/bulldozer/db/utilities";
import { bulldozerWriteManualTransaction, bulldozerWriteOneTimePurchase, bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { REFUND_TXN_PREFIX } from "@/lib/payments/refund-txn-id";
import { resolveSelectedPriceFromProduct } from "@/app/api/latest/internal/payments/transactions/transaction-builder";
import { ONE_TIME_PURCHASE_PRODUCT_GRANT_ENTRY_INDEX, SUBSCRIPTION_START_PRODUCT_GRANT_ENTRY_INDEX } from "@/lib/payments/schema/phase-1/transactions";
import { paymentsSchema } from "@/lib/payments/schema/singleton";
import type { ManualTransactionRow, TransactionEntryData } from "@/lib/payments/schema/types";
import { getStripeForAccount } from "@/lib/stripe";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, type PrismaClientTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, adminAuthTypeSchema, moneyAmountSchema, productSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { moneyAmountToStripeUnits } from "@stackframe/stack-shared/dist/utils/currencies";
import { SUPPORTED_CURRENCIES, type MoneyAmount } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import type Stripe from "stripe";
import { InferType } from "yup";

const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD")
  ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

/**
 * Builds parameters for `stripe.refunds.create`. The platform-fee invariant —
 * we never let Stripe reverse our charge-leg 0.9% application fee on refund —
 * lives here so it has exactly one source of truth.
 */
export function buildStripeRefundParams(args: {
  paymentIntentId: string,
  amountStripeUnits: number,
  metadata?: Record<string, string>,
}): Stripe.RefundCreateParams {
  return {
    payment_intent: args.paymentIntentId,
    amount: args.amountStripeUnits,
    ...(args.metadata ? { metadata: args.metadata } : {}),
    refund_application_fee: false,
  };
}

/**
 * Formats stripe units as a decimal money string with the currency's full
 * decimal places — this is the canonical shape for `moneyAmountToStripeUnits`
 * (which right-pads the fractional part to currency.decimals before
 * stripping the dot, so shorter inputs like "5" also round-trip correctly).
 * E.g. for USD: 5000 → "50.00", 1 → "0.01", 100 → "1.00".
 */
function stripeUnitsToMoneyAmount(stripeUnits: number): string {
  if (!Number.isFinite(stripeUnits) || Math.trunc(stripeUnits) !== stripeUnits) {
    throw new StackAssertionError("Stripe units must be an integer", { stripeUnits });
  }
  const absolute = Math.abs(stripeUnits);
  const decimals = USD_CURRENCY.decimals;
  const units = absolute.toString().padStart(decimals + 1, "0");
  const integerPart = units.slice(0, -decimals) || "0";
  const fractionalPart = units.slice(-decimals);
  return `${integerPart}.${fractionalPart}`;
}

function readProductLineId(product: InferType<typeof productSchema>): string | null {
  const productLineId = Reflect.get(product, "productLineId");
  return typeof productLineId === "string" ? productLineId : null;
}

function getTotalUsdStripeUnits(options: {
  product: InferType<typeof productSchema>,
  priceId: string | null,
  quantity: number,
}): number {
  const selectedPrice = resolveSelectedPriceFromProduct(options.product, options.priceId);
  const usdPrice = selectedPrice?.USD;
  if (typeof usdPrice !== "string") {
    throw new KnownErrors.SchemaError("Refunds are only supported for USD-priced purchases.");
  }
  if (!Number.isFinite(options.quantity) || Math.trunc(options.quantity) !== options.quantity) {
    throw new StackAssertionError("Purchase quantity is not an integer", { quantity: options.quantity });
  }
  return moneyAmountToStripeUnits(usdPrice as MoneyAmount, USD_CURRENCY) * options.quantity;
}

// ── Refund row construction ────────────────────────────────────────────────

function makeRefundTxnId(sourceTxnId: string): string {
  return `${REFUND_TXN_PREFIX}${sourceTxnId}:${randomUUID()}`;
}

/**
 * Derive a deterministic Stripe idempotency key from the tenancy, source
 * transaction, refund amount, and the cumulative amount already refunded
 * before this call. A network-level retry of the same admin click hits all
 * three identical inputs and dedupes at Stripe. Two intentional partials of
 * the same amount get distinct keys because `priorRefundedStripeUnits`
 * advances after the first one commits.
 */
function makeStripeIdempotencyKey(args: {
  tenancyId: string,
  sourceTxnId: string,
  amountStripeUnits: number,
  priorRefundedStripeUnits: number,
}): string {
  const fingerprint = `${args.tenancyId}:${args.sourceTxnId}:${args.amountStripeUnits}:${args.priorRefundedStripeUnits}`;
  return `refund:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 32)}`;
}

function buildProductRevocationEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  sourceTxnId: string,
  productGrantEntryIndex: number,
  productId: string | null,
  productLineId: string | null,
  quantity: number,
}): Extract<TransactionEntryData, { type: "product-revocation" }> {
  return {
    type: "product-revocation",
    customerType: options.customerType,
    customerId: options.customerId,
    adjustedTransactionId: options.sourceTxnId,
    adjustedEntryIndex: options.productGrantEntryIndex,
    quantity: options.quantity,
    productId: options.productId,
    productLineId: options.productLineId,
  };
}

/**
 * Money-transfer entry on a refund row. The amount is stored as a positive
 * decimal money string; the parent `type: "refund"` is the semantic
 * discriminator that tells consumers this is money flowing back to the
 * customer. (Storing a literal negative would break `moneyAmountSchema`,
 * which requires non-negative values.)
 */
function buildMoneyTransferEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  refundAmountStripeUnits: number,
}): Extract<TransactionEntryData, { type: "money-transfer" }> {
  return {
    type: "money-transfer",
    customerType: options.customerType,
    customerId: options.customerId,
    chargedAmount: {
      USD: stripeUnitsToMoneyAmount(options.refundAmountStripeUnits),
    },
  };
}

// ── Bulldozer reads: prior refund summary for a source txn ─────────────────

type PriorRefundSummary = {
  refundedStripeUnits: number,
  productRevoked: boolean,
};

async function readPriorRefundSummary(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
  sourceTxnId: string,
}): Promise<PriorRefundSummary> {
  const executionContext = createBulldozerExecutionContext();
  const baseSql = toQueryableSqlQuery(paymentsSchema.transactions.listRowsInGroup(executionContext, {
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));
  const sql = `
    SELECT "__rows"."rowdata" AS "rowData"
    FROM (${baseSql}) AS "__rows"
    WHERE "__rows"."rowdata"->>'tenancyId' = ${quoteSqlStringLiteral(options.tenancyId).sql}
      AND "__rows"."rowdata"->>'type' = 'refund'
      AND "__rows"."rowdata"->>'customerType' = ${quoteSqlStringLiteral(options.customerType).sql}
      AND "__rows"."rowdata"->>'customerId' = ${quoteSqlStringLiteral(options.customerId).sql}
      -- LIKE pattern is safe today because source txnIds are
      -- 'sub-start:<uuid>' / 'sub-renewal:<id>' / 'otp:<id>' — none of
      -- which contain LIKE metacharacters (percent / underscore / backslash).
      -- If a future source format introduces those, escape them before
      -- interpolation.
      AND ("__rows"."rowdata"->>'txnId') LIKE ${quoteSqlStringLiteral(`${REFUND_TXN_PREFIX}${options.sourceTxnId}:%`).sql}
  `;
  const rows = await options.prisma.$queryRaw<Array<{ rowData: unknown }>>`${Prisma.raw(sql)}`;
  let refundedStripeUnits = 0;
  let productRevoked = false;
  for (const row of rows) {
    const rowData = row.rowData;
    if (typeof rowData !== "object" || rowData === null) continue;
    const entries = Reflect.get(rowData, "entries");
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const type = Reflect.get(entry, "type");
      if (type === "product-revocation") {
        const adjustedTxnId = Reflect.get(entry, "adjustedTransactionId");
        if (adjustedTxnId === options.sourceTxnId) {
          productRevoked = true;
        }
      } else if (type === "money-transfer") {
        const chargedAmount = Reflect.get(entry, "chargedAmount");
        if (typeof chargedAmount !== "object" || chargedAmount === null) continue;
        const usd = Reflect.get(chargedAmount, "USD");
        if (typeof usd !== "string") continue;
        // Refund money-transfer entries store positive amounts (the refund
        // row's `type: "refund"` carries the sign); guard against legacy data
        // that may have a leading minus.
        const absolute = usd.startsWith("-") ? usd.slice(1) : usd;
        refundedStripeUnits += moneyAmountToStripeUnits(absolute as MoneyAmount, USD_CURRENCY);
      }
    }
  }
  return { refundedStripeUnits, productRevoked };
}

// ── Bulldozer reads: outstanding item grants for an OTP ────────────────────
//
// Subscriptions get their item grants expired automatically: setting
// `endedAt` triggers the subscription timefold to emit a `subscription-end`
// event whose `itemQuantityChangesToExpire` covers every still-outstanding
// grant (initial + item-grant-repeats). OTPs have no equivalent end event —
// `revokedAt` only stops the OTP timefold from scheduling future repeats —
// so any items granted by prior `item-grant-repeat` txns (and by the OTP
// itself with `expiresWhen: "when-purchase-expires"`) would remain valid
// forever after a revoke. To close that gap, the refund row emits explicit
// `item-quantity-expire` entries for every outstanding grant whose
// `expiresWhen` is `"when-purchase-expires"` or `"when-repeated"`. Permanent
// grants (`expiresWhen: null`) are intentionally left alone, matching the
// subscription-end filter — see `subscription-timefold-algo.ts:430-441`.

type OutstandingItemGrant = {
  txnId: string,
  entryIndex: number,
  itemId: string,
  quantity: number,
};

/**
 * Pure dedup logic: given the OTP txn and all its item-grant-repeat txns,
 * collect every `item-quantity-change` entry then subtract any grant already
 * referenced by a later `item-quantity-expire` entry (which is how
 * "when-repeated" grants get retired by subsequent IGRs). Entries with
 * `expiresWhen: null` are excluded — they're permanent by design.
 */
export function computeOutstandingItemGrantsForOtp(
  rows: Array<{ txnId: unknown, entries: unknown }>,
): OutstandingItemGrant[] {
  const grants: OutstandingItemGrant[] = [];
  const expiredKeys = new Set<string>();
  const grantKey = (txnId: string, entryIndex: number) => `${txnId}:${entryIndex}`;

  for (const row of rows) {
    const txnId = row.txnId;
    if (typeof txnId !== "string") continue;
    const entries = row.entries;
    if (!Array.isArray(entries)) continue;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (typeof entry !== "object" || entry === null) continue;
      const type = Reflect.get(entry, "type");
      if (type === "item-quantity-change") {
        const expiresWhen = Reflect.get(entry, "expiresWhen");
        if (expiresWhen !== "when-purchase-expires" && expiresWhen !== "when-repeated") {
          // Permanent grants survive revocation (matches sub-end semantics).
          continue;
        }
        const itemId = Reflect.get(entry, "itemId");
        const quantity = Reflect.get(entry, "quantity");
        if (typeof itemId !== "string" || typeof quantity !== "number") continue;
        grants.push({ txnId, entryIndex: index, itemId, quantity });
      } else if (type === "item-quantity-expire") {
        const adjustedTxnId = Reflect.get(entry, "adjustedTransactionId");
        const adjustedIdx = Reflect.get(entry, "adjustedEntryIndex");
        if (typeof adjustedTxnId !== "string" || typeof adjustedIdx !== "number") continue;
        expiredKeys.add(grantKey(adjustedTxnId, adjustedIdx));
      }
    }
  }

  return grants.filter((g) => !expiredKeys.has(grantKey(g.txnId, g.entryIndex)));
}

async function readOutstandingItemGrantsForOtp(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
  purchaseId: string,
}): Promise<OutstandingItemGrant[]> {
  const executionContext = createBulldozerExecutionContext();
  const baseSql = toQueryableSqlQuery(paymentsSchema.transactions.listRowsInGroup(executionContext, {
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));
  const otpTxnId = `otp:${options.purchaseId}`;
  const igrPrefix = `igr:${options.purchaseId}:`;
  // LIKE pattern safety: purchaseId is a UUID and the igr txnId format is
  // `igr:<purchaseId>:<effectiveAtMillis>` — neither contains LIKE
  // metacharacters today. Same caveat as `readPriorRefundSummary` above.
  const sql = `
    SELECT "__rows"."rowdata" AS "rowData"
    FROM (${baseSql}) AS "__rows"
    WHERE "__rows"."rowdata"->>'tenancyId' = ${quoteSqlStringLiteral(options.tenancyId).sql}
      AND "__rows"."rowdata"->>'customerType' = ${quoteSqlStringLiteral(options.customerType).sql}
      AND "__rows"."rowdata"->>'customerId' = ${quoteSqlStringLiteral(options.customerId).sql}
      AND (
        ("__rows"."rowdata"->>'txnId') = ${quoteSqlStringLiteral(otpTxnId).sql}
        OR (
          ("__rows"."rowdata"->>'type') = 'item-grant-repeat'
          AND ("__rows"."rowdata"->>'txnId') LIKE ${quoteSqlStringLiteral(`${igrPrefix}%`).sql}
        )
      )
  `;
  const rows = await options.prisma.$queryRaw<Array<{ rowData: unknown }>>`${Prisma.raw(sql)}`;
  return computeOutstandingItemGrantsForOtp(rows.map((row) => {
    const rowData = row.rowData;
    if (typeof rowData !== "object" || rowData === null) {
      return { txnId: null, entries: null };
    }
    return {
      txnId: Reflect.get(rowData, "txnId"),
      entries: Reflect.get(rowData, "entries"),
    };
  }));
}

// ── Stripe payment-intent resolution for invoice refunds ───────────────────

async function resolveInvoicePaymentIntentId(stripe: Stripe, stripeInvoiceId: string): Promise<string> {
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ["payments"] });
  const payments = invoice.payments?.data;
  if (!payments || payments.length === 0) {
    throw new StackAssertionError("Invoice has no payments", { stripeInvoiceId });
  }
  const paidPayment = payments.find((payment) => payment.status === "paid");
  if (!paidPayment) {
    throw new StackAssertionError("Invoice has no paid payment", { stripeInvoiceId });
  }
  const paymentIntentId = paidPayment.payment.payment_intent;
  if (!paymentIntentId || typeof paymentIntentId !== "string") {
    throw new StackAssertionError("Payment has no payment intent", { stripeInvoiceId });
  }
  return paymentIntentId;
}

// ── Route ─────────────────────────────────────────────────────────────────

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      type: yupString().oneOf(["subscription", "one-time-purchase"]).defined(),
      id: yupString().defined(),
      invoice_id: yupString().optional(),
      amount_usd: moneyAmountSchema(USD_CURRENCY).defined(),
      // `end_action` collapses the previous two-flag API (`revoke_product`,
      // `end_subscription`) into a single tri-state matching the dashboard's
      // section-2 lifecycle picker:
      //   "now"           → end product access immediately. For subs:
      //                     cancel Stripe immediately + set endedAt=now +
      //                     write a product-revocation entry on the refund
      //                     row (which expires outstanding item grants via
      //                     subscription-end). For OTPs: set revokedAt=now +
      //                     write product-revocation + emit explicit
      //                     item-quantity-expire entries (no sub-end exists
      //                     for OTPs).
      //   "at-period-end" → cancel-at-period-end on the Stripe sub + set
      //                     endedAt=currentPeriodEnd. Subscriptions only —
      //                     OTPs have no period.
      //   undefined       → no lifecycle change; refund money only.
      end_action: yupString().oneOf(["now", "at-period-end"]).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
      refund_transaction_id: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const amountUsd = body.amount_usd as MoneyAmount;
    const amountStripeUnits = moneyAmountToStripeUnits(amountUsd, USD_CURRENCY);
    const endAction = body.end_action;

    if (amountStripeUnits < 0) {
      throw new KnownErrors.SchemaError("Refund amount cannot be negative.");
    }

    if (body.type === "one-time-purchase") {
      if (body.invoice_id !== undefined) {
        throw new KnownErrors.SchemaError("invoice_id is not applicable to one-time purchases.");
      }
      if (endAction === "at-period-end") {
        throw new KnownErrors.SchemaError("end_action='at-period-end' is only valid for subscriptions; one-time purchases have no period.");
      }
      if (amountStripeUnits === 0 && endAction === undefined) {
        throw new KnownErrors.SchemaError("Refund must do something: specify a non-zero amount or set end_action='now'.");
      }
      return await handleOneTimePurchaseRefund({
        prisma,
        tenancy: auth.tenancy,
        purchaseId: body.id,
        amountUsd,
        amountStripeUnits,
        endNow: endAction === "now",
      });
    }

    // subscription path
    if (amountStripeUnits === 0 && endAction === undefined) {
      throw new KnownErrors.SchemaError("Refund must do something: specify a non-zero amount or set end_action.");
    }
    return await handleSubscriptionRefund({
      prisma,
      tenancy: auth.tenancy,
      subscriptionId: body.id,
      invoiceId: body.invoice_id,
      amountUsd,
      amountStripeUnits,
      endAction,
    });
  },
});

// ── Subscription refund handler ────────────────────────────────────────────
//
// Known concurrency / atomicity gaps (deferred to a follow-up):
//
// 1. **Race on cap check.** Two concurrent refund requests for the same
//    source can both call `readPriorRefundSummary` before either commits its
//    refund row, so both pass the cap check and over-refund. Wrapping this
//    flow in a Prisma `$transaction` does NOT fix it — `bulldozerWriteManualTransaction`
//    embeds its own `BEGIN; ... COMMIT;` (see `lib/bulldozer/db/index.ts:162`),
//    so its writes commit independently of any outer Prisma tx. A real fix
//    needs either a bulldozer-aware mutex (writes-table sentinel row, advisory
//    lock taken on a long-lived dedicated connection, etc.) or a "pending
//    refund intent" pattern that participates in the cap calc before Stripe is
//    called. In practice, refunds are admin-only and rare, so the race window
//    is small.
//
// 2. **Stripe + DB are not atomic.** A successful `stripe.refunds.create`
//    followed by a write failure leaves the customer refunded with no ledger
//    row. The Stripe idempotency key is derived from
//    `(tenancyId, sourceTxnId, amountStripeUnits, priorRefundedStripeUnits)`
//    — *not* from `refundTxnId` — so:
//      - Stripe-success → DB-fail → caller retries: `prior` is unchanged
//        (no row committed), the key matches, Stripe dedupes, and the
//        second attempt's bulldozer write recovers the state. Self-heals.
//      - DB-success → response lost → caller retries: `prior` now includes
//        the just-committed amount, so a fresh key is generated and Stripe
//        issues a second real refund. This is the open hole — no
//        out-of-band reconciliation today. Tracked alongside (1).
async function handleSubscriptionRefund(options: {
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancy: Tenancy,
  subscriptionId: string,
  invoiceId: string | undefined,
  amountUsd: MoneyAmount,
  amountStripeUnits: number,
  endAction: "now" | "at-period-end" | undefined,
}) {
  const { prisma, tenancy } = options;
  const endNow = options.endAction === "now";
  const endAtPeriodEnd = options.endAction === "at-period-end";
  const subscription = await prisma.subscription.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: options.subscriptionId } },
  });
  if (!subscription) {
    throw new KnownErrors.SubscriptionInvoiceNotFound(options.subscriptionId);
  }
  // Legacy refund backstop: the pre-rework flow set `refundedAt` and gated
  // all further refunds on it. The new bulldozer-derived prior-refund
  // summary doesn't see those legacy refunds, so without this gate an admin
  // could double-refund through Stripe on a previously-refunded purchase.
  // Preserve the legacy `SubscriptionAlreadyRefunded` known-error code so
  // callers catching by code still work.
  if (subscription.refundedAt) {
    throw new KnownErrors.SubscriptionAlreadyRefunded(subscription.id);
  }

  // End-at-period-end replay guard. The empty-entries refund row written by
  // `amount=0, end_action="at-period-end"` is not visible to
  // `readPriorRefundSummary` (which only tracks money + product-revocation),
  // so without this gate the call is a forever-no-op that accumulates phantom
  // rows on each replay. The sub's lifecycle state is authoritative here.
  if (options.amountStripeUnits === 0 && endAtPeriodEnd) {
    if (subscription.cancelAtPeriodEnd || subscription.endedAt) {
      throw new KnownErrors.SchemaError("Subscription is already scheduled to end.");
    }
  }

  const customerType = subscription.customerType.toLowerCase() as "user" | "team" | "custom";
  const isTestMode = subscription.creationSource === "TEST_MODE";
  const product = subscription.product as InferType<typeof productSchema>;
  const productLineId = readProductLineId(product);

  if (isTestMode && options.amountStripeUnits > 0) {
    throw new KnownErrors.TestModePurchaseNonRefundable();
  }

  // Determine which invoice this refund targets — defaults to the start invoice.
  let invoice: { id: string, stripeInvoiceId: string, amountTotal: number | null } | null = null;
  let sourceTxnId: string;
  if (options.invoiceId !== undefined) {
    const found = await prisma.subscriptionInvoice.findUnique({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: options.invoiceId } },
    });
    if (!found || found.stripeSubscriptionId !== subscription.stripeSubscriptionId) {
      throw new KnownErrors.SubscriptionInvoiceNotFound(options.invoiceId);
    }
    // `end_action="now"` is a sub-wide action (the product grant lives on
    // the sub-start txn, not on renewal txns), so it can only meaningfully
    // be paired with a refund targeting the creation invoice — or the default
    // no-invoice-id call which already implies start. Targeting a renewal
    // invoice with immediate end would write a product-revocation entry
    // pointing at a non-existent entry on the renewal txn.
    if (endNow && !found.isSubscriptionCreationInvoice) {
      throw new KnownErrors.SchemaError("Cannot end product access immediately when refunding a renewal invoice — product revocation applies to the subscription as a whole. Omit invoice_id or pass the creation invoice id.");
    }
    invoice = { id: found.id, stripeInvoiceId: found.stripeInvoiceId, amountTotal: found.amountTotal };
    sourceTxnId = found.isSubscriptionCreationInvoice
      ? `sub-start:${subscription.id}`
      : `sub-renewal:${found.id}`;
  } else if (!isTestMode) {
    const startInvoices = await prisma.subscriptionInvoice.findMany({
      where: {
        tenancyId: tenancy.id,
        isSubscriptionCreationInvoice: true,
        subscription: { tenancyId: tenancy.id, id: subscription.id },
      },
    });
    if (startInvoices.length === 0) {
      throw new KnownErrors.SubscriptionInvoiceNotFound(subscription.id);
    }
    if (startInvoices.length > 1) {
      throw new StackAssertionError("Multiple subscription creation invoices found for subscription", { subscriptionId: subscription.id });
    }
    const startInvoice = startInvoices[0];
    invoice = { id: startInvoice.id, stripeInvoiceId: startInvoice.stripeInvoiceId, amountTotal: startInvoice.amountTotal };
    sourceTxnId = `sub-start:${subscription.id}`;
  } else {
    // test-mode sub has no invoice; refund references the synthetic start txn.
    sourceTxnId = `sub-start:${subscription.id}`;
  }

  // Cap = original − sum(prior refunds for this source txn). Test-mode subs
  // have no money flow (amount must be 0 anyway, see check above), so the cap
  // is irrelevant — short-circuit to 0 to avoid a USD-only throw on non-USD
  // test-mode products. In live mode, `getTotalUsdStripeUnits` enforces
  // USD-only pricing (throws otherwise). The invoice's `amountTotal` is the
  // more accurate cap (reflects proration, quantity changes, discounts), but
  // SubscriptionInvoice doesn't persist the invoice currency — so we only
  // trust `amountTotal` after the USD pre-flight has succeeded.
  const productCapStripeUnits = isTestMode
    ? 0
    : getTotalUsdStripeUnits({
      product,
      priceId: subscription.priceId ?? null,
      quantity: subscription.quantity,
    });
  const totalStripeUnits = isTestMode
    ? 0
    : (invoice?.amountTotal ?? productCapStripeUnits);

  const prior = await readPriorRefundSummary({
    prisma,
    tenancyId: tenancy.id,
    customerType,
    customerId: subscription.customerId,
    sourceTxnId,
  });
  const remainingStripeUnits = Math.max(0, totalStripeUnits - prior.refundedStripeUnits);
  if (options.amountStripeUnits > remainingStripeUnits) {
    throw new KnownErrors.SchemaError(`Refund amount cannot exceed the remaining refundable amount ($${stripeUnitsToMoneyAmount(remainingStripeUnits)}).`);
  }
  if (endNow && prior.productRevoked) {
    throw new KnownErrors.SchemaError("This subscription's product has already been revoked.");
  }

  const refundTxnId = makeRefundTxnId(sourceTxnId);

  // ── Stripe side ───────────────────────────────────────────────────────
  if (options.amountStripeUnits > 0 && !isTestMode) {
    const stripe = await getStripeForAccount({ tenancy });
    const paymentIntentId = await resolveInvoicePaymentIntentId(stripe, invoice!.stripeInvoiceId);
    await stripe.refunds.create(
      buildStripeRefundParams({
        paymentIntentId,
        amountStripeUnits: options.amountStripeUnits,
        metadata: {
          tenancyId: tenancy.id,
          subscriptionId: subscription.id,
          refundTxnId,
          ...(invoice ? { invoiceId: invoice.id } : {}),
        },
      }),
      {
        idempotencyKey: makeStripeIdempotencyKey({
          tenancyId: tenancy.id,
          sourceTxnId,
          amountStripeUnits: options.amountStripeUnits,
          priorRefundedStripeUnits: prior.refundedStripeUnits,
        }),
      },
    );
  }

  // ── Lifecycle: Prisma + Stripe ────────────────────────────────────────
  const now = new Date();
  let updatedSub: typeof subscription | null = null;
  if (endNow) {
    // Immediate end. Stripe sub canceled, Prisma endedAt=now → timefold
    // auto-emits subscription-end with item-quantity-expire entries. Preserve
    // an existing `endedAt` if the sub already ended naturally — clobbering
    // it with a later `now` would re-trigger the sub-end event with stale
    // outstandingGrants state.
    if (!isTestMode && subscription.stripeSubscriptionId) {
      const stripe = await getStripeForAccount({ tenancy });
      // Idempotent cancel: the Stripe sub may already be canceled (natural
      // end before this refund). `resource_missing` is what Stripe returns
      // when the sub no longer exists; `subscription_already_canceled` is
      // the documented code for re-cancel on an existing-but-canceled sub.
      // Neither is an error from our perspective.
      try {
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code !== "resource_missing" && code !== "subscription_already_canceled") {
          throw e;
        }
      }
    }
    updatedSub = await prisma.subscription.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: subscription.id } },
      data: {
        // Don't touch `cancelAtPeriodEnd` — it's meaningless once `endedAt`
        // is in the past, and writing `true` alongside an immediate `endedAt`
        // creates inconsistent state for any reader that consults the flag
        // without joining `endedAt`.
        status: "canceled",
        canceledAt: subscription.canceledAt ?? now,
        endedAt: subscription.endedAt ?? now,
      },
    });
  } else if (endAtPeriodEnd) {
    // End at period end. Items follow natural lifecycle when sub-end fires
    // at period boundary.
    if (!isTestMode && subscription.stripeSubscriptionId) {
      const stripe = await getStripeForAccount({ tenancy });
      // Same idempotent-cancel guard as the endNow branch above. The Stripe
      // money refund has already been issued at this point (lines ~585-608),
      // so an unhandled `subscription_already_canceled` / `resource_missing`
      // error here would propagate up before `bulldozerWriteManualTransaction`
      // commits the ledger row, leaving the customer refunded with no record.
      // Reachable when an admin pairs `amount > 0` with `end_action="at-period-end"`
      // on a sub that's already terminal (the empty-amount case is caught
      // earlier by the replay guard).
      try {
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code !== "resource_missing" && code !== "subscription_already_canceled") {
          throw e;
        }
      }
    }
    updatedSub = await prisma.subscription.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: subscription.id } },
      data: {
        cancelAtPeriodEnd: true,
        canceledAt: subscription.canceledAt ?? now,
        endedAt: subscription.endedAt ?? subscription.currentPeriodEnd,
      },
    });
  }

  if (updatedSub) {
    await bulldozerWriteSubscription(prisma, updatedSub);
  }

  // ── Refund row ────────────────────────────────────────────────────────
  const refundEntries: TransactionEntryData[] = [];
  if (options.amountStripeUnits > 0 && !isTestMode) {
    refundEntries.push(buildMoneyTransferEntry({
      customerType,
      customerId: subscription.customerId,
      refundAmountStripeUnits: options.amountStripeUnits,
    }));
  }
  if (endNow) {
    refundEntries.push(buildProductRevocationEntry({
      customerType,
      customerId: subscription.customerId,
      sourceTxnId,
      productGrantEntryIndex: SUBSCRIPTION_START_PRODUCT_GRANT_ENTRY_INDEX,
      productId: subscription.productId ?? null,
      productLineId,
      quantity: subscription.quantity,
    }));
  }

  const nowMillis = now.getTime();
  const refundRow: ManualTransactionRow = {
    txnId: refundTxnId,
    tenancyId: tenancy.id,
    effectiveAtMillis: nowMillis,
    type: "refund",
    entries: refundEntries,
    customerType,
    customerId: subscription.customerId,
    paymentProvider: isTestMode ? "test_mode" : "stripe",
    createdAtMillis: nowMillis,
  };
  await bulldozerWriteManualTransaction(prisma, refundTxnId, refundRow);

  return {
    statusCode: 200 as const,
    bodyType: "json" as const,
    body: { success: true, refund_transaction_id: refundTxnId },
  };
}

// ── One-time-purchase refund handler ───────────────────────────────────────
//
// See the concurrency / atomicity caveats on `handleSubscriptionRefund`
// above — the cap-check race and Stripe-vs-DB non-atomicity apply equally
// to OTPs.
async function handleOneTimePurchaseRefund(options: {
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancy: Tenancy,
  purchaseId: string,
  amountUsd: MoneyAmount,
  amountStripeUnits: number,
  endNow: boolean,
}) {
  const { prisma, tenancy } = options;
  const purchase = await prisma.oneTimePurchase.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: options.purchaseId } },
  });
  if (!purchase) {
    throw new KnownErrors.OneTimePurchaseNotFound(options.purchaseId);
  }
  // Legacy refund backstop — see handleSubscriptionRefund above. Preserves
  // the legacy `OneTimePurchaseAlreadyRefunded` known-error code for callers
  // catching by code.
  if (purchase.refundedAt) {
    throw new KnownErrors.OneTimePurchaseAlreadyRefunded(purchase.id);
  }

  const customerType = purchase.customerType.toLowerCase() as "user" | "team" | "custom";
  const isTestMode = purchase.creationSource === "TEST_MODE";
  const product = purchase.product as InferType<typeof productSchema>;
  const productLineId = readProductLineId(product);

  if (isTestMode && options.amountStripeUnits > 0) {
    throw new KnownErrors.TestModePurchaseNonRefundable();
  }

  const sourceTxnId = `otp:${purchase.id}`;
  const totalStripeUnits = isTestMode
    ? 0
    : getTotalUsdStripeUnits({
      product,
      priceId: purchase.priceId ?? null,
      quantity: purchase.quantity,
    });

  const prior = await readPriorRefundSummary({
    prisma,
    tenancyId: tenancy.id,
    customerType,
    customerId: purchase.customerId,
    sourceTxnId,
  });
  const remainingStripeUnits = Math.max(0, totalStripeUnits - prior.refundedStripeUnits);
  if (options.amountStripeUnits > remainingStripeUnits) {
    throw new KnownErrors.SchemaError(`Refund amount cannot exceed the remaining refundable amount ($${stripeUnitsToMoneyAmount(remainingStripeUnits)}).`);
  }
  if (options.endNow && prior.productRevoked) {
    throw new KnownErrors.SchemaError("This purchase's product has already been revoked.");
  }

  const refundTxnId = makeRefundTxnId(sourceTxnId);

  // ── Stripe side ───────────────────────────────────────────────────────
  if (options.amountStripeUnits > 0 && !isTestMode) {
    if (!purchase.stripePaymentIntentId) {
      throw new StackAssertionError("Live-mode one-time purchase missing stripePaymentIntentId", { purchaseId: purchase.id });
    }
    const stripe = await getStripeForAccount({ tenancy });
    await stripe.refunds.create(
      buildStripeRefundParams({
        paymentIntentId: purchase.stripePaymentIntentId,
        amountStripeUnits: options.amountStripeUnits,
        metadata: { tenancyId: tenancy.id, purchaseId: purchase.id, refundTxnId },
      }),
      {
        idempotencyKey: makeStripeIdempotencyKey({
          tenancyId: tenancy.id,
          sourceTxnId,
          amountStripeUnits: options.amountStripeUnits,
          priorRefundedStripeUnits: prior.refundedStripeUnits,
        }),
      },
    );
  }

  // ── Lifecycle: Prisma ─────────────────────────────────────────────────
  const now = new Date();
  if (options.endNow) {
    const updatedPurchase = await prisma.oneTimePurchase.update({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: purchase.id } },
      data: { revokedAt: now },
    });
    await bulldozerWriteOneTimePurchase(prisma, updatedPurchase);
  }

  // ── Refund row ────────────────────────────────────────────────────────
  const refundEntries: TransactionEntryData[] = [];
  if (options.amountStripeUnits > 0 && !isTestMode) {
    refundEntries.push(buildMoneyTransferEntry({
      customerType,
      customerId: purchase.customerId,
      refundAmountStripeUnits: options.amountStripeUnits,
    }));
  }
  if (options.endNow) {
    refundEntries.push(buildProductRevocationEntry({
      customerType,
      customerId: purchase.customerId,
      sourceTxnId,
      productGrantEntryIndex: ONE_TIME_PURCHASE_PRODUCT_GRANT_ENTRY_INDEX,
      productId: purchase.productId ?? null,
      productLineId,
      quantity: purchase.quantity,
    }));
    // Expire outstanding item grants from the OTP txn and any
    // item-grant-repeat txns. See the helper docs above for the rationale —
    // OTPs have no equivalent of the subscription-end cascade.
    const outstandingGrants = await readOutstandingItemGrantsForOtp({
      prisma,
      tenancyId: tenancy.id,
      customerType,
      customerId: purchase.customerId,
      purchaseId: purchase.id,
    });
    for (const grant of outstandingGrants) {
      refundEntries.push({
        type: "item-quantity-expire",
        customerType,
        customerId: purchase.customerId,
        adjustedTransactionId: grant.txnId,
        adjustedEntryIndex: grant.entryIndex,
        itemId: grant.itemId,
        quantity: grant.quantity,
      });
    }
  }

  const nowMillis = now.getTime();
  const refundRow: ManualTransactionRow = {
    txnId: refundTxnId,
    tenancyId: tenancy.id,
    effectiveAtMillis: nowMillis,
    type: "refund",
    entries: refundEntries,
    customerType,
    customerId: purchase.customerId,
    paymentProvider: isTestMode ? "test_mode" : "stripe",
    createdAtMillis: nowMillis,
  };
  await bulldozerWriteManualTransaction(prisma, refundTxnId, refundRow);

  return {
    statusCode: 200 as const,
    bodyType: "json" as const,
    body: { success: true, refund_transaction_id: refundTxnId },
  };
}

// ── Inline tests for the Stripe params builder ─────────────────────────────

import.meta.vitest?.describe("buildStripeRefundParams", (test) => {
  test("always sets refund_application_fee: false to keep our 0.9% with the platform", ({ expect }) => {
    const params = buildStripeRefundParams({ paymentIntentId: "pi_test", amountStripeUnits: 5000 });
    expect(params.refund_application_fee).toBe(false);
  });
  test("propagates payment_intent and amount as-is", ({ expect }) => {
    const params = buildStripeRefundParams({ paymentIntentId: "pi_abc", amountStripeUnits: 1234 });
    expect(params.payment_intent).toBe("pi_abc");
    expect(params.amount).toBe(1234);
  });
  test("propagates metadata when provided and omits the key when not", ({ expect }) => {
    const withMeta = buildStripeRefundParams({
      paymentIntentId: "pi_x",
      amountStripeUnits: 1,
      metadata: { tenancyId: "t1", purchaseId: "p1" },
    });
    expect(withMeta.metadata).toEqual({ tenancyId: "t1", purchaseId: "p1" });
    expect(withMeta.refund_application_fee).toBe(false);

    const withoutMeta = buildStripeRefundParams({ paymentIntentId: "pi_x", amountStripeUnits: 1 });
    expect("metadata" in withoutMeta).toBe(false);
    expect(withoutMeta.refund_application_fee).toBe(false);
  });
  test("includes refundTxnId in metadata when threaded through", ({ expect }) => {
    const params = buildStripeRefundParams({
      paymentIntentId: "pi_x",
      amountStripeUnits: 1,
      metadata: { tenancyId: "t1", subscriptionId: "s1", refundTxnId: "refund:sub-start:abc:uuid" },
    });
    // Stripe types `metadata` as `MetadataParam | "" | undefined`; we know
    // we passed an object, so narrow before reading.
    const metadata = params.metadata;
    if (typeof metadata !== "object" || metadata === null) {
      throw new Error("expected metadata object");
    }
    expect(metadata.refundTxnId).toBe("refund:sub-start:abc:uuid");
  });
});

import.meta.vitest?.describe("computeOutstandingItemGrantsForOtp", (test) => {
  test("returns when-purchase-expires and when-repeated grants from the OTP txn", ({ expect }) => {
    const otp = {
      txnId: "otp:p1",
      entries: [
        { type: "product-grant", customerType: "user", customerId: "u" },
        { type: "money-transfer", customerType: "user", customerId: "u" },
        { type: "item-quantity-change", customerType: "user", customerId: "u", itemId: "tokens", quantity: 50, expiresWhen: "when-purchase-expires" },
        { type: "item-quantity-change", customerType: "user", customerId: "u", itemId: "credits", quantity: 100, expiresWhen: "when-repeated" },
      ],
    };
    const out = computeOutstandingItemGrantsForOtp([otp]);
    expect(out).toEqual([
      { txnId: "otp:p1", entryIndex: 2, itemId: "tokens", quantity: 50 },
      { txnId: "otp:p1", entryIndex: 3, itemId: "credits", quantity: 100 },
    ]);
  });

  test("excludes permanent (expiresWhen=null) grants — matches sub-end semantics", ({ expect }) => {
    const otp = {
      txnId: "otp:p1",
      entries: [
        { type: "product-grant", customerType: "user", customerId: "u" },
        { type: "item-quantity-change", customerType: "user", customerId: "u", itemId: "perma", quantity: 10, expiresWhen: null },
        { type: "item-quantity-change", customerType: "user", customerId: "u", itemId: "temp", quantity: 5, expiresWhen: "when-purchase-expires" },
      ],
    };
    const out = computeOutstandingItemGrantsForOtp([otp]);
    expect(out).toEqual([
      { txnId: "otp:p1", entryIndex: 2, itemId: "temp", quantity: 5 },
    ]);
  });

  test("subtracts grants already retired by a later IGR's item-quantity-expire", ({ expect }) => {
    // OTP grants 100 credits (when-repeated). Then an IGR expires those and grants 100 fresh.
    // Only the latest 100 remain outstanding.
    const otp = {
      txnId: "otp:p1",
      entries: [
        { type: "product-grant", customerType: "user", customerId: "u" },
        { type: "item-quantity-change", customerType: "user", customerId: "u", itemId: "credits", quantity: 100, expiresWhen: "when-repeated" },
      ],
    };
    const igr = {
      txnId: "igr:p1:1000",
      entries: [
        { type: "item-quantity-expire", customerType: "user", customerId: "u", adjustedTransactionId: "otp:p1", adjustedEntryIndex: 1, itemId: "credits", quantity: 100 },
        { type: "item-quantity-change", customerType: "user", customerId: "u", itemId: "credits", quantity: 100, expiresWhen: "when-repeated" },
      ],
    };
    const out = computeOutstandingItemGrantsForOtp([otp, igr]);
    expect(out).toEqual([
      { txnId: "igr:p1:1000", entryIndex: 1, itemId: "credits", quantity: 100 },
    ]);
  });

  test("accumulates when-purchase-expires grants across multiple IGRs (no auto-expiry)", ({ expect }) => {
    // Three monthly IGRs each granting 100 bonus tokens that expire only when the purchase does.
    const otp = {
      txnId: "otp:p1",
      entries: [{ type: "product-grant", customerType: "user", customerId: "u" }],
    };
    const igrs = [1000, 2000, 3000].map((t) => ({
      txnId: `igr:p1:${t}`,
      entries: [
        { type: "item-quantity-change", customerType: "user", customerId: "u", itemId: "bonus", quantity: 100, expiresWhen: "when-purchase-expires" },
      ],
    }));
    const out = computeOutstandingItemGrantsForOtp([otp, ...igrs]);
    expect(out).toHaveLength(3);
    expect(out.map((g) => g.txnId)).toEqual(["igr:p1:1000", "igr:p1:2000", "igr:p1:3000"]);
  });

  test("ignores non-item entries and malformed rows", ({ expect }) => {
    const out = computeOutstandingItemGrantsForOtp([
      { txnId: "otp:p1", entries: [
        { type: "product-grant" },
        { type: "money-transfer" },
        { type: "item-quantity-change", itemId: "x", quantity: 1, expiresWhen: "when-purchase-expires" },
      ] },
      // malformed: missing entries array
      { txnId: "otp:bad", entries: null },
      // malformed: non-string txnId
      { txnId: 42, entries: [] },
    ]);
    expect(out).toEqual([
      { txnId: "otp:p1", entryIndex: 2, itemId: "x", quantity: 1 },
    ]);
  });
});

