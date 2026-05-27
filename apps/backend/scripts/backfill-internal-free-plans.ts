/**
 * Grants the `free` plan to every billing team on Hexclave's own
 * billing project that doesn't already have a plan. Runs at deploy /
 * db init time.
 *
 * Why we need it: we used to give the free plan implicitly via an
 * "include-by-default" rule. Removing that left some old teams with no
 * subscription at all, which made plan-limit checks (user count,
 * analytics events, etc.) read 0 quota and reject every request. This
 * script puts everyone back on a clean baseline.
 *
 * Safe to re-run: a team that already has a plan in the free product
 * line is left alone.
 */

import { ensureFreePlanForBillingTeam } from "@/lib/payments/ensure-free-plan";
// eslint-disable-next-line @typescript-eslint/no-deprecated -- idiomatic way to get the internal tenancy today (see plan-entitlements.ts)
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, type Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { HexclaveAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";

// Page size for streaming teams. Big enough to amortise round-trips,
// small enough to stay tiny in memory (~18KB per page).
const TEAM_BATCH_SIZE = 500;

function log(msg: string) {
  console.log(`[Backfill][InternalFreePlans] ${msg}`);
}

/**
 * Yields every billing team in the internal tenancy, page by page,
 * ordered by `teamId`. Keyset pagination (`teamId > cursor`) so this
 * stays fast on tenancies with millions of teams.
 */
async function* iterateInternalTeamIds(
  internalTenancy: Tenancy,
  batchSize: number,
): AsyncIterable<string> {
  let cursor: string | null = null;
  while (true) {
    const batch: { teamId: string }[] = await globalPrismaClient.team.findMany({
      where: {
        tenancyId: internalTenancy.id,
        ...(cursor != null ? { teamId: { gt: cursor } } : {}),
      },
      select: { teamId: true },
      orderBy: { teamId: "asc" },
      take: batchSize,
    });
    if (batch.length === 0) return;
    for (const { teamId } of batch) {
      yield teamId;
    }
    cursor = batch[batch.length - 1].teamId;
  }
}

export async function runBackfillInternalFreePlans(): Promise<{
  granted: number,
  failed: number,
  total: number,
}> {
  log("Starting...");
  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID, true);
  if (internalTenancy == null) {
    throw new HexclaveAssertionError("Internal billing tenancy not found", {
      billingProjectId: "internal",
      branchId: DEFAULT_BRANCH_ID,
    });
  }

  // Fail fast if the `free` product is misconfigured. The grant call
  // below silently no-ops in that case; raising here makes the deploy
  // log point at the actual cause instead of "0 granted out of N teams".
  const freePlanProduct = getOrUndefined(internalTenancy.config.payments.products, "free");
  if (
    freePlanProduct == null
    || freePlanProduct.customerType !== "team"
    || freePlanProduct.productLineId == null
  ) {
    throw new HexclaveAssertionError(
      "Internal tenancy `free` product is not configured as a team-typed, product-line-tagged plan; cannot run backfill",
      { freePlanProduct },
    );
  }

  let granted = 0;
  let failed = 0;
  let total = 0;

  for await (const teamId of iterateInternalTeamIds(internalTenancy, TEAM_BATCH_SIZE)) {
    total++;
    try {
      if (await ensureFreePlanForBillingTeam(teamId)) granted++;
    } catch (e) {
      // Per-team isolation: log and keep going. One team's transient
      // DB blip shouldn't leave every later team unprocessed; the next
      // run will retry whatever failed here.
      failed++;
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(
        `[Backfill][InternalFreePlans][team=${teamId}] Failed: ${err.message}`,
        err,
      );
    }
    if (total % 100 === 0) {
      log(`Progress: ${total} (granted=${granted}, failed=${failed})`);
    }
  }

  log(`Done. granted=${granted} failed=${failed} total=${total}`);
  return { granted, failed, total };
}
