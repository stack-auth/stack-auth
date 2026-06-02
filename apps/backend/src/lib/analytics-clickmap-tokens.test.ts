import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { signJWT } from "@hexclave/shared/dist/utils/jwt";
import { describe, expect, it } from "vitest";
import { normalizeAnalyticsClickmapOrigin, verifyAnalyticsClickmapToken } from "./analytics-clickmap-tokens";

describe("analytics clickmap token helpers", () => {
  it("normalizes a trusted-domain URL to its origin", () => {
    expect(normalizeAnalyticsClickmapOrigin("https://example.com/dashboard?x=1")).toMatchInlineSnapshot(`"https://example.com"`);
  });

  it("rejects non-HTTP origins", () => {
    expect(() => normalizeAnalyticsClickmapOrigin("javascript:alert(1)")).toThrow(StatusError);
  });

  it("returns the project encoded in a valid clickmap token", async () => {
    const token = await signJWT({
      issuer: "hexclave:analytics:clickmap",
      audience: "hexclave:analytics:clickmap-overlay",
      expirationTime: "24h",
      payload: {
        kind: "analytics_clickmap_overlay",
        scope: "clickmap:read",
        project_id: "internal",
        branch_id: "main",
        origin: "http://localhost:8101",
      },
    });

    const payload = await verifyAnalyticsClickmapToken({
      token,
      origin: "http://localhost:8101/projects/internal/analytics/clickmaps",
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
        "kind": "analytics_clickmap_overlay",
        "origin": "http://localhost:8101",
        "project_id": "internal",
        "scope": "clickmap:read",
      }
    `);
  });
});
