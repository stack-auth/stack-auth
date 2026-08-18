import { describe, expect, it } from "vitest";
import { getGrowthAnalyticsClickhouseSettings } from "./analytics-sql";

/**
 * These settings are the tenant isolation boundary for agent-authored SQL: the growth agent writes
 * the SELECT, so nothing but `SQL_project_id`/`SQL_branch_id` keeps it inside the caller's data, and
 * nothing but `readonly`/`allow_ddl` keeps it from writing. Growth runs its own copy of this block
 * (see the module header for why), so it is pinned here — a copy that silently loses a setting is a
 * cross-tenant leak, not a style regression.
 */
describe("growth analytics ClickHouse settings", () => {
  it("scopes every query to the caller's project and branch", () => {
    const settings = getGrowthAnalyticsClickhouseSettings("proj_123", "branch_abc");
    expect(settings.SQL_project_id).toBe("proj_123");
    expect(settings.SQL_branch_id).toBe("branch_abc");
  });

  it("forbids writes and DDL", () => {
    const settings = getGrowthAnalyticsClickhouseSettings("proj_123", "main");
    expect(settings.readonly).toBe("1");
    expect(settings.allow_ddl).toBe(0);
  });

  it("bounds execution time and result size", () => {
    // Without these an agent can hang the ClickHouse cluster with one bad GROUP BY, and a runaway
    // result would be materialized in the backend before the character budget could reject it.
    const settings = getGrowthAnalyticsClickhouseSettings("proj_123", "main");
    expect(settings.max_execution_time).toBe(5);
    expect(settings.max_result_rows).toBe("10000");
    expect(settings.max_result_bytes).toBe((10 * 1024 * 1024).toString());
    expect(settings.result_overflow_mode).toBe("throw");
  });

  it("matches the full expected settings block", () => {
    // Whole-object assertion so an ADDED setting is noticed too, not just a removed one.
    expect(getGrowthAnalyticsClickhouseSettings("proj_123", "main")).toMatchInlineSnapshot(`
      {
        "SQL_branch_id": "main",
        "SQL_project_id": "proj_123",
        "allow_ddl": 0,
        "max_execution_time": 5,
        "max_result_bytes": "10485760",
        "max_result_rows": "10000",
        "readonly": "1",
        "result_overflow_mode": "throw",
      }
    `);
  });
});
