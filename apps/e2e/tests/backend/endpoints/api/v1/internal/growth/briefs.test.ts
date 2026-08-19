import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { createGrowthProject } from "./growth-helpers";

const BASE_PATH = "/api/latest/internal/growth/briefs";
const INTERNAL_RESOURCE_DENIAL = "This Growth resource is not available.";

describe("internal growth briefs", { timeout: 90_000 }, () => {
  it("denies customer access to the brief list", async ({ expect }) => {
    await createGrowthProject();

    const response = await niceBackendFetch(BASE_PATH, { accessType: "admin" });
    expect(response.status).toBe(403);
    expect(response.body).toBe(INTERNAL_RESOURCE_DENIAL);
  });

  it("denies customer access to brief details", async ({ expect }) => {
    await createGrowthProject();

    const response = await niceBackendFetch(`${BASE_PATH}/${encodeURIComponent(randomUUID())}`, { accessType: "admin" });
    expect(response.status).toBe(403);
    expect(response.body).toBe(INTERNAL_RESOURCE_DENIAL);
  });

  it("keeps customer brief reads behind the report release gate", async ({ expect }) => {
    await createGrowthProject();

    const response = await niceBackendFetch(`${BASE_PATH}/${encodeURIComponent(randomUUID())}/read`, {
      accessType: "admin",
      method: "POST",
    });
    expect(response.status).toBe(409);
    expect(response.body).toBe("Your growth report is still being prepared.");
  });

  it("keeps the internal-resource denial uniform when the Growth app is disabled", async ({ expect }) => {
    await createGrowthProject();
    const clientList = await niceBackendFetch(BASE_PATH, { accessType: "client" });
    expect(clientList.status).toBe(401);

    const clientDetail = await niceBackendFetch(`${BASE_PATH}/${encodeURIComponent(randomUUID())}`, { accessType: "client" });
    expect(clientDetail.status).toBe(401);

    const clientRead = await niceBackendFetch(`${BASE_PATH}/${encodeURIComponent(randomUUID())}/read`, {
      accessType: "client",
      method: "POST",
    });
    expect(clientRead.status).toBe(401);

    await Project.updateConfig({ "apps.installed.gtm.enabled": false });

    const list = await niceBackendFetch(BASE_PATH, { accessType: "admin" });
    expect(list.status).toBe(403);
    expect(list.body).toBe(INTERNAL_RESOURCE_DENIAL);

    const detail = await niceBackendFetch(`${BASE_PATH}/${encodeURIComponent(randomUUID())}`, { accessType: "admin" });
    expect(detail.status).toBe(403);
    expect(detail.body).toBe(INTERNAL_RESOURCE_DENIAL);

    const read = await niceBackendFetch(`${BASE_PATH}/${encodeURIComponent(randomUUID())}/read`, {
      accessType: "admin",
      method: "POST",
    });
    expect(read.status).toBe(400);
  });
});
