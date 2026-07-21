import { describe, expect, it } from "vitest";
import {
  BPS_TOTAL,
  bpsToPercentText,
  describeCurrentRollout,
  FLAG_OPERATOR_METADATA,
  FLAG_OPERATORS,
  formatBps,
  getFlagStatus,
  getLinkedExperiments,
  isStrictSemver,
  serializeExperimentConfig,
  serializeFlagConfig,
  toExperimentRunConfig,
  parseFeatureFlagsSection,
  percentToBps,
  validateExperimentConfig,
  validateFlagConfig,
  validateFlagKey,
  validateVariantJsonValue,
  type ExperimentConfig,
  type FeatureFlagsSection,
  type FlagConfig,
} from "./config";

function makeFlag(overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    internalId: "flag_checkout_redesign",
    displayName: "Checkout redesign",
    description: "",
    type: "boolean",
    enabled: true,
    killed: false,
    archived: false,
    variants: [
      { id: "variant-on", label: "On", jsonValue: "true" },
      { id: "variant-off", label: "Off", jsonValue: "false" },
    ],
    fallbackVariantId: "variant-off",
    defaultServe: { type: "variant", variantId: "variant-off" },
    rules: [],
    prerequisites: [],
    holdoutBps: 0,
    mutualExclusionGroup: null,
    createdAtMillis: 1700000000000,
    ...overrides,
  };
}

function makeSection(overrides: Partial<FeatureFlagsSection> = {}): FeatureFlagsSection {
  return {
    flags: new Map([["checkout-redesign", makeFlag()]]),
    segments: new Map(),
    experiments: new Map(),
    ...overrides,
  };
}

function makeExperiment(overrides: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return {
    displayName: "Checkout test",
    hypothesis: "The redesign increases purchases.",
    flagKey: "checkout-redesign",
    assignmentUnit: "user",
    // Deliberately not first: allocation order must never define the control.
    controlVariantId: "variant-off",
    allocation: [
      { variantId: "variant-on", weightBps: 5000 },
      { variantId: "variant-off", weightBps: 5000 },
    ],
    trafficBps: 10_000,
    metrics: [{
      id: "metric-1",
      label: "Purchases",
      role: "primary",
      source: { type: "custom_event", eventName: "purchase-completed" },
    }],
    attributionWindowHours: 168,
    mutualExclusionGroup: null,
    schedule: { startAtIso: null, endAtIso: null },
    archived: false,
    createdAtMillis: 1700000000000,
    ...overrides,
  };
}

describe("basis-point formatting", () => {
  it("formats whole and fractional percentages", () => {
    expect(formatBps(0)).toBe("0%");
    expect(formatBps(10_000)).toBe("100%");
    expect(formatBps(5000)).toBe("50%");
    expect(formatBps(3333)).toBe("33.33%");
    expect(formatBps(1)).toBe("0.01%");
    expect(formatBps(2550)).toBe("25.5%");
  });

  it("parses percentage text into basis points", () => {
    expect(percentToBps("25")).toBe(2500);
    expect(percentToBps("25%")).toBe(2500);
    expect(percentToBps("33.33")).toBe(3333);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("101")).toBeNull();
    expect(percentToBps("-1")).toBeNull();
    expect(percentToBps("abc")).toBeNull();
    expect(percentToBps("")).toBeNull();
  });

  it("round-trips through the text representation", () => {
    for (const bps of [0, 1, 25, 2500, 3333, 9999, 10_000]) {
      expect(percentToBps(bpsToPercentText(bps))).toBe(bps);
    }
  });
});

describe("validateFlagKey", () => {
  it("accepts kebab-case keys", () => {
    expect(validateFlagKey("checkout-redesign")).toBeNull();
    expect(validateFlagKey("a")).toBeNull();
    expect(validateFlagKey("flag-2")).toBeNull();
  });

  it("rejects invalid keys", () => {
    expect(validateFlagKey("")).not.toBeNull();
    expect(validateFlagKey("Checkout")).not.toBeNull();
    expect(validateFlagKey("2fast")).not.toBeNull();
    expect(validateFlagKey("has spaces")).not.toBeNull();
    expect(validateFlagKey("a".repeat(65))).not.toBeNull();
  });
});

describe("isStrictSemver", () => {
  it("accepts strict semver", () => {
    expect(isStrictSemver("1.2.3")).toBe(true);
    expect(isStrictSemver("0.0.1")).toBe(true);
    expect(isStrictSemver("1.0.0-beta.1")).toBe(true);
    expect(isStrictSemver("1.0.0+build.5")).toBe(true);
  });

  it("rejects loose forms", () => {
    expect(isStrictSemver("v1.2.3")).toBe(false);
    expect(isStrictSemver("1.2")).toBe(false);
    expect(isStrictSemver("01.2.3")).toBe(false);
    expect(isStrictSemver("1.2.3.4")).toBe(false);
  });
});

