import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject, unlockGrowthWorkspaceAsStaff } from "./growth-helpers";

const OVERVIEW_PATH = "/api/latest/internal/growth/overview";
const AGENT_BASE = "/api/latest/internal/growth-agent";
const FINDING_DOCUMENT = { format: "growth-mdx-v1", source_mdx: "## Evidence\n\nThe first-session drop is concentrated before project two.", data: [] };

async function createGrowthProjectScope() {
  const keys = await createGrowthProject();
  if (keys === "no-project") throw new Error("Growth overview test requires a fresh project.");
  return { project_id: keys.projectId, branch_id: "main" };
}

describe("internal Growth overview", () => {
  it("stays closed until the customer's first report is released", async ({ expect }) => {
    // The overview carries the insights, the journey stages and the category scores — everything the
    // hold is meant to withhold — so it answers nothing at all until a report is published.
    await createGrowthProjectScope();
    const held = await niceBackendFetch(OVERVIEW_PATH, { accessType: "admin" });
    expect(held.status).toBe(409);
    expect(held.body).toBe("Your growth report is still being prepared.");
  });

  it("returns an honest bounded empty state", async ({ expect }) => {
    const scope = await createGrowthProjectScope();
    const reportId = await unlockGrowthWorkspaceAsStaff(scope);
    const response = await niceBackendFetch(OVERVIEW_PATH, { accessType: "admin" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      // The released report itself, which is what opened the workspace in the first place.
      latest_report: { id: reportId },
      latest_brief: null,
      findings: [],
      notes: [],
      actions: [],
      archive: [],
      needs_category_count: 0,
      limit: 24,
    });
    const categories = (response.body as { categories: { category: string, count: number, score: number | null }[] }).categories;
    expect(categories).toEqual([
      "product", "reach", "conversion", "retention", "revenue",
    ].map((category) => ({ category, count: 0, score: null })));
  });

  it("bounds display rows, preserves full category counts, and isolates tenants", async ({ expect }) => {
    const scope = await createGrowthProjectScope();
    await unlockGrowthWorkspaceAsStaff(scope);
    const findings = await niceBackendFetch(`${AGENT_BASE}/findings`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        source: "report",
        findings: [
          { kind: "signal", category: "conversion", tags: ["Onboarding", " onboarding "], title: "First activation signal", body: "One", document: FINDING_DOCUMENT },
          { kind: "signal", category: "conversion", tags: [], title: "Second activation signal", body: "Two" },
          { kind: "signal", category: "revenue", tags: ["pricing"], title: "Revenue signal", body: "Three" },
        ],
      },
    });
    expect(findings.status).toBe(200);
    const action = await niceBackendFetch(`${AGENT_BASE}/action-items`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, type_id: "custom", category: "conversion", tags: ["experiment"], title: "Activation action", description: "Try the fix.", document: FINDING_DOCUMENT },
    });
    expect(action.status).toBe(200);

    const bounded = await niceBackendFetch(`${OVERVIEW_PATH}?limit=1`, { accessType: "admin" });
    expect(bounded.status).toBe(200);
    expect(bounded.body).toMatchObject({ limit: 1 });
    expect((bounded.body as { findings: unknown[] }).findings).toHaveLength(1);
    expect((bounded.body as { actions: unknown[] }).actions).toHaveLength(1);
    const categories = (bounded.body as { categories: { category: string, count: number }[] }).categories;
    expect(categories.find((category) => category.category === "conversion")?.count).toBe(3);
    expect(categories.find((category) => category.category === "revenue")?.count).toBe(1);

    const clamped = await niceBackendFetch(`${OVERVIEW_PATH}?limit=500`, { accessType: "admin" });
    expect(clamped).toMatchObject({ status: 200, body: { limit: 50 } });
    const normalizedFinding = (clamped.body as { findings: { title: string, tags: string[], document: unknown }[] }).findings.find((finding) => finding.title === "First activation signal");
    expect(normalizedFinding?.tags).toEqual(["onboarding"]);
    expect(normalizedFinding?.document).toMatchObject({ format: "growth-mdx-v1", sourceMdx: FINDING_DOCUMENT.source_mdx });
    expect((clamped.body as { actions: { document: unknown }[] }).actions[0]?.document).toMatchObject({ format: "growth-mdx-v1", sourceMdx: FINDING_DOCUMENT.source_mdx });
    const invalid = await niceBackendFetch(`${OVERVIEW_PATH}?limit=0`, { accessType: "admin" });
    expect(invalid.status).toBe(400);

    // Released too, so this still asserts tenant isolation rather than the gate answering first.
    await unlockGrowthWorkspaceAsStaff(await createGrowthProjectScope());
    const otherProject = await niceBackendFetch(OVERVIEW_PATH, { accessType: "admin" });
    expect(otherProject.status).toBe(200);
    expect(otherProject.body).toMatchObject({ findings: [], actions: [], needs_category_count: 0 });
  });
});
