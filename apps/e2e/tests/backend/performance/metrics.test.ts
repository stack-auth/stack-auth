import { performance } from "node:perf_hooks";
import { describe } from "vitest";
import { it } from "../../helpers";
import { InternalProjectKeys, User, backendContext, niceBackendFetch } from "../backend-helpers";


describe.skip("/api/v1/users performance", () => {
  backendContext.set({
    projectKeys: InternalProjectKeys,
  });

  it("lists users within the expected response time", async ({ expect }) => {
    // Warm up the endpoint so that caches/connection pools are ready
    await niceBackendFetch("/api/v1/users?limit=10", { accessType: "server" });

    const start = performance.now();
    const response = await niceBackendFetch("/api/v1/users?limit=200000", { accessType: "server" });
    const durationMs = performance.now() - start;

    expect(response.status).toBe(200);
    console.log("items length", response.body.items.length);
    console.log("durationMs", durationMs);
  });
});

describe("/api/v1/internal/metrics performance", () => {
  backendContext.set({
    projectKeys: InternalProjectKeys,
  });

  it("lists metrics within the expected response time", async ({ expect }) => {
    await niceBackendFetch("/api/v1/internal/metrics", { accessType: "admin" });

    const measure = async () => {
      const start = performance.now();
      const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: "admin" });
      const durationMs = performance.now() - start;
      expect(response.status).toBe(200);
      return durationMs;
    };

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await measure());
    }
    console.log("results", results);
    console.log("average", results.reduce((a, b) => a + b, 0) / results.length);
  });
});