describe("getFlagStatus", () => {
  it("orders archived over killed over enabled/disabled", () => {
    expect(getFlagStatus(makeFlag())).toBe("enabled");
    expect(getFlagStatus(makeFlag({ enabled: false }))).toBe("disabled");
    expect(getFlagStatus(makeFlag({ killed: true }))).toBe("killed");
    expect(getFlagStatus(makeFlag({ killed: true, archived: true }))).toBe("archived");
  });
});

describe("describeCurrentRollout", () => {
  it("reports zero rollout for killed, archived, and disabled flags", () => {
    expect(describeCurrentRollout(makeFlag({ killed: true }))).toBe("0% (killed)");
    expect(describeCurrentRollout(makeFlag({ archived: true }))).toBe("0% (archived)");
    expect(describeCurrentRollout(makeFlag({ enabled: false }))).toBe("0% (disabled)");
  });

  it("accounts for holdouts", () => {
    expect(describeCurrentRollout(makeFlag({ holdoutBps: 1000 }))).toContain("90%");
  });
});

describe("operator metadata", () => {
  it("covers every operator", () => {
    for (const operator of FLAG_OPERATORS) {
      expect(FLAG_OPERATOR_METADATA.has(operator)).toBe(true);
    }
  });
});

describe("validateVariantJsonValue", () => {
  it("enforces the flag's value type", () => {
    expect(validateVariantJsonValue("boolean", "true")).toBeNull();
    expect(validateVariantJsonValue("boolean", "\"yes\"")).not.toBeNull();
    expect(validateVariantJsonValue("string", "\"hello\"")).toBeNull();
    expect(validateVariantJsonValue("string", "42")).not.toBeNull();
    expect(validateVariantJsonValue("number", "42.5")).toBeNull();
    expect(validateVariantJsonValue("number", "\"42\"")).not.toBeNull();
    expect(validateVariantJsonValue("json", "{\"a\": [1, 2]}")).toBeNull();
    expect(validateVariantJsonValue("json", "{not json")).not.toBeNull();
  });
});

describe("validateFlagConfig", () => {
  it("accepts a well-formed flag", () => {
    expect(validateFlagConfig("checkout-redesign", makeFlag(), makeSection())).toEqual([]);
  });

  it("rejects a fallback variant that does not exist", () => {
    const errors = validateFlagConfig("checkout-redesign", makeFlag({ fallbackVariantId: "nope" }), makeSection());
    expect(errors.some((error) => error.includes("fallback"))).toBe(true);
  });

  it("rejects splits that do not sum to 100%", () => {
    const flag = makeFlag({
      defaultServe: {
        type: "split",
        split: [
          { variantId: "variant-on", weightBps: 5000 },
          { variantId: "variant-off", weightBps: 4000 },
        ],
      },
    });
    const errors = validateFlagConfig("checkout-redesign", flag, makeSection());
    expect(errors.some((error) => error.includes("100%"))).toBe(true);
  });

  it("rejects self-referencing prerequisites", () => {
    const flag = makeFlag({ prerequisites: [{ flagKey: "checkout-redesign", requiredVariantId: "variant-on" }] });
    const errors = validateFlagConfig("checkout-redesign", flag, makeSection());
    expect(errors.some((error) => error.includes("own prerequisite"))).toBe(true);
  });

  it("rejects rules without conditions and out-of-range rollouts", () => {
    const flag = makeFlag({
      rules: [{
        id: "rule-1",
        label: "Bad rule",
        enabled: true,
        conditions: [],
        serve: { type: "variant", variantId: "variant-on" },
        rolloutBps: BPS_TOTAL + 1,
      }],
    });
    const errors = validateFlagConfig("checkout-redesign", flag, makeSection());
    expect(errors.some((error) => error.includes("at least one condition"))).toBe(true);
    expect(errors.some((error) => error.includes("between 0% and 100%"))).toBe(true);
  });

  it("rejects semver conditions with loose versions", () => {
    const flag = makeFlag({
      rules: [{
        id: "rule-1",
        label: "Version rule",
        enabled: true,
        conditions: [{ attribute: "app.version", operator: "semver_gte", value: "v1.2" }],
        serve: { type: "variant", variantId: "variant-on" },
        rolloutBps: BPS_TOTAL,
      }],
    });
    const errors = validateFlagConfig("checkout-redesign", flag, makeSection());
    expect(errors.some((error) => error.includes("strict semver"))).toBe(true);
  });

  it("requires targeting dates to be canonical UTC timestamps", () => {
    const withDate = (value: string) => makeFlag({
      rules: [{
        id: "rule-date",
        label: "Date rule",
        enabled: true,
        conditions: [{ attribute: "user.signedUpAt", operator: "before", value }],
        serve: { type: "variant", variantId: "variant-on" },
        rolloutBps: BPS_TOTAL,
      }],
    });
    expect(validateFlagConfig("checkout-redesign", withDate("2026-07-18T12:30:00.000Z"), makeSection())).toEqual([]);
    expect(validateFlagConfig("checkout-redesign", withDate("2026-07-18T12:30"), makeSection())
      .some((error) => error.includes("strict UTC"))).toBe(true);
  });
});

