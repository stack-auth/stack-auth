import { CustomerType, PrismaClient, PurchaseCreationSource, Subscription, SubscriptionStatus } from "@/generated/prisma/client";
import { bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { getOwnedProductsForCustomer } from "@/lib/payments/customer-data";
// eslint-disable-next-line @typescript-eslint/no-deprecated -- idiomatic way to get the internal tenancy today (see plan-entitlements.ts)
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, retryTransaction, type PrismaClientTransaction } from "@/prisma-client";
import { addInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";

/**
 * Free/team/growth plans live on the internal tenancy; the "customer" is a
 * team in the internal project (a billing team). This file owns the two
 * writes that touch the free-plan sub for such a team:
 *
 *   - `createFreePlanSubscriptionRow` — Prisma-only insert. Callers run the
 *     subsequent `bulldozerWriteSubscription` themselves, so they can keep
 *     the Prisma insert inside whatever outer transaction they own while
 *     the Bulldozer write (which issues its own BEGIN/COMMIT) happens
 *     after the tx commits.
 *   - `ensureFreePlanForBillingTeam` — the regrant path. Idempotent; no-op
 *     if the team already owns a plan in the same product line.
 */

async function getInternalBillingTenancy(): Promise<Tenancy> {
  const tenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID, true);
  if (tenancy == null) {
    throw new StackAssertionError("Internal billing tenancy not found");
  }
  return tenancy;
}

function isAddOnProduct(product: { isAddOnTo?: false | Record<string, true> | null }): boolean {
  return product.isAddOnTo != null && product.isAddOnTo !== false && Object.keys(product.isAddOnTo).length > 0;
}

/**
 * Writes the `free` Subscription row. Caller is responsible for a subsequent
 * `bulldozerWriteSubscription(prisma, sub)` after any outer transaction
 * commits, and for verifying there's no conflicting plan in the same line.
 *
 * `prisma` is deliberately typed as the union — the helper does a single
 * `subscription.create` that works identically with a full client or a tx
 * client. When called with a full client, the Prisma insert and the
 * downstream `bulldozerWriteSubscription` are NOT atomic; same trade-off as
 * every other dual-write call site.
 *
 * `creationSource` is a parameter because the right value depends on context
 * (auto-regrant vs team-creation vs a hypothetical test-mode seed). Throws
 * on a misconfigured `free` product so broken deploys fail loudly.
 */
export async function createFreePlanSubscriptionRow(options: {
  prisma: PrismaClient | PrismaClientTransaction,
  internalTenancy: Tenancy,
  billingTeamId: string,
  creationSource: PurchaseCreationSource,
}): Promise<Subscription> {
  const { prisma, internalTenancy, billingTeamId, creationSource } = options;
  const freePlanProduct = getOrUndefined(internalTenancy.config.payments.products, "free");
  if (freePlanProduct == null || freePlanProduct.customerType !== "team" || freePlanProduct.productLineId == null) {
    throw new StackAssertionError(
      "Internal tenancy `free` product is not configured as a team-typed, product-line-tagged plan; cannot grant",
      { freePlanProduct },
    );
  }

  // First price, same as validatePurchaseSession's default when no priceId
  // is supplied. The `length` check is needed because TS types `[0]` as
  // non-undefined (no noUncheckedIndexedAccess in our tsconfig).
  const prices = freePlanProduct.prices === "include-by-default" ? {} : freePlanProduct.prices;
  const priceEntries = typedEntries(prices);
  if (priceEntries.length === 0) {
    throw new StackAssertionError("Free plan has no prices configured");
  }
  const [firstPriceId, firstPrice] = priceEntries[0];
  const priceInterval = firstPrice.interval;

  const now = new Date();
  return await prisma.subscription.create({
    data: {
      tenancyId: internalTenancy.id,
      customerId: billingTeamId,
      customerType: CustomerType.TEAM,
      status: SubscriptionStatus.active,
      productId: "free",
      priceId: firstPriceId,
      product: freePlanProduct,
      quantity: 1,
      currentPeriodStart: now,
      // No interval only happens if the free plan is misconfigured as one-off;
      // fall back to a 2099 sentinel so the sub never naturally ends.
      currentPeriodEnd: priceInterval != null ? addInterval(now, priceInterval) : new Date("2099-12-31T23:59:59Z"),
      cancelAtPeriodEnd: false,
      creationSource,
    },
  });
}

