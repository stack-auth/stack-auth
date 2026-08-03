import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

const CRON_AUTH = { "Authorization": "Bearer mock_cron_secret" };

async function createBrainProject() {
  await Project.createAndSwitch();
  await Project.updateConfig({ "apps.installed.brain.enabled": true });
  return backendContext.value.projectKeys;
}

describe("Brain API", () => {
  it("rejects client/server access and requires the app to be installed", async ({ expect }) => {
    await Project.createAndSwitch();

    const disabled = await niceBackendFetch("/api/v1/internal/brain", {
      method: "GET",
      accessType: "admin",
    });
    expect(disabled.status).toBe(403);

    await Project.updateConfig({ "apps.installed.brain.enabled": true });

    const client = await niceBackendFetch("/api/v1/internal/brain", {
      method: "GET",
      accessType: "client",
    });
    expect(client.status).toBe(401);

    const ok = await niceBackendFetch("/api/v1/internal/brain", {
      method: "GET",
      accessType: "admin",
    });
    expect(ok).toMatchObject({
      status: 200,
      body: {
        enabled: true,
        pending_queue_count: 0,
        messages: [],
      },
    });
  });

  it("enqueues signup and signin events and exposes them on the queue", async ({ expect }) => {
    await createBrainProject();

    const { password } = await Auth.Password.signUpWithEmail({ password: "brain-test-password" });

    const queueAfterSignup = await niceBackendFetch("/api/v1/internal/brain/queue", {
      method: "GET",
      accessType: "admin",
      query: { status: "QUEUED,CLAIMED,FAILED,COMPLETED" },
    });
    expect(queueAfterSignup.status).toBe(200);
    const signupTypes = (queueAfterSignup.body.items as Array<{ type: string }>).map((item) => item.type);
    expect(signupTypes).toContain("user.signed_up");

    await Auth.signOut();
    await Auth.Password.signInWithEmail({ password });

    const queueAfterSignin = await niceBackendFetch("/api/v1/internal/brain/queue", {
      method: "GET",
      accessType: "admin",
      query: { status: "QUEUED,CLAIMED,FAILED,COMPLETED" },
    });
    expect(queueAfterSignin.status).toBe(200);
    const types = (queueAfterSignin.body.items as Array<{ type: string }>).map((item) => item.type);
    expect(types).toContain("auth.signed_in");
  });

  it("isolates queue items across projects", async ({ expect }) => {
    const projectA = await createBrainProject();
    await Auth.Password.signUpWithEmail();

    const projectBKeys = await createBrainProject();
    const empty = await niceBackendFetch("/api/v1/internal/brain/queue", {
      method: "GET",
      accessType: "admin",
    });
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);

    backendContext.set({ projectKeys: projectA });
    const projectAQueue = await niceBackendFetch("/api/v1/internal/brain/queue", {
      method: "GET",
      accessType: "admin",
      query: { status: "QUEUED,CLAIMED,FAILED,COMPLETED" },
    });
    expect(projectAQueue.status).toBe(200);
    expect((projectAQueue.body.items as unknown[]).length).toBeGreaterThan(0);

    // Keep projectBKeys referenced so the switch above is intentional.
    expect(projectBKeys).toBeTruthy();
  });

  it("accepts human messages onto the singleton conversation", async ({ expect }) => {
    await createBrainProject();

    const post = await niceBackendFetch("/api/v1/internal/brain/messages", {
      method: "POST",
      accessType: "admin",
      body: { text: "Hello Brain" },
    });
    expect(post).toMatchObject({
      status: 200,
      body: {
        message_id: expect.any(String),
      },
    });

    const state = await niceBackendFetch("/api/v1/internal/brain", {
      method: "GET",
      accessType: "admin",
    });
    expect(state.status).toBe(200);
    const userMessages = (state.body.messages as Array<{ role: string, content: unknown }>).filter((m) => m.role === "user");
    expect(userMessages.length).toBeGreaterThan(0);
  });

  it("runs the brain engine cron route with the cron secret", async ({ expect }) => {
    await createBrainProject();
    const response = await niceBackendFetch("/api/v1/internal/brain-engine-step", {
      method: "GET",
      headers: CRON_AUTH,
      query: { only_one_step: "true" },
    });
    expect(response).toMatchObject({
      status: 200,
      body: { ok: true },
    });
  });
});
