import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, InternalProjectKeys, backendContext, niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, asGrowthStaff, createGrowthProject, publishGrowthPresentationAsStaff, requireRunId } from "./growth-helpers";

const GROWTH_BASE = "/api/latest/internal/growth";
const ADMIN_BASE = "/api/latest/internal/growth/admin";
const AGENT_BASE = "/api/latest/internal/growth-agent";

// Growth fixtures seed sandbox-backed workflows during onboarding and can land around 60s under
// full-suite load, so default-timeout tests need 90s of headroom.

/**
 * What a customer may read, and when. Analysis writes an internal report artifact; staff must author
 * and publish a presentation before the customer can read the report.
 *
 * The workspace is dark until a presentation is published, and either presentation unpublish or
 * report unpublish puts it back in the dark.
 *
 * Seeding "plays the agent" with the shared machine secret, the way report-actions.test.ts does:
 * reports have no customer-facing write API, so that is the only way one comes into existence.
 */

async function seedProjectWithoutReport() {
  const keys = await createGrowthProject();
  if (keys === "no-project") throw new Error("The release-gate test requires a fresh project.");

  const onboarding = await niceBackendFetch(`${GROWTH_BASE}/onboarding`, {
    accessType: "admin",
    method: "POST",
    body: { website_url: "https://release-gate.example.com", company_summary: "Release gate fixture" },
  });
  if (onboarding.status !== 200) throw new Error(`Growth onboarding failed with ${onboarding.status}.`);
  return { projectId: keys.projectId, scope: { project_id: keys.projectId, branch_id: "main" }, runId: requireRunId(onboarding.body) };
}

async function seedReport(options: { presentation: "published" | "unpublished" | "none" } = { presentation: "published" }) {
  const { projectId, scope, runId } = await seedProjectWithoutReport();
  const report = await niceBackendFetch(`${AGENT_BASE}/report`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: {
      ...scope,
      run_id: runId,
      title: "Growth analysis for the fixture",
      summary: "Everything the customer may now see.",
      content_md: "# Live\n\nPublished on write.",
      action_items: [
        { type_id: "custom", category: "conversion", tags: [], title: "A suggestion", description: "Also live." },
        { type_id: "custom", category: "retention", tags: [], title: "A second suggestion", description: "Keep it live." },
      ],
    },
  });
  if (report.status !== 200) throw new Error(`Saving the report failed with ${report.status}.`);
  const reportId = (report.body as { report_id: string }).report_id;
  const actionItemIds = (report.body as { action_item_ids: string[] }).action_item_ids;
  if (options.presentation !== "none") {
    await createGrowthPresentationAsStaff(projectId, reportId, actionItemIds, options.presentation === "published");
  }
  return { projectId, scope, runId, reportId, actionItemIds };
}

async function createGrowthPresentationAsStaff(projectId: string, reportId: string, actionItemIds: string[], publish: boolean): Promise<string> {
  return await asGrowthStaff(async () => {
    const created = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}/presentations`, {
      accessType: "client",
      method: "POST",
      body: {
        target_project_id: projectId,
        format: "sandboxed-tsx-v1",
        tsx_source: "const Dashboard = () => null;",
        action_item_ids: actionItemIds,
      },
    });
    if (created.status !== 201) throw new Error(`Creating the growth presentation failed with ${created.status}.`);
    const presentationId = (created.body as { id: string }).id;
    if (publish) {
      const published = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}/presentations/${presentationId}`, {
        accessType: "client",
        method: "PATCH",
        body: { target_project_id: projectId, action: "publish" },
      });
      if (published.status !== 200) throw new Error(`Publishing the growth presentation failed with ${published.status}.`);
    }
    return presentationId;
  });
}

