import { describe, expect, it } from "vitest";
import { normalizeUrlPath } from "./normalize-url";

describe("normalizeUrlPath", () => {
  it("groups dynamic routes while preserving their stable path structure", () => {
    expect(normalizeUrlPath("/users/550e8400-e29b-41d4-a716-446655440000/settings?tab=security#password"))
      .toBe("/users/:id/settings");
    expect(normalizeUrlPath("/orders/12345/items/67890")).toBe("/orders/:id/items/:id");
  });

  it("does not group ordinary static route segments", () => {
    expect(normalizeUrlPath("/projects/internal/analytics/paths")).toBe("/projects/internal/analytics/paths");
  });
});
