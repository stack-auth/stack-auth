import { ensureCustomerExists } from "@/lib/payments";
import { bulldozerDeleteItemQuantityChanges, bulldozerTryDecreaseItemQuantityChanges, bulldozerWriteItemQuantityChanges } from "@/lib/payments/bulldozer-dual-write";
import { getItemQuantitiesForCustomer } from "@/lib/payments/customer-data";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { getOrUndefined } from "@hexclave/shared/dist/utils/objects";
import { Result } from "@hexclave/shared/dist/utils/results";
import { typedToUppercase } from "@hexclave/shared/dist/utils/strings";
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "./tenancies";

export type MeteredPlanItemId =
  | typeof ITEM_IDS.analyticsEvents
  | typeof ITEM_IDS.analyticsSpans
  | typeof ITEM_IDS.sessionReplays;

export type AnalyticsPlanItemId =
  | MeteredPlanItemId
  | typeof ITEM_IDS.analyticsTimeoutSeconds;

type PlanItemDebit = {
  itemId: MeteredPlanItemId,
  quantity: number,
  /**
   * Stable identity for retryable ingestion. Both fields must describe the
   * same logical debit on every retry; they become the stored row identity and
   * timestamp instead of generating a new transaction.
   */
  idempotency?: {
    key: string,
    createdAt: Date,
  },
};

type PlanItemQuantityChange = {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: "TEAM",
  itemId: MeteredPlanItemId,
  quantity: number,
  description: string | null,
  expiresAt: Date | null,
  createdAt: Date,
};

const inFlightPlanQuantityReads = new Map<string, Promise<Map<AnalyticsPlanItemId, number>>>();

function deterministicPlanChangeId(parts: readonly string[]): string {
  const hex = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  const variantNibble = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variantNibble}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function getBillingContext(billingTeamId: string, itemIds: readonly AnalyticsPlanItemId[]) {
  const tenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID, true);
  if (tenancy == null) {
    throw new HexclaveAssertionError("Internal billing tenancy not found", {
      billingProjectId: "internal",
      branchId: DEFAULT_BRANCH_ID,
    });
  }

  for (const itemId of itemIds) {
    const itemConfig = getOrUndefined(tenancy.config.payments.items, itemId);
    if (itemConfig == null) {
      throw new KnownErrors.ItemNotFound(itemId);
    }
    if (itemConfig.customerType !== "team") {
      throw new KnownErrors.ItemCustomerTypeDoesNotMatch(itemId, billingTeamId, itemConfig.customerType, "team");
    }
  }

  const prisma = await getPrismaClientForTenancy(tenancy);
  await ensureCustomerExists({
    prisma,
    tenancyId: tenancy.id,
    customerType: "team",
    customerId: billingTeamId,
  });
  return { tenancy, prisma };
}

/**
 * Reads all requested plan quantities from one Bulldozer snapshot. The public
 * item API fetches the same customer-wide snapshot once per item, which makes
 * mixed telemetry batches pay duplicate backend and Bulldozer round trips.
 */
export async function getAnalyticsPlanItemQuantities(
  billingTeamId: string,
  itemIds: readonly AnalyticsPlanItemId[],
): Promise<Map<AnalyticsPlanItemId, number>> {
  if (itemIds.length === 0) {
    return new Map();
  }
  const key = `${billingTeamId}\0${[...itemIds].sort().join("\0")}`;
  const existingRead = inFlightPlanQuantityReads.get(key);
  if (existingRead != null) {
    return new Map(await existingRead);
  }

  const newRead = (async () => {
    const { tenancy, prisma } = await getBillingContext(billingTeamId, itemIds);
    const quantities = await getItemQuantitiesForCustomer({
      prisma,
      tenancyId: tenancy.id,
      customerType: "team",
      customerId: billingTeamId,
    });
    return new Map(itemIds.map((itemId) => [itemId, quantities[itemId] ?? 0]));
  })();
  inFlightPlanQuantityReads.set(key, newRead);
  try {
    return new Map(await newRead);
  } finally {
    // Coalesce only genuinely overlapping dashboard queries. Deleting the
    // settled promise avoids stale plan data after a subscription change.
    if (inFlightPlanQuantityReads.get(key) === newRead) {
      inFlightPlanQuantityReads.delete(key);
    }
  }
}

/**
 * Records all accepted telemetry debits in one Postgres transaction after
 * checking one customer-wide quantity snapshot. This preserves fail-closed
 * limits while preventing an exhausted span item from partially charging the
 * event half of a mixed batch.
 */
