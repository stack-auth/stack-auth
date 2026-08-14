import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject, requireRunId, unlockGrowthWorkspaceAsStaff } from "./growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth";
const AGENT_BASE = "/api/latest/internal/growth-agent";

const BRIEF_DOCUMENT = {
  format: "growth-mdx-v1",
  source_mdx: "## Yesterday\n\n<Metric data=\"signups\" />",
  data: [{
    id: "signups",
    kind: "metric",
    title: "New signups",
    unit: "count",
    source: "Growth daily metrics · yesterday",
    takeaway: "Signups increased versus the trailing daily average.",
    value: 18,
    comparison_label: "trailing average",
    comparison_value: 16,
  }],
};

// The admin briefs surface has no write API of its own — briefs come into existence through the
// daily-brief workflow's rollup plus the machine-facing growth-agent upsert. So these tests seed by
// "playing the agent" (like report-actions.test.ts, and deliberately WITHOUT mock-eve: no workflow
// runs here) and then exercise the admin read/ack routes on top. The workflow-driven pipeline
// (rollup -> Eve dispatch -> deliveries) is e2e-covered in growth-workflows.test.ts; the delivery
// registry itself is unit-covered in apps/backend/src/lib/growth/delivery/delivery.test.ts.

async function createGrowthProjectWithIds() {
  const projectKeys = await createGrowthProject();
  if (projectKeys === "no-project") {
    throw new Error("createGrowthProject should have switched the context to a fresh project.");
  }
  // Tests always run against the default branch.
  return { projectId: projectKeys.projectId, branchId: "main" };
}

async function completeOnboarding() {
  const onboarding = await niceBackendFetch(`${ADMIN_BASE}/onboarding`, {
    accessType: "admin",
    method: "POST",
    body: { website_url: "https://plannery.example.com", company_summary: "Project management for small teams." },
  });
  if (onboarding.status !== 200) {
    throw new Error(`Growth onboarding failed with status ${onboarding.status}.`);
  }
  return requireRunId(onboarding.body);
}

/** Plays the agent: upserts one "ready" brief for the given UTC day and returns its id. */
async function seedBrief(scope: { project_id: string, branch_id: string }, date: string) {
  const response = await niceBackendFetch(`${AGENT_BASE}/briefs`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: {
      ...scope,
      date,
      summary: `What changed on ${date}.`,
      content_md: `# Daily brief for ${date}\n\nDetails...`,
      document: BRIEF_DOCUMENT,
    },
  });
  if (response.status !== 200) {
    throw new Error(`Seeding the brief for ${date} failed with status ${response.status}.`);
  }
  return (response.body as { brief_id: string }).brief_id;
}

