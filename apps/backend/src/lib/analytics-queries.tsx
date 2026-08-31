import { getHexclaveServerApp } from "@/hexclave";
import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { getSafeClickhouseErrorMessage } from "@/lib/clickhouse-errors";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { Tenancy } from "@/lib/tenancies";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS, PLAN_LIMITS } from "@hexclave/shared/dist/plans";
import type { Json } from "@hexclave/shared/dist/utils/json";
import { Result } from "@hexclave/shared/dist/utils/results";
import { randomUUID } from "crypto";

export const ANALYTICS_QUERY_MAX_TIMEOUT_MS = Math.max(...Object.values(PLAN_LIMITS).map(p => p.analyticsTimeoutSeconds)) * 1000;
export const ANALYTICS_QUERY_DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESULT_ROWS = 10_000;
const MAX_RESULT_BYTES = 10 * 1024 * 1024;

export async function runAnalyticsQuery(options: {
  tenancy: Tenancy,
  query: string,
  params?: Record<string, unknown>,
  timeoutMs: number,
}): Promise<{ result: Record<string, Json>[], queryId: string }> {
  const { tenancy } = options;

  let effectiveTimeoutMs = options.timeoutMs;
  const billingTeamId = getBillingTeamId(tenancy.project);
  if (billingTeamId != null && arePlanLimitsEnforced()) {
    const app = getHexclaveServerApp();
    const timeoutItem = await app.getItem({ itemId: ITEM_IDS.analyticsTimeoutSeconds, teamId: billingTeamId });
    // clickHouse treats max_execution_time=0 as
    // "unlimited", so a customer with zero timeout entitlement (no active
    // plan in the plans line, or a transient gap between paid-plan end
    // and free regrant) would otherwise get unbounded query execution.
    if (timeoutItem.quantity <= 0) {
      throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.analyticsTimeoutSeconds, billingTeamId, 1);
    }
    const maxAllowedMs = timeoutItem.quantity * 1000;
    effectiveTimeoutMs = Math.min(options.timeoutMs, maxAllowedMs);
  }

  const client = getClickhouseExternalClient();
  const queryId = `${tenancy.project.id}:${tenancy.branchId}:${randomUUID()}`;
  const resultSet = await Result.fromPromise(client.query({
    query: options.query,
    query_id: queryId,
    query_params: options.params ?? {},
    clickhouse_settings: {
      SQL_project_id: tenancy.project.id,
      SQL_branch_id: tenancy.branchId,
      max_execution_time: effectiveTimeoutMs / 1000,
      readonly: "1",
      allow_ddl: 0,
      max_result_rows: MAX_RESULT_ROWS.toString(),
      max_result_bytes: MAX_RESULT_BYTES.toString(),
      result_overflow_mode: "throw",
    },
    format: "JSONEachRow",
  }));

  if (resultSet.status === "error") {
    const message = getSafeClickhouseErrorMessage(resultSet.error, options.query);
    throw new KnownErrors.AnalyticsQueryError(message);
  }

  const rows = await resultSet.data.json<Record<string, Json>>();
  return { result: rows, queryId };
}
