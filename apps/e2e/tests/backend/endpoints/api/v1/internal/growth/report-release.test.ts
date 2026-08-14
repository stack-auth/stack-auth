import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, INTERNAL_PROJECT_OWNER_TEAM_ID, InternalProjectKeys, Team, backendContext, niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject, publishGrowthReportAsStaff, requireRunId } from "./growth-helpers";

const GROWTH_BASE = "/api/latest/internal/growth";
const ADMIN_BASE = "/api/latest/internal/growth/admin";
const AGENT_BASE = "/api/latest/internal/growth-agent";

/**
 * The release gate: a growth report is written by the analysis but withheld from the customer until
 * a Hexclave staff member publishes it, and until then the customer's whole workspace is dark.
 *
 * Seeding "plays the agent" with the shared machine secret, the way report-actions.test.ts does —
 * reports have no customer-facing write API, so that is the only way one comes into existence.
 */

async function seedHeldReport() {
  const keys = await createGrowthProject();
  if (keys === "no-project") throw new Error("The release-gate test requires a fresh project.");
  const scope = { project_id: keys.projectId, branch_id: "main" };

  const onboarding = await niceBackendFetch(`${GROWTH_BASE}/onboarding`, {
    accessType: "admin",
    method: "POST",
    body: { website_url: "https://release-gate.example.com", company_summary: "Release gate fixture" },
  });
  if (onboarding.status !== 200) throw new Error(`Growth onboarding failed with ${onboarding.status}.`);
  const runId = requireRunId(onboarding.body);

  const report = await niceBackendFetch(`${AGENT_BASE}/report`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: {
      ...scope,
      run_id: runId,
      title: "Growth analysis for the fixture",
      summary: "Everything the customer must not see yet.",
      content_md: "# Held\n\nUnreviewed.",
      action_items: [
        { type_id: "custom", category: "conversion", tags: [], title: "Unreviewed suggestion", description: "Also withheld." },
      ],
    },
  });
  if (report.status !== 200) throw new Error(`Saving the report failed with ${report.status}.`);
  return { projectId: keys.projectId, scope, reportId: (report.body as { report_id: string }).report_id };
}

async function signInAsInternalAdmin(): Promise<void> {
  backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
  const { userId } = await Auth.fastSignUp();
  await Team.addMember(INTERNAL_PROJECT_OWNER_TEAM_ID, userId);
}

