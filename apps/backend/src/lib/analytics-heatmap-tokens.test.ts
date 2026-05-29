import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { signJWT } from "@stackframe/stack-shared/dist/utils/jwt";
import { describe, expect, it } from "vitest";
import { normalizeAnalyticsHeatmapOrigin, verifyAnalyticsHeatmapToken } from "./analytics-heatmap-tokens";

describe("analytics heatmap token helpers", () => {
  it("normalizes a trusted-domain URL to its origin", () => {
    expect(normalizeAnalyticsHeatmapOrigin("https://example.com/dashboard?x=1")).toMatchInlineSnapshot(`"https://example.com"`);
  });

  it("rejects non-HTTP origins", () => {
    expect(() => normalizeAnalyticsHeatmapOrigin("javascript:alert(1)")).toThrow(StatusError);
  });

  it("returns the project encoded in a valid heatmap token", async () => {
    const token = await signJWT({
      issuer: "hexclave:analytics:heatmap",
      audience: "hexclave:analytics:heatmap-overlay",
      expirationTime: "24h",
      payload: {
        kind: "analytics_heatmap_overlay",
        scope: "heatmap:read",
        project_id: "internal",
        branch_id: "main",
        origin: "http://localhost:8101",
      },
    });

    const payload = await verifyAnalyticsHeatmapToken({
      token,
      origin: "http://localhost:8101/projects/internal/analytics/heatmaps",
    });

    expect({
      kind: payload.kind,
      scope: payload.scope,
      project_id: payload.project_id,
      branch_id: payload.branch_id,
      origin: payload.origin,
    }).toMatchInlineSnapshot(`
      {
        "branch_id": "main",
        "kind": "analytics_heatmap_overlay",
        "origin": "http://localhost:8101",
        "project_id": "internal",
        "scope": "heatmap:read",
      }
    `);
  });
});
