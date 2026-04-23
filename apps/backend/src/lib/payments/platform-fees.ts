import { getStackStripe } from "@/lib/stripe";
import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";

function stripeErrorContext(err: unknown): Record<string, unknown> {
  if (err instanceof Stripe.errors.StripeError) {
    return {
      stripeErrCode: err.code,
      stripeErrType: err.type,
      stripeRequestId: err.requestId,
      stripeStatusCode: err.statusCode,
      stripeErrMessage: err.message,
    };
  }
  return { error: err };
}

// 0.9% of every Stripe money movement on a non-internal project is collected
// as a platform fee. Charge-leg fees ride along via Stripe's native
// application_fee_* params; outflow-leg fees (e.g. refunds) are collected via
// inverse Connect transfers — see collectInverseFee below.
export const APPLICATION_FEE_BPS = 90;

const INTERNAL_PROJECT_ID = "internal";

export const PlatformFeeStatus = {
  PENDING: "PENDING",
  COLLECTED: "COLLECTED",
  FAILED: "FAILED",
} as const;
export type PlatformFeeStatus = typeof PlatformFeeStatus[keyof typeof PlatformFeeStatus];

export const PlatformFeeSourceType = {
  REFUND: "REFUND",
} as const;
export type PlatformFeeSourceType = typeof PlatformFeeSourceType[keyof typeof PlatformFeeSourceType];

export function getApplicationFeeBps(projectId: string): number {
  if (projectId === INTERNAL_PROJECT_ID) return 0;
  return APPLICATION_FEE_BPS;
}

export function computeApplicationFeeAmount(options: { amountStripeUnits: number, projectId: string }): number {
  const bps = getApplicationFeeBps(options.projectId);
  if (bps === 0) return 0;
  return Math.round(options.amountStripeUnits * bps / 10000);
}

export function getApplicationFeePercentOrUndefined(projectId: string): number | undefined {
  const bps = getApplicationFeeBps(projectId);
  if (bps === 0) return undefined;
  return bps / 100;
}

/**
 * Collect an inverse platform fee for an outflow event (e.g. a refund).
 *
 * Contract: this function **never throws**. It is designed to be fire-and-forget
 * from the callsite via `runAsynchronously(...)`. Any config / lookup / Stripe /
 * DB error results in a durable PlatformFeeEvent row with `status = FAILED` and
 * a descriptive error message, plus a Sentry event. Callers may treat the
 * originating money movement as already-succeeded regardless of outcome here.
 */
export async function collectInverseFee(options: {
  tenancy: Tenancy,
  amountStripeUnits: number,
  currency: string,
  sourceType: PlatformFeeSourceType,
  sourceId: string,
}): Promise<void> {
  try {
    await collectInverseFeeInner(options);
  } catch (err) {
    // Last-resort catch: the inner function is engineered to always return
    // normally, but if a DB lookup or other helper throws before we can write
    // a ledger row, we still need to avoid surfacing the error to the caller.
    captureError("collect-inverse-fee-unexpected", new StackAssertionError(
      "Unexpected error in collectInverseFee — ledger state may be missing for this refund",
      {
        sourceType: options.sourceType,
        sourceId: options.sourceId,
        tenancyId: options.tenancy.id,
        ...stripeErrorContext(err),
      }
    ));
  }
}

