import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";

describe("GET /api/v1/internal/changelog", () => {
  it("should return changelog entries with expected structure", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/changelog", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("entries");
    expect(Array.isArray(response.body.entries)).toBe(true);
    expect(response.body.entries.length).toBeGreaterThan(0);

    const entry = response.body.entries[0];
    expect(entry).toHaveProperty("version");
    expect(entry).toHaveProperty("type");
    expect(entry).toHaveProperty("markdown");
    expect(entry).toHaveProperty("bulletCount");
    expect(typeof entry.version).toBe("string");
    expect(["major", "minor", "patch"]).toContain(entry.type);
    expect(typeof entry.markdown).toBe("string");
    expect(typeof entry.bulletCount).toBe("number");
    expect(entry.bulletCount).toBeGreaterThanOrEqual(0);
  });

  it("should return at most 8 entries", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/changelog", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    expect(response.body.entries.length).toBeLessThanOrEqual(8);
  });
});
