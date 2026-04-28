// Pure feature-flag evaluator. No IO. Used by the backend evaluation endpoint and by SDKs that
// have bootstrapped flag definitions locally — both must arrive at the same answer for the same
// (flag, context) pair, so all bucketing routes through `hashing.ts`.

import { bucket, weightedVariant } from "./hashing";
import type {
  ConditionOperator,
  EvalContext,
  EvalResult,
  FeatureFlagsConfig,
  FlagCondition,
  FlagDef,
  FlagRule,
  HoldoutDef,
} from "./types";
import { getFeatureFlagRegexPatternError, maxFeatureFlagRegexAttributeLength } from "./types";

function getDottedAttribute(context: EvalContext, attribute: string): unknown {
  const parts = attribute.split(".");
  let cursor: unknown = context;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = Reflect.get(cursor, part);
  }
  return cursor;
}

function compareSemver(a: string, b: string): number | undefined {
  type ParsedSemver = {
    core: number[],
    prerelease: Array<string | number> | undefined,
  };
  const parse = (v: string) => {
    const withoutBuild = v.split("+", 1)[0];
    const buildText = v.includes("+") ? v.slice(v.indexOf("+") + 1) : undefined;
    if (buildText !== undefined && !isValidSemverIdentifierList(buildText, false)) return undefined;
    const dashIndex = withoutBuild.indexOf("-");
    const coreText = dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
    const prereleaseText = dashIndex === -1 ? undefined : withoutBuild.slice(dashIndex + 1);
    const coreParts = coreText.split(".");
    if (coreParts.length !== 3 || coreParts.some(part => !/^(0|[1-9]\d*)$/.test(part))) return undefined;
    if (prereleaseText !== undefined && !isValidSemverIdentifierList(prereleaseText, true)) return undefined;
    const core = coreParts.map(part => Number(part));
    const prerelease = prereleaseText?.split(".").map(part => /^(0|[1-9]\d*)$/.test(part) ? Number(part) : part);
    return { core, prerelease } satisfies ParsedSemver;
  };
  const av = parse(a);
  const bv = parse(b);
  if (av === undefined || bv === undefined) return undefined;
  for (let i = 0; i < 3; i++) {
    const x = av.core[i];
    const y = bv.core[i];
    if (x !== y) return x - y;
  }
  if (av.prerelease === undefined && bv.prerelease === undefined) return 0;
  if (av.prerelease === undefined) return 1;
  if (bv.prerelease === undefined) return -1;
  const len = Math.min(av.prerelease.length, bv.prerelease.length);
  for (let i = 0; i < len; i++) {
    const x = av.prerelease[i];
    const y = bv.prerelease[i];
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else if (typeof x === "number") {
      return -1;
    } else if (typeof y === "number") {
      return 1;
    } else {
      const cmp = lexicalCompare(x, y);
      if (cmp !== 0) return cmp;
    }
  }
  return av.prerelease.length - bv.prerelease.length;
}

function isValidSemverIdentifierList(value: string, forbidNumericLeadingZeroes: boolean): boolean {
  if (value.length === 0) return false;
  return value.split(".").every((part) => {
    if (!/^[0-9A-Za-z-]+$/.test(part)) return false;
    return !forbidNumericLeadingZeroes || !/^\d+$/.test(part) || /^(0|[1-9]\d*)$/.test(part);
  });
}

function lexicalCompare(a: string, b: string): number {
  return a < b ? -1 : (a > b ? 1 : 0);
}

const regexCache = new Map<string, RegExp>();
const regexCacheMaxSize = 1000;

function getCompiledRegex(pattern: string): RegExp | undefined {
  const existing = regexCache.get(pattern);
  if (existing !== undefined) {
    regexCache.delete(pattern);
    regexCache.set(pattern, existing);
    return existing;
  }
  const error = getFeatureFlagRegexPatternError(pattern);
  if (error !== undefined) return undefined;
  const regex = new RegExp(pattern);
  regexCache.set(pattern, regex);
  if (regexCache.size > regexCacheMaxSize) {
    const oldestKey = regexCache.keys().next().value;
    if (oldestKey !== undefined) {
      regexCache.delete(oldestKey);
    }
  }
  return regex;
}

function isTruthyFlagValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function applyOperator(
  operator: ConditionOperator,
  actual: unknown,
  expected: unknown,
  cohorts: Record<string, boolean> | undefined,
): boolean {
  switch (operator) {
    case "eq": { return actual === expected; }
    case "neq": { return actual !== expected; }
    case "contains": {
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    }
    case "not_contains": {
      return !(typeof actual === "string" && typeof expected === "string" && actual.includes(expected));
    }
    case "regex": {
      if (typeof actual !== "string" || typeof expected !== "string") return false;
      if (actual.length > maxFeatureFlagRegexAttributeLength) return false;
      const regex = getCompiledRegex(expected);
      return regex?.test(actual) ?? false;
    }
    case "gt": { return typeof actual === "number" && typeof expected === "number" && actual > expected; }
    case "gte": { return typeof actual === "number" && typeof expected === "number" && actual >= expected; }
    case "lt": { return typeof actual === "number" && typeof expected === "number" && actual < expected; }
    case "lte": { return typeof actual === "number" && typeof expected === "number" && actual <= expected; }
    case "in": { return Array.isArray(expected) && expected.includes(actual); }
    case "not_in": { return !(Array.isArray(expected) && expected.includes(actual)); }
    case "is_set": { return actual !== undefined && actual !== null; }
    case "is_not_set": { return actual === undefined || actual === null; }
    case "before":
    case "after": {
      const toMs = (v: unknown) => {
        if (v instanceof Date) return v.getTime();
        if (typeof v === "number") return v;
        if (typeof v === "string") {
          const ms = Date.parse(v);
          return Number.isNaN(ms) ? undefined : ms;
        }
        return undefined;
      };
      const a = toMs(actual);
      const b = toMs(expected);
      if (a === undefined || b === undefined) return false;
      return operator === "before" ? a < b : a > b;
    }
    case "semver_eq":
    case "semver_gt":
    case "semver_lt": {
      if (typeof actual !== "string" || typeof expected !== "string") return false;
      const cmp = compareSemver(actual, expected);
      if (cmp === undefined) return false;
      if (operator === "semver_eq") return cmp === 0;
      if (operator === "semver_gt") return cmp > 0;
      return cmp < 0;
    }
    case "in_cohort": {
      if (typeof expected !== "string") return false;
      return Boolean(cohorts?.[expected]);
    }
  }
}

function conditionMatches(
  condition: FlagCondition,
  context: EvalContext,
): boolean {
  if (!condition.attribute || !condition.operator) return false;
  const actual = getDottedAttribute(context, condition.attribute);
  return applyOperator(condition.operator, actual, condition.value, context.cohorts);
}

function ruleMatches(rule: FlagRule, context: EvalContext): boolean {
  if (rule.enabled === false) return false;
  if (!rule.variantKey && !rule.variantWeights) return false;
  const conditions = rule.conditions ? Object.values(rule.conditions).filter((c): c is FlagCondition => !!c) : [];
  for (const c of conditions) {
    if (!conditionMatches(c, context)) return false;
  }
  return true;
}

function pickStickyId(stickyBy: FlagRule["stickyBy"], context: EvalContext): string | undefined {
  switch (stickyBy) {
    case "userId": { return context.userId ?? context.distinctId; }
    case "teamId": { return context.teamId; }
    case "distinctId":
    case undefined: { return context.distinctId ?? context.userId; }
  }
}

function sortRules(rules: FlagDef["rules"]): Array<readonly [string, FlagRule]> {
  if (!rules) return [];
  const entries = Object.entries(rules).filter(([, r]) => r != null) as Array<readonly [string, FlagRule]>;
  return entries.sort(([aId, a], [bId, b]) => {
    const ap = a.priority ?? 0;
    const bp = b.priority ?? 0;
    if (ap !== bp) return bp - ap;
    return lexicalCompare(aId, bId);
  });
}

function variantValue(flag: FlagDef, variantKey: string | undefined): unknown {
  if (!variantKey) return undefined;
  const v = flag.variants?.[variantKey];
  if (v === undefined) return undefined;
  return v.value;
}

function pickRuleVariant(flagKey: string, ruleId: string, rule: FlagRule, context: EvalContext): string | undefined {
  if (rule.variantWeights) {
    const stickyId = pickStickyId(rule.stickyBy, context);
    if (!stickyId) return undefined;
    return weightedVariant(
      stickyId,
      `${flagKey}.${ruleId}.variant.${rule.rolloutSeed ?? ""}`,
      Object.entries(rule.variantWeights).map(([key, weight]) => ({ key, weight })),
    );
  }
  return rule.variantKey;
}

function inHoldout(holdout: HoldoutDef, holdoutId: string, context: EvalContext): boolean {
  const pct = holdout.percentage ?? 0;
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  const distinctId = context.distinctId ?? context.userId ?? "";
  if (!distinctId) return false;
  return bucket(distinctId, `holdout.${holdoutId}.${holdout.seed ?? ""}`) < pct / 100;
}

