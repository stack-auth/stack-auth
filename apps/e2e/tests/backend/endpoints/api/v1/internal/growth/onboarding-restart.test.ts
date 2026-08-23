import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { createGrowthProject, requireRunId } from "./growth-helpers";

const BASE_PATH = "/api/latest/internal/growth";


function requireItems(body: unknown): unknown[] {
  if (typeof body !== "object" || body == null || !("items" in body) || !Array.isArray(body.items)) {
    throw new Error("Expected the growth response to contain an items array.");
  }
  return body.items;
}

function requireAnalysisSummary(body: unknown): { run_id: unknown, state: unknown } {
  if (typeof body !== "object" || body == null || !("analysis" in body)) {
    throw new Error("Expected the growth response to contain an analysis object.");
  }
  const analysis = body.analysis;
  if (typeof analysis !== "object" || analysis == null || !("run_id" in analysis) || !("state" in analysis)) {
    throw new Error("Expected the growth response analysis to contain state and run_id.");
  }
  return { run_id: analysis.run_id, state: analysis.state };
}

describe("internal growth onboarding restart", { timeout: 90_000 }, () => {
  it("rejects restarts without admin access and on projects without the app", async ({ expect }) => {
    await Project.createAndSwitch();
    const disabled = await niceBackendFetch(`${BASE_PATH}/onboarding/restart`, { accessType: "admin", method: "POST" });
    expect(disabled.status).toBe(400);

    await Project.updateConfig({ "apps.installed.gtm.enabled": true });
    const clientAccess = await niceBackendFetch(`${BASE_PATH}/onboarding/restart`, { accessType: "client", method: "POST" });
    expect(clientAccess.status).toBe(401);
  });

  it("refuses to restart a project that never onboarded", async ({ expect }) => {
    await createGrowthProject();
    const response = await niceBackendFetch(`${BASE_PATH}/onboarding/restart`, { accessType: "admin", method: "POST" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "Growth onboarding has not been completed for this project.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("cancels the in-flight run, reopens the form, and lets onboarding be completed again", { timeout: 300_000 }, async ({ expect }) => {
    await createGrowthProject();

    const onboarding = await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://wrong-site.example.com", company_summary: "The details the customer regrets." },
    });
    expect(onboarding.status).toBe(200);
    const firstRunId = requireRunId(onboarding.body);

    const restart = await niceBackendFetch(`${BASE_PATH}/onboarding/restart`, { accessType: "admin", method: "POST" });
    expect(restart.status).toBe(200);
    expect(restart.body).toMatchObject({ cancelled_run_ids: [firstRunId] });

    const afterRestart = await niceBackendFetch(`${BASE_PATH}/status`, { accessType: "admin" });
    expect(afterRestart.status).toBe(200);
    expect(afterRestart.body).toMatchObject({
      onboarding: { completed: false, website_url: null, completed_at_millis: null },
      analysis: { state: "none", run_id: null, trigger: null },
    });
    expect(requireAnalysisSummary(afterRestart.body)).toMatchInlineSnapshot(`
      {
        "run_id": null,
        "state": "none",
      }
    `);

    const second = await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com", company_summary: "Project management for small teams." },
    });
    expect(second.status).toBe(200);
    const secondRunId = requireRunId(second.body);
    expect(secondRunId).not.toBe(firstRunId);

    const afterSecond = await niceBackendFetch(`${BASE_PATH}/status`, { accessType: "admin" });
    expect(afterSecond.body).toMatchObject({
      onboarding: { completed: true, website_url: "https://plannery.example.com/" },
      analysis: { state: "running", run_id: secondRunId, trigger: "initial" },
    });
  });

  it("keeps the findings and milestones a restart is not supposed to destroy", { timeout: 300_000 }, async ({ expect }) => {
    await createGrowthProject();
    await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });

    const before = await niceBackendFetch(`${BASE_PATH}/milestones`, { accessType: "admin" });
    expect(before.status).toBe(200);
    expect(requireItems(before.body)).toHaveLength(3);

    await niceBackendFetch(`${BASE_PATH}/onboarding/restart`, { accessType: "admin", method: "POST" });
    const afterRestart = await niceBackendFetch(`${BASE_PATH}/milestones`, { accessType: "admin" });
    expect(requireItems(afterRestart.body)).toHaveLength(3);

    await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });
    const afterSecond = await niceBackendFetch(`${BASE_PATH}/milestones`, { accessType: "admin" });
    expect(requireItems(afterSecond.body)).toHaveLength(3);
  });
});