export async function tryDecreasePlanItemQuantities(
  billingTeamId: string,
  debits: readonly PlanItemDebit[],
): Promise<{ insufficientItemId: MeteredPlanItemId | null }> {
  const nonZeroDebits = debits.filter(({ quantity }) => quantity !== 0);
  for (const debit of nonZeroDebits) {
    if (!Number.isSafeInteger(debit.quantity) || debit.quantity < 0) {
      throw new HexclaveAssertionError("Plan item debit must be a non-negative safe integer", {
        itemId: debit.itemId,
        quantity: debit.quantity,
      });
    }
    if (debit.idempotency != null) {
      if (debit.idempotency.key.length === 0) {
        throw new HexclaveAssertionError("Plan item debit idempotency key must not be empty", {
          itemId: debit.itemId,
        });
      }
      if (!Number.isFinite(debit.idempotency.createdAt.getTime())) {
        throw new HexclaveAssertionError("Plan item debit idempotency timestamp must be a valid date", {
          itemId: debit.itemId,
        });
      }
    }
  }
  if (nonZeroDebits.length === 0) {
    return { insufficientItemId: null };
  }

  const { tenancy, prisma } = await getBillingContext(billingTeamId, nonZeroDebits.map(({ itemId }) => itemId));
  const changes: PlanItemQuantityChange[] = nonZeroDebits.map((debit) => ({
    id: debit.idempotency == null
      ? randomUUID()
      : deterministicPlanChangeId([
        "hexclave-plan-debit-v1",
        tenancy.id,
        billingTeamId,
        debit.itemId,
        debit.idempotency.key,
      ]),
    tenancyId: tenancy.id,
    customerId: billingTeamId,
    customerType: typedToUppercase("team"),
    itemId: debit.itemId,
    quantity: -debit.quantity,
    description: null,
    expiresAt: null,
    createdAt: debit.idempotency?.createdAt ?? new Date(),
  }));

  // Bulldozer owns the current balance. Its conditional batch endpoint applies
  // all rows to one candidate snapshot, checks the resulting balances, and
  // commits or rejects under the service's existing global write lock. This is
  // one HTTP round trip instead of the former GET + POST pair.
  const debitResult = await bulldozerTryDecreaseItemQuantityChanges(changes);
  if (debitResult.insufficientItemId != null) {
    const insufficientDebit = nonZeroDebits.find(({ itemId }) => itemId === debitResult.insufficientItemId);
    if (insufficientDebit == null) {
      throw new HexclaveAssertionError("Bulldozer reported an insufficient item that was not part of the requested plan debit", {
        insufficientItemId: debitResult.insufficientItemId,
        requestedItemIds: nonZeroDebits.map(({ itemId }) => itemId),
      });
    }
    return { insufficientItemId: insufficientDebit.itemId };
  }

  await persistPlanItemChangesOrRollback(prisma, changes);
  return { insufficientItemId: null };
}

export async function increasePlanItemQuantity(
  billingTeamId: string,
  itemId: MeteredPlanItemId,
  quantity: number,
): Promise<void> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new HexclaveAssertionError("Plan item refund must be a positive safe integer", {
      itemId,
      quantity,
    });
  }
  const { tenancy, prisma } = await getBillingContext(billingTeamId, [itemId]);
  const change: PlanItemQuantityChange = {
    id: randomUUID(),
    tenancyId: tenancy.id,
    customerId: billingTeamId,
    customerType: typedToUppercase("team"),
    itemId,
    quantity,
    description: null,
    expiresAt: null,
    createdAt: new Date(),
  };
  await bulldozerWriteItemQuantityChanges([change]);
  await persistPlanItemChangesOrRollback(prisma, [change]);
}

async function persistPlanItemChangesOrRollback(
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  changes: PlanItemQuantityChange[],
): Promise<void> {
  const persistResult = await Result.fromPromise(retryTransaction(prisma, async (tx) => {
    await tx.itemQuantityChange.createMany({
      data: changes,
      // Fixed row ids make transaction retries safe even if the client receives
      // an ambiguous commit result.
      skipDuplicates: true,
    });
  }));
  if (persistResult.status === "ok") return;

  const rollbackResult = await Result.fromPromise(bulldozerDeleteItemQuantityChanges(changes));
  if (rollbackResult.status === "error") {
    throw new HexclaveAssertionError("Failed to persist plan item quantity changes to Postgres and failed to roll them back from Bulldozer", {
      cause: persistResult.error,
      rollbackError: rollbackResult.error,
      changeIds: changes.map((change) => change.id),
    });
  }
  throw persistResult.error;
}