/**
 * Evaluate a single flag against `context`. Pure: same inputs → same output. `seenFlags` tracks
 * dependency recursion to break cycles (returns reason: "cycle", default variant).
 */
export function evaluateFlag(
  flagKey: string,
  config: FeatureFlagsConfig,
  context: EvalContext,
  seenFlags: ReadonlySet<string> = new Set(),
): EvalResult {
  const flag = config.flags?.[flagKey];
  if (!flag) {
    return { flagKey, variantKey: undefined, value: undefined, reason: "missing" };
  }

  const defaultResult = (reason: EvalResult["reason"], ruleId?: string): EvalResult => ({
    flagKey,
    variantKey: flag.defaultVariantKey,
    value: variantValue(flag, flag.defaultVariantKey),
    reason,
    ...(ruleId !== undefined ? { ruleId } : {}),
  });

  if (flag.killSwitch) return defaultResult("kill_switch");
  if (flag.enabled === false) return defaultResult("disabled");

  if (flag.dependsOn) {
    if (seenFlags.has(flag.dependsOn)) return defaultResult("cycle");
    const dep = evaluateFlag(flag.dependsOn, config, context, new Set([...seenFlags, flagKey]));
    if (!isTruthyFlagValue(dep.value)) return defaultResult("dep_unmet");
  }

  if (flag.holdoutId) {
    const holdout = config.holdouts?.[flag.holdoutId];
    if (holdout && inHoldout(holdout, flag.holdoutId, context)) {
      return defaultResult("holdout");
    }
  }

  for (const [ruleId, rule] of sortRules(flag.rules)) {
    if (!ruleMatches(rule, context)) continue;
    const pct = rule.rolloutPercentage ?? 100;
    if (pct <= 0) continue;
    if (pct < 100) {
      const stickyId = pickStickyId(rule.stickyBy, context);
      if (!stickyId) continue;
      if (bucket(stickyId, `${flagKey}.${ruleId}.${rule.rolloutSeed ?? ""}`) >= pct / 100) {
        continue;
      }
    }
    const variantKey = pickRuleVariant(flagKey, ruleId, rule, context);
    if (!variantKey) continue;
    return {
      flagKey,
      variantKey,
      value: variantValue(flag, variantKey),
      reason: "matched_rule",
      ruleId,
    };
  }

  return defaultResult("default");
}

/** Evaluate a list of flag keys (or all flags, if `flagKeys` is omitted). */
export function evaluateFlags(
  config: FeatureFlagsConfig,
  context: EvalContext,
  flagKeys?: ReadonlyArray<string>,
): Record<string, EvalResult> {
  const keys = flagKeys ?? Object.keys(config.flags ?? {});
  const out = new Map<string, EvalResult>();
  for (const k of keys) {
    out.set(k, evaluateFlag(k, config, context));
  }
  return Object.fromEntries(out);
}

/**
 * Look up a flag by its user-facing `key` field rather than its config id. Returns undefined if
 * no flag has that key. (Definitions are keyed by an opaque id in config; consumers identify
 * flags by the human-readable `key` string.)
 */
export function findFlagIdByKey(config: FeatureFlagsConfig, key: string): string | undefined {
  if (!config.flags) return undefined;
  for (const [id, def] of Object.entries(config.flags)) {
    if (def?.key === key) return id;
  }
  return undefined;
}


import.meta.vitest?.test("evaluateFlag returns missing for unknown flag", ({ expect }) => {
  const r = evaluateFlag("nope", { flags: {} }, { distinctId: "u" });
  expect(r.reason).toBe("missing");
  expect(r.value).toBeUndefined();
});

import.meta.vitest?.test("evaluateFlag respects killSwitch and disabled", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      f1: {
        key: "f1", type: "boolean", killSwitch: true, defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: { r: { priority: 0, rolloutPercentage: 100, variantKey: "on" } },
      },
      f2: {
        key: "f2", type: "boolean", enabled: false, defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: { r: { priority: 0, rolloutPercentage: 100, variantKey: "on" } },
      },
    },
  };
  expect(evaluateFlag("f1", config, { distinctId: "u" }).reason).toBe("kill_switch");
  expect(evaluateFlag("f1", config, { distinctId: "u" }).value).toBe(false);
  expect(evaluateFlag("f2", config, { distinctId: "u" }).reason).toBe("disabled");
  expect(evaluateFlag("f2", config, { distinctId: "u" }).value).toBe(false);
});

