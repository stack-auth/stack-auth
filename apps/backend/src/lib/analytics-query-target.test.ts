import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const warehouseAuth = vi.hoisted(() => ({ value: null as { username: string, password: string } | null }));
const created = vi.hoisted(() => ({ external: 0, warehouse: [] as unknown[] }));

vi.mock("@/lib/data-warehouse", () => ({
  getDataWarehouseQueryAuth: async () => warehouseAuth.value,
}));

vi.mock("@/lib/clickhouse", () => ({
  WAREHOUSE_ANALYTICS_CLICKHOUSE_SETTINGS: { max_memory_usage: "1" },
  getClickhouseExternalClient: () => {
    created.external++;
    return { kind: "external" };
  },
  createClickhouseWarehouseClient: (auth: unknown, database: string, settings: unknown) => {
    created.warehouse.push({ auth, database, settings });
    return { kind: "warehouse" };
  },
}));

const { READ_ONLY_SQL_CLICKHOUSE_SETTINGS, resolveAnalyticsQueryTarget } = await import("./analytics-query-target");

const tenancy = { id: "ten_1", branchId: "main", project: { id: "proj_1" } } as any;

describe("choosing where analytics SQL runs", () => {
  it("uses the shared cluster with row-policy scoping when the project has no warehouse", async () => {
    // The overwhelmingly common case, and the one that must not regress: these
    // two settings are the entire tenant boundary on the shared cluster.
    warehouseAuth.value = null;

    const target = await resolveAnalyticsQueryTarget(tenancy);

    expect(target.isWarehouse).toBe(false);
    expect(target.client).toEqual({ kind: "external" });
    expect(target.scopeSettings).toEqual({ SQL_project_id: "proj_1", SQL_branch_id: "main" });
  });

  it("uses the project's own warehouse client when it has one", async () => {
    warehouseAuth.value = { username: "u", password: "p" };

    const target = await resolveAnalyticsQueryTarget(tenancy);

    expect(target.isWarehouse).toBe(true);
    expect(target.client).toEqual({ kind: "warehouse" });
    // Row policies belong to the shared cluster; on a warehouse the user's own
    // grants are the boundary, and these columns do not exist on its tables.
    expect(target.scopeSettings).toEqual({});
  });

  it("gives the warehouse client a resource ceiling", async () => {
    // Without one, a warehouse project falls back to its settings profile's much
    // looser per-query memory default and skips the bounded join algorithm.
    warehouseAuth.value = { username: "u", password: "p" };
    created.warehouse = [];

    await resolveAnalyticsQueryTarget(tenancy);

    expect(created.warehouse).toHaveLength(1);
    expect((created.warehouse[0] as any).settings).toEqual({ max_memory_usage: "1" });
  });
});

describe("read-only SQL settings", () => {
  it("forbids writes and DDL, and refuses to truncate an oversized result", () => {
    // These are what make it safe to pass a model-authored SELECT straight
    // through. `result_overflow_mode: throw` matters as much as the limits: the
    // alternative silently returns a partial result the model would treat as
    // complete.
    expect(READ_ONLY_SQL_CLICKHOUSE_SETTINGS).toEqual({
      readonly: "1",
      allow_ddl: 0,
      result_overflow_mode: "throw",
    });
  });
});

/**
 * Every read-only SQL surface a customer can reach must resolve its target the
 * same way, or they disagree about what that customer's data is.
 *
 * This is asserted against the source rather than by executing the paths,
 * because the failure being prevented is a *new* surface — or a refactor of an
 * existing one — quietly constructing its own client again. That is exactly how
 * the dashboard AI tool ended up unable to see warehouse tables while the
 * analytics route could: two inlined copies of the same decision, only one of
 * which grew the warehouse branch.
 *
 * `lib/growth/analytics-sql.ts` is deliberately excluded — its module header
 * explains why growth keeps its own copy, and coupling it here would undo that
 * decision by the back door.
 */
describe("analytics SQL surfaces stay in step", () => {
  // Relative to this file, so the test does not depend on the working directory
  // vitest happens to be invoked from.
  const SURFACES = [
    "../app/api/latest/analytics/query/route.ts",
    "./ai/tools/sql-query.ts",
  ];

  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it.each(SURFACES)("%s resolves its target through the shared helper", path => {
    const source = read(path);
    expect(source).toContain("resolveAnalyticsQueryTarget");
  });

  it.each(SURFACES)("%s does not construct a ClickHouse client of its own", path => {
    const source = read(path);
    // Either of these means the surface has re-made the shared-vs-warehouse
    // decision locally, which is the thing that drifted last time.
    expect(source).not.toContain("getClickhouseExternalClient");
    expect(source).not.toContain("createClickhouseWarehouseClient");
  });

  it.each(SURFACES)("%s applies the tenant scoping and read-only settings it is given", path => {
    const source = read(path);
    // Dropping scopeSettings on the shared cluster is a cross-tenant leak;
    // dropping the read-only settings lets an untrusted SELECT write.
    expect(source).toContain("...target.scopeSettings");
    expect(source).toContain("...READ_ONLY_SQL_CLICKHOUSE_SETTINGS");
  });

  it("still lets each surface set its own limits", () => {
    // The shared part is which client and whose data — not how long a query may
    // run or how much it may return. Those differ by surface on purpose (a model
    // gets a tighter budget than a customer's own console), so the helper must
    // not pin them.
    expect(READ_ONLY_SQL_CLICKHOUSE_SETTINGS).not.toHaveProperty("max_execution_time");
    expect(READ_ONLY_SQL_CLICKHOUSE_SETTINGS).not.toHaveProperty("max_result_rows");
  });
});
