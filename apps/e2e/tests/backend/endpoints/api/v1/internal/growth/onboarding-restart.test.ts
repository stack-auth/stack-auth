import { urlString } from "@hexclave/shared/dist/utils/urls";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { createGrowthProject, requireRunId } from "./growth-helpers";

function requireItems(body: unknown): unknown[] {
  if (typeof body !== "object" || body == null || !("items" in body) || !Array.isArray(body.items)) {
    throw new Error("Expected the growth response to contain an items array.");
  }
  return body.items;
}

describe("internal growth onboarding restart", { timeout: 90_000 }, () => {
  it("rejects restarts without admin access and on projects without the app", async ({ expect }) => {
    await Project.createAndSwitch();
    const disabled = await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding/restart`, { accessType: "admin", method: "POST" });
    expect(disabled.status).toBe(400);

    await Project.updateConfig({ "apps.installed.gtm.enabled": true });
    const clientAccess = await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding/restart`, { accessType: "client", method: "POST" });
    expect(clientAccess.status).toBe(401);
  });

  it("refuses to restart a project that never onboarded", async ({ expect }) => {
    await createGrowthProject();
    const response = await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding/restart`, { accessType: "admin", method: "POST" });
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

    const onboarding = await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://wrong-site.example.com", company_summary: "The details the customer regrets." },
    });
    expect(onboarding.status).toBe(200);
    const firstRunId = requireRunId(onboarding.body);

    const restart = await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding/restart`, { accessType: "admin", method: "POST" });
    expect(restart.status).toBe(200);
    expect(restart.body).toMatchObject({ cancelled_run_ids: [firstRunId] });

    const afterRestart = await niceBackendFetch(urlString`/api/latest/internal/growth/status`, { accessType: "admin" });
    expect(afterRestart.status).toBe(200);
    expect(afterRestart.body).toMatchObject({
      onboarding: { completed: false, website_url: null, completed_at_millis: null },
      analysis: { state: "none", run_id: null, trigger: null },
    });

    const second = await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com", company_summary: "Project management for small teams." },
    });
    expect(second.status).toBe(200);
    const secondRunId = requireRunId(second.body);
    expect(secondRunId).not.toBe(firstRunId);

    const afterSecond = await niceBackendFetch(urlString`/api/latest/internal/growth/status`, { accessType: "admin" });
    expect(afterSecond.body).toMatchObject({
      onboarding: { completed: true, website_url: "https://plannery.example.com/" },
      analysis: { state: "running", run_id: secondRunId, trigger: "initial" },
    });
  });

  it("keeps the findings and milestones a restart is not supposed to destroy", { timeout: 300_000 }, async ({ expect }) => {
    await createGrowthProject();
    await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });

    const before = await niceBackendFetch(urlString`/api/latest/internal/growth/milestones`, { accessType: "admin" });
    expect(before.status).toBe(200);
    expect(requireItems(before.body)).toHaveLength(3);

    await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding/restart`, { accessType: "admin", method: "POST" });
    const afterRestart = await niceBackendFetch(urlString`/api/latest/internal/growth/milestones`, { accessType: "admin" });
    expect(requireItems(afterRestart.body)).toHaveLength(3);

    await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });
    const afterSecond = await niceBackendFetch(urlString`/api/latest/internal/growth/milestones`, { accessType: "admin" });
    expect(requireItems(afterSecond.body)).toHaveLength(3);
  });

  it("rejects a concurrent restart after another restart claims the onboarding generation", async ({ expect }) => {
    await createGrowthProject();
    const onboarding = await niceBackendFetch(urlString`/api/latest/internal/growth/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });
    expect(onboarding.status).toBe(200);

    const restarts = await Promise.all([
      niceBackendFetch(urlString`/api/latest/internal/growth/onboarding/restart`, { accessType: "admin", method: "POST" }),
      niceBackendFetch(urlString`/api/latest/internal/growth/onboarding/restart`, { accessType: "admin", method: "POST" }),
    ]);
    const statuses = restarts.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 400 || status === 409)).toHaveLength(1);

    const afterRestart = await niceBackendFetch(urlString`/api/latest/internal/growth/status`, { accessType: "admin" });
    const statusBody = afterRestart.body;
    if (typeof statusBody !== "object" || statusBody == null || !("onboarding" in statusBody) || !("analysis" in statusBody)) {
      throw new Error("Expected the growth status response to contain onboarding and analysis objects.");
    }
    expect({ onboarding: statusBody.onboarding, analysis: statusBody.analysis }).toMatchInlineSnapshot(`
      {
        "analysis": {
          "completed_at_millis": null,
          "compute_metrics": null,
          "error_message": null,
          "integrations": null,
          "run_id": null,
          "started_at_millis": null,
          "state": "none",
          "steps": null,
          "trigger": null,
        },
        "onboarding": {
          "completed": false,
          "completed_at_millis": null,
          "website_url": null,
        },
      }
    `);
  });
});
