import { WAREHOUSE_ANALYTICS_CLICKHOUSE_SETTINGS, createClickhouseWarehouseClient, getClickhouseExternalClient } from "@/lib/clickhouse";
import { getDataWarehouseQueryAuth } from "@/lib/data-warehouse";
import type { Tenancy } from "@/lib/tenancies";
import type { ClickHouseClient } from "@clickhouse/client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

/**
 * Where a project's analytics SQL runs, and what keeps it inside that project.
 *
 * There are two arrangements, and every read-only SQL surface has to pick the
 * same one for a given project or they disagree about what the customer's data
 * even is:
 *
 *  - **Shared cluster.** Most projects. Everyone's rows live in one set of
 *    tables, and `SQL_project_id` / `SQL_branch_id` drive the ClickHouse row
 *    policies that separate them. Losing those settings is a cross-tenant leak,
 *    so they are not optional decoration.
 *
 *  - **Own warehouse.** A project that provisioned one gets its own database and
 *    its own ClickHouse user, and the isolation is that user's grants rather
 *    than a row policy — so the scoping settings are deliberately *absent*
 *    there. Its data-source tables (Postgres, Convex) exist only in this
 *    database, which is why a surface still pointed at the shared cluster cannot
 *    see them at all.
 *
 * Resolving that choice in one place is the point: this used to be inlined in
 * the analytics query route and separately in the dashboard AI's `sql-query`
 * tool, and the tool never grew the warehouse branch — so "Run query" could read
 * a customer's synced tables and "Ask AI" silently could not.
 */
export type AnalyticsQueryTarget = {
  client: ClickHouseClient,
  /**
   * Settings that scope the query to this tenancy. Merge into the caller's own
   * settings — never replace them, and never drop these.
   */
  scopeSettings: Record<string, string>,
  /** True when the project reads from its own warehouse database. */
  isWarehouse: boolean,
};

/**
 * The settings that make an untrusted, possibly model-authored SELECT safe to
 * run at all: no writes, no DDL, and a bounded result.
 *
 * Separate from `scopeSettings` because they answer a different question —
 * scoping is about *whose* data, this is about *what the query may do* — and
 * because a caller may tighten the limits without being able to weaken safety.
 */
export const READ_ONLY_SQL_CLICKHOUSE_SETTINGS = {
  readonly: "1",
  allow_ddl: 0,
  result_overflow_mode: "throw",
} as const;

export async function resolveAnalyticsQueryTarget(tenancy: Tenancy): Promise<AnalyticsQueryTarget> {
  const warehouseAuth = await getDataWarehouseQueryAuth(tenancy);
  if (warehouseAuth == null) {
    return {
      client: getClickhouseExternalClient(),
      scopeSettings: { SQL_project_id: tenancy.project.id, SQL_branch_id: tenancy.branchId },
      isWarehouse: false,
    };
  }
  return {
    // The shared client bakes its resource ceiling in at construction, so the
    // warehouse client is given one too: without it a warehouse project falls
    // back to the much looser per-query memory default of its own settings
    // profile and skips the GROUP BY spill and bounded join algorithm entirely.
    client: createClickhouseWarehouseClient(
      warehouseAuth,
      getEnvVariable("STACK_CLICKHOUSE_DATABASE", "default"),
      WAREHOUSE_ANALYTICS_CLICKHOUSE_SETTINGS,
    ),
    // Row policies belong to the shared cluster. On a warehouse the user's own
    // grants are the boundary, and sending these would scope a query by columns
    // its tables do not have.
    scopeSettings: {},
    isWarehouse: true,
  };
}