import.meta.vitest?.test("evaluateFlag matches conditions and rolls out", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      checkout: {
        key: "checkout", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: {
          beta: {
            priority: 10,
            rolloutPercentage: 100,
            variantKey: "on",
            conditions: { c1: { attribute: "user.email", operator: "contains", value: "@beta.io" } },
          },
        },
      },
    },
  };
  expect(evaluateFlag("checkout", config, { distinctId: "u", user: { email: "x@beta.io" } }).value).toBe(true);
  expect(evaluateFlag("checkout", config, { distinctId: "u", user: { email: "x@other.com" } }).value).toBe(false);
});

import.meta.vitest?.test("rule priority orders rules and stops at first match", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      f: {
        key: "f", type: "string", enabled: true, defaultVariantKey: "z",
        variants: { a: { value: "a" }, b: { value: "b" }, z: { value: "z" } },
        rules: {
          // Lower priority rule listed first to confirm we sort.
          low: { priority: 1, rolloutPercentage: 100, variantKey: "b" },
          high: { priority: 10, rolloutPercentage: 100, variantKey: "a" },
        },
      },
    },
  };
  const r = evaluateFlag("f", config, { distinctId: "u" });
  expect(r.value).toBe("a");
  expect(r.ruleId).toBe("high");
});

import.meta.vitest?.test("percentage rollout converges to spec ±1.5% over 100k samples", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      f: {
        key: "f", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: { r: { priority: 0, rolloutPercentage: 30, rolloutSeed: "s1", variantKey: "on" } },
      },
    },
  };
  let on = 0;
  const n = 100_000;
  for (let i = 0; i < n; i++) {
    if (evaluateFlag("f", config, { distinctId: `u-${i}` }).value === true) on++;
  }
  expect(Math.abs(on / n - 0.3)).toBeLessThan(0.015);
});

import.meta.vitest?.test("weighted variant rules pick deterministic variants from weights", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      f: {
        key: "f", type: "multivariate", enabled: true, defaultVariantKey: "control",
        variants: {
          control: { value: "control" },
          treatment: { value: "treatment" },
        },
        rules: {
          r: {
            priority: 0,
            rolloutPercentage: 100,
            rolloutSeed: "s1",
            variantWeights: { control: 0.5, treatment: 0.5 },
          },
        },
      },
    },
  };
  const first = evaluateFlag("f", config, { distinctId: "stable-user" });
  const second = evaluateFlag("f", config, { distinctId: "stable-user" });
  expect(first).toEqual(second);

  const seen = new Set<string | undefined>();
  for (let i = 0; i < 50; i++) {
    seen.add(evaluateFlag("f", config, { distinctId: `u-${i}` }).variantKey);
  }
  expect(seen).toEqual(new Set(["control", "treatment"]));
});

import.meta.vitest?.test("dependsOn gates evaluation", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      gate: {
        key: "gate", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: {
          allow: {
            priority: 0, rolloutPercentage: 100, variantKey: "on",
            conditions: { c: { attribute: "user.team", operator: "eq", value: "alpha" } },
          },
        },
      },
      child: {
        key: "child", type: "string", enabled: true, defaultVariantKey: "z", dependsOn: "gate",
        variants: { a: { value: "a" }, z: { value: "z" } },
        rules: { r: { priority: 0, rolloutPercentage: 100, variantKey: "a" } },
      },
    },
  };
  expect(evaluateFlag("child", config, { distinctId: "u", user: { team: "alpha" } }).value).toBe("a");
  const blocked = evaluateFlag("child", config, { distinctId: "u", user: { team: "beta" } });
  expect(blocked.reason).toBe("dep_unmet");
  expect(blocked.value).toBe("z");
});

import.meta.vitest?.test("dependsOn treats non-empty JSON values as truthy", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      gate: {
        key: "gate", type: "json", enabled: true, defaultVariantKey: "on",
        variants: { on: { value: { enabled: true } }, off: { value: {} } },
      },
      child: {
        key: "child", type: "string", enabled: true, defaultVariantKey: "z", dependsOn: "gate",
        variants: { a: { value: "a" }, z: { value: "z" } },
        rules: { r: { priority: 0, rolloutPercentage: 100, variantKey: "a" } },
      },
    },
  };
  expect(evaluateFlag("child", config, { distinctId: "u" }).value).toBe("a");
});

import.meta.vitest?.test("dependency cycles are broken safely", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      a: { key: "a", type: "boolean", enabled: true, defaultVariantKey: "off", dependsOn: "b",
        variants: { on: { value: true }, off: { value: false } } },
      b: { key: "b", type: "boolean", enabled: true, defaultVariantKey: "off", dependsOn: "a",
        variants: { on: { value: true }, off: { value: false } } },
    },
  };
  // Should not stack-overflow; both end up on default with reason cycle or dep_unmet.
  const r = evaluateFlag("a", config, { distinctId: "u" });
  expect(r.value).toBe(false);
});

