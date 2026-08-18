import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject } from "./growth-helpers";

// NOTE: inline snapshots hand-written with the stack down — may need `-u` refresh on first live run

const ADMIN_BASE = "/api/latest/internal/growth";
const AGENT_BASE = "/api/latest/internal/growth-agent";
const SERVER_BASE = "/api/v1/internal/growth-server";

// Growth fixtures seed sandbox-backed workflows during onboarding and can land around 60s under
// full-suite load, so default-timeout tests need 90s of headroom.

// E2E coverage for the wide growth metric store (ClickHouse growth_daily_metrics /
// growth_daily_ad_metrics) and its agent-facing surfaces: the daily rollup writing rows, schema
// discovery via column comments, row-policy isolation between projects, and the metrics-context
// route. The rollup route takes ordinary server auth (see growth-workflows.test.ts's bridge-call
// pattern); the agent routes take the shared machine secret (GROWTH_AGENT_AUTH). None of these
// tests dispatch to Eve — the direct rollup call creates the day's brief but never contacts the
// mock (which may only be bound by growth-workflows.test.ts), so this file is safe to run in its
// own vitest worker.
//
// Row values depend on whatever the shared dev ClickHouse and DB contain, so content assertions
// stay shape-level (count > 0, non-empty strings); the exact row-builder output is pinned by the
// unit tests in apps/backend/src/lib/growth/metric-store.test.ts.

type AgentScope = { project_id: string, branch_id: string };

// Mirrors the local helper in ../growth-agent/reads.test.ts (deliberately not exported from there:
// test files must not import each other, and growth-helpers.ts stays minimal).
async function createOnboardedGrowthProject(): Promise<AgentScope> {
  const projectKeys = await createGrowthProject();
  if (projectKeys === "no-project") {
    throw new Error("createGrowthProject should have switched to a real project.");
  }
  const onboardingResponse = await niceBackendFetch(`${ADMIN_BASE}/onboarding`, {
    method: "POST",
    accessType: "admin",
    body: { website_url: "https://example.com", company_summary: "An example company." },
  });
  if (onboardingResponse.status !== 200) {
    throw new Error(`Growth onboarding failed: ${JSON.stringify(onboardingResponse.body)}`);
  }
  return { project_id: projectKeys.projectId, branch_id: projectKeys.branchId ?? "main" };
}

function yesterdayUtcDate(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Direct server-auth rollup call for yesterday's UTC day (the rollup only accepts fully-elapsed
 * recent days, so yesterday is always valid). Throws instead of expecting so callers that only
 * need the side effect stay terse.
 */
async function runRollupForYesterday() {
  const response = await niceBackendFetch(`${SERVER_BASE}/daily/rollup`, {
    method: "POST",
    accessType: "server",
    body: { date: yesterdayUtcDate() },
  });
  if (response.status !== 200) {
    throw new Error(`Growth daily rollup failed: ${JSON.stringify(response.body)}`);
  }
  return response;
}

async function agentSqlQuery(scope: AgentScope, query: string) {
  return await niceBackendFetch(`${AGENT_BASE}/sql-query`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: { ...scope, query },
  });
}

/** Narrows a successful sql-query body's rows, failing loudly on any shape surprise. */
function requireSqlRows(body: unknown): Record<string, unknown>[] {
  if (typeof body !== "object" || body == null || !("success" in body) || body.success !== true || !("rows" in body) || !Array.isArray(body.rows)) {
    throw new Error(`Expected a successful sql-query body with rows, got: ${JSON.stringify(body)}`);
  }
  return body.rows as Record<string, unknown>[];
}

/**
 * count() is a ClickHouse UInt64, which JSONEachRow serializes as a STRING by default
 * (output_format_json_quote_64bit_integers=1), so the value must be numified before comparing.
 */
