import type { AgentModelOptionsDefinition, AgentReasoningDefinition } from "eve";

/**
 * The single source of truth for how every growth agent reaches its model — the root agent AND the
 * declared subagents. Covers both the model id and the gateway provider routing, because the two
 * only make sense together: a provider order is a list of slugs that serve one specific model.
 *
 * WHY THIS FILE EXISTS: eve subagents inherit NOTHING from the root agent (each
 * `agent/subagents/<id>/` directory is its own agent root), so before this the model was written
 * out in four places and the `HEXCLAVE_GROWTH_MODEL` env override only reached the root. That meant
 * "switch the growth agent's model" was a code change in three files that were easy to miss — the
 * subagents silently stayed on their hardcoded model while the root moved. Now all four spread
 * `getGrowthModelConfig()`, which is the ONLY export: there is deliberately no way to get the model
 * id without also getting its routing, so the same drift can't come back through a second accessor.
 *
 * Read per call, never cached at module scope, so a deployment can change the model or the provider
 * order without a rebuild — and so tests can vary them.
 */

/**
 * Fallback when `HEXCLAVE_GROWTH_MODEL` is unset. Gateway model ids are plain strings (eve's default
 * routing is the Vercel AI Gateway using the Vercel project's own identity — no API key to manage;
 * see the 2026-08-04 decision recorded in agent/agent.ts).
 */
const DEFAULT_GROWTH_MODEL = "zai/glm-5.2";

/**
 * Gateway provider slugs, in attempt order, for `DEFAULT_GROWTH_MODEL`.
 *
 * WHY THIS EXISTS: glm-5.2 is served by several providers at wildly different speeds, and until now
 * we let the gateway pick. A measured 50-request run on 2026-08-08 landed almost entirely on
 * `alibaba` and came back at ~59 tok/s steady-state (a linear fit of duration against generated
 * tokens gives `duration ~= 2.5s + tokens/58.9`, R^2=0.997). That is what made a full deep analysis
 * take 27 minutes, and what pushed the latency-sensitive interview turn past the backend's 120s
 * budget into a 502 -- the model was never the problem, the provider was. Wafer serves the same
 * model at ~466 tps with ~2.6s latency, so preferring it is roughly an 8x throughput change for a
 * small price *drop* ($1.26/$3.96 per M vs Z.AI's $1.40/$4.40).
 *
 * These are gateway PROVIDER slugs, not model ids, and they are case-sensitive. The gateway
 * silently ignores a slug it does not recognise -- a typo here degrades routing with no error
 * anywhere -- so they were read off the gateway's own catalog for this model rather than guessed.
 *
 * `order` is a PREFERENCE, not a restriction (that would be `only`), so providers beyond these two
 * still serve as fallback -- the gateway just tries these first, fastest known first.
 */
const DEFAULT_GROWTH_PROVIDER_ORDER = ["wafer", "zai"] as const;

/**
 * Overrides `DEFAULT_GROWTH_PROVIDER_ORDER` with a comma-separated slug list. Exists for the same
 * reason `HEXCLAVE_GROWTH_MODEL` does: when a provider degrades, routing around it should be an env
 * change, not a deploy. Unset or empty keeps the default; set-but-all-blank (e.g. `",,"`) throws
 * rather than quietly falling back, since a routing var that silently does nothing is exactly the
 * failure this whole file is trying to prevent.
 */
function resolveProviderOrder(): readonly string[] {
  const override = process.env.HEXCLAVE_GROWTH_PROVIDER_ORDER;
  if (override == null || override.length === 0) return DEFAULT_GROWTH_PROVIDER_ORDER;

  const slugs = override.split(",").map(slug => slug.trim()).filter(slug => slug.length > 0);
  if (slugs.length === 0) {
    throw new Error(
      `HEXCLAVE_GROWTH_PROVIDER_ORDER is set to ${JSON.stringify(override)}, which contains no provider slugs. Unset it to use the default order (${DEFAULT_GROWTH_PROVIDER_ORDER.join(", ")}), or give it a comma-separated list of gateway provider slugs.`,
    );
  }
  return slugs;
}

function resolveModel(): string {
  const override = process.env.HEXCLAVE_GROWTH_MODEL;
  return override != null && override.length > 0 ? override : DEFAULT_GROWTH_MODEL;
}

/**
 * Reasoning effort for every growth model call. `"none"` turns reasoning OFF entirely.
 *
 * WHY OFF: reasoning is not a rounding error in this workload, it is the majority of it. Measured
 * over a full analysis run on 2026-08-10 (69 gateway requests, all served by Wafer): 58,205
 * reasoning tokens against 35,421 output tokens — 62% of everything generated. One single call
 * spent 242 seconds producing 17,875 reasoning tokens to emit 1,087 tokens of actual output.
 *
 * That matters because generation speed turned out to be a dead end. The same run measured
 * `duration ~= 1.48s + tokens/79.8` (R^2=0.983) on Wafer, versus `2.5s + tokens/58.9` on alibaba —
 * i.e. the provider switch bought ~1.35x, NOT the ~8x the gateway catalog's headline 466 tps
 * implied. With routing exhausted, cutting the token COUNT is the only lever left with real
 * leverage.
 *
 * THIS SETTING ALONE DOES NOT WORK ON glm-5.2 — see GROWTH_THINKING_PROVIDER_OPTIONS below, which
 * is the part that actually disables reasoning. It is kept anyway because it is the portable,
 * provider-agnostic expression of intent: if HEXCLAVE_GROWTH_MODEL is pointed at an OpenAI,
 * Anthropic, Google, or Bedrock model, this is the field that takes effect there.
 *
 * This is a SPEED-FOR-DEPTH trade, not a free win, and glm-5.2 offers no middle setting to soften
 * it: its gateway catalog advertises a reasoning toggle plus effort values of only `high`/`xhigh`,
 * so the realistic choices are "off" or "expensive". Off is the current default because the run
 * time was the product problem. If report quality regresses, flip this back via the env var below
 * and compare against the 2026-08-10 baseline rather than guessing.
 */