describe("internal Growth report release", () => {
  it("withholds the whole workspace from the customer until a report is published", async ({ expect }) => {
    await seedHeldReport();

    // Every surface that could reveal what the unreviewed report says. The overview carries the
    // insights and category scores; actions ARE the suggestions; briefs and chat both speak from the
    // same findings.
    for (const path of [
      `${GROWTH_BASE}/overview`,
      `${GROWTH_BASE}/metrics-overview`,
      `${GROWTH_BASE}/actions`,
      `${GROWTH_BASE}/briefs`,
      `${GROWTH_BASE}/chat/conversations`,
    ]) {
      const response = await niceBackendFetch(path, { accessType: "admin" });
      expect([path, response.status]).toEqual([path, 409]);
      expect(response.body).toMatchObject({ error: "Your growth report is still being prepared." });
    }

    // The report itself 404s rather than 409s: to the customer an unreleased report is indistinguishable
    // from one that has not been written, and neither is a state they can act on.
    const held = await niceBackendFetch(`${GROWTH_BASE}/reports/latest`, { accessType: "admin" });
    expect(held.status).toBe(404);
  });

  it("keeps the status endpoint open, reporting the hold rather than the report", async ({ expect }) => {
    await seedHeldReport();
    // Status must stay reachable — it is what drives the "check back in about 24 hours" timeline, so
    // locking it would leave the customer with a blank page instead of an explanation.
    const status = await niceBackendFetch(`${GROWTH_BASE}/status`, { accessType: "admin" });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ latest_report: null, latest_brief: null, release: { state: "preparing" } });
  });

  it("releases everything once staff publish, and the report reads back as the customer's latest", async ({ expect }) => {
    const { projectId, reportId } = await seedHeldReport();
    await publishGrowthReportAsStaff(projectId, reportId);

    const status = await niceBackendFetch(`${GROWTH_BASE}/status`, { accessType: "admin" });
    expect(status.body).toMatchObject({ release: { state: "released" }, latest_report: { id: reportId, read_at_millis: null } });

    const overview = await niceBackendFetch(`${GROWTH_BASE}/overview`, { accessType: "admin" });
    expect(overview.status).toBe(200);
    const actions = await niceBackendFetch(`${GROWTH_BASE}/actions`, { accessType: "admin" });
    expect(actions.status).toBe(200);
    const briefs = await niceBackendFetch(`${GROWTH_BASE}/briefs`, { accessType: "admin" });
    expect(briefs.status).toBe(200);

    const report = await niceBackendFetch(`${GROWTH_BASE}/reports/latest`, { accessType: "admin" });
    expect(report).toMatchObject({ status: 200, body: { id: reportId, title: "Growth analysis for the fixture" } });
  });

  it("marks a published report read once and exposes the receipt on status", async ({ expect }) => {
    const { projectId, reportId } = await seedHeldReport();

    // Held and malformed ids have the same miss shape as the report GET. A customer cannot use the
    // receipt endpoint to discover a report that staff have not released.
    const held = await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}/read`, { accessType: "admin", method: "POST" });
    expect(held.status).toBe(404);
    const malformed = await niceBackendFetch(`${GROWTH_BASE}/reports/not-a-uuid/read`, { accessType: "admin", method: "POST" });
    expect(malformed.status).toBe(404);

    await publishGrowthReportAsStaff(projectId, reportId);
    const first = await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}/read`, { accessType: "admin", method: "POST" });
    expect(first).toMatchObject({ status: 200, body: { id: reportId } });
    const afterFirst = await niceBackendFetch(`${GROWTH_BASE}/status`, { accessType: "admin" });
    const firstReadAt = (afterFirst.body as { latest_report: { read_at_millis: number | null } }).latest_report.read_at_millis;
    expect(firstReadAt).toEqual(expect.any(Number));

    // Opening the report in another tab is idempotent and preserves the original first-read time.
    const second = await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}/read`, { accessType: "admin", method: "POST" });
    expect(second).toMatchObject({ status: 200, body: { id: reportId } });
    const afterSecond = await niceBackendFetch(`${GROWTH_BASE}/status`, { accessType: "admin" });
    expect((afterSecond.body as { latest_report: { read_at_millis: number | null } }).latest_report.read_at_millis).toBe(firstReadAt);
  });

  it("locks the workspace again only for the report, not for the customer, when staff unpublish", async ({ expect }) => {
    const { projectId, reportId } = await seedHeldReport();
    await publishGrowthReportAsStaff(projectId, reportId);
    await signInAsInternalAdmin();

    const unpublished = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}`, {
      accessType: "client",
      method: "PATCH",
      body: { target_project_id: projectId, action: "unpublish" },
    });
    expect(unpublished.status).toBe(200);
    expect(unpublished.body).toMatchObject({ reports: [{ id: reportId, published_at_millis: null }] });

    // Publishing twice, or unpublishing what is not published, is a stale second tab — 409, not 500.
    const again = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}`, {
      accessType: "client",
      method: "PATCH",
      body: { target_project_id: projectId, action: "unpublish" },
    });
    expect(again.status).toBe(409);
  });

  it("shows staff the held report, and refuses non-platform-admins entirely", async ({ expect }) => {
    const { projectId, reportId } = await seedHeldReport();

    // A signed-in internal-project user who is NOT on the owner team: the internal publishable key is
    // public, so "signed into internal" must never be enough to read another company's report.
    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
    await Auth.fastSignUp();
    for (const [path, init] of [
      [`${ADMIN_BASE}/reports?project_id=${projectId}`, {}],
      [`${ADMIN_BASE}/reports/${reportId}?project_id=${projectId}`, {}],
      [`${ADMIN_BASE}/reports/${reportId}`, { method: "PATCH", body: { target_project_id: projectId, action: "publish" } }],
    ] as const) {
      const response = await niceBackendFetch(path, { accessType: "client", ...init });
      expect([path, response.status]).toEqual([path, 403]);
    }

    await signInAsInternalAdmin();
    const list = await niceBackendFetch(`${ADMIN_BASE}/reports?project_id=${projectId}`, { accessType: "client" });
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      reports: [{ id: reportId, trigger: "initial", action_item_count: 1, published_at_millis: null, published_by_user_id: null }],
    });

    // Staff read the full report while the customer cannot — same builder, published-only filter lifted.
    const detail = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}?project_id=${projectId}`, { accessType: "client" });
    expect(detail).toMatchObject({
      status: 200,
      body: {
        id: reportId,
        title: "Growth analysis for the fixture",
        content_md: "# Held\n\nUnreviewed.",
        published_at_millis: null,
        action_items: [{ title: "Unreviewed suggestion" }],
      },
    });

    // A malformed or foreign report id is a clean 404, never a Postgres cast error.
    const missing = await niceBackendFetch(`${ADMIN_BASE}/reports/not-a-uuid?project_id=${projectId}`, { accessType: "client" });
    expect(missing.status).toBe(404);
  });
});
