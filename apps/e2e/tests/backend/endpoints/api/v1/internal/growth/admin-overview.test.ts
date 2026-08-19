import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, INTERNAL_PROJECT_OWNER_TEAM_ID, InternalProjectKeys, Team, backendContext, niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject } from "./growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth/admin";
const GROWTH_BASE = "/api/latest/internal/growth";
const AGENT_BASE = "/api/latest/internal/growth-agent";

// Growth fixtures seed sandbox-backed workflows during onboarding and can land around 60s under
// full-suite load, so default-timeout tests need 90s of headroom.

async function signInAsInternalAdmin(): Promise<void> {
  backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
  const { userId } = await Auth.fastSignUp();
  await Team.addMember(INTERNAL_PROJECT_OWNER_TEAM_ID, userId);
}

async function createOnboardedProjectWithAction() {
  const keys = await createGrowthProject();
  if (keys === "no-project") throw new Error("Growth admin test requires a fresh project.");
  const onboarding = await niceBackendFetch(`${GROWTH_BASE}/onboarding`, {
    accessType: "admin",
    method: "POST",
    body: { website_url: "https://admin-overview.example.com", company_summary: "Growth admin fixture" },
  });
  if (onboarding.status !== 200) throw new Error(`Growth onboarding failed with ${onboarding.status}.`);
  const scope = { project_id: keys.projectId, branch_id: "main" };
  const action = await niceBackendFetch(`${AGENT_BASE}/action-items`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: { ...scope, type_id: "custom", category: "conversion", tags: ["initial"], title: "Original proposal", description: "Original description" },
  });
  if (action.status !== 200) throw new Error(`Growth action creation failed with ${action.status}.`);
  return { projectId: keys.projectId, actionId: (action.body as { action_item_id: string }).action_item_id };
}

type ActionUpdateOverrides = Partial<{
  type_id: string,
  category: string,
  tags: string[],
  title: string,
  description: string,
  status: string,
  payload: unknown,
  watched_metrics: { metric_id: string, window_days: number }[],
}>;

function actionUpdateBody(projectId: string, overrides: ActionUpdateOverrides = {}) {
  return {
    target_project_id: projectId,
    type_id: "custom",
    category: "conversion",
    tags: ["admin-edited"],
    title: "Edited proposal",
    description: "Edited description",
    status: "proposed",
    ...overrides,
  };
}

describe("internal Growth admin", { timeout: 90_000 }, () => {
  it("requires an internal platform admin", async ({ expect }) => {
    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
    expect((await niceBackendFetch(`${ADMIN_BASE}/projects`, { accessType: "client" })).status).toBe(401);

    await createGrowthProject();
    await Auth.fastSignUp();
    const customerRequest = await niceBackendFetch(`${ADMIN_BASE}/projects`, { accessType: "client" });
    expect(customerRequest.status).toBe(401);
    expect(customerRequest.body).toMatchObject({ code: "EXPECTED_INTERNAL_PROJECT" });
  });

  it("requires the selected project for manual scheduler actions", async ({ expect }) => {
    await signInAsInternalAdmin();
    const response = await niceBackendFetch(`${ADMIN_BASE}/run-now`, {
      accessType: "client",
      method: "POST",
      body: { step: "analysis_tick" },
    });
    expect(response.status).toBe(400);
  });

  it("edits customer-visible Growth data without bypassing action lifecycle rules", async ({ expect }) => {
    const { projectId, actionId } = await createOnboardedProjectWithAction();
    await signInAsInternalAdmin();

    const projects = await niceBackendFetch(`${ADMIN_BASE}/projects`, { accessType: "client" });
    expect(projects.status).toBe(200);
    expect(projects.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: projectId })]));

    const note = await niceBackendFetch(`${ADMIN_BASE}/findings`, {
      accessType: "client",
      method: "POST",
      body: { target_project_id: projectId, kind: "ignored-for-notes", note: true, category: "revenue", tags: ["Pricing", " pricing "], title: "Pricing note", body: "Keep the annual plan visible." },
    });
    expect(note.status).toBe(201);
    const score = await niceBackendFetch(`${ADMIN_BASE}/category-scores`, {
      accessType: "client",
      method: "PUT",
      body: { target_project_id: projectId, category: "revenue", score: 73 },
    });
    expect(score).toMatchObject({ status: 200, body: { category: "revenue", score: 73 } });

    const edited = await niceBackendFetch(`${ADMIN_BASE}/actions/${actionId}`, {
      accessType: "client",
      method: "PATCH",
      body: actionUpdateBody(projectId, {
        payload: { experiment: "onboarding" },
        watched_metrics: [{ metric_id: "new_signups", window_days: 21 }],
      }),
    });
    expect(edited).toMatchObject({
      status: 200,
      body: {
        id: actionId,
        title: "Edited proposal",
        tags: ["admin-edited"],
        payload: { experiment: "onboarding" },
        watched_metrics: [{ metric_id: "new_signups", window_days: 21 }],
      },
    });

    const invalidCompleted = await niceBackendFetch(`${ADMIN_BASE}/actions/${actionId}`, {
      accessType: "client",
      method: "PATCH",
      body: actionUpdateBody(projectId, { title: "Must not persist", status: "completed" }),
    });
    expect(invalidCompleted.status).toBe(400);

    const overview = await niceBackendFetch(`${ADMIN_BASE}/overview?project_id=${projectId}`, { accessType: "client" });
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({
      notes: [expect.objectContaining({ source: "admin", kind: "note", category: "revenue", tags: ["pricing"], title: "Pricing note" })],
      actions: [expect.objectContaining({ id: actionId, title: "Edited proposal" })],
    });
    const revenue = (overview.body as { categories: { category: string, score: number | null }[] }).categories.find((category) => category.category === "revenue");
    expect(revenue?.score).toBe(73);

    const activated = await niceBackendFetch(`${ADMIN_BASE}/actions/${actionId}`, {
      accessType: "client",
      method: "PATCH",
      body: actionUpdateBody(projectId, { status: "active" }),
    });
    expect(activated).toMatchObject({ status: 200, body: { status: "active" } });

    const invalidFunctionalEdit = await niceBackendFetch(`${ADMIN_BASE}/actions/${actionId}`, {
      accessType: "client",
      method: "PATCH",
      body: actionUpdateBody(projectId, { status: "active", payload: { experiment: "changed-after-activation" } }),
    });
    expect(invalidFunctionalEdit.status).toBe(400);
  });
});
