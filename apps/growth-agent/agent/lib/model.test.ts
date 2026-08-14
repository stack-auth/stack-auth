import { afterEach, describe, expect, it, vi } from "vitest";
import { getGrowthModelConfig } from "./model.ts";

describe("getGrowthModelConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes to the Vercel AI Gateway glm-5.2 by default", () => {
    vi.stubEnv("HEXCLAVE_GROWTH_MODEL", "");
    expect(getGrowthModelConfig().model).toBe("zai/glm-5.2");
  });

  it("keeps the deployment override available for a manual fallback", () => {
    vi.stubEnv("HEXCLAVE_GROWTH_MODEL", "xai/grok-4.5");
    expect(getGrowthModelConfig().model).toBe("xai/grok-4.5");
  });

  it("turns reasoning off by default, because it was 62% of everything the model generated", () => {
    // Measured 2026-08-10 across a full run: 58,205 reasoning tokens vs 35,421 output tokens. This
    // is the single biggest lever left after provider routing was exhausted, so a silent revert to
    // provider-default would quietly undo the main speed fix.
    vi.stubEnv("HEXCLAVE_GROWTH_REASONING", "");
    expect(getGrowthModelConfig().reasoning).toBe("none");
  });

  it("lets a deployment re-test the speed/depth trade without a code change", () => {
    vi.stubEnv("HEXCLAVE_GROWTH_REASONING", "high");
    expect(getGrowthModelConfig().reasoning).toBe("high");
  });

  it("throws on an unrecognised reasoning level instead of silently ignoring it", () => {
    // A reasoning var that quietly does nothing would be worst-case: the operator would conclude
    // reasoning made no difference to quality, when in fact it was never applied.
    vi.stubEnv("HEXCLAVE_GROWTH_REASONING", "off");
    expect(() => getGrowthModelConfig()).toThrow(/is not a reasoning level/);
  });

  it("reaches every agent, since all four spread the whole config", () => {
    // The reasoning field is a SIBLING of modelOptions in eve's agent definition, so it only takes
    // effect because the call sites spread getGrowthModelConfig() rather than picking fields off it.
    vi.stubEnv("HEXCLAVE_GROWTH_REASONING", "");
    expect(Object.keys(getGrowthModelConfig()).sort()).toEqual(["model", "modelOptions", "reasoning"]);
  });

  it("sends Z.AI's native thinking switch, which is what actually disables glm-5.2's reasoning", () => {
    // The generic `reasoning` field is NOT sufficient: the gateway only translates effort levels for
    // OpenAI/Anthropic/Google/Bedrock, so for a zai model it is accepted and dropped. Measured with
    // `reasoning: "none"` already set (2026-08-11, 150 requests): reasoning was still 64.0% of
    // generated tokens, versus a 62.2% baseline before the flag existed. This provider-native option
    // is the one Vercel documents as taking "full precedence", so losing it silently restores a
    // ~3x slower run.
    vi.stubEnv("HEXCLAVE_GROWTH_PROVIDER_ORDER", "");
    const providerOptions = getGrowthModelConfig().modelOptions.providerOptions;
    expect(providerOptions?.zai).toEqual({ thinking: { type: "disabled" } });
    // Keyed under the serving provider too: the model namespace is `zai` but requests route to
    // `wafer`, and the gateway docs are ambiguous about which name provider options match on.
    expect(providerOptions?.wafer).toEqual({ thinking: { type: "disabled" } });
  });

  it("keeps the gateway routing block intact alongside the thinking options", () => {
    // The thinking options are spread into the same providerOptions object as `gateway`, so a
    // careless edit could shadow the provider order. Both must survive together.
    vi.stubEnv("HEXCLAVE_GROWTH_PROVIDER_ORDER", "alibaba,zai");
    const providerOptions = getGrowthModelConfig().modelOptions.providerOptions;
    expect(providerOptions?.gateway).toEqual({ order: ["alibaba", "zai"] });
    expect(providerOptions?.zai).toEqual({ thinking: { type: "disabled" } });
  });

  it("prefers the fastest glm-5.2 providers, in order", () => {
    // Measured 2026-08-08: unpinned routing landed on `alibaba` at ~59 tok/s steady-state. Wafer
    // serves the same model at ~90 tok/s (measured 2026-08-11 over 150 requests, fit R^2=0.963) —
    // about 1.5x, NOT the ~8x the gateway catalog's headline 466 tps implied, which is why routing
    // alone never got the run under target. The ORDER is still the point of the test: asserting
    // membership would not catch a regression that puts the slower provider first.
    vi.stubEnv("HEXCLAVE_GROWTH_PROVIDER_ORDER", "");
    expect(getGrowthModelConfig().modelOptions).toMatchInlineSnapshot(`
      {
        "providerOptions": {
          "gateway": {
            "order": [
              "wafer",
              "zai",
            ],
          },
          "wafer": {
            "thinking": {
              "type": "disabled",
            },
          },
          "zai": {
            "thinking": {
              "type": "disabled",
            },
          },
        },
      }
    `);
  });

  it("applies no provider-compliance filter, because a measured run showed one costs ~7x throughput", () => {
    // `disallowPromptTraining: true` was tried on 2026-08-10 and silently excluded Wafer despite the
    // gateway catalog flagging it compliant: measured 65 tok/s (alibaba) instead of ~466 (Wafer).
    // Pinned as a test so re-adding either filter is a deliberate act with a re-measurement, not a
    // one-line "safety" tweak. See the comment in model.ts.
    const gateway = getGrowthModelConfig().modelOptions.providerOptions?.gateway;
    expect(gateway).not.toHaveProperty("disallowPromptTraining");
    expect(gateway).not.toHaveProperty("zeroDataRetention");
  });

  it("does not pin with `only`, so an outage degrades to a slow run rather than a failed one", () => {
    const gateway = getGrowthModelConfig().modelOptions.providerOptions?.gateway;
    expect(gateway).toBeDefined();
    expect(gateway).not.toHaveProperty("only");
  });

  it("lets a deployment re-order providers without a rebuild", () => {
    vi.stubEnv("HEXCLAVE_GROWTH_PROVIDER_ORDER", "zai, wafer ,fireworks");
    expect(getGrowthModelConfig().modelOptions.providerOptions?.gateway).toEqual({
      order: ["zai", "wafer", "fireworks"],
    });
  });

  it("throws when the provider override is set but names no providers", () => {
    // A routing var that parses to nothing must not silently fall back to the default order — the
    // operator set it precisely because they wanted to move off the default.
    vi.stubEnv("HEXCLAVE_GROWTH_PROVIDER_ORDER", " , ,");
    expect(() => getGrowthModelConfig()).toThrow(/contains no provider slugs/);
  });
});