async function collectInverseFeeInner(options: {
  tenancy: Tenancy,
  amountStripeUnits: number,
  currency: string,
  sourceType: PlatformFeeSourceType,
  sourceId: string,
}): Promise<void> {
  // Explicit invariant: multi-currency fee aggregation isn't built out yet, so
  // we assert here rather than silently miscategorising a non-USD refund as a
  // USD due in the ledger.
  if (options.currency !== "usd") {
    throw new StackAssertionError("collectInverseFee currently only supports usd", {
      currency: options.currency,
      sourceType: options.sourceType,
      sourceId: options.sourceId,
    });
  }

  const projectId = options.tenancy.project.id;
  const feeAmount = computeApplicationFeeAmount({ amountStripeUnits: options.amountStripeUnits, projectId });
  if (feeAmount <= 0) return;

  // Write the ledger row FIRST, before any config / lookup / Stripe call.
  // This guarantees durable state exists for every fee event — config failures
  // and account-lookup failures are recorded as FAILED rows that ops can see
  // and retry, rather than being silently dropped.
  const ledgerKey = { sourceType_sourceId: { sourceType: options.sourceType, sourceId: options.sourceId } };
  const ledgerRow = await globalPrismaClient.platformFeeEvent.upsert({
    where: ledgerKey,
    create: {
      tenancyId: options.tenancy.id,
      projectId,
      sourceType: options.sourceType,
      sourceId: options.sourceId,
      amount: feeAmount,
      currency: options.currency,
      status: PlatformFeeStatus.PENDING,
    },
    update: {},
  });
  if (ledgerRow.status === PlatformFeeStatus.COLLECTED) return;

  const platformAccountId = getEnvVariable("STACK_STRIPE_PLATFORM_ACCOUNT_ID", "");
  if (!platformAccountId) {
    await markLedgerFailed(ledgerKey, "STACK_STRIPE_PLATFORM_ACCOUNT_ID not set");
    captureError("collect-inverse-fee", new StackAssertionError(
      "STACK_STRIPE_PLATFORM_ACCOUNT_ID not set; inverse fee collection skipped",
      { sourceType: options.sourceType, sourceId: options.sourceId, tenancyId: options.tenancy.id }
    ));
    return;
  }

  const project = await globalPrismaClient.project.findUnique({
    where: { id: projectId },
    select: { stripeAccountId: true },
  });
  const stripeAccountId = project?.stripeAccountId;
  if (!stripeAccountId) {
    await markLedgerFailed(ledgerKey, "Project has no stripeAccountId");
    captureError("collect-inverse-fee", new StackAssertionError(
      "Project has no stripeAccountId; cannot collect inverse fee",
      { sourceType: options.sourceType, sourceId: options.sourceId, projectId }
    ));
    return;
  }

  const platformStripe = getStackStripe();
  // `transfer_group` is our durable reconciliation key. Stripe's
  // `idempotencyKey` only dedupes within ~24h, so a retry *after* the key
  // expires (ledger-update-failure scenario) would otherwise create a second
  // transfer and double-debit the merchant. By tagging every transfer with a
  // stable, content-addressed `transfer_group` derived from `(sourceType,
  // sourceId)` we can look the transfer up on Stripe on retry and reconcile
  // instead of creating a new one.
  const transferGroup = `platform-fee-${options.sourceType}-${options.sourceId}`;

  // Retry reconciliation: if a prior attempt on this sourceId left the ledger
  // without a stripeTransferId (the transfer might have succeeded but our
  // ledger-update crashed), list transfers on the merchant's account for this
  // transfer_group and use the pre-existing transfer if we find one.
  //
  // Two error cases are handled explicitly below; the distinction matters
  // because falling through to `transfers.create` is only safe when we've
  // proven no transfer exists yet:
  //   (a) the `transfers.list` lookup itself fails — safe to fall through:
  //       we don't know if a transfer exists, but the idempotency key on the
  //       near-term retry (24h window) still dedupes, and worst case the NEXT
  //       retry's reconciliation will pick up whatever we create here.
  //   (b) the lookup succeeds AND returns a pre-existing transfer, but the
  //       ledger update then fails — we MUST NOT fall through. Creating a
  //       second transfer now (or after the idempotency key expires on a
  //       later retry) would double-debit the merchant. Bail with FAILED so
  //       ops sees the inconsistency and can reconcile manually using the
  //       captured transfer id.
  if (!ledgerRow.stripeTransferId) {
    let existing: Stripe.ApiList<Stripe.Transfer> | null = null;
    try {
      existing = await platformStripe.transfers.list(
        { transfer_group: transferGroup, limit: 1 },
        { stripeAccount: stripeAccountId },
      );
    } catch (searchErr) {
      captureError("collect-inverse-fee-search", new StackAssertionError(
        "Failed to search Stripe for existing platform fee transfer before retry — proceeding with idempotent create",
        { sourceType: options.sourceType, sourceId: options.sourceId, ...stripeErrorContext(searchErr) }
      ));
      // Case (a): fall through to `transfers.create`.
    }

    if (existing && existing.data.length > 0) {
      const pre = existing.data[0];
      try {
        await globalPrismaClient.platformFeeEvent.update({
          where: ledgerKey,
          data: {
            status: PlatformFeeStatus.COLLECTED,
            stripeTransferId: pre.id,
            collectedAt: new Date(pre.created * 1000),
            error: null,
          },
        });
      } catch (dbErr) {
        // Case (b): DO NOT fall through. We know a transfer exists on Stripe
        // (id: pre.id) but we couldn't record it. Mark FAILED loudly and
        // return; creating another transfer here would double-debit after
        // the idempotency key expires.
        captureError("collect-inverse-fee-ledger-reconcile", new StackAssertionError(
          "Found pre-existing Stripe transfer during retry reconciliation but ledger update failed — manual reconciliation needed to avoid double-debit on next retry",
          { sourceType: options.sourceType, sourceId: options.sourceId, preExistingTransferId: pre.id, dbErr: dbErr instanceof Error ? dbErr.message : String(dbErr) }
        ));
        await markLedgerFailed(
          ledgerKey,
          `Pre-existing Stripe transfer ${pre.id} found but ledger update failed during reconciliation; manual intervention required to avoid double-debit`,
        );
        return;
      }
      return;
    }
  }

  let transferId: string;
  try {
    // Transfer from the connected account's Stripe balance back to the
    // platform. Executed AS the connected account (stripeAccount header) with
    // destination set to our platform account ID.
    const transfer = await platformStripe.transfers.create(
      {
        amount: feeAmount,
        currency: options.currency,
        destination: platformAccountId,
        transfer_group: transferGroup,
        metadata: {
          platformFeeSourceType: options.sourceType,
          platformFeeSourceId: options.sourceId,
          platformFeeTenancyId: options.tenancy.id,
        },
      },
      {
        stripeAccount: stripeAccountId,
        idempotencyKey: transferGroup,
      },
    );
    transferId = transfer.id;
  } catch (stripeErr) {
    captureError("collect-inverse-fee", new StackAssertionError(
      "Failed to collect inverse platform fee",
      {
        sourceType: options.sourceType,
        sourceId: options.sourceId,
        tenancyId: options.tenancy.id,
        ...stripeErrorContext(stripeErr),
      }
    ));
    await markLedgerFailed(ledgerKey, stripeErr instanceof Error ? stripeErr.message : String(stripeErr));
    return;
  }

  try {
    await globalPrismaClient.platformFeeEvent.update({
      where: ledgerKey,
      data: {
        status: PlatformFeeStatus.COLLECTED,
        stripeTransferId: transferId,
        collectedAt: new Date(),
        // Clear any error from a previous failed attempt so ops / the
        // listing endpoint don't surface stale failure reasons.
        error: null,
      },
    });
  } catch (dbErr) {
    // The money was collected but we couldn't record it. Log loudly — someone
    // will need to reconcile the ledger row against the Stripe transfer id.
    captureError("collect-inverse-fee-ledger-write", new StackAssertionError(
      "Stripe transfer succeeded but ledger update failed — manual reconciliation needed",
      { sourceType: options.sourceType, sourceId: options.sourceId, transferId, dbErr }
    ));
  }
}

