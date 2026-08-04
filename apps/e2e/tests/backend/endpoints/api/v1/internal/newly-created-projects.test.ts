import { describe } from "vitest";
import { it } from "../../../../../helpers";
import {
  Auth,
  INTERNAL_PROJECT_OWNER_TEAM_ID,
  InternalProjectKeys,
  Project,
  Team,
  backendContext,
  niceBackendFetch,
} from "../../../../backend-helpers";

const BASE_PATH = "/api/latest/internal/newly-created-projects";

async function signInAsInternalAdmin() {
  backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
  const { userId } = await Auth.fastSignUp();
  await Team.addMember(INTERNAL_PROJECT_OWNER_TEAM_ID, userId);
  return backendContext.value.userAuth;
}

describe("internal newly-created projects", () => {
  it("rejects unauthenticated, customer-project, and non-platform-admin requests", async ({ expect }) => {
    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
    const unauthenticated = await niceBackendFetch(BASE_PATH, { accessType: "client" });
    expect(unauthenticated.status).toBe(401);

    await Project.createAndSwitch();
    await Auth.fastSignUp();
    const customerProject = await niceBackendFetch(BASE_PATH, { accessType: "client" });
    expect([400, 401]).toContain(customerProject.status);

    const customerUserAuth = backendContext.value.userAuth;
    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: customerUserAuth });
    const nonPlatformAdmin = await niceBackendFetch(BASE_PATH, { accessType: "client" });
    expect([401, 403]).toContain(nonPlatformAdmin.status);
  });

  it("uses the fully rendered config for app and domain information", async ({ expect }) => {
    const internalUserAuth = await signInAsInternalAdmin();
    const { projectId } = await Project.createAndSwitch({
      display_name: "Rendered Config Project",
    }, true);
    await Project.updateConfig({
      "domains.trustedDomains.rendered-config": {
        baseUrl: "https://rendered-config.example.com",
        handlerPath: "/handler",
      },
    });
    await Project.pushConfig({
      apps: {
        installed: {
          teams: { enabled: true },
          rbac: { enabled: true },
        },
      },
    });
    const draft = await niceBackendFetch("/api/latest/internal/email-drafts", {
      accessType: "admin",
      method: "POST",
      body: {
        display_name: "Newly-created projects test draft",
        theme_id: false,
      },
    });
    expect(draft.status).toBe(200);

    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: internalUserAuth });
    const list = await niceBackendFetch(
      `${BASE_PATH}?rde=both&onboarding=both&min_users=0`,
      { accessType: "client" },
    );
    expect(list.status).toBe(200);
    expect(list.body.filters).toMatchObject({
      candidate_window_size: expect.any(Number),
      candidate_window_saturated: expect.any(Boolean),
    });
    const row = list.body.projects.find((project: { id: string }) => project.id === projectId);
    expect(row).toMatchObject({
      id: projectId,
      display_name: "Rendered Config Project",
      domains: ["https://rendered-config.example.com"],
      featured_apps: {
        emails: "used",
      },
    });
    expect(row.other_enabled_apps).toEqual(expect.arrayContaining(["teams", "rbac"]));

    const detail = await niceBackendFetch(`${BASE_PATH}/${projectId}`, { accessType: "client" });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: projectId,
    });
  });
});
