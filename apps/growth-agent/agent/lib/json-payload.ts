import { z } from "zod";

/**
 * Schemas for the open-ended JSON bags our tools hand to the backend (`data`, `metadata`, and the
 * `ad_campaign` slice of an action item payload).
 *
 * WHY THIS EXISTS — these were all `z.json()`, which is the natural way to say "any JSON value" and
 * which broke tool calling outright on some providers. `z.json()` is *recursive* by definition (a
 * JSON value may be an array of JSON values), so Zod emits it as a self-referencing `$def`:
 *
 *     $defs.__schema0.anyOf[4] = { type: "array", items: { $ref: "#/$defs/__schema0" } }
 *                                                          ^^^^ points back at itself
 *
 * Recursive `$ref` is legal JSON Schema, but providers disagree about whether they will accept one
 * in a tool definition: Z.AI does, Wafer rejects the whole request in ~0.3s with
 * `400 ... contains recursive JSON Schema references`. That is a schema pre-validation failure, not
 * an inference failure — and since the tool list is identical on every request, it is deterministic.
 * With provider fallback configured it did not look like a bug at all; it looked like a working
 * system that had merely settled on the slower provider.
 *
 * THE FIX — the 400 is only ever about the JSON Schema we *emit*. It says nothing about how
 * permissive the runtime validator may be, and the two do not have to move together. So instead of
 * spelling out a finite depth (which shrinks what we accept AND inflates the schema), we keep the
 * value type opaque: `z.unknown()` emits `additionalProperties: {}` — "any value", no `$ref`, no
 * depth limit, and a schema SMALLER than the recursive one it replaces (174 bytes vs 388 for a
 * single field). Arbitrary nesting still parses at runtime, exactly as `z.json()` did.
 *
 * The one thing deliberately given up versus `z.json()` is a bare top-level primitive; see below.
 */

/**
 * A JSON object (never a bare primitive or array) with arbitrary keys and arbitrary values.
 *
 * Object-at-the-top is the only real tightening versus `z.json()`, and it is a CHOICE, not something
 * a reader forces. Worth being precise about, because the two uses differ:
 *   - `payload` — every reader (`extractGrowthBlogIdea`, `parseAdCampaignPayload`, the dashboard's
 *     `codingAgentPromptSchema`) begins by requiring a record and discards anything else, so a bare
 *     primitive there was never usable data; it just failed silently one layer later.
 *   - `data` / `metadata` — pure pass-through. The backend stores them as opaque JSON and surfaces
 *     them untouched (see `overview.ts`); nothing narrows them. A bare `data: 42` therefore used to
 *     round-trip fine and is now rejected at the tool boundary.
 *
 * We take that tightening on purpose: every tool asking for one of these bags asks for keyed values
 * ("the machine-readable key numbers you cited"), so an unkeyed scalar was never the intent, and a
 * loud rejection the model can correct beats a number stored under no name. If a legitimate use for
 * a top-level array turns up, widen this to a union with `z.array(z.unknown())` — that stays
 * recursion-free — rather than going back to `z.json()`.
 *
 * Values are `unknown` rather than a spelled-out shape because these bags genuinely are open-ended
 * ("the machine-readable key numbers you cited"). Where a payload's shape IS known, type it — see
 * `actionItemPayloadSchema` below.
 */
export const jsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * An action item's `payload`, as the AGENT is allowed to write it.
 *
 * Typed rather than left as an open bag because every key here already has a reader with a fixed
 * shape, so the shape was known information we were throwing away — and because a model that
 * misspells `coding_agent_prompt` currently produces an action item that looks fine in the API and
 * silently renders no prompt panel. Declaring the keys turns that into a tool-call validation error
 * the model can see and correct on the spot.
 *
 * Deliberately NOT a discriminated union on `type_id`: `coding_agent_prompt` renders for *any*
 * action type (a blog, an ad, or a custom item can each need a code change), so the keys are
 * independent options rather than per-type alternatives.
 *
 * `draft_markdown` is intentionally absent — the backend writes it back into this same payload after
 * the customer asks for a draft. It is not the agent's to set, and leaving it out of the tool schema
 * is what says so.
 *
 * Readers, for anyone changing this:
 *   - `coding_agent_prompt` → dashboard `CodingAgentPromptSection` (any type)
 *   - `blog_idea`           → backend `extractGrowthBlogIdea` + dashboard `blogIdeaPayloadSchema`
 *   - `ad_campaign`         → dashboard `parseAdCampaignPayload` (`run_ads` only)
 *
 * STRICT on purpose. Zod's default is to silently strip unknown keys, which would preserve the exact
 * failure this schema exists to remove: a model that writes `codeing_agent_prompt` would still get a
 * 200 and an action item that renders no prompt panel, just with the key dropped a layer earlier.
 * Rejecting instead turns a typo into a tool error the model sees and retries. The cost is that a
 * genuinely new payload key must be added here before the agent can write it — that is the intended
 * direction of the tradeoff, since the alternative is keys that reach the database and are read by
 * nobody.
 */
export const actionItemPayloadSchema = z.strictObject({
  /** Ready-to-paste prompt for the customer's own coding agent. Valid on any action type. */
  coding_agent_prompt: z.string().trim().min(1).optional(),
  /**
   * The idea a `publish_blog` item carries instead of a finished post; the customer generates the
   * draft on demand. Only `title` is required — this mirrors `extractGrowthBlogIdea`, which accepts
   * a title-only idea, because a run that couldn't ground the other fields should still be able to
   * propose the post rather than drop it.
   */
  blog_idea: z.strictObject({
    // `.trim()` before `.min(1)`: the readers test `value.trim().length > 0`, so a
    // whitespace-only title passes a naive `.min(1)` here and then makes the backend drop the
    // entire idea on read — an action item that exists but can never generate its post.
    title: z.string().trim().min(1),
    // `.nullish()`, not `.optional()`: both readers accept an explicit null here (the dashboard
    // schema uses `.nullish()`, and the backend runs every field through a `readOptionalString`
    // that treats null as absent). A model emitting `"aeo_angle": null` for a field it could not
    // ground is doing the right thing, and must not have its whole tool call rejected for it.
    target_intent: z.string().nullish(),
    aeo_angle: z.string().nullish(),
    outline_summary: z.string().nullish(),
  }).optional(),
  /**
   * A proposed ad campaign on a `run_ads` item. Left as an open object on purpose:
   * the backend's `validateRunAdsActionItemPayload` deliberately checks only "is it an object at
   * all" until the ad platform connector lands, and mirroring the dashboard's `AdCampaignSpec` here
   * would duplicate a spec that is still moving — the same four-places-to-update trap the `type_id`
   * comment in create-action-item.ts already warns about. Tighten this when the backend tightens.
   */
  ad_campaign: jsonObjectSchema.optional(),
});
