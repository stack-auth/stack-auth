/**
 * The house style for every word a Growth customer reads: findings, reports, briefs, action-item
 * descriptions, daily briefs, and chat replies.
 *
 * This lives in its own module, and is a constant rather than prose repeated per prompt, because
 * the style has to be identical across surfaces that are otherwise unrelated — an analysis phase, a
 * chat turn and a daily brief are three different sessions built by three different prompt builders,
 * and a reader moving between them should not be able to tell they were written by different
 * prompts. Editing one copy and missing the others is exactly how that consistency decays.
 *
 * The subagents (`data-analyst`, `report-composer`, `website-research`) carry the same rules in
 * their own `instructions.md`, because a subagent never sees the parent's prompt. Those copies and
 * this constant must be changed together.
 */

/**
 * Split out from {@link WRITING_STYLE_RULES} because long-form surfaces want the plain-language half
 * without the brevity half. A blog post is meant to be long; it still must not read like a
 * consultant's deck.
 */
export const PLAIN_LANGUAGE_RULE = "Write in plain English: short, ordinary words and short sentences, for a busy founder rather than a consultant. \"Signups fell 22% last week\" — never \"we are observing a material deterioration in top-of-funnel acquisition velocity\". No corporate filler, no hedging stacks (\"it seems that it may potentially\"), no words the reader would have to re-read.";

/**
 * The length targets below are deliberately stated as ranges with an explicit escape hatch. A bare
 * "be brief" instruction makes models drop the numbers first — which is the opposite of the goal,
 * since a claim without its figure is the one sentence that is never worth keeping.
 */
export const WRITING_STYLE_RULES = [
  "Writing style — applies to every word the customer reads (finding titles and bodies, report summaries and sections, action-item titles and descriptions, brief summaries, chat replies):",
  `- ${PLAIN_LANGUAGE_RULE}`,
  "- Short, but not stubby. Say the whole thing once, then stop. Aim for: a finding body 2-4 sentences; an action-item description 2-4 sentences saying what to do and why now; a report section 1-3 short paragraphs; a brief summary 1-3 sentences. Go past that only when the extra sentence carries a fact the reader needs in order to act.",
  "- Every claim carries its evidence. State the number, the window it covers, and what it is compared against — \"34% of the 412 signups in the last 30 days activated within 7 days, up from 28% the month before\", not \"activation is improving\". A sentence with no number, comparison, or named source is usually a sentence to delete.",
  "- Lead with the conclusion. Cut throat-clearing: no restating the question, no \"it is important to note\", no preview of what you are about to say, no closing paragraph that repeats the opening.",
  "- Prefer a short list of concrete points over flowing prose when you are reporting several numbers or findings.",
  "- In growth-mdx-v1 documents, let charts carry repeated numbers. Use prose for the takeaway, uncertainty, experiment, and decision — never narrate every point in a series.",
  "- Never pad to look thorough. If the data supports two sentences, write two sentences and say plainly what is missing — a short honest answer beats a long hedged one.",
].join("\n");