const DEFAULT_GROWTH_REASONING: AgentReasoningDefinition = "none";

/**
 * Overrides `DEFAULT_GROWTH_REASONING`, for the same reason the model and provider order are
 * overridable: the speed/depth trade above should be re-testable on a live deployment without a
 * code change. Values are the AI SDK's effort levels; an unrecognised one throws rather than
 * silently falling back, because a reasoning setting that quietly does nothing is precisely the
 * failure this would be introduced to investigate.
 */
const GROWTH_REASONING_LEVELS: readonly AgentReasoningDefinition[] = ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"];

function resolveReasoning(): AgentReasoningDefinition {
  const override = process.env.HEXCLAVE_GROWTH_REASONING;
  if (override == null || override.length === 0) return DEFAULT_GROWTH_REASONING;

  const match = GROWTH_REASONING_LEVELS.find((level) => level === override);
  if (match == null) {
    throw new Error(
      `HEXCLAVE_GROWTH_REASONING is set to ${JSON.stringify(override)}, which is not a reasoning level. Unset it to use the default (${DEFAULT_GROWTH_REASONING}), or set it to one of: ${GROWTH_REASONING_LEVELS.join(", ")}.`,
    );
  }
  return match;
}

/**
 * Z.AI's NATIVE thinking switch, which is what actually turns glm-5.2's reasoning off.
 *
 * WHY THE GENERIC `reasoning` FIELD IS NOT ENOUGH: the AI SDK's provider-agnostic effort level is
 * translated to each provider's native API by the gateway, and the gateway's translation table
 * covers OpenAI, Anthropic, Google/Vertex and Bedrock only. Z.AI is not in it, so `reasoning:
 * "none"` is accepted and then silently dropped. We measured exactly that: across a 150-request run
 * on 2026-08-11 with `reasoning: "none"` already set, reasoning was still 64.0% of generated tokens
 * (221,215 of 345,871) — statistically indistinguishable from the 62.2% baseline before the flag
 * existed. An earlier 50-request run read 36.7% and briefly looked like a partial win; it was
 * sample noise.
 *
 * Z.AI's own API takes `thinking: { type: "enabled" | "disabled" }`, and glm-5.2 supports the
 * toggle (the gateway catalog lists `reasoning_options: [{type:"toggle"}, {type:"effort", values:
 * ["high","xhigh"]}]` — note there is no "low", which is why there is no cheap middle ground).
 * Vercel's docs are explicit that a reasoning-related entry in `providerOptions` "takes full
 * precedence" over the top-level `reasoning` value, so this is the setting that wins.
 *
 * Keyed under BOTH `zai` and `wafer` deliberately. The model id's namespace is `zai`, but the
 * request is routed to the `wafer` provider, and the gateway's documentation is ambiguous about
 * which of the two names it matches provider options against (its own examples use the model
 * namespace in one place and the serving provider in another). Unknown keys are ignored, so
 * covering both is free and removes the guess.
 */
const GROWTH_THINKING_PROVIDER_OPTIONS = {
  zai: { thinking: { type: "disabled" } },
  wafer: { thinking: { type: "disabled" } },
} as const;

/**
 * The full model handle to spread into `defineAgent`. Spread rather than destructured at each call
 * site so that anything added here later (reasoning effort, context window) reaches all four agents
 * without four more edits.
 */
export function getGrowthModelConfig(): { model: string, modelOptions: AgentModelOptionsDefinition, reasoning: AgentReasoningDefinition } {
  return {
    model: resolveModel(),
    reasoning: resolveReasoning(),
    modelOptions: {
      providerOptions: {
        // Spread first so the gateway block below cannot be shadowed by a future key collision.
        ...GROWTH_THINKING_PROVIDER_OPTIONS,
        gateway: {
          order: [...resolveProviderOrder()],
          // NO `disallowPromptTraining` / `zeroDataRetention` FILTER HERE, and that is a measured
          // decision rather than an oversight -- please read before adding one back.
          //
          // Both read like free safety wins. They are not: they are FILTERS over the eligible
          // provider set, and glm-5.2's providers differ ~8x in speed, so narrowing the set moves
          // which one serves you. We ran `disallowPromptTraining: true` for one full analysis run on
          // 2026-08-10 and measured the result from eve's own step telemetry (`eve logs --events`,
          // 92 model calls): 65 tok/s aggregate, median 60, max 130, unimodal. That is `alibaba`'s
          // ~59 tok/s, not Wafer's ~466 -- i.e. the filter silently excluded Wafer despite the
          // gateway catalog flagging it as compliant, and cost roughly 7x throughput to do it.
          //
          // So: trust a measured run over the catalog's compliance flags. If a privacy filter is
          // ever required, add it AND re-measure tok/s, and expect to trade most of the speed for
          // it. The provider-independent control that does not cost throughput is the PII gate on
          // the sql-query route (backend lib/growth/sql-privacy.ts), which keeps end-user personal
          // data out of prompts no matter who serves them.
        },
      },
    },
  };
}
