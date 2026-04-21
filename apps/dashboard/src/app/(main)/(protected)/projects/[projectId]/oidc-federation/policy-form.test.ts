import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { describe, expect, it, vi } from "vitest";
import {
  draftToPolicy,
  emptyDraft,
  newAudienceRow,
  newClaimRow,
  policyToDraft,
  probeIssuerDiscovery,
  validateDraft,
  type PolicyDraft,
} from "./policy-form";

describe("emptyDraft", () => {
  it("starts with one empty audience row and no claim rows", () => {
    const d = emptyDraft();
    expect(d.audiences.length).toBe(1);
    expect(d.audiences[0].value).toBe("");
    expect(d.claimRows).toEqual([]);
    expect(d.enabled).toBe(true);
    expect(d.tokenTtlSeconds).toBe(900);
  });
});

describe("draftToPolicy", () => {
  const baseDraft = (): PolicyDraft => ({
    id: "pol-1",
    displayName: "Vercel prod",
    enabled: true,
    issuerUrl: "  https://oidc.vercel.com/acme  ",
    audiences: [newAudienceRow("https://vercel.com/acme"), newAudienceRow("")],
    claimRows: [
      { rowId: "r1", claim: "environment", operator: "equals", valuesRaw: "production\npreview" },
      { rowId: "r2", claim: "sub", operator: "like", valuesRaw: "owner:acme:project:*:environment:production" },
    ],
    tokenTtlSeconds: 900,
  });

  it("trims issuer URL + display name and drops empty audience rows", () => {
    const p = draftToPolicy(baseDraft());
    expect(p.issuerUrl).toBe("https://oidc.vercel.com/acme");
    expect(p.displayName).toBe("Vercel prod");
    expect(Object.values(p.audiences ?? {})).toEqual(["https://vercel.com/acme"]);
  });

  it("converts claim rows into stringEquals / stringLike records keyed by generated IDs", () => {
    const p = draftToPolicy(baseDraft());
    const equalsRecord = p.claimConditions.stringEquals?.environment ?? {};
    const likeRecord = p.claimConditions.stringLike?.sub ?? {};
    expect(Object.values(equalsRecord).filter((v): v is string => typeof v === "string").sort(stringCompare)).toEqual(["preview", "production"]);
    expect(Object.values(likeRecord)).toEqual(["owner:acme:project:*:environment:production"]);
  });

  it("merges two rows with the same claim + operator into one entry", () => {
    const draft = baseDraft();
    draft.claimRows = [
      { rowId: "r1", claim: "aud", operator: "equals", valuesRaw: "a" },
      { rowId: "r2", claim: "aud", operator: "equals", valuesRaw: "b" },
    ];
    const p = draftToPolicy(draft);
    const audRecord = p.claimConditions.stringEquals?.aud ?? {};
    expect(Object.values(audRecord).filter((v): v is string => typeof v === "string").sort(stringCompare)).toEqual(["a", "b"]);
  });

  it("drops rows with empty claim names or no values", () => {
    const draft = baseDraft();
    draft.claimRows = [
      { rowId: "r1", claim: "", operator: "equals", valuesRaw: "x" },
      { rowId: "r2", claim: "environment", operator: "equals", valuesRaw: "   \n  " },
    ];
    const p = draftToPolicy(draft);
    expect(p.claimConditions.stringEquals).toEqual({});
  });
});

