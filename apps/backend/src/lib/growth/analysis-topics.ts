import { StatusError } from "@hexclave/shared/dist/utils/errors";

export type GrowthAnalysisTopic = {
  id: string,
  title: string,
  /**
   * Two-to-three plain-language sentences on what this topic actually does, shown to the customer on
   * hover over the topic's row in the analysis checklist. Written from the reader's perspective ("your
   * landing page"), not the agent's — this is the only place in the product that explains what each
   * strategy is, and someone watching a 20-minute analysis should be able to tell why each step is there.
   *
   * Keep these honest about the OUTPUT, not just the intent: they set the expectation the report is then
   * judged against. If a topic's skill changes what it produces, this string changes with it.
   */
  description: string,
};

/**
 * Mirror of the analysis-topic registry that lives with the agent runtime (apps/growth-agent). The backend
 * needs the ids, titles and descriptions: ids validate incoming `analysis:<id>` phase writes, and titles and
 * descriptions render in phase checklists (the agent side owns the skill that does the work, and has no use
 * for the customer-facing copy). Adding an analysis topic is one entry here plus the skill + registry entry on
 * the agent side.
 */
export const GROWTH_ANALYSIS_TOPICS = new Map<string, GrowthAnalysisTopic>([
  ["first-screen-audit", {
    id: "first-screen-audit",
    title: "First-screen audit",
    description: "Audits the first screen of your landing page — headline, subheadline and main call to action — against who actually signs up and sticks around. It proposes exact replacement copy rather than vague directions, with the evidence behind each change.",
  }],
  ["seo-aeo-strategy", {
    id: "seo-aeo-strategy",
    title: "SEO & AEO strategy",
    description: "Works out which search intents you can realistically win, in classic search and in answer engines like AI assistants. Produces a prioritized content plan plus one ready-to-approve blog idea — the draft itself is written later, only if you pick it.",
  }],
  ["traffic-quality", {
    id: "traffic-quality",
    title: "Traffic quality",
    description: "Ranks your acquisition sources by the quality of the users they deliver rather than raw volume, comparing activation and return rates source by source. The output is a concrete list of where to double down, what to fix and what to cut.",
  }],
  ["icp-visitor-outreach", {
    id: "icp-visitor-outreach",
    title: "ICP visitor outreach",
    description: "Finds the users who look like your ideal customer but never activated or went quiet, and sizes each stalled segment. It drafts the re-engagement emails for each one, written for the point where those users actually stopped.",
  }],
]);

export function assertGrowthAnalysisTopicId(topicId: string): void {
  if (!GROWTH_ANALYSIS_TOPICS.has(topicId)) {
    throw new StatusError(400, `Unknown growth analysis topic id: ${topicId}`);
  }
}
