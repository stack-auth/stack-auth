import { z } from "zod";

export const growthCategorySchema = z.enum([
  "product",
  "reach",
  "conversion",
  "retention",
  "revenue",
]).describe("Exactly one stage in the growth journey: product, reach, conversion, retention, or revenue.");

/**
 * Tags are optional agent input, not a schema-level default. Some model providers reject or
 * mis-handle JSON Schema `default` keywords in tool definitions, so each tool applies the empty
 * array after validation instead. The backend remains the source of truth for normalization.
 */
export const growthTagsSchema = z.array(
  z.string().min(1).max(40),
).max(10).optional().describe("Optional JSON array of up to 10 short secondary tag strings. Omit it when no useful secondary tags apply; never send a single string.");

/**
 * Every category, exactly once, in one call — mirrored from the backend, which rejects a partial or
 * duplicated set. `length` rather than `min`/`max` so a model that scores six categories gets a
 * schema error naming the count instead of a runtime 400 after the round trip.
 */
export const growthCategoryScoresSchema = z.array(z.object({
  category: growthCategorySchema,
  score: z.number().int().min(0).max(100).describe("0-100, where 0 means this area is completely unaddressed and 100 means it is genuinely excellent. Score relative to what this product realistically needs at its stage, not against an enterprise ideal."),
})).length(5).describe("Exactly one score for each of the 5 growth stages: product, reach, conversion, retention, revenue. Partial sets are rejected because the customer's growth journey needs every stage scored.");