describe("validateExperimentConfig", () => {
  it("accepts a well-formed experiment", () => {
    expect(validateExperimentConfig(makeExperiment(), makeSection())).toEqual([]);
  });

  it("requires exactly one primary metric", () => {
    const noPrimary = makeExperiment({
      metrics: [{
        id: "metric-1",
        label: "Guardrail only",
        role: "guardrail",
        source: { type: "custom_event", eventName: "error-shown" },
      }],
    });
    expect(validateExperimentConfig(noPrimary, makeSection()).some((error) => error.includes("primary"))).toBe(true);
  });

  it("requires allocation to sum to 100% across at least two variants", () => {
    const experiment = makeExperiment({
      allocation: [{ variantId: "variant-on", weightBps: 10_000 }],
    });
    const errors = validateExperimentConfig(experiment, makeSection());
    expect(errors.some((error) => error.includes("at least two"))).toBe(true);
  });

  it("preserves an explicit control variant independently of allocation order", () => {
    const experiment = makeExperiment();
    const serialized = serializeExperimentConfig("experiment-1", experiment, makeSection());
    const frozen = toExperimentRunConfig(experiment, makeSection());

    expect(serialized.controlVariantKey).toBe("variant-off");
    expect(frozen.control_variant_id).toBe("variant-off");
  });

  it("requires the explicit control to be allocated", () => {
    const errors = validateExperimentConfig(makeExperiment({ controlVariantId: "missing" }), makeSection());
    expect(errors.some((error) => error.includes("control variant"))).toBe(true);
  });

  it("requires the linked flag to exist", () => {
    const experiment = makeExperiment({ flagKey: "missing-flag" });
    const errors = validateExperimentConfig(experiment, makeSection());
    expect(errors.some((error) => error.includes("existing flag"))).toBe(true);
  });

  it("rejects a schedule that ends before it starts", () => {
    const experiment = makeExperiment({
      schedule: { startAtIso: "2026-07-18T10:00:00.000Z", endAtIso: "2026-07-17T10:00:00.000Z" },
    });
    const errors = validateExperimentConfig(experiment, makeSection());
    expect(errors.some((error) => error.includes("after the start"))).toBe(true);
  });
});

describe("parseFeatureFlagsSection", () => {
  it("parses an absent section to empty maps", () => {
    const section = parseFeatureFlagsSection({});
    expect(section.flags.size).toBe(0);
    expect(section.segments.size).toBe(0);
    expect(section.experiments.size).toBe(0);
  });

  it("round-trips a full section", () => {
    const flag = makeFlag({
      rules: [{
        id: "rule-1",
        label: "Team members",
        enabled: true,
        conditions: [
          { attribute: "user.email", operator: "ends_with", value: "@example.com" },
          { attribute: "user.id", operator: "in", values: ["a", "b"] },
          { attribute: "user.id", operator: "exists" },
        ],
        serve: { type: "split", split: [{ variantId: "variant-on", weightBps: 10_000 }] },
        rolloutBps: 5000,
      }],
    });
    const experiment = makeExperiment();
    const section = parseFeatureFlagsSection({
      featureFlags: {
        flags: { [flag.internalId]: serializeFlagConfig(flag.internalId, "checkout-redesign", flag, makeSection()) },
        segments: { "beta-testers": { displayName: "Beta testers", conditions: { beta: { attribute: "context.beta", operator: "eq", value: "true" } } } },
        experiments: { "experiment-1": serializeExperimentConfig("experiment-1", experiment, makeSection()) },
      },
    });
    expect(section.flags.get("checkout-redesign")).toEqual(flag);
    expect(section.segments.get("beta-testers")?.displayName).toBe("Beta testers");
    expect(section.experiments.get("experiment-1")).toEqual(experiment);
  });

  it("throws loudly on malformed sections", () => {
    expect(() => parseFeatureFlagsSection({ featureFlags: { flags: { bad: { key: "bad", displayName: 42, type: "boolean", variants: { off: { value: false } }, fallbackVariantKey: "off" } } } }))
      .toThrowError(/featureFlags\.flags\.bad\.displayName/);
    expect(() => parseFeatureFlagsSection({ featureFlags: "nope" }))
      .toThrowError(/featureFlags/);
  });
});

describe("getLinkedExperiments", () => {
  it("returns non-archived experiments linked to the flag", () => {
    const section = makeSection({
      experiments: new Map([
        ["experiment-1", makeExperiment()],
        ["experiment-2", makeExperiment({ archived: true })],
        ["experiment-3", makeExperiment({ flagKey: "other-flag" })],
      ]),
    });
    const linked = getLinkedExperiments(section, "checkout-redesign");
    expect(linked.map((entry) => entry.id)).toEqual(["experiment-1"]);
  });
});
