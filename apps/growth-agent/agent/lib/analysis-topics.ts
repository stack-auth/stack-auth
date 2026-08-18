/**
 * Registry of growth analysis topics this agent can execute as `analysis:<id>`
 * analysis phases. Must stay in sync with the backend's GROWTH_ANALYSIS_TOPICS map
 * (apps/backend/src/lib/growth/analysis-topics.ts), which validates the ids, and
 * with the skills under `agent/skills/<skillName>/SKILL.md`, which hold the
 * actual procedure. Adding an analysis topic is one entry in each place.
 */

export type GrowthAnalysisTopic = {
  readonly id: string,
  readonly title: string,
  /** Name of the skill under `agent/skills/` holding this analysis topic's procedure. */
  readonly skillName: string,
};

export const GROWTH_ANALYSIS_TOPICS = new Map<string, GrowthAnalysisTopic>([
  ["first-screen-audit", { id: "first-screen-audit", title: "First-screen audit", skillName: "first-screen-audit" }],
  ["seo-aeo-strategy", { id: "seo-aeo-strategy", title: "SEO & AEO strategy", skillName: "seo-aeo-strategy" }],
  ["traffic-quality", { id: "traffic-quality", title: "Traffic quality", skillName: "traffic-quality" }],
  ["icp-visitor-outreach", { id: "icp-visitor-outreach", title: "ICP visitor outreach", skillName: "icp-visitor-outreach" }],
]);
