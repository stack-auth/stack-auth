import { z } from "zod";

/**
 * Dashboard-side READ mirror of the frozen `AdCampaignSpec` (see the orchestrator's
 * meta-ads-frozen-contracts doc §1, canonically `apps/backend/src/lib/ad-platforms/campaign-spec.ts`).
 *
 * This is deliberately NOT a validator: the backend is the only place that decides whether a spec is
 * creatable (`validateAdCampaignSpecShape` et al.). This schema only needs to parse a stored
 * `payload.ad_campaign` well enough to render it, so every field a future spec version might add stays
 * open (`.passthrough()` is intentionally NOT used — an unrecognized shape should degrade to the "no
 * readable campaign" notice, matching the `blogPayloadSchema.safeParse` pattern the run_ads stub
 * already used) rather than throw and blank the whole action page. The dashboard cannot import backend
 * code, so this and the backend's hand-written validator must be kept in step by hand — see the frozen
 * contract's note on the growth-agent's own hand-mirrored copy for the same tradeoff.
 */

export const AD_CAMPAIGN_OBJECTIVES = ["OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"] as const;
export const AD_SPECIAL_AD_CATEGORIES = [
  "HOUSING", "CREDIT", "EMPLOYMENT", "ISSUES_ELECTIONS_POLITICS",
  "FINANCIAL_PRODUCTS_SERVICES", "ONLINE_GAMBLING_AND_GAMING",
] as const;

/** Human-readable labels for the attestation checklist — order matches AD_SPECIAL_AD_CATEGORIES. */
export const AD_SPECIAL_AD_CATEGORY_LABELS: Record<typeof AD_SPECIAL_AD_CATEGORIES[number], string> = {
  HOUSING: "Housing",
  CREDIT: "Credit",
  EMPLOYMENT: "Employment",
  ISSUES_ELECTIONS_POLITICS: "Social issues, elections, or politics",
  FINANCIAL_PRODUCTS_SERVICES: "Financial products or services",
  ONLINE_GAMBLING_AND_GAMING: "Online gambling and gaming",
};

const adImageSpecSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("generated"), asset_id: z.string(), prompt: z.string(), brand_kit_ref: z.string().nullable() }),
  z.object({ source: z.literal("unbound"), candidate_urls: z.array(z.string()), rationale: z.string() }),
  z.object({ source: z.literal("ad_account_image_hash"), hash: z.string() }),
  z.object({ source: z.literal("url"), url: z.string() }),
]);
export type AdCampaignImageSpec = z.infer<typeof adImageSpecSchema>;

const adCreativeSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("link_ad"),
    page_id: z.string(),
    instagram_actor_id: z.string().nullable(),
    primary_text: z.string(),
    headline: z.string(),
    description: z.string().nullable(),
    link_url: z.string(),
    display_link: z.string().nullable(),
    call_to_action: z.string(),
    image: adImageSpecSchema,
  }),
  z.object({
    kind: z.literal("existing_page_post"),
    page_id: z.string(),
    object_story_id: z.string(),
    call_to_action: z.string().nullable(),
  }),
]);
export type AdCampaignCreativeSpec = z.infer<typeof adCreativeSpecSchema>;

export const adCampaignSpecSchema = z.object({
  spec_version: z.literal(1),
  platform: z.literal("meta"),
  account_id: z.string(),
  objective: z.enum(AD_CAMPAIGN_OBJECTIVES),
  special_ad_categories: z.array(z.enum(AD_SPECIAL_AD_CATEGORIES)),
  budget: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("daily"), amount_minor: z.number(), currency: z.string() }),
    z.object({ mode: z.literal("lifetime"), amount_minor: z.number(), currency: z.string() }),
  ]),
  schedule: z.object({ start_at_millis: z.number().nullable(), end_at_millis: z.number().nullable() }),
  targeting: z.object({
    geo: z.object({
      countries: z.array(z.string()),
      regions: z.array(z.object({ key: z.string() })),
      cities: z.array(z.object({ key: z.string(), radius_miles: z.number() })),
    }),
    age_min: z.number().nullable(),
    age_max: z.number().nullable(),
    genders: z.array(z.enum(["male", "female"])).nullable(),
    locales: z.array(z.number()).nullable(),
    interests: z.array(z.object({ id: z.string(), name: z.string() })),
    advantage_audience: z.boolean(),
  }),
  placements: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("automatic") }),
    z.object({
      mode: z.literal("manual"),
      publisher_platforms: z.array(z.string()),
      facebook_positions: z.array(z.string()),
      instagram_positions: z.array(z.string()),
    }),
  ]),
  delivery: z.object({
    optimization_goal: z.string(),
    billing_event: z.string(),
    bid_strategy: z.enum(["LOWEST_COST_WITHOUT_CAP", "COST_CAP"]),
    bid_amount_minor: z.number().nullable(),
  }),
  creative: adCreativeSpecSchema,
  naming: z.object({ campaign_name: z.string(), ad_set_name: z.string(), ad_name: z.string() }),
});

export type AdCampaignSpec = z.infer<typeof adCampaignSpecSchema>;

/** The placeholder the agent emits for `account_id` when it proposes while Meta is disconnected. */
export const AD_ACCOUNT_PLACEHOLDER_ID = "act_0";

/** A short, readable summary of an objective for card/dialog headers. */
export const AD_OBJECTIVE_LABELS: Record<typeof AD_CAMPAIGN_OBJECTIVES[number], string> = {
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_ENGAGEMENT: "Engagement",
};

/** Meta's approximate display truncation points, used by the ad preview's character counters. */
export const AD_PREVIEW_LIMITS = {
  primaryText: 125,
  headline: 40,
  description: 30,
} as const;

export function summarizeAdTargeting(targeting: AdCampaignSpec["targeting"]): string {
  const parts: string[] = [];
  if (targeting.geo.countries.length > 0) parts.push(targeting.geo.countries.join(", "));
  if (targeting.geo.regions.length > 0) parts.push(`${targeting.geo.regions.length} region${targeting.geo.regions.length === 1 ? "" : "s"}`);
  if (targeting.geo.cities.length > 0) parts.push(`${targeting.geo.cities.length} cit${targeting.geo.cities.length === 1 ? "y" : "ies"}`);
  const geo = parts.length === 0 ? "Everywhere" : parts.join(" · ");
  const age = targeting.age_min == null && targeting.age_max == null
    ? "All ages"
    : `Ages ${targeting.age_min ?? 18}-${targeting.age_max ?? 65}`;
  const genders = targeting.genders == null ? "All genders" : targeting.genders.join(" & ");
  return `${geo} · ${age} · ${genders}${targeting.advantage_audience ? " · Advantage+ audience" : ""}`;
}
