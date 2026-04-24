import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { describe, expect, it } from "vitest";
import {
  claimConditionsToJson,
  draftToPolicy,
  emptyDraft,
  newAudienceRow,
  parseClaimConditionsJson,
  policyToDraft,
  validateDraft,
  type PolicyDraft,
} from "./oidc-policy-form";

describe("emptyDraft", () => {
  it("starts with one empty audience row and empty claim conditions JSON", () => {
    const d = emptyDraft();
    expect(d.audiences.length).toBe(1);
    expect(d.audiences[0].value).toBe("");
    const parsed = parseClaimConditionsJson(d.claimConditionsJson);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") {
      expect(parsed.parsed).toEqual({ stringEquals: {}, stringLike: {} });
    }
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
    claimConditionsJson: JSON.stringify({
      stringEquals: { environment: ["production", "preview"] },
      stringLike: { sub: ["owner:acme:project:*:environment:production"] },
    }),
    tokenTtlSeconds: 900,
  });

  it("trims issuer URL + display name and drops empty audience rows", () => {
    const p = draftToPolicy(baseDraft());
    expect(p.issuerUrl).toBe("https://oidc.vercel.com/acme");
    expect(p.displayName).toBe("Vercel prod");
    expect(Object.values(p.audiences ?? {})).toEqual(["https://vercel.com/acme"]);
  });

  it("converts JSON into stringEquals / stringLike records keyed by generated IDs", () => {
    const p = draftToPolicy(baseDraft());
    const equalsRecord = p.claimConditions.stringEquals?.environment ?? {};
    const likeRecord = p.claimConditions.stringLike?.sub ?? {};
    expect(Object.values(equalsRecord).filter((v): v is string => typeof v === "string").sort(stringCompare)).toEqual(["preview", "production"]);
    expect(Object.values(likeRecord)).toEqual(["owner:acme:project:*:environment:production"]);
  });

  it("drops claims with no values", () => {
    const draft: PolicyDraft = {
      ...baseDraft(),
      claimConditionsJson: JSON.stringify({ stringEquals: { environment: [] } }),
    };
    const p = draftToPolicy(draft);
    expect(p.claimConditions.stringEquals).toEqual({});
  });

  it("treats blank JSON as no conditions", () => {
    const draft: PolicyDraft = { ...baseDraft(), claimConditionsJson: "" };
    const p = draftToPolicy(draft);
    expect(p.claimConditions.stringEquals).toEqual({});
    expect(p.claimConditions.stringLike).toEqual({});
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
      claimConditionsJson: JSON.stringify({
        stringLike: { sub: ["repo:acme/*:environment:production"] },
      }),
      tokenTtlSeconds: 600,
    };
    const policy = draftToPolicy(original);
    const back = policyToDraft("pol-1", policy);
    expect(back.displayName).toBe(original.displayName);
    expect(back.issuerUrl).toBe(original.issuerUrl);
    expect(back.audiences.map(a => a.value)).toEqual(["https://github.com/acme"]);
    const parsedBack = parseClaimConditionsJson(back.claimConditionsJson);
    expect(parsedBack.kind).toBe("ok");
    if (parsedBack.kind === "ok") {
      expect(parsedBack.parsed.stringLike).toEqual({ sub: ["repo:acme/*:environment:production"] });
    }
    expect(back.tokenTtlSeconds).toBe(600);
  });

  it("seeds at least one audience row when the policy has none", () => {
    const policyWithoutAudiences = draftToPolicy({ ...emptyDraft(), displayName: "x", issuerUrl: "https://x" });
    const d = policyToDraft("pol-x", { ...policyWithoutAudiences, audiences: {} });
    expect(d.audiences.length).toBe(1);
  });
});

describe("claimConditionsToJson", () => {
  it("flattens internal id-keyed records into plain value arrays", () => {
    const json = claimConditionsToJson({
      displayName: "x",
      enabled: true,
      issuerUrl: "https://x",
      audiences: {},
      claimConditions: {
        stringEquals: { environment: { id1: "production", id2: "preview" } },
        stringLike: { sub: { id3: "repo:acme/*" } },
      },
      tokenTtlSeconds: 900,
    });
    expect(JSON.parse(json)).toEqual({
      stringEquals: { environment: ["production", "preview"] },
      stringLike: { sub: ["repo:acme/*"] },
    });
  });
});

describe("parseClaimConditionsJson", () => {
  it("returns error on invalid JSON", () => {
    const r = parseClaimConditionsJson("{not json");
    expect(r.kind).toBe("error");
  });
  it("returns error when top-level is not an object", () => {
    const r = parseClaimConditionsJson("[]");
    expect(r.kind).toBe("error");
  });
  it("returns error when section values are not string arrays", () => {
    const r = parseClaimConditionsJson(JSON.stringify({ stringEquals: { sub: "not-an-array" } }));
    expect(r.kind).toBe("error");
  });
  it("accepts an empty object", () => {
    const r = parseClaimConditionsJson("{}");
    expect(r).toEqual({ kind: "ok", parsed: { stringEquals: {}, stringLike: {} } });
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
    const d = { ...emptyDraft(), tokenTtlSeconds: 10_000, claimConditionsJson: "{not json" };
    const kinds = validateDraft(d).map(i => i.kind);
    expect(kinds).toContain("missing-display-name");
    expect(kinds).toContain("missing-issuer");
    expect(kinds).toContain("missing-audiences");
    expect(kinds).toContain("invalid-ttl");
    expect(kinds).toContain("invalid-claim-conditions-json");
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
