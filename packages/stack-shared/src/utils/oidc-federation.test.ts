import { describe, expect, test } from "vitest";
import { MAX_CLAIM_VALUE_LENGTH, MAX_GLOB_PATTERN_LENGTH, matchClaims, stringLikeMatch } from "./oidc-federation";

describe("stringLikeMatch", () => {
  test("exact literal with no wildcards", () => {
    expect(stringLikeMatch("repo:acme/app", "repo:acme/app")).toBe(true);
    expect(stringLikeMatch("repo:acme/app", "repo:acme/app:more")).toBe(false);
    expect(stringLikeMatch("repo:acme/app", "repo:acme/ap")).toBe(false);
  });

  test("star matches any char sequence (incl. empty)", () => {
    expect(stringLikeMatch("repo:acme/*", "repo:acme/app")).toBe(true);
    expect(stringLikeMatch("repo:acme/*", "repo:acme/")).toBe(true);
    expect(stringLikeMatch("repo:acme/*:production", "repo:acme/app:production")).toBe(true);
    expect(stringLikeMatch("repo:acme/*:production", "repo:acme/app:staging")).toBe(false);
  });

  test("question mark matches exactly one char", () => {
    expect(stringLikeMatch("v?", "v1")).toBe(true);
    expect(stringLikeMatch("v?", "v")).toBe(false);
    expect(stringLikeMatch("v?", "v12")).toBe(false);
  });

  test("regex metacharacters are treated as literals", () => {
    expect(stringLikeMatch("a.b", "a.b")).toBe(true);
    expect(stringLikeMatch("a.b", "axb")).toBe(false);
    expect(stringLikeMatch("a+b(c)", "a+b(c)")).toBe(true);
    expect(stringLikeMatch("a+b(c)", "aab(c)")).toBe(false);
  });

  test("pathological near-miss patterns terminate quickly (linear)", () => {
    const pattern = "*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b";
    const value = "a".repeat(80);
    const start = Date.now();
    expect(stringLikeMatch(pattern, value)).toBe(false);
    expect(Date.now() - start).toBeLessThan(50);
  });

  test("length caps reject oversized input", () => {
    expect(stringLikeMatch("*".repeat(MAX_GLOB_PATTERN_LENGTH + 1), "x")).toBe(false);
    expect(stringLikeMatch("*", "x".repeat(MAX_CLAIM_VALUE_LENGTH + 1))).toBe(false);
  });
});

const stringEquals = (entries: Record<string, string | string[]>) => ({
  stringEquals: new Map<string, string | string[]>(Object.entries(entries)),
});
const stringLike = (entries: Record<string, string | string[]>) => ({
  stringLike: new Map<string, string | string[]>(Object.entries(entries)),
});

describe("matchClaims", () => {
  test("empty conditions always match", () => {
    expect(matchClaims({}, { sub: "anything" })).toEqual({ matched: true });
  });

  test("stringEquals happy path", () => {
    const r = matchClaims(
      stringEquals({ sub: "owner:acme:project:app:environment:production" }),
      { sub: "owner:acme:project:app:environment:production" },
    );
    expect(r).toEqual({ matched: true });
  });

  test("stringEquals mismatch fails with reason", () => {
    const r = matchClaims(
      stringEquals({ environment: "production" }),
      { environment: "preview" },
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toMatch(/environment/);
  });

  test("stringEquals array — any-of semantics", () => {
    const cond = stringEquals({ environment: ["production", "preview"] });
    expect(matchClaims(cond, { environment: "production" }).matched).toBe(true);
    expect(matchClaims(cond, { environment: "preview" }).matched).toBe(true);
    expect(matchClaims(cond, { environment: "development" }).matched).toBe(false);
  });

  test("missing claim fails loudly", () => {
    const r = matchClaims(
      stringEquals({ environment: "production" }),
      { sub: "x" },
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toMatch(/missing claim/);
  });

  test("stringLike wildcard on sub", () => {
    const cond = stringLike({ sub: "owner:acme:project:*:environment:production" });
    expect(matchClaims(cond, { sub: "owner:acme:project:app:environment:production" }).matched).toBe(true);
    expect(matchClaims(cond, { sub: "owner:acme:project:app:environment:preview" }).matched).toBe(false);
    expect(matchClaims(cond, { sub: "owner:evil:project:app:environment:production" }).matched).toBe(false);
  });

  test("stringEquals + stringLike combine with AND", () => {
    const cond = {
      ...stringEquals({ environment: "production" }),
      ...stringLike({ sub: "repo:acme/*" }),
    };
    expect(matchClaims(cond, { environment: "production", sub: "repo:acme/app" }).matched).toBe(true);
    expect(matchClaims(cond, { environment: "preview", sub: "repo:acme/app" }).matched).toBe(false);
    expect(matchClaims(cond, { environment: "production", sub: "repo:other/app" }).matched).toBe(false);
  });

  test("numeric/boolean claims coerced to string", () => {
    expect(matchClaims(stringEquals({ count: "3" }), { count: 3 }).matched).toBe(true);
    expect(matchClaims(stringEquals({ active: "true" }), { active: true }).matched).toBe(true);
  });

  test("array claims match when any element matches (stringEquals)", () => {
    expect(matchClaims(stringEquals({ roles: "admin" }), { roles: ["admin", "user"] }).matched).toBe(true);
    expect(matchClaims(stringEquals({ roles: "admin" }), { roles: ["viewer", "user"] }).matched).toBe(false);
  });

  test("array claims match when any element matches (stringLike)", () => {
    const cond = stringLike({ groups: "team:*" });
    expect(matchClaims(cond, { groups: ["team:eng", "team:ops"] }).matched).toBe(true);
    expect(matchClaims(cond, { groups: ["dept:eng"] }).matched).toBe(false);
  });

  test("object claims fail with a distinct reason (not 'missing')", () => {
    const r = matchClaims(stringEquals({ meta: "x" }), { meta: { nested: "x" } });
    expect(r.matched).toBe(false);
    if (!r.matched) {
      expect(r.reason).not.toMatch(/missing/);
      expect(r.reason).toMatch(/object/);
    }
  });
});
