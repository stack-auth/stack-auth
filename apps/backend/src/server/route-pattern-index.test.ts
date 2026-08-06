import { describe, expect, it } from "vitest";
import { RoutePatternIndex } from "./route-pattern-index";

describe("RoutePatternIndex", () => {
  it("keeps the common static API path on the precomputed fast path", () => {
    const index = new RoutePatternIndex([
      "/api/latest/users/[user_id]",
      "/api/latest/users/me",
      "/api/[...notFoundPath]",
    ], (pattern) => pattern);

    expect(index.getStaticMatches("/api/latest/users/me")).toEqual([
      "/api/latest/users/me",
    ]);
  });

  it("matches dynamic and catch-all routes with Next-compatible precedence and params", () => {
    const index = new RoutePatternIndex([
      "/api/[...notFoundPath]",
      "/api/latest/users/[user_id]",
    ], (pattern) => pattern);

    expect(index.getDynamicMatches("/api/latest/users/user-123")).toEqual([
      {
        params: { user_id: "user-123" },
        value: "/api/latest/users/[user_id]",
      },
      {
        params: { notFoundPath: ["latest", "users", "user-123"] },
        value: "/api/[...notFoundPath]",
      },
    ]);
  });
});
