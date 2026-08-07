/**
 * Storage entitlement for imported data.
 *
 * Every other plan limit today is throughput- or time-based
 * (`analytics_timeout_seconds`, `analytics_events`). Imported data is a new
 * cost axis: it is resident, it is written by a background job the user is not
 * watching, and nothing else in the system bounds it. Without this check a
 * customer pointing a source at a 500M-row Postgres lands all of it in our
 * ClickHouse.
 *
 * The check is enforced BEFORE each slice is written rather than after, and the
 * run is failed with a clear message rather than silently truncated — a sync
 * that quietly stops at the cap is exactly the "silent stale data" failure mode
 * the product is trying to avoid.
 */
import { getHexclaveServerApp } from "@/hexclave";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import type { Tenancy } from "@/lib/tenancies";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { countImportedRowsForProject } from "./clickhouse";

export type ImportedRowsBudget = {
  /** Rows that may still be written before the entitlement is exhausted. */
  remaining: number,
  limit: number,
  used: number,
  enforced: boolean,
};

export const UNENFORCED_BUDGET: ImportedRowsBudget = {
  remaining: Number.MAX_SAFE_INTEGER,
  limit: Number.MAX_SAFE_INTEGER,
  used: 0,
  enforced: false,
};

/**
 * Reads the project's remaining imported-row budget.
 *
 * Resolved once per sync tick rather than per record: the ClickHouse count is
 * a full scan of the project's imported rows, and a tick's slice budget already
 * bounds how far past the cap a single tick could overshoot.
 */
export async function getImportedRowsBudget(tenancy: Tenancy): Promise<ImportedRowsBudget> {
  const billingTeamId = getBillingTeamId(tenancy.project);
  if (billingTeamId == null || !arePlanLimitsEnforced()) {
    return UNENFORCED_BUDGET;
  }

  const app = getHexclaveServerApp();
  const item = await app.getItem({ itemId: ITEM_IDS.importedRows, teamId: billingTeamId });
  const limit = item.quantity;
  const used = await countImportedRowsForProject(tenancy);
  return {
    remaining: Math.max(0, limit - used),
    limit,
    used,
    enforced: true,
  };
}

export function assertBudgetAllows(budget: ImportedRowsBudget, rowCount: number): void {
  if (!budget.enforced) return;
  if (rowCount > budget.remaining) {
    throw new StatusError(
      StatusError.BadRequest,
      `You've reached your plan's limit of ${budget.limit.toLocaleString()} imported rows. `
      + `Turn off streams you don't need or upgrade your plan, then sync again.`,
    );
  }
}

import.meta.vitest?.test("an unenforced budget never blocks", ({ expect }) => {
  expect(() => assertBudgetAllows(UNENFORCED_BUDGET, 10_000_000)).not.toThrow();
});

import.meta.vitest?.test("an exhausted budget fails loudly instead of truncating", ({ expect }) => {
  const budget: ImportedRowsBudget = { remaining: 10, limit: 50_000, used: 49_990, enforced: true };
  expect(() => assertBudgetAllows(budget, 10)).not.toThrow();
  expect(() => assertBudgetAllows(budget, 11)).toThrow("reached your plan's limit of 50,000 imported rows");
});
