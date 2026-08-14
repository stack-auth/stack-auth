import { describe, expect, it } from "vitest";
import type { AdPlatformAccount } from "@/lib/ad-platforms/ad-platform-types";
import { categoriesAckMatches, parseAdCampaignPayload, pickDefaultAccount } from "./ads-panel";

function account(overrides: Partial<AdPlatformAccount> = {}): AdPlatformAccount {
  return {
    id: "act_1",
    name: "Acme",
    currency: "USD",
    timezone: "America/New_York",
    status: "active",
    isActive: true,
    hasFundingSource: true,
    businessId: null,
    ...overrides,
  };
}

describe("pickDefaultAccount", () => {
  it("returns null when there are no accounts", () => {
    expect(pickDefaultAccount([])).toBeNull();
  });

  it("picks the first active, funded account over an earlier inactive one", () => {
    const inactive = account({ id: "act_1", isActive: false });
    const funded = account({ id: "act_2", isActive: true, hasFundingSource: true });
    expect(pickDefaultAccount([inactive, funded])).toEqual(funded);
  });

  it("skips an active account with no funding source in favor of a funded one", () => {
    const noFunding = account({ id: "act_1", isActive: true, hasFundingSource: false });
    const funded = account({ id: "act_2", isActive: true, hasFundingSource: true });
    expect(pickDefaultAccount([noFunding, funded])).toEqual(funded);
  });

  it("falls back to the first account when none are both active and funded", () => {
    const first = account({ id: "act_1", isActive: false, hasFundingSource: false });
    const second = account({ id: "act_2", isActive: false, hasFundingSource: true });
    expect(pickDefaultAccount([first, second])).toEqual(first);
  });
});

describe("categoriesAckMatches", () => {
  it("matches an empty spec against an empty ack (the common case)", () => {
    expect(categoriesAckMatches([], [])).toBe(true);
  });

  it("does not match an empty spec against a non-empty ack", () => {
    expect(categoriesAckMatches([], ["HOUSING"])).toBe(false);
  });

  it("matches regardless of declaration order", () => {
    expect(categoriesAckMatches(["CREDIT", "HOUSING"], ["HOUSING", "CREDIT"])).toBe(true);
  });

  it("rejects a superset — an ack must not add categories the spec didn't declare", () => {
    expect(categoriesAckMatches(["HOUSING"], ["HOUSING", "CREDIT"])).toBe(false);
  });

  it("rejects a subset — an ack must not drop categories the spec declared", () => {
    expect(categoriesAckMatches(["HOUSING", "CREDIT"], ["HOUSING"])).toBe(false);
  });
});

describe("parseAdCampaignPayload", () => {
  const validSpec = {
    spec_version: 1,
    platform: "meta",
    account_id: "act_1",
    objective: "OUTCOME_TRAFFIC",
    special_ad_categories: [],
    budget: { mode: "daily", amount_minor: 2000, currency: "USD" },
    schedule: { start_at_millis: null, end_at_millis: null },
    targeting: {
      geo: { countries: ["US"], regions: [], cities: [] },
      age_min: null, age_max: null, genders: null, locales: null, interests: [], advantage_audience: true,
    },
    placements: { mode: "automatic" },
    delivery: { optimization_goal: "LINK_CLICKS", billing_event: "LINK_CLICKS", bid_strategy: "LOWEST_COST_WITHOUT_CAP", bid_amount_minor: null },
    creative: {
      kind: "link_ad", page_id: "p1", instagram_actor_id: null,
      primary_text: "hi", headline: "hi", description: null,
      link_url: "https://example.com", display_link: null, call_to_action: "LEARN_MORE",
      image: { source: "generated", asset_id: "a1", prompt: "p", brand_kit_ref: null },
    },
    naming: { campaign_name: "c", ad_set_name: "a", ad_name: "ad" },
  };

  it("parses a valid payload", () => {
    const result = parseAdCampaignPayload({ ad_campaign: validSpec });
    expect(result).not.toBeNull();
    expect(result?.account_id).toBe("act_1");
  });

  it("degrades to null (not a throw) for a missing ad_campaign key", () => {
    expect(parseAdCampaignPayload({})).toBeNull();
  });

  it("degrades to null for a null payload", () => {
    expect(parseAdCampaignPayload(null)).toBeNull();
  });

  it("degrades to null for a malformed ad_campaign", () => {
    expect(parseAdCampaignPayload({ ad_campaign: { ...validSpec, budget: "not-an-object" } })).toBeNull();
  });
});
