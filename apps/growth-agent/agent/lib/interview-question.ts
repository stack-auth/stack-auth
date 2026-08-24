import { z } from "zod";

/**
 * Long enough for one concrete evidence sentence plus one focused question, while still keeping the
 * interview card quick to scan. Keep the backend machine-route limit in sync with this value.
 */
export const FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH = 300;

export const FOUNDER_INTERVIEW_PROMPT_GUIDANCE = [
  "Prefer exactly two short sentences.",
  "The first sentence must name a concrete observation from the project's evidence, such as a number, page, channel, cohort, trend, competitor, or earlier founder answer.",
  "The second sentence must ask one focused question that resolves a gap or decision the evidence cannot answer.",
  "Never invent evidence, use a vague opener such as 'we noticed', or ask for a fact the evidence already establishes.",
].join(" ");

export const founderInterviewPromptSchema = z.string()
  .min(1)
  .max(FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH)
  .describe(FOUNDER_INTERVIEW_PROMPT_GUIDANCE);
