import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GROWTH_CATEGORIES = [
  "product",
  "reach",
  "conversion",
  "retention",
  "revenue",
] as const;

export type GrowthCategory = typeof GROWTH_CATEGORIES[number];

export const LEGACY_GROWTH_CATEGORIES = ["acquisition", "activation", "engagement", "content", "ads"] as const;

const LEGACY_GROWTH_CATEGORY_MAP = new Map<string, GrowthCategory>([
  ["engagement", "product"],
  ["acquisition", "reach"],
  ["content", "reach"],
  ["ads", "reach"],
  ["activation", "conversion"],
]);

export function isGrowthCategory(value: string): value is GrowthCategory {
  return GROWTH_CATEGORIES.some((category) => category === value);
}

/** Maps the previous seven-part taxonomy into the five-stage growth journey on reads. */
export function normalizeStoredGrowthCategory(value: string): GrowthCategory | null {
  return isGrowthCategory(value) ? value : LEGACY_GROWTH_CATEGORY_MAP.get(value) ?? null;
}

/**
 * A note is a GrowthFinding whose `kind` is exactly this. It is deliberately a KIND and not a
 * SOURCE: notes started out as admin-only rows (`source: "admin"`) and the overview read model used
 * to split the findings/notes lanes on `source === "admin" && kind === "note"`, but the analysis
 * phases now write notes too, and pinning them to the admin source would have made the agent's notes
 * indistinguishable from a human's. Keeping the source truthful (the phase key that observed the
 * trend) and splitting the lane on the kind preserves both the lane and the provenance.
 *
 * Lives in this taxonomy module rather than next to its writer so that getGrowthOverviewBody can
 * read it without importing agent-writes.ts and its whole import graph.
 */
export const GROWTH_NOTE_KIND = "note";

export const GROWTH_CATEGORY_SCORE_MIN = 0;
export const GROWTH_CATEGORY_SCORE_MAX = 100;

/**
 * Category scores have two writers now — the internal admin editor and the report phase's
 * `save-category-scores` agent tool — so the range lives here rather than being spelled out at each
 * write site. Both writers land in the same `GrowthCategoryScore` rows and the growth journey reads them
 * without knowing who wrote them, so a range that drifted between the two would silently produce
 * out-of-range points on the chart.
 */
export function assertGrowthCategoryScore(score: number): number {
  if (!Number.isInteger(score) || score < GROWTH_CATEGORY_SCORE_MIN || score > GROWTH_CATEGORY_SCORE_MAX) {
    throw new StatusError(400, `score must be an integer from ${GROWTH_CATEGORY_SCORE_MIN} to ${GROWTH_CATEGORY_SCORE_MAX}`);
  }
  return score;
}

const GROWTH_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GROWTH_TAG_MAX_COUNT = 10;
export const GROWTH_TAG_MAX_LENGTH = 40;

export function assertGrowthCategory(value: string): GrowthCategory {
  if (!isGrowthCategory(value)) {
    throw new StatusError(400, `Unknown growth category: ${value}`);
  }
  return value;
}

/**
 * Tags are display and filtering metadata, but letting every writer invent spelling/casing variants
 * would make the filter useless within days. Normalize once at the write boundary and preserve the
 * caller's order while removing duplicates.
 */
export function normalizeGrowthTags(values: readonly string[]): string[] {
  if (values.length > GROWTH_TAG_MAX_COUNT) {
    throw new StatusError(400, `Growth items can have at most ${GROWTH_TAG_MAX_COUNT} tags.`);
  }
  const normalized: string[] = [];
  for (const value of values) {
    const tag = value.trim().toLowerCase().replaceAll(/\s+/g, "-");
    if (tag.length === 0 || tag.length > GROWTH_TAG_MAX_LENGTH || !GROWTH_TAG_PATTERN.test(tag)) {
      throw new StatusError(400, `Invalid growth tag "${value}". Use a ${GROWTH_TAG_MAX_LENGTH}-character-or-shorter kebab-case slug.`);
    }
    if (!normalized.includes(tag)) normalized.push(tag);
  }
  return normalized;
}