/**
 * Regrants the `free` plan if the billing team has no active plan in the
 * free plan's product line. Callers can fire this speculatively — it silently
 * no-ops on misconfiguration, when a plan is already owned, or when a
 * concurrent caller already established the free sub.
 *
 * Two-phase concurrency story:
 *
 *   1. Fast path — optimistic bulldozer read. In the overwhelming common
 *      case the billing team already has some plan in the product line
 *      (free, team, or growth), so we return immediately without touching
 *      Prisma's Subscription table.
 *
 *   2. Slow path — if the fast path sees "no base plan," re-check the
 *      Subscription source-of-truth under SERIALIZABLE isolation and
 *      insert atomically. The bulldozer derived ledger lags pg_cron and
 *      can't detect in-flight writes from concurrent callers, so we
 *      cannot rely on it for idempotency; reading the Subscription table
 *      directly under SSI is the only way to serialize the check+insert.
 *      `retryTransaction` handles P2028 serialization failures by
 *      retrying; on the retry the other caller's row is visible and we
 *      skip the insert.
 *
 * We do this
 */
export async function ensureFreePlanForBillingTeam(billingTeamId: string): Promise<void> {
  const internalTenancy = await getInternalBillingTenancy();
  const freePlanProduct = getOrUndefined(internalTenancy.config.payments.products, "free");
  if (freePlanProduct == null || freePlanProduct.customerType !== "team" || freePlanProduct.productLineId == null) {
    return;
  }
  const freeProductLineId = freePlanProduct.productLineId;

  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);

  // Fast path: bulldozer-based optimistic check. Only BASE plans count —
  // add-ons (extra-seats etc.) don't provide baseline entitlements on their
  // own, so losing the base plan while still holding an add-on still
  // triggers a regrant.
  const ownedProducts = await getOwnedProductsForCustomer({
    prisma: internalPrisma,
    tenancyId: internalTenancy.id,
    customerType: "team",
    customerId: billingTeamId,
  });
  const alreadyHasBasePlanInLine = Object.values(ownedProducts).some(
    (p) =>
      p.productLineId === freeProductLineId
      && p.quantity > 0
      && !isAddOnProduct(p.product),
  );
  if (alreadyHasBasePlanInLine) {
    return;
  }

  // Slow path: the team appears to have no base plan. Re-check under
  // SERIALIZABLE isolation and insert atomically so a concurrent caller
  // can't produce a duplicate free sub.
  const createdSub = await retryTransaction(internalPrisma, async (tx) => {
    const existing = await tx.subscription.findFirst({
      where: {
        tenancyId: internalTenancy.id,
        customerId: billingTeamId,
        customerType: CustomerType.TEAM,
        productId: "free",
        status: { in: [SubscriptionStatus.active, SubscriptionStatus.trialing] },
      },
      select: { id: true },
    });
    if (existing != null) {
      return null;
    }
    return await createFreePlanSubscriptionRow({
      prisma: tx,
      internalTenancy,
      billingTeamId,
      // Free is always paymentProvider=stripe (via the non-TEST_MODE CASE),
      // regardless of testMode. API_GRANT is the closest semantic fit.
      creationSource: PurchaseCreationSource.API_GRANT,
    });
  }, { level: "serializable" });

  if (createdSub != null) {
    // Bulldozer write happens outside the tx — it issues its own BEGIN/
    // COMMIT and can't nest. If it fails after the Prisma insert committed,
    // the sub exists in Prisma but not yet in Bulldozer; same trade-off as
    // all other dual-write call sites, reconciled by the next sync.
    await bulldozerWriteSubscription(internalPrisma, createdSub);
  }
}