function requireSingleCount(body: unknown): number {
  const rows = requireSqlRows(body);
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one aggregate row, got: ${JSON.stringify(rows)}`);
  }
  const count = Number(rows[0].c);
  if (!Number.isFinite(count)) {
    throw new Error(`Expected a numeric count() value, got: ${JSON.stringify(rows[0])}`);
  }
  return count;
}

describe("growth metric store rollup", { timeout: 90_000 }, () => {
  it("writes wide metric rows to ClickHouse that the agent's sql-query can read back", { timeout: 120_000 }, async ({ expect }) => {
    const scope = await createOnboardedGrowthProject();

    const rollup = await runRollupForYesterday();
    expect(rollup.body).toMatchObject({
      brief_id: expect.any(String),
      brief_status: "generating",
      created: true,
    });

    const countResponse = await agentSqlQuery(scope, "SELECT count() AS c FROM growth_daily_metrics");
    expect(countResponse.status).toBe(200);
    // The exact count depends on the catalog size and on which metrics were computable for this
    // fresh project (non-finite values are skipped by design), so only emptiness is asserted; the
    // exact row set per bundle is pinned by the metric-store unit tests.
    expect(countResponse.body).toMatchObject({ success: true, truncated: false, row_count: 1 });
    expect(requireSingleCount(countResponse.body)).toBeGreaterThan(0);
  });

  it("is idempotent per day: a second rollup returns the existing brief without re-claiming the day", { timeout: 120_000 }, async ({ expect }) => {
    await createOnboardedGrowthProject();
    const first = await runRollupForYesterday();
    const firstBriefId = (first.body as { brief_id: string }).brief_id;
    const second = await runRollupForYesterday();
    expect(second.body).toMatchObject({ brief_id: firstBriefId, created: false });
  });
});

describe("growth metric store schema discovery", { timeout: 90_000 }, () => {
  it("exposes both growth tables via SHOW TABLES and documents columns via DESCRIBE comments", { timeout: 120_000 }, async ({ expect }) => {
    const scope = await createOnboardedGrowthProject();

    // SHOW TABLES pins the limited user's GRANT list actually containing the two new tables.
    const showTables = await agentSqlQuery(scope, "SHOW TABLES");
    expect(showTables.status).toBe(200);
    const tableNames = requireSqlRows(showTables.body).map((row) => row.name);
    expect(tableNames).toEqual(expect.arrayContaining(["growth_daily_metrics", "growth_daily_ad_metrics"]));

    // The column comments are the agent's authoritative schema docs (the correlation rules tell it
    // to DESCRIBE before querying), so pin that they actually got applied to the default.* view.
    const describe = await agentSqlQuery(scope, "DESCRIBE TABLE growth_daily_metrics");
    expect(describe.status).toBe(200);
    const describeRows = requireSqlRows(describe.body);
    expect(describeRows.length).toBeGreaterThan(0);
    const metricIdRow = describeRows.find((row) => row.name === "metric_id");
    if (metricIdRow == null) {
      throw new Error(`DESCRIBE TABLE growth_daily_metrics returned no metric_id column: ${JSON.stringify(describeRows)}`);
    }
    // Non-empty string, asserted matcher-style so no cast is needed on the unknown-typed row.
    expect(metricIdRow.comment).toEqual(expect.stringMatching(/\S/));
  });
});

describe("growth metric store isolation", { timeout: 90_000 }, () => {
  it("scopes growth_daily_metrics reads to the querying project via the row policy", { timeout: 120_000 }, async ({ expect }) => {
    // Project 1 rolls up, so the shared table definitely holds rows...
    const firstScope = await createOnboardedGrowthProject();
    await runRollupForYesterday();
    const firstCount = await agentSqlQuery(firstScope, "SELECT count() AS c FROM growth_daily_metrics");
    expect(requireSingleCount(firstCount.body)).toBeGreaterThan(0);

    // ...but a second project's agent must count 0 of them. This is the security property of the
    // whole design: templates never filter by project/branch, the row policy does.
    const secondScope = await createOnboardedGrowthProject();
    const secondCount = await agentSqlQuery(secondScope, "SELECT count() AS c FROM growth_daily_metrics");
    expect(secondCount.status).toBe(200);
    expect(secondCount.body).toMatchObject({ success: true, truncated: false });
    expect(requireSingleCount(secondCount.body)).toBe(0);
  });
});

describe("growth-agent metrics-context", { timeout: 90_000 }, () => {
  it("returns the catalog, queryable tables, correlation rules, and post-rollup freshness", { timeout: 120_000 }, async ({ expect }) => {
    const scope = await createOnboardedGrowthProject();
    // Roll up first so freshness has something to report for this tenancy.
    await runRollupForYesterday();

    const response = await niceBackendFetch(`${AGENT_BASE}/metrics-context`, {
      method: "GET",
      headers: GROWTH_AGENT_AUTH,
      query: scope,
    });
    expect(response.status).toBe(200);
    // The catalog itself will churn as metrics are added, so the snapshot pins only the top-level
    // wire shape; entry-level invariants are asserted structurally below.
    expect(Object.keys(response.body as Record<string, unknown>).sort()).toMatchInlineSnapshot(`
      [
        "correlation_rules",
        "freshness",
        "not_possible",
        "on_the_fly_metrics",
        "queryable_tables",
        "stored_metrics",
      ]
    `);

    // NiceResponse.body is `any`; this annotation documents the parts of the wire shape asserted here.
    const body: {
      stored_metrics: { id: unknown, label: unknown, unit: unknown, kind: unknown }[],
      on_the_fly_metrics: { id: unknown, sql_template: unknown }[],
      not_possible: { id: unknown, description: unknown }[],
      queryable_tables: string[],
      correlation_rules: string,
      freshness: { latest_stored_date: string | null, earliest_stored_date: string | null, ad_metrics_present: boolean },
    } = response.body;

    expect(body.stored_metrics.length).toBeGreaterThan(0);
    for (const metric of body.stored_metrics) {
      expect(metric).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        unit: expect.any(String),
        kind: expect.any(String),
      });
    }
    expect(body.on_the_fly_metrics.length).toBeGreaterThan(0);
    for (const metric of body.on_the_fly_metrics) {
      expect(metric).toMatchObject({ id: expect.any(String), sql_template: expect.stringMatching(/\S/) });
    }
    expect(body.not_possible.length).toBeGreaterThan(0);
    expect(body.queryable_tables).toEqual(expect.arrayContaining(["growth_daily_metrics", "growth_daily_ad_metrics"]));
    // The correlation rules must spell out the two timezone bases (UTC product days vs
    // ad-account-local ad days) — the core caveat of the two-table design.
    expect(body.correlation_rules).toContain("UTC");
    expect(body.correlation_rules).toMatch(/timezone/i);

    // Freshness reflects the rollup above. The exact dates depend on the loaders' window bounds
    // relative to "now", so only well-formedness is asserted.
    expect(body.freshness.latest_stored_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.freshness.earliest_stored_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No ad platform is connected in e2e, so the best-effort ad write records nothing.
    expect(body.freshness.ad_metrics_present).toBe(false);
  });

  // Mirrors the auth-negative style of ../growth-agent/reads.test.ts (status-only assertions on
  // the shared authenticateGrowthAgentRequest entry point); sql-query's negatives live there.
  it("rejects missing and wrong bearer secrets", async ({ expect }) => {
    const scope = await createOnboardedGrowthProject();

    const missingHeader = await niceBackendFetch(`${AGENT_BASE}/metrics-context`, {
      method: "GET",
      query: scope,
    });
    expect(missingHeader.status).toBe(401);

    const wrongSecret = await niceBackendFetch(`${AGENT_BASE}/metrics-context`, {
      method: "GET",
      headers: { "authorization": "Bearer definitely-not-the-secret" },
      query: scope,
    });
    expect(wrongSecret.status).toBe(401);
  });
});

describe("growth compute-metrics phase", { timeout: 90_000 }, () => {
  it("reports the compute-metrics phase as its own status block, not a checklist step", async ({ expect }) => {
    await createOnboardedGrowthProject();
    // lifecycle.test.ts pins the full ordered checklist (which excludes compute-metrics), so this
    // covers the standalone `analysis.compute_metrics` block the dashboard renders above it: the
    // phase state plus the catalog-derived metric label list.
    const status = await niceBackendFetch(`${ADMIN_BASE}/status`, { accessType: "admin" });
    expect(status.status).toBe(200);
    const analysis = (status.body as {
      analysis: {
        steps: { id: string, label: string, state: string }[],
        compute_metrics: { state: string, metric_labels: string[] } | null,
      },
    }).analysis;
    // The phase renders as its own block, never as a checklist row (same for integrations, whose
    // own block is asserted in lifecycle.test.ts).
    expect(analysis.steps.some((step) => step.id === "compute-metrics")).toBe(false);
    expect(analysis.steps.some((step) => step.id === "integrations")).toBe(false);
    expect(analysis.compute_metrics).toMatchObject({ state: "pending" });
    const metricLabels = analysis.compute_metrics?.metric_labels ?? [];
    expect(metricLabels.length).toBeGreaterThan(0);
    for (const label of metricLabels) {
      expect(label).toEqual(expect.stringMatching(/\S/));
    }
  });
});
