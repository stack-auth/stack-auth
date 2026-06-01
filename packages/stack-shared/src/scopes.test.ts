import { describe, expect, it } from "vitest";
import { ALL_SCOPES, getMissingScopes, intersectScopes, isScope, parseScopeString, SCOPES, scopesToString } from "./scopes";

describe("scopes registry", () => {
  it("ALL_SCOPES matches the keys of SCOPES", () => {
    expect([...ALL_SCOPES].sort()).toEqual(Object.keys(SCOPES).sort());
  });

  it("isScope recognizes registered scopes and rejects others", () => {
    expect(isScope("users:read")).toBe(true);
    expect(isScope("teams:write")).toBe(true);
    expect(isScope("not:a:scope")).toBe(false);
    expect(isScope("")).toBe(false);
  });
});

describe("parseScopeString", () => {
  it("returns an empty array for null/undefined/empty", () => {
    expect(parseScopeString(null)).toEqual([]);
    expect(parseScopeString(undefined)).toEqual([]);
    expect(parseScopeString("")).toEqual([]);
    expect(parseScopeString("   ")).toEqual([]);
  });

  it("splits on spaces and drops empty segments", () => {
    expect(parseScopeString("users:read teams:read")).toEqual(["users:read", "teams:read"]);
    expect(parseScopeString("  users:read   teams:read  ")).toEqual(["users:read", "teams:read"]);
  });

  it("deduplicates", () => {
    expect(parseScopeString("users:read users:read teams:read")).toEqual(["users:read", "teams:read"]);
  });

  it("preserves unknown scope strings (never silently widens or drops)", () => {
    expect(parseScopeString("users:read legacy:scope")).toEqual(["users:read", "legacy:scope"]);
  });
});

describe("scopesToString", () => {
  it("joins with spaces and deduplicates", () => {
    expect(scopesToString(["users:read", "teams:read"])).toBe("users:read teams:read");
    expect(scopesToString(["users:read", "users:read"])).toBe("users:read");
    expect(scopesToString([])).toBe("");
  });

  it("round-trips with parseScopeString", () => {
    const scopes = ["users:read", "teams:write", "contact_channels:read"];
    expect(parseScopeString(scopesToString(scopes))).toEqual(scopes);
  });
});

describe("intersectScopes", () => {
  it("keeps only requested scopes that are allowed", () => {
    expect(intersectScopes(["users:read", "teams:write"], ["users:read", "teams:read"])).toEqual(["users:read"]);
  });

  it("returns empty when nothing overlaps", () => {
    expect(intersectScopes(["users:write"], ["teams:read"])).toEqual([]);
  });

  it("can never grant a scope beyond the allowed set", () => {
    expect(intersectScopes(["users:read", "users:write", "teams:write"], ["users:read"])).toEqual(["users:read"]);
  });
});

describe("getMissingScopes", () => {
  it("returns empty when all required scopes are present", () => {
    expect(getMissingScopes(["users:read"], ["users:read", "teams:read"])).toEqual([]);
    expect(getMissingScopes([], ["users:read"])).toEqual([]);
    expect(getMissingScopes([], [])).toEqual([]);
  });

  it("returns the required scopes that are absent", () => {
    expect(getMissingScopes(["users:read", "teams:write"], ["users:read"])).toEqual(["teams:write"]);
    expect(getMissingScopes(["users:read", "teams:write"], [])).toEqual(["users:read", "teams:write"]);
  });
});