describe.sequential("internal Growth report release", { timeout: 300_000 }, () => {
  it("withholds the whole workspace from the customer until a report exists", { timeout: 300_000 }, async ({ expect }) => {
    await seedProjectWithoutReport();

    // Every surface that could reveal what an unwritten report would say. These analysis surfaces
    // are staff-only even when the customer has a released workspace.
    for (const path of [
      `${GROWTH_BASE}/overview`,
      `${GROWTH_BASE}/metrics-overview`,
      `${GROWTH_BASE}/actions`,
      `${GROWTH_BASE}/briefs`,
    ]) {
      const response = await niceBackendFetch(path, { accessType: "admin" });
      expect([path, response.status]).toEqual([path, 403]);
      expect([path, response.body]).toEqual([path, "This Growth resource is not available."]);
    }

    // The report itself 404s rather than 409s: to the customer a report that does not exist yet and
    // one that was pulled back are the same thing, and neither is a state they can act on.
    const missing = await niceBackendFetch(`${GROWTH_BASE}/reports/latest`, { accessType: "admin" });
    expect(missing.status).toBe(404);
  });

  it("keeps the status endpoint open, reporting the wait rather than a report", { timeout: 300_000 }, async ({ expect }) => {
    await seedProjectWithoutReport();
    // Status must stay reachable — it is what drives the lifecycle timeline, so locking it would
    // leave the customer with a blank page instead of an explanation. `not_ready` rather than
    // `preparing` because onboarding leaves every analysis phase pending (see lifecycle.test.ts);
    // the hold only begins once deep analysis actually starts.
    const status = await niceBackendFetch(`${GROWTH_BASE}/status`, { accessType: "admin" });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ latest_report: null, latest_brief: null, release: { state: "not_ready" } });
  });

  it("does not release a report merely because the agent wrote it", { timeout: 300_000 }, async ({ expect }) => {
    const { projectId, scope, runId } = await seedProjectWithoutReport();
    const report = await niceBackendFetch(`${AGENT_BASE}/report`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        title: "Held report",
        summary: "Awaiting presentation review.",
        content_md: "# Internal",
        action_items: [],
      },
    });
    expect(report.status).toBe(200);
    const reportId = (report.body as { report_id: string }).report_id;
    expect((await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}`, { accessType: "admin" })).status).toBe(404);

    await publishGrowthPresentationAsStaff(projectId, reportId, []);
    expect((await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}`, { accessType: "admin" })).status).toBe(200);
  });

  it("versions, publishes, and unpublishes presentations without drifting the report gate", { timeout: 300_000 }, async ({ expect }) => {
    const { projectId, reportId, actionItemIds } = await seedReport();
    const customerV1 = await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}`, { accessType: "admin" });
    expect(customerV1).toMatchObject({
      status: 200,
      body: { presentation: { version: 1, tsx_source: "const Dashboard = () => null;" } },
    });

    const versionTwo = await asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}/presentations`, {
      accessType: "client",
      method: "POST",
      body: {
        target_project_id: projectId,
        tsx_source: "const Dashboard = () => null;\n// version two",
        action_item_ids: [...actionItemIds].reverse(),
      },
    }));
    expect(versionTwo).toMatchObject({ status: 201, body: { version: 2, published_at_millis: null } });
    const versionTwoId = (versionTwo.body as { id: string }).id;

    const versions = await asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}/presentations?project_id=${projectId}`, { accessType: "client" }));
    expect(versions).toMatchObject({ status: 200, body: { presentations: [{ version: 2 }, { version: 1 }] } });

    const published = await asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}/presentations/${versionTwoId}`, {
      accessType: "client",
      method: "PATCH",
      body: { target_project_id: projectId, action: "publish" },
    }));
    expect(published).toMatchObject({ status: 200, body: { id: versionTwoId, version: 2, published_at_millis: expect.any(Number) } });
    const customerV2 = await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}`, { accessType: "admin" });
    expect(customerV2).toMatchObject({
      status: 200,
      body: {
        presentation: { version: 2, tsx_source: "const Dashboard = () => null;\n// version two" },
        action_items: [...actionItemIds].reverse().map((id) => expect.objectContaining({ id })),
      },
    });

    const unpublished = await asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}/presentations/${versionTwoId}`, {
      accessType: "client",
      method: "PATCH",
      body: { target_project_id: projectId, action: "unpublish" },
    }));
    expect(unpublished).toMatchObject({ status: 200, body: { id: versionTwoId, published_at_millis: null } });
    expect((await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}`, { accessType: "admin" })).status).toBe(404);
  });

  it("rejects invalid presentation source, format, and action-item selections", { timeout: 300_000 }, async ({ expect }) => {
    const { projectId, reportId, actionItemIds } = await seedReport();
    const create = (body: Record<string, unknown>) => asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}/presentations`, {
      accessType: "client",
      method: "POST",
      body: { target_project_id: projectId, ...body },
    }));
    expect((await create({ format: "unknown", tsx_source: "const Dashboard = () => null;", action_item_ids: [] })).status).toBe(400);
    // JSX/TSX compilation belongs to the sandbox; the backend only checks the source contract.
    expect((await create({ tsx_source: "const Dashboard = ;", action_item_ids: [] })).status).toBe(201);
    expect((await create({ tsx_source: "const Dashboard = () => null;", action_item_ids: [actionItemIds[0], actionItemIds[0]] })).status).toBe(400);
    expect((await create({ tsx_source: "const Dashboard = () => null;", action_item_ids: [randomUUID()] })).status).toBe(400);
  });

  it("pins curated action items while recomposing a published report", { timeout: 300_000 }, async ({ expect }) => {
    const { scope, runId, reportId, actionItemIds } = await seedReport();
    const recomposed = await niceBackendFetch(`${AGENT_BASE}/report`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        title: "Recomposed growth analysis",
        summary: "The internal artifact was refreshed.",
        content_md: "# Refreshed",
        action_items: [],
      },
    });
    expect(recomposed.status).toBe(200);

    const customer = await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}`, { accessType: "admin" });
    expect(customer).toMatchObject({ status: 200, body: { presentation: { version: 1 }, action_items: [{ id: expect.any(String) }, { id: expect.any(String) }] } });
    expect(customer.body.action_items.map((item: { id: string }) => item.id)).toEqual(actionItemIds);
    expect(customer.body).not.toHaveProperty("title");
    expect(customer.body).not.toHaveProperty("summary");
    expect(customer.body).not.toHaveProperty("content_md");
  });

  it("pins curated action items for an unpublished presentation", { timeout: 300_000 }, async ({ expect }) => {
    const { scope, runId, reportId, actionItemIds } = await seedReport({ presentation: "unpublished" });
    const recomposed = await niceBackendFetch(`${AGENT_BASE}/report`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        title: "Recomposed growth analysis",
        summary: "The internal artifact was refreshed.",
        content_md: "# Refreshed",
        action_items: [],
      },
    });
    expect(recomposed.status).toBe(200);
    expect(recomposed.body).toMatchObject({ action_item_ids: actionItemIds });
  });

  it("still replaces proposals when no presentation exists", { timeout: 300_000 }, async ({ expect }) => {
    const { scope, runId, reportId } = await seedReport({ presentation: "none" });
    const recomposed = await niceBackendFetch(`${AGENT_BASE}/report`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        title: "Recomposed growth analysis",
        summary: "The internal artifact was refreshed.",
        content_md: "# Refreshed",
        action_items: [],
      },
    });
    expect(recomposed.status).toBe(200);
    expect(recomposed.body).toMatchObject({ report_id: reportId, action_item_ids: [] });
  });

  it("releases everything after staff publishes a presentation", { timeout: 300_000 }, async ({ expect }) => {
    const { reportId } = await seedReport();

    const status = await niceBackendFetch(`${GROWTH_BASE}/status`, { accessType: "admin" });
    expect(status.body).toMatchObject({ release: { state: "released" }, latest_report: { id: reportId, read_at_millis: null } });

    for (const path of [`${GROWTH_BASE}/overview`, `${GROWTH_BASE}/metrics-overview`, `${GROWTH_BASE}/actions`, `${GROWTH_BASE}/briefs`]) {
      const response = await niceBackendFetch(path, { accessType: "admin" });
      expect([path, response.status]).toEqual([path, 403]);
      expect([path, response.body]).toEqual([path, "This Growth resource is not available."]);
    }

    const report = await niceBackendFetch(`${GROWTH_BASE}/reports/latest`, { accessType: "admin" });
    expect(report).toMatchObject({ status: 200, body: { id: reportId, presentation: { version: 1 } } });
    expect(report.body).not.toHaveProperty("title");
    expect(report.body).not.toHaveProperty("summary");
  });

  it("allows customer activation only for actions curated into the live presentation", { timeout: 300_000 }, async ({ expect }) => {
    const { projectId, reportId, actionItemIds } = await seedReport();
    await publishGrowthPresentationAsStaff(projectId, reportId, [actionItemIds[0]]);

    const uncurated = await niceBackendFetch(`${GROWTH_BASE}/actions/${actionItemIds[1]}/activate`, {
      accessType: "admin",
      method: "POST",
    });
    expect(uncurated.status).toBe(403);
    expect(uncurated.body).toBe("This action is not available.");

    const curated = await niceBackendFetch(`${GROWTH_BASE}/actions/${actionItemIds[0]}/activate`, {
      accessType: "admin",
      method: "POST",
    });
    expect(curated).toMatchObject({ status: 200, body: { status: "active" } });
  });

  it("marks a report read once and exposes the receipt on status", { timeout: 300_000 }, async ({ expect }) => {
    const { reportId } = await seedReport();

    // A malformed id is a clean 404 from the receipt endpoint too, never a Postgres cast error.
    const malformed = await niceBackendFetch(`${GROWTH_BASE}/reports/not-a-uuid/read`, { accessType: "admin", method: "POST" });
    expect(malformed.status).toBe(404);

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

  it("takes a report back out of the customer's hands when staff unpublish", async ({ expect }) => {
    const { projectId, reportId } = await seedReport();

    const unpublished = await asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}`, {
      accessType: "client",
      method: "PATCH",
      body: { target_project_id: projectId, action: "unpublish" },
    }));
    expect(unpublished.status).toBe(200);
    expect(unpublished.body).toMatchObject({ reports: [{ id: reportId, published_at_millis: null }] });

    // The whole point of keeping the publishedAt filter: an unpublished report really is gone for
    // the customer, not merely missing from one response.
    const gone = await niceBackendFetch(`${GROWTH_BASE}/reports/${reportId}`, { accessType: "admin" });
    expect(gone.status).toBe(404);
    const adminDetail = await asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}?project_id=${projectId}`, { accessType: "client" }));
    expect(adminDetail).toMatchObject({ status: 200, body: { presentations: [{ version: 1, published_at_millis: null }] } });
    const overview = await niceBackendFetch(`${GROWTH_BASE}/overview`, { accessType: "admin" });
    expect(overview).toMatchObject({ status: 403, body: "This Growth resource is not available." });

    // Unpublishing what is not published is a stale second tab — 409, not 500.
    const again = await asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}`, {
      accessType: "client",
      method: "PATCH",
      body: { target_project_id: projectId, action: "unpublish" },
    }));
    expect(again.status).toBe(409);
  });

  it("has no publish action left to call", { timeout: 300_000 }, async ({ expect }) => {
    const { projectId, reportId } = await seedReport();
    // Guards the decision rather than the code: re-adding "publish" would mean re-adding a review
    // queue for reports, which is exactly what this build moved onto the interview instead. Rejected
    // by the route schema, so it is a 400 rather than a 404 or a silent no-op.
    const published = await asGrowthStaff(async () => await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}`, {
      accessType: "client",
      method: "PATCH",
      body: { target_project_id: projectId, action: "publish" },
    }));
    expect(published.status).toBe(400);
  });

  it("shows staff every report, and refuses non-platform-admins entirely", { timeout: 300_000 }, async ({ expect }) => {
    const { projectId, reportId } = await seedReport();

    // A signed-in internal-project user who is NOT on the owner team: the internal publishable key is
    // public, so "signed into internal" must never be enough to read another company's report.
    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
    await Auth.fastSignUp();
    for (const [path, init] of [
      [`${ADMIN_BASE}/reports?project_id=${projectId}`, {}],
      [`${ADMIN_BASE}/reports/${reportId}?project_id=${projectId}`, {}],
      [`${ADMIN_BASE}/reports/${reportId}/presentations?project_id=${projectId}`, {}],
      [`${ADMIN_BASE}/reports/${reportId}/presentations`, { method: "POST", body: { target_project_id: projectId, tsx_source: "const Dashboard = () => null;", action_item_ids: [] } }],
      [`${ADMIN_BASE}/reports/${reportId}`, { method: "PATCH", body: { target_project_id: projectId, action: "unpublish" } }],
      [`${ADMIN_BASE}/reports/${reportId}/presentations/not-a-uuid`, { method: "PATCH", body: { target_project_id: projectId, action: "publish" } }],
    ] as const) {
      const response = await niceBackendFetch(path, { accessType: "client", ...init });
      expect([path, response.status]).toEqual([path, 403]);
    }

    await asGrowthStaff(async () => {
      const list = await niceBackendFetch(`${ADMIN_BASE}/reports?project_id=${projectId}`, { accessType: "client" });
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({
        reports: [{ id: reportId, trigger: "initial", action_item_count: 2, published_by_user_id: expect.any(String) }],
      });
      expect((list.body as { reports: { published_at_millis: number | null }[] }).reports[0].published_at_millis).toEqual(expect.any(Number));

      const detail = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}?project_id=${projectId}`, { accessType: "client" });
      expect(detail).toMatchObject({
        status: 200,
        body: {
          id: reportId,
          title: "Growth analysis for the fixture",
          content_md: "# Live\n\nPublished on write.",
          action_items: expect.arrayContaining([expect.objectContaining({ title: "A suggestion" })]),
        },
      });

      // A malformed or foreign report id is a clean 404, never a Postgres cast error.
      const missing = await niceBackendFetch(`${ADMIN_BASE}/reports/not-a-uuid?project_id=${projectId}`, { accessType: "client" });
      expect(missing.status).toBe(404);
    });
  });
});
