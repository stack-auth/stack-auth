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

  it("matches a normalized pathname against a static pattern with a trailing slash", () => {
    const index = new RoutePatternIndex([
      "/api/users/",
    ], (pattern) => pattern);

    expect(index.getStaticMatches("/api/users")).toEqual([
      "/api/users/",
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

  it("keeps __proto__ route parameters as own enumerable properties", () => {
    const index = new RoutePatternIndex([
      "/api/[__proto__]",
      "/files/[[...__proto__]]",
    ], (pattern) => pattern);

    expect(index.getDynamicMatches("/api/user-123").map(({ params }) => ({
      entries: Object.entries(params),
      hasDefaultPrototype: Object.getPrototypeOf(params) === Object.prototype,
    }))).toEqual([
      {
        entries: [["__proto__", "user-123"]],
        hasDefaultPrototype: true,
      },
    ]);
    expect(index.getDynamicMatches("/files/a/b").map(({ params }) => ({
      entries: Object.entries(params),
      hasDefaultPrototype: Object.getPrototypeOf(params) === Object.prototype,
    }))).toEqual([
      {
        entries: [["__proto__", ["a", "b"]]],
        hasDefaultPrototype: true,
      },
    ]);
  });
});