describe("policyToDraft", () => {
  it("roundtrips through draftToPolicy preserving semantic content", () => {
    const original: PolicyDraft = {
      id: "pol-1",
      displayName: "GH Actions",
      enabled: true,
      issuerUrl: "https://token.actions.githubusercontent.com",
      audiences: [newAudienceRow("https://github.com/acme")],
      claimRows: [
        { rowId: "r1", claim: "sub", operator: "like", valuesRaw: "repo:acme/*:environment:production" },
      ],
      tokenTtlSeconds: 600,
    };
    const policy = draftToPolicy(original);
    const back = policyToDraft("pol-1", policy);
    expect(back.displayName).toBe(original.displayName);
    expect(back.issuerUrl).toBe(original.issuerUrl);
    expect(back.audiences.map(a => a.value)).toEqual(["https://github.com/acme"]);
    expect(back.claimRows.length).toBe(1);
    expect(back.claimRows[0].claim).toBe("sub");
    expect(back.claimRows[0].operator).toBe("like");
    expect(back.claimRows[0].valuesRaw).toBe("repo:acme/*:environment:production");
    expect(back.tokenTtlSeconds).toBe(600);
  });

  it("preserves audience and claim value ids on an unchanged roundtrip", () => {
    const policy = {
      displayName: "unchanged",
      enabled: true,
      issuerUrl: "https://issuer.example.com",
      audiences: {
        aud1: "audience-a",
      },
      claimConditions: {
        stringEquals: {
          environment: {
            env1: "production",
            env2: "preview",
          },
        },
        stringLike: {
          sub: {
            sub1: "repo:acme/*",
          },
        },
      },
      tokenTtlSeconds: 900,
    } satisfies ReturnType<typeof draftToPolicy>;

    const roundTripped = draftToPolicy(policyToDraft("pol-1", policy));
    expect(roundTripped).toEqual(policy);
  });

  it("seeds at least one audience row when the policy has none", () => {
    const policyWithoutAudiences = draftToPolicy({ ...emptyDraft(), displayName: "x", issuerUrl: "https://x" });
    const d = policyToDraft("pol-x", { ...policyWithoutAudiences, audiences: {} });
    expect(d.audiences.length).toBe(1);
  });
});

describe("validateDraft", () => {
  it("accepts a fully-filled draft", () => {
    const d = emptyDraft();
    d.displayName = "x";
    d.issuerUrl = "https://x";
    d.audiences[0].value = "x";
    expect(validateDraft(d)).toEqual([]);
  });
  it("flags all individual issues", () => {
    const d = { ...emptyDraft(), tokenTtlSeconds: 10_000 };
    const kinds = validateDraft(d).map(i => i.kind);
    expect(kinds).toContain("missing-display-name");
    expect(kinds).toContain("missing-issuer");
    expect(kinds).toContain("missing-audiences");
    expect(kinds).toContain("invalid-ttl");
  });
  it("flags TTL below 30", () => {
    const d = emptyDraft();
    d.displayName = "x";
    d.issuerUrl = "https://x";
    d.audiences[0].value = "x";
    d.tokenTtlSeconds = 10;
    expect(validateDraft(d).map(i => i.kind)).toEqual(["invalid-ttl"]);
  });
});

describe("probeIssuerDiscovery", () => {
  it("returns ok when the discovery doc contains issuer + jwks_uri", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response(JSON.stringify({ issuer: "https://idp", jwks_uri: "https://idp/jwks" }), { status: 200 }));
    const result = await probeIssuerDiscovery("https://idp/", { fetchImpl });
    expect(result).toEqual({ kind: "ok", issuer: "https://idp", jwksUri: "https://idp/jwks" });
    expect(fetchImpl).toHaveBeenCalledWith("https://idp/.well-known/openid-configuration", expect.any(Object));
  });
  it("returns error on non-200", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response("nope", { status: 404 }));
    const result = await probeIssuerDiscovery("https://idp", { fetchImpl });
    expect(result.kind).toBe("error");
  });
  it("returns error when issuer URL is empty", async () => {
    const result = await probeIssuerDiscovery("");
    expect(result).toEqual({ kind: "error", reason: "issuer URL is empty" });
  });
  it("returns error on malformed discovery doc", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const result = await probeIssuerDiscovery("https://idp", { fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.reason).toMatch(/issuer/);
  });
});

describe("newClaimRow / newAudienceRow", () => {
  it("assigns distinct row ids", () => {
    expect(newClaimRow().rowId).not.toBe(newClaimRow().rowId);
    expect(newAudienceRow().rowId).not.toBe(newAudienceRow().rowId);
  });
});
