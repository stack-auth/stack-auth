import { describe, expect, it } from "vitest";
import { GROWTH_METRIC_IDS } from "./action-item-types";
import { GROWTH_AGENT_QUERYABLE_TABLES, GROWTH_METRIC_CATALOG } from "./metric-catalog";

// Extracts every table referenced by FROM/JOIN in a template, minus CTE names defined in the
// template itself. Regex-based on purpose: templates are static strings we author, not arbitrary
// SQL, so a full parser would be overkill — but if a template ever confuses this extraction, fix
// the extraction rather than weakening the invariant.
function extractReferencedTables(sql: string): string[] {
  const cteNames = new Set<string>();
  for (const match of sql.matchAll(/(?:\bWITH|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+AS\s*\(/gi)) {
    cteNames.add(match[1].toLowerCase());
  }
  const tables: string[] = [];
  for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi)) {
    const name = match[1].toLowerCase();
    if (!cteNames.has(name)) {
      tables.push(name);
    }
  }
  return tables;
}

describe("GROWTH_METRIC_CATALOG", () => {
  it("has unique ids", () => {
    const ids = GROWTH_METRIC_CATALOG.map((metric) => metric.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses snake_case ids", () => {
    for (const metric of GROWTH_METRIC_CATALOG) {
      expect(metric.id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("has a sqlTemplate iff availability is on_the_fly", () => {
    for (const metric of GROWTH_METRIC_CATALOG) {
      if (metric.availability === "on_the_fly") {
        expect(
          metric.sqlTemplate != null && metric.sqlTemplate.trim().length > 0,
          `${metric.id} is on_the_fly and must have a non-empty sqlTemplate`,
        ).toBe(true);
      } else {
        expect(metric.sqlTemplate, `${metric.id} is ${metric.availability} and must not have a sqlTemplate`).toBeUndefined();
      }
    }
  });

  it("never scopes sqlTemplates by project/branch or reads internal tables (row policies scope)", () => {
    for (const metric of GROWTH_METRIC_CATALOG) {
      if (metric.sqlTemplate == null) continue;
      expect(metric.sqlTemplate, `${metric.id} must not filter by project_id`).not.toContain("project_id");
      expect(metric.sqlTemplate, `${metric.id} must not filter by branch_id`).not.toContain("branch_id");
      expect(metric.sqlTemplate, `${metric.id} must only query default.* views`).not.toContain("analytics_internal");
    }
  });

  it("only references queryable tables in sqlTemplates", () => {
    const queryable = new Set<string>(GROWTH_AGENT_QUERYABLE_TABLES);
    for (const metric of GROWTH_METRIC_CATALOG) {
      if (metric.sqlTemplate == null) continue;
      const referenced = extractReferencedTables(metric.sqlTemplate);
      expect(referenced.length, `${metric.id} template should reference at least one table`).toBeGreaterThan(0);
      for (const table of referenced) {
        expect(queryable.has(table), `${metric.id} references "${table}" which is not in GROWTH_AGENT_QUERYABLE_TABLES`).toBe(true);
      }
    }
  });

  it("routes page-view metrics through the derived public store", () => {
    const pageViewMetricIds = new Set([
      "utm_source_breakdown",
      "paid_click_landings",
      "top_pages",
      "landing_pages",
      "referrer_domains",
      "traffic_heatmap",
    ]);
    for (const metric of GROWTH_METRIC_CATALOG) {
      if (!pageViewMetricIds.has(metric.id)) continue;
      expect(metric.sqlTemplate).toContain("FROM page_views");
      expect(metric.sqlTemplate).not.toContain("FROM spans");
    }
  });

  it("mentions every legacy growth metric id in some legacyIdNote", () => {
    const notes = GROWTH_METRIC_CATALOG
      .map((metric) => metric.legacyIdNote)
      .filter((note): note is string => note != null);
    for (const legacyId of GROWTH_METRIC_IDS) {
      const mentioned = notes.some((note) => note.includes(`\`${legacyId}\``));
      expect(mentioned, `legacy metric id "${legacyId}" must be mentioned (backtick-quoted) by at least one legacyIdNote`).toBe(true);
    }
  });

  it("keeps ads metrics in the ad-account timezone and everything else in UTC", () => {
    for (const metric of GROWTH_METRIC_CATALOG) {
      if (metric.availability !== "stored") continue;
      if (metric.category === "ads") {
        expect(metric.timezone, `${metric.id} is stored ads data and lives in growth_daily_ad_metrics with account-local dates`).toBe("ad_account");
        expect(metric.description).toContain("growth_daily_ad_metrics");
      } else {
        expect(metric.timezone, `${metric.id} is stored in growth_daily_metrics which is UTC-only`).toBe("utc");
      }
    }
  });

  it("only marks flow metrics (or the reconstructible total_users) as backfillable", () => {
    for (const metric of GROWTH_METRIC_CATALOG) {
      if (!metric.backfillable) continue;
      expect(metric.availability, `${metric.id}: only stored metrics can be backfilled`).toBe("stored");
      if (metric.kind === "snapshot") {
        // total_users is the one snapshot that can be reconstructed (cumulative signups anchored
        // at the current total); any other backfillable snapshot is a catalog bug.
        expect(metric.id).toBe("total_users");
      }
    }
  });

  // This is the sync tripwire for the row-policy and GRANT list in
  // apps/backend/scripts/clickhouse-migrations.ts.
  it("matches the row-policy table list in scripts/clickhouse-migrations.ts", () => {
    expect([...GROWTH_AGENT_QUERYABLE_TABLES]).toEqual([
      "events",
      "spans",
      "page_views",
      "users",
      "contact_channels",
      "teams",
      "team_member_profiles",
      "team_permissions",
      "team_invitations",
      "email_outboxes",
      "project_permissions",
      "notification_preferences",
      "refresh_tokens",
      "connected_accounts",
      "growth_daily_metrics",
      "growth_daily_ad_metrics",
    ]);
  });
});
