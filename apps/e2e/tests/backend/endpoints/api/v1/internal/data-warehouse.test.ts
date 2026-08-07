import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { niceBackendFetch, Project } from "../../../../backend-helpers";

describe("data source connector catalogue", () => {
  it("requires admin access", async ({ expect }) => {
    await Project.createAndSwitch();
    const response = await niceBackendFetch("/api/latest/internal/data-warehouse/connectors", {
      method: "GET",
      accessType: "client",
    });
    expect(response.status).toBe(401);
  });

  it("serves runtime-supported connectors from the complete v2.1 corpus", async ({ expect }) => {
    await Project.createAndSwitch();
    const response = await niceBackendFetch("/api/latest/internal/data-warehouse/connectors", {
      method: "GET",
      accessType: "admin",
    });

    expect(response.status).toBe(200);
    expect(response.body.stats).toMatchObject({
      total: 97,
      streams: 1013,
    });
    expect(response.body.stats.connectable).toBeGreaterThan(0);
    expect(response.body.stats.connectable).toBeLessThan(response.body.stats.total);

    const connectors = response.body.connectors;
    expect(connectors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "stripe-native",
        auth_tier: "T1_SIMPLE",
        credential_mode: expect.any(String),
      }),
      expect.objectContaining({ id: "custom-rest" }),
    ]));
    // Continuous/log sources are retained in the corpus but withheld until a
    // driver can honor their checkpoint and continuity semantics.
    expect(connectors.some((connector: { id: string }) => connector.id === "kinesis")).toBe(false);
  });
});