describe("internal growth briefs", () => {
  it("lists briefs newest-day-first with cursor pagination", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    await completeOnboarding();
    await unlockGrowthWorkspaceAsStaff(scope);
    // Seeded oldest-day-first on purpose: the list must order by the brief's `date`, not by
    // creation order.
    const briefIdByDate = new Map<string, string>();
    for (const date of ["2026-07-01", "2026-07-02", "2026-07-03"]) {
      briefIdByDate.set(date, await seedBrief(scope, date));
    }

    const list = await niceBackendFetch(`${ADMIN_BASE}/briefs`, { accessType: "admin" });
    expect(list.status).toBe(200);
    const listBody = list.body as { items: { id: string, date: string, status: string, summary: string, content_md: string, document: unknown, read_at_millis: number | null, created_at_millis: number }[], next_cursor: string | null };
    expect(listBody.next_cursor).toBeNull();
    expect(listBody.items.map((item) => item.date)).toEqual(["2026-07-03", "2026-07-02", "2026-07-01"]);
    for (const item of listBody.items) {
      expect(item).toMatchObject({
        id: briefIdByDate.get(item.date),
        status: "ready",
        summary: `What changed on ${item.date}.`,
        content_md: `# Daily brief for ${item.date}\n\nDetails...`,
        document: expect.objectContaining({ format: "growth-mdx-v1", sourceMdx: BRIEF_DOCUMENT.source_mdx }),
        read_at_millis: null,
      });
      expect(typeof item.created_at_millis).toBe("number");
    }

    // Two pages of 2: the cursor from page one yields the remaining brief, with no overlap.
    const pageOne = await niceBackendFetch(`${ADMIN_BASE}/briefs?limit=2`, { accessType: "admin" });
    expect(pageOne.status).toBe(200);
    const pageOneBody = pageOne.body as { items: { date: string }[], next_cursor: string | null };
    expect(pageOneBody.items.map((item) => item.date)).toEqual(["2026-07-03", "2026-07-02"]);
    expect(typeof pageOneBody.next_cursor).toBe("string");
    const pageTwo = await niceBackendFetch(`${ADMIN_BASE}/briefs?limit=2&cursor=${pageOneBody.next_cursor}`, { accessType: "admin" });
    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body).toMatchObject({ next_cursor: null });
    expect((pageTwo.body as { items: { date: string }[] }).items.map((item) => item.date)).toEqual(["2026-07-01"]);

    // A cursor that is no brief of this project is a clean 400 (both garbage and unknown UUIDs).
    const unknownCursor = await niceBackendFetch(`${ADMIN_BASE}/briefs?cursor=${randomUUID()}`, { accessType: "admin" });
    expect(unknownCursor.status).toBe(400);
    const garbageCursor = await niceBackendFetch(`${ADMIN_BASE}/briefs?cursor=not-a-uuid`, { accessType: "admin" });
    expect(garbageCursor.status).toBe(400);
  });

  it("serves a single brief and 404s across projects and for garbage ids", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    await completeOnboarding();
    await unlockGrowthWorkspaceAsStaff(scope);
    const briefId = await seedBrief(scope, "2026-07-01");

    const byId = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}`, { accessType: "admin" });
    expect(byId.status).toBe(200);
    expect(byId.body).toMatchObject({
      id: briefId,
      date: "2026-07-01",
      status: "ready",
      summary: "What changed on 2026-07-01.",
      content_md: "# Daily brief for 2026-07-01\n\nDetails...",
      document: expect.objectContaining({ format: "growth-mdx-v1", sourceMdx: BRIEF_DOCUMENT.source_mdx }),
      read_at_millis: null,
    });

    // Garbage ids must be a clean 404, not a database cast error.
    const garbageId = await niceBackendFetch(`${ADMIN_BASE}/briefs/not-a-real-id`, { accessType: "admin" });
    expect(garbageId.status).toBe(404);
    const unknownId = await niceBackendFetch(`${ADMIN_BASE}/briefs/${randomUUID()}`, { accessType: "admin" });
    expect(unknownId.status).toBe(404);

    // Another project (with the app enabled) must not see this brief — same 404, no id probing.
    // Released as well, so what this asserts is still tenant isolation and not the release gate
    // answering first.
    const otherProject = await createGrowthProjectWithIds();
    await unlockGrowthWorkspaceAsStaff({ project_id: otherProject.projectId, branch_id: otherProject.branchId });
    const crossProject = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}`, { accessType: "admin" });
    expect(crossProject.status).toBe(404);
    const crossProjectRead = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}/read`, { accessType: "admin", method: "POST" });
    expect(crossProjectRead.status).toBe(404);
  });

  it("marks briefs read idempotently, keeping the first read timestamp", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    await completeOnboarding();
    await unlockGrowthWorkspaceAsStaff(scope);
    const briefId = await seedBrief(scope, "2026-07-01");

    const read = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}/read`, { accessType: "admin", method: "POST" });
    expect(read).toMatchObject({ status: 200, body: { status: "ready" } });
    const afterFirstRead = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}`, { accessType: "admin" });
    expect(afterFirstRead.status).toBe(200);
    const firstReadAtMillis = (afterFirstRead.body as { read_at_millis: number | null }).read_at_millis;
    expect(typeof firstReadAtMillis).toBe("number");

    const readAgain = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}/read`, { accessType: "admin", method: "POST" });
    expect(readAgain).toMatchObject({ status: 200, body: { status: "ready" } });
    const afterSecondRead = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}`, { accessType: "admin" });
    expect(afterSecondRead.status).toBe(200);
    expect((afterSecondRead.body as { read_at_millis: number | null }).read_at_millis).toBe(firstReadAtMillis);

    const unknown = await niceBackendFetch(`${ADMIN_BASE}/briefs/${randomUUID()}/read`, { accessType: "admin", method: "POST" });
    expect(unknown.status).toBe(404);
  });

  it("rejects non-admin access and projects without the growth app", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    await completeOnboarding();
    await unlockGrowthWorkspaceAsStaff(scope);
    const briefId = await seedBrief(scope, "2026-07-01");

    const clientList = await niceBackendFetch(`${ADMIN_BASE}/briefs`, { accessType: "client" });
    expect(clientList.status).toBe(401);
    const clientGet = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}`, { accessType: "client" });
    expect(clientGet.status).toBe(401);
    const clientRead = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}/read`, { accessType: "client", method: "POST" });
    expect(clientRead.status).toBe(401);

    // Disabling the app cuts off the whole surface, even for admins and existing data.
    await Project.updateConfig({ "apps.installed.gtm.enabled": false });
    const disabledList = await niceBackendFetch(`${ADMIN_BASE}/briefs`, { accessType: "admin" });
    expect(disabledList.status).toBe(400);
    const disabledGet = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}`, { accessType: "admin" });
    expect(disabledGet.status).toBe(400);
    const disabledRead = await niceBackendFetch(`${ADMIN_BASE}/briefs/${briefId}/read`, { accessType: "admin", method: "POST" });
    expect(disabledRead.status).toBe(400);
  });
});