async function markLedgerFailed(
  where: { sourceType_sourceId: { sourceType: string, sourceId: string } },
  error: string,
): Promise<void> {
  try {
    await globalPrismaClient.platformFeeEvent.update({
      where,
      data: { status: PlatformFeeStatus.FAILED, error },
    });
  } catch (dbErr) {
    captureError("collect-inverse-fee-ledger-write", new StackAssertionError(
      "Failed to record FAILED status on platform fee event",
      { where, originalError: error, dbErr }
    ));
  }
}

import.meta.vitest?.describe("platform fee helpers", (test) => {
  test("getApplicationFeeBps returns 0 for internal project", ({ expect }) => {
    expect(getApplicationFeeBps("internal")).toBe(0);
  });
  test("getApplicationFeeBps returns APPLICATION_FEE_BPS for any other project", ({ expect }) => {
    expect(getApplicationFeeBps("proj_abc123")).toBe(APPLICATION_FEE_BPS);
    expect(getApplicationFeeBps("some-uuid")).toBe(APPLICATION_FEE_BPS);
  });
  test("computeApplicationFeeAmount is 0.9% of the charge, rounded", ({ expect }) => {
    expect(computeApplicationFeeAmount({ amountStripeUnits: 10000, projectId: "p" })).toBe(90);
    expect(computeApplicationFeeAmount({ amountStripeUnits: 12345, projectId: "p" })).toBe(111);
    expect(computeApplicationFeeAmount({ amountStripeUnits: 500000, projectId: "p" })).toBe(4500);
  });
  test("computeApplicationFeeAmount is 0 for internal project", ({ expect }) => {
    expect(computeApplicationFeeAmount({ amountStripeUnits: 10000, projectId: "internal" })).toBe(0);
  });
  test("getApplicationFeePercentOrUndefined returns 0.9 for non-internal", ({ expect }) => {
    expect(getApplicationFeePercentOrUndefined("proj_abc")).toBe(0.9);
  });
  test("getApplicationFeePercentOrUndefined returns undefined for internal", ({ expect }) => {
    expect(getApplicationFeePercentOrUndefined("internal")).toBeUndefined();
  });
});