import.meta.vitest?.test("holdout excludes a slice from any variant", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      f: {
        key: "f", type: "boolean", enabled: true, defaultVariantKey: "off", holdoutId: "global",
        variants: { on: { value: true }, off: { value: false } },
        rules: { r: { priority: 0, rolloutPercentage: 100, variantKey: "on" } },
      },
    },
    holdouts: { global: { percentage: 100, seed: "h" } },  // everyone in holdout → all default
  };
  for (let i = 0; i < 50; i++) {
    expect(evaluateFlag("f", config, { distinctId: `u-${i}` }).reason).toBe("holdout");
  }
});

import.meta.vitest?.test("operators: regex, in, gt, is_set, before/after, semver", ({ expect }) => {
  const make = (operator: ConditionOperator, value: unknown) => ({
    flags: {
      f: {
        key: "f", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: { r: {
          priority: 0, rolloutPercentage: 100, variantKey: "on",
          conditions: { c: { attribute: "user.attr", operator, value } },
        } },
      },
    },
  } satisfies FeatureFlagsConfig);
  const ev = (cfg: FeatureFlagsConfig, attr: unknown) =>
    evaluateFlag("f", cfg, { distinctId: "u", user: { attr } }).value;

  expect(ev(make("regex", "^foo"), "foobar")).toBe(true);
  expect(ev(make("regex", "^foo"), "barfoo")).toBe(false);
  expect(ev(make("in", ["a", "b"]), "a")).toBe(true);
  expect(ev(make("not_in", ["a", "b"]), "c")).toBe(true);
  expect(ev(make("gt", 5), 10)).toBe(true);
  expect(ev(make("gt", 5), 5)).toBe(false);
  expect(ev(make("is_set", undefined), "anything")).toBe(true);
  expect(ev(make("is_not_set", undefined), undefined)).toBe(true);
  expect(ev(make("before", "2025-01-02"), "2025-01-01T00:00:00Z")).toBe(true);
  expect(ev(make("after", "2025-01-02"), "2025-01-03T00:00:00Z")).toBe(true);
  expect(ev(make("semver_gt", "1.2.0"), "1.3.0")).toBe(true);
  expect(ev(make("semver_eq", "1.2.0"), "1.2.0")).toBe(true);
  expect(ev(make("semver_lt", "2.0.0"), "1.99.0")).toBe(true);
  expect(ev(make("semver_gt", "1.0.0-alpha"), "1.0.0")).toBe(true);
  expect(ev(make("semver_eq", "1.0.0+build1"), "1.0.0+build2")).toBe(true);
  expect(ev(make("semver_gt", "1.0.0"), "malformed")).toBe(false);
  expect(ev(make("semver_gt", "malformed"), "1.0.0")).toBe(false);
  expect(ev(make("semver_gt", "1.0.0"), "1.0")).toBe(false);
  expect(ev(make("semver_gt", "1.0.0"), "1.0.0-01")).toBe(false);
});

import.meta.vitest?.test("in_cohort matches cohort membership in context", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      f: {
        key: "f", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: { r: {
          priority: 0, rolloutPercentage: 100, variantKey: "on",
          conditions: { c: { attribute: "user.id", operator: "in_cohort", value: "vips" } },
        } },
      },
    },
  };
  expect(evaluateFlag("f", config, { distinctId: "u", cohorts: { vips: true } }).value).toBe(true);
  expect(evaluateFlag("f", config, { distinctId: "u", cohorts: {} }).value).toBe(false);
});

import.meta.vitest?.test("evaluation is sticky for the same distinctId", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      f: {
        key: "f", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: { r: { priority: 0, rolloutPercentage: 50, rolloutSeed: "s", variantKey: "on" } },
      },
    },
  };
  const a = evaluateFlag("f", config, { distinctId: "stable" }).value;
  const b = evaluateFlag("f", config, { distinctId: "stable" }).value;
  expect(a).toBe(b);
});

import.meta.vitest?.test("findFlagIdByKey resolves user-facing key to config id", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: {
      "abc-123": { key: "checkout", type: "boolean", defaultVariantKey: "off",
        variants: { off: { value: false } } },
    },
  };
  expect(findFlagIdByKey(config, "checkout")).toBe("abc-123");
  expect(findFlagIdByKey(config, "missing")).toBeUndefined();
});
