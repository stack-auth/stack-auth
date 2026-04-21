import { describe, expect, test } from "vitest";
import { matchClaims, stringLikeToRegExp } from "./oidc-federation";

describe("stringLikeToRegExp", () => {
  const re = stringLikeToRegExp;

  test("exact literal with no wildcards", () => {
    expect(re("repo:acme/app").test("repo:acme/app")).toBe(true);
    expect(re("repo:acme/app").test("repo:acme/app:more")).toBe(false);
    expect(re("repo:acme/app").test("repo:acme/ap")).toBe(false);
  });

  test("star matches any char sequence (incl. empty)", () => {
    expect(re("repo:acme/*").test("repo:acme/app")).toBe(true);
    expect(re("repo:acme/*").test("repo:acme/")).toBe(true);
    expect(re("repo:acme/*:production").test("repo:acme/app:production")).toBe(true);
    expect(re("repo:acme/*:production").test("repo:acme/app:staging")).toBe(false);
  });

  test("question mark matches exactly one char", () => {
    expect(re("v?").test("v1")).toBe(true);
    expect(re("v?").test("v")).toBe(false);
    expect(re("v?").test("v12")).toBe(false);
  });

  test("regex metacharacters in pattern are escaped", () => {
    expect(re("a.b").test("a.b")).toBe(true);
    expect(re("a.b").test("axb")).toBe(false);
    expect(re("a+b(c)").test("a+b(c)")).toBe(true);
    expect(re("a+b(c)").test("aab(c)")).toBe(false);
  });
});

describe("matchClaims", () => {
  test("empty conditions always match", () => {
    expect(matchClaims({}, { sub: "anything" })).toEqual({ matched: true });
  });

  test("stringEquals happy path", () => {
    const r = matchClaims(
      { stringEquals: { sub: "owner:acme:project:app:environment:production" } },
      { sub: "owner:acme:project:app:environment:production" },
    );
    expect(r).toEqual({ matched: true });
  });

  test("stringEquals mismatch fails with reason", () => {
    const r = matchClaims(
      { stringEquals: { environment: "production" } },
      { environment: "preview" },
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toMatch(/environment/);
  });

  test("stringEquals array — any-of semantics", () => {
    const cond = { stringEquals: { environment: ["production", "preview"] } };
    expect(matchClaims(cond, { environment: "production" }).matched).toBe(true);
    expect(matchClaims(cond, { environment: "preview" }).matched).toBe(true);
    expect(matchClaims(cond, { environment: "development" }).matched).toBe(false);
  });

  test("missing claim fails loudly", () => {
    const r = matchClaims(
      { stringEquals: { environment: "production" } },
      { sub: "x" },
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toMatch(/missing claim/);
  });

  test("stringLike wildcard on sub", () => {
    const cond = { stringLike: { sub: "owner:acme:project:*:environment:production" } };
    expect(matchClaims(cond, { sub: "owner:acme:project:app:environment:production" }).matched).toBe(true);
    expect(matchClaims(cond, { sub: "owner:acme:project:app:environment:preview" }).matched).toBe(false);
    expect(matchClaims(cond, { sub: "owner:evil:project:app:environment:production" }).matched).toBe(false);
  });

  test("stringEquals + stringLike combine with AND", () => {
    const cond = {
      stringEquals: { environment: "production" },
      stringLike: { sub: "repo:acme/*" },
    };
    expect(matchClaims(cond, { environment: "production", sub: "repo:acme/app" }).matched).toBe(true);
    expect(matchClaims(cond, { environment: "preview", sub: "repo:acme/app" }).matched).toBe(false);
    expect(matchClaims(cond, { environment: "production", sub: "repo:other/app" }).matched).toBe(false);
  });

  test("numeric/boolean claims coerced to string", () => {
    expect(matchClaims({ stringEquals: { count: "3" } }, { count: 3 }).matched).toBe(true);
    expect(matchClaims({ stringEquals: { active: "true" } }, { active: true }).matched).toBe(true);
  });

  test("object/array claims are treated as missing (no implicit stringify)", () => {
    const r = matchClaims({ stringEquals: { roles: "admin" } }, { roles: ["admin", "user"] });
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toMatch(/missing/);
  });
});
