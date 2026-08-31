import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, asGrowthStaff, createGrowthProject, unlockGrowthWorkspaceAsStaff } from "./growth-helpers";

const ADMIN_OVERVIEW_PATH = "/api/latest/internal/growth/admin/overview";
const CUSTOMER_OVERVIEW_PATH = "/api/latest/internal/growth/overview";
const AGENT_BASE = "/api/latest/internal/growth-agent";
const FINDING_DOCUMENT = { format: "growth-mdx-v1", source_mdx: "## Evidence\n\nThe first-session drop is concentrated before project two.", data: [] };
const INTERNAL_RESOURCE_DENIAL = "This Growth resource is not available.";

// Growth fixtures seed sandbox-backed workflows during onboarding and can land around 60s under
// full-suite load, so default-timeout tests need 90s of headroom.

async function createGrowthProjectScope() {
  const keys = await createGrowthProject();
  if (keys === "no-project") throw new Error("Growth overview test requires a fresh project.");
  return { project_id: keys.projectId, branch_id: "main" };
}

async function getAdminOverview(projectId: string) {
  return await asGrowthStaff(async () => await niceBackendFetch(
    `${ADMIN_OVERVIEW_PATH}?project_id=${encodeURIComponent(projectId)}`,
    { accessType: "client" },
  ));
}

describe("internal Growth overview", { timeout: 90_000 }, () => {
  it("denies customer access while retaining the staff-targeted overview", async ({ expect }) => {
    const scope = await createGrowthProjectScope();
    const customer = await niceBackendFetch(CUSTOMER_OVERVIEW_PATH, { accessType: "admin" });
    expect(customer.status).toBe(403);
    expect(customer.body).toBe(INTERNAL_RESOURCE_DENIAL);

    const held = await getAdminOverview(scope.project_id);
    expect(held.status).toBe(404);
    expect(held.body).toBe("Growth project not found.");
  });

  it("returns an honest bounded empty state", async ({ expect }) => {
    const scope = await createGrowthProjectScope();
    const reportId = await unlockGrowthWorkspaceAsStaff(scope);
    const response = await getAdminOverview(scope.project_id);
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
      limit: 50,
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
        source: "website-research",
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

    const customerBounded = await niceBackendFetch(`${CUSTOMER_OVERVIEW_PATH}?limit=1`, { accessType: "admin" });
    expect(customerBounded.status).toBe(403);
    expect(customerBounded.body).toBe(INTERNAL_RESOURCE_DENIAL);

    const overview = await getAdminOverview(scope.project_id);
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({ limit: 50 });
    expect((overview.body as { findings: unknown[] }).findings).toHaveLength(3);
    expect((overview.body as { actions: unknown[] }).actions).toHaveLength(1);
    const categories = (overview.body as { categories: { category: string, count: number }[] }).categories;
    expect(categories.find((category) => category.category === "conversion")?.count).toBe(3);
    expect(categories.find((category) => category.category === "revenue")?.count).toBe(1);

    const normalizedFinding = (overview.body as { findings: { title: string, tags: string[], document: unknown }[] }).findings.find((finding) => finding.title === "First activation signal");
    expect(normalizedFinding?.tags).toEqual(["onboarding"]);
    expect(normalizedFinding?.document).toMatchObject({ format: "growth-mdx-v1", sourceMdx: FINDING_DOCUMENT.source_mdx });
    expect((overview.body as { actions: { document: unknown }[] }).actions[0]?.document).toMatchObject({ format: "growth-mdx-v1", sourceMdx: FINDING_DOCUMENT.source_mdx });
    // Released too, so this still asserts tenant isolation rather than the gate answering first.
    const otherScope = await createGrowthProjectScope();
    await unlockGrowthWorkspaceAsStaff(otherScope);
    const otherProject = await getAdminOverview(otherScope.project_id);
    expect(otherProject.status).toBe(200);
    expect(otherProject.body).toMatchObject({ findings: [], actions: [], needs_category_count: 0 });
  });
});
