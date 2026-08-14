import { describe, expect, it } from "vitest";
import { getUnreadGrowthReport, selectGrowthHighlight } from "@/app/(main)/(protected)/projects/[projectId]/growth/components/workspace-overview";
import { buildGrowthDemoOverview, buildGrowthDemoStatus, GROWTH_DEMO_NOW_MILLIS } from "./growth-demo-data";

const PROJECT_ID = "11111111-2222-3333-4444-555555555555";

describe("selectGrowthHighlight", () => {
  it("leads with the daily brief once one exists", () => {
    const overview = buildGrowthDemoOverview(GROWTH_DEMO_NOW_MILLIS);
    const brief = overview.latestBrief ?? expect.fail("The overview demo fixture is expected to carry a brief.");
    const highlight = selectGrowthHighlight(overview, PROJECT_ID);
    expect(highlight).toEqual({
      kind: "brief",
      summary: brief.summary,
      createdAtMillis: brief.createdAtMillis,
      href: `/projects/${PROJECT_ID}/growth/briefs/${brief.id}`,
    });
  });

  it("falls back to the deep-analysis report on day one, before any brief exists", () => {
    // This is the state a project is in for its whole first day: the analysis run has produced a
    // report, but the first daily brief cannot exist until a full day of metrics has accumulated.
    // A dev database realistically only ever holds one of the two states, so this branch is the easy
    // one to break without noticing.
    const overview = { ...buildGrowthDemoOverview(GROWTH_DEMO_NOW_MILLIS), latestBrief: null };
    const report = overview.latestReport ?? expect.fail("The overview demo fixture is expected to carry a report.");
    expect(selectGrowthHighlight(overview, PROJECT_ID)).toEqual({
      kind: "report",
      summary: report.summary,
      createdAtMillis: report.createdAtMillis,
      // No report id in the path: the report page always renders the latest report.
      href: `/projects/${PROJECT_ID}/growth/report`,
    });
  });

  it("has nothing to lead with before the first run finishes", () => {
    const overview = { ...buildGrowthDemoOverview(GROWTH_DEMO_NOW_MILLIS), latestBrief: null, latestReport: null };
    expect(selectGrowthHighlight(overview, PROJECT_ID)).toBeNull();
  });

  it("scopes both hrefs to the project it was asked about", () => {
    const withBrief = buildGrowthDemoOverview(GROWTH_DEMO_NOW_MILLIS);
    const withReportOnly = { ...withBrief, latestBrief: null };
    for (const overview of [withBrief, withReportOnly]) {
      expect(selectGrowthHighlight(overview, "other-project")?.href).toMatch(/^\/projects\/other-project\/growth\//);
    }
  });
});

describe("getUnreadGrowthReport", () => {
  it("returns the published report until it has been opened", () => {
    const status = buildGrowthDemoStatus("steady-state", GROWTH_DEMO_NOW_MILLIS);
    expect(getUnreadGrowthReport(status)?.id).toBe(status.latestReport?.id);
  });

  it("hides the prompt after that report is read", () => {
    const status = buildGrowthDemoStatus("steady-state", GROWTH_DEMO_NOW_MILLIS);
    if (status.latestReport == null) expect.fail("The steady-state fixture must include a report.");
    status.latestReport.readAtMillis = GROWTH_DEMO_NOW_MILLIS;
    expect(getUnreadGrowthReport(status)).toBeNull();
  });

  it("renders no prompt before a report is published", () => {
    const status = buildGrowthDemoStatus("report-ready", GROWTH_DEMO_NOW_MILLIS);
    expect(status.latestReport).toBeNull();
    expect(getUnreadGrowthReport(status)).toBeNull();
  });
});
