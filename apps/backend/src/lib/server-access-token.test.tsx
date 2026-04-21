import { KnownErrors } from "@stackframe/stack-shared";
import { describe, expect, it } from "vitest";
import { clampServerAccessTokenTtlSeconds, mintServerAccessToken, verifyServerAccessToken } from "./server-access-token";

describe("clampServerAccessTokenTtlSeconds", () => {
  it("returns the default when undefined", () => {
    expect(clampServerAccessTokenTtlSeconds(undefined)).toBe(900);
  });
  it("clamps to min", () => {
    expect(clampServerAccessTokenTtlSeconds(5)).toBe(30);
  });
  it("clamps to max", () => {
    expect(clampServerAccessTokenTtlSeconds(10_000)).toBe(3600);
  });
  it("passes through in-range values", () => {
    expect(clampServerAccessTokenTtlSeconds(1800)).toBe(1800);
  });
  it("falls back to default for NaN", () => {
    expect(clampServerAccessTokenTtlSeconds(Number.NaN)).toBe(900);
  });
});

describe("mintServerAccessToken + verifyServerAccessToken roundtrip", () => {
  const federation = {
    policyId: "policy-1",
    issuer: "https://oidc.vercel.com/acme",
    subject: "owner:acme:project:app:environment:production",
    audience: "https://vercel.com/acme",
  };

  it("mints a token that verifies back out with the same project + federation metadata", async () => {
    const minted = await mintServerAccessToken({
      projectId: "internal",
      branchId: "main",
      federation,
      ttlSeconds: 60,
    });
    expect(minted.ttlSeconds).toBe(60);
    expect(typeof minted.accessToken).toBe("string");
    const verified = await verifyServerAccessToken(minted.accessToken, { projectId: "internal" });
    if (verified.status === "error") throw verified.error;
    expect(verified.data.projectId).toBe("internal");
    expect(verified.data.branchId).toBe("main");
    expect(verified.data.federation).toEqual(federation);
  });

  it("rejects a token presented with the wrong projectId (cross-project replay guard)", async () => {
    const minted = await mintServerAccessToken({
      projectId: "internal",
      branchId: "main",
      federation,
      ttlSeconds: 60,
    });
    const verified = await verifyServerAccessToken(minted.accessToken, { projectId: "other-project" });
    expect(verified.status).toBe("error");
    if (verified.status === "error") {
      expect(verified.error).toBeInstanceOf(KnownErrors.UnparsableAccessToken);
    }
  });

  it("rejects garbage", async () => {
    const verified = await verifyServerAccessToken("not-a-real-token", { projectId: "internal" });
    expect(verified.status).toBe("error");
  });

  it("returns the token's own branchId so the caller can compare against its asserted branch", async () => {
    const minted = await mintServerAccessToken({
      projectId: "internal",
      branchId: "main",
      federation,
      ttlSeconds: 60,
    });
    const verified = await verifyServerAccessToken(minted.accessToken, { projectId: "internal" });
    if (verified.status === "error") throw verified.error;
    expect(verified.data.branchId).toBe("main");
  });
});
