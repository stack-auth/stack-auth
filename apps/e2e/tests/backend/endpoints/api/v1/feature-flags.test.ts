import { it } from "../../../../helpers";
import { evaluateFlag } from "@stackframe/stack-shared/dist/feature-flags/evaluator";
import type { FeatureFlagsConfig } from "@stackframe/stack-shared/dist/feature-flags/types";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

async function setupProjectWithFlags(featureFlags: FeatureFlagsConfig) {
  await Project.createAndSwitch();
  await Project.updatePushedConfig({ featureFlags });
}

it("/feature-flags/evaluate returns the default variant when no rules match", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "checkout-flag": {
        key: "checkout",
        type: "boolean",
        enabled: true,
        killSwitch: false,
        defaultVariantKey: "off",
        variants: {
          on: { value: true },
          off: { value: false },
        },
        rules: {},
      },
    },
  });

  const response = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "client",
    body: { distinct_id: "user-1" },
  });

  expect(response.status).toBe(200);
  expect(response.body.results.checkout).toMatchObject({
    flag_key: "checkout",
    variant_key: "off",
    value: false,
    reason: "default",
  });
});

it("/feature-flags/evaluate matches a condition rule and returns the rule variant", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "beta-flag": {
        key: "beta",
        type: "boolean",
        enabled: true,
        killSwitch: false,
        defaultVariantKey: "off",
        variants: {
          on: { value: true },
          off: { value: false },
        },
        rules: {
          "beta-emails": {
            priority: 10,
            enabled: true,
            rolloutPercentage: 100,
            variantKey: "on",
            conditions: {
              email: { attribute: "user.email", operator: "contains", value: "@beta.io" },
            },
          },
        },
      },
    },
  });

  const matchResponse = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "server",
    body: {
      distinct_id: "u",
      user: { email: "alice@beta.io" },
    },
  });
  expect(matchResponse.status).toBe(200);
  expect(matchResponse.body.results.beta).toMatchObject({
    flag_key: "beta",
    variant_key: "on",
    value: true,
    reason: "matched_rule",
    rule_id: "beta-emails",
  });

  const noMatchResponse = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "server",
    body: {
      distinct_id: "u",
      user: { email: "alice@other.com" },
    },
  });
  expect(noMatchResponse.body.results.beta.value).toBe(false);
  expect(noMatchResponse.body.results.beta.reason).toBe("default");
});

it("/feature-flags/evaluate honors killSwitch over enabled rules", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "kill-flag": {
        key: "kill",
        type: "boolean",
        enabled: true,
        killSwitch: true,
        defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: {
          all: { priority: 0, enabled: true, rolloutPercentage: 100, variantKey: "on" },
        },
      },
    },
  });

  const response = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "client",
    body: { distinct_id: "u" },
  });
  expect(response.body.results.kill).toMatchObject({
    flag_key: "kill",
    variant_key: "off",
    value: false,
    reason: "kill_switch",
  });
});

it("/feature-flags/evaluate returns the same variant for the same distinct_id under partial rollout", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "rollout-flag": {
        key: "rollout",
        type: "boolean",
        enabled: true,
        killSwitch: false,
        defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: {
          partial: {
            priority: 0, enabled: true, rolloutPercentage: 50, rolloutSeed: "seed-1", variantKey: "on",
          },
        },
      },
    },
  });

  const fetchOnce = async () => {
    const r = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
      method: "POST",
      accessType: "client",
      body: { distinct_id: "stable-user" },
    });
    return r.body.results.rollout;
  };

  const a = await fetchOnce();
  const b = await fetchOnce();
  expect(a.value).toEqual(b.value);
  expect(a.variant_key).toEqual(b.variant_key);
});

it("/feature-flags/evaluate returns deterministic weighted variants for multivariate rules", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "pricing-flag": {
        key: "pricing",
        type: "multivariate",
        enabled: true,
        defaultVariantKey: "control",
        variants: {
          control: { value: "control" },
          treatment: { value: "treatment" },
        },
        rules: {
          all: {
            priority: 0,
            enabled: true,
            rolloutPercentage: 100,
            rolloutSeed: "pricing-seed",
            variantWeights: {
              control: 0.5,
              treatment: 0.5,
            },
          },
        },
      },
    },
  });

  const fetchOnce = async (distinctId: string) => {
    const r = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
      method: "POST",
      accessType: "client",
      body: { distinct_id: distinctId, flag_keys: ["pricing"] },
    });
    return r.body.results.pricing;
  };

  const stableA = await fetchOnce("stable-user");
  const stableB = await fetchOnce("stable-user");
  expect(stableA.variant_key).toEqual(stableB.variant_key);

  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const result = await fetchOnce(`weighted-user-${i}`);
    seen.add(result.variant_key);
  }
  expect(seen).toEqual(new Set(["control", "treatment"]));
});

it("/feature-flags/evaluate scopes to flag_keys when provided", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "f1": { key: "f1", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { off: { value: false } }, rules: {} },
      "f2": { key: "f2", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { off: { value: false } }, rules: {} },
    },
  });

  const response = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "client",
    body: { distinct_id: "u", flag_keys: ["f1"] },
  });
  expect(Object.keys(response.body.results)).toEqual(["f1"]);
});

it("/feature-flags/evaluate falls back to the authenticated user id when distinct_id is omitted", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "rollout-flag": {
        key: "rollout",
        type: "boolean",
        enabled: true,
        killSwitch: false,
        defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: {
          partial: {
            priority: 0, enabled: true, rolloutPercentage: 50, rolloutSeed: "auth-user-fallback", variantKey: "on",
          },
        },
      },
    },
  });
  const { userId } = await Auth.Anonymous.signUp();

  const omittedDistinctId = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "client",
    body: { flag_keys: ["rollout"] },
  });
  const explicitUserId = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "client",
    body: { distinct_id: userId, flag_keys: ["rollout"] },
  });

  expect(omittedDistinctId.body.results.rollout).toMatchObject({
    flag_key: "rollout",
    variant_key: explicitUserId.body.results.rollout.variant_key,
    value: explicitUserId.body.results.rollout.value,
  });
});

it("/feature-flags/evaluate ignores caller-supplied targeting attributes for client-key requests", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "internal-tools": {
        key: "internal-tools",
        type: "boolean",
        enabled: true,
        killSwitch: false,
        defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: {
          employee: {
            priority: 0,
            enabled: true,
            rolloutPercentage: 100,
            variantKey: "on",
            conditions: {
              email: { attribute: "user.email", operator: "regex", value: "@stack-auth\\.com$" },
            },
          },
        },
      },
    },
  });

  const clientResponse = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "client",
    body: {
      distinct_id: "spoofing-client",
      user: { email: "attacker@stack-auth.com" },
      flag_keys: ["internal-tools"],
    },
  });
  expect(clientResponse.body.results["internal-tools"]).toMatchObject({
    variant_key: "off",
    value: false,
    reason: "default",
  });

  const serverResponse = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "server",
    body: {
      distinct_id: "trusted-server",
      user: { email: "employee@stack-auth.com" },
      flag_keys: ["internal-tools"],
    },
  });
  expect(serverResponse.body.results["internal-tools"]).toMatchObject({
    variant_key: "on",
    value: true,
    reason: "matched_rule",
  });
});

it("/feature-flags/evaluate returns missing for requested unknown flag keys", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "f1": { key: "f1", type: "boolean", enabled: true, defaultVariantKey: "off",
        variants: { off: { value: false } }, rules: {} },
    },
  });

  const response = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "client",
    body: { distinct_id: "u", flag_keys: ["missing"] },
  });
  expect(response.body.results.missing).toMatchObject({
    flag_key: "missing",
    variant_key: null,
    reason: "missing",
  });
});

it("/feature-flags/bootstrap returns opaque-id definitions, public key lookup, with ownerUserId stripped and a stable version", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "internal-id": {
        key: "checkout",
        type: "boolean",
        enabled: true,
        killSwitch: false,
        ownerUserId: "user-secret-id",
        defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: {},
      },
    },
  });

  const first = await niceBackendFetch("/api/latest/feature-flags/bootstrap", {
    method: "GET",
    accessType: "client",
  });
  expect(first.status).toBe(200);
  expect(first.body.flags).toHaveProperty("internal-id");
  expect(first.body.flag_ids_by_key).toEqual({ checkout: "internal-id" });
  // ownerUserId is operator metadata; it must never reach the SDK bootstrap payload.
  expect(first.body.flags["internal-id"]).not.toHaveProperty("ownerUserId");
  expect(typeof first.body.version).toBe("string");

  // Calling again without changes returns the same version — important for SDK cache freshness.
  const second = await niceBackendFetch("/api/latest/feature-flags/bootstrap", {
    method: "GET",
    accessType: "client",
  });
  expect(second.body.version).toBe(first.body.version);

  const revalidated = await niceBackendFetch("/api/latest/feature-flags/bootstrap", {
    method: "GET",
    accessType: "client",
    headers: { "if-none-match": first.headers.get("etag") ?? first.body.version },
  });
  expect(revalidated.status).toBe(304);
});

it("/feature-flags/bootstrap preserves dependency references for local SDK evaluation", async ({ expect }) => {
  await setupProjectWithFlags({
    flags: {
      "gate-id": {
        key: "gate",
        type: "boolean",
        enabled: true,
        defaultVariantKey: "off",
        variants: { on: { value: true }, off: { value: false } },
        rules: {
          allow: {
            priority: 0,
            enabled: true,
            rolloutPercentage: 100,
            variantKey: "on",
            conditions: {
              email: { attribute: "user.email", operator: "contains", value: "@beta.io" },
            },
          },
        },
      },
      "child-id": {
        key: "child",
        type: "string",
        enabled: true,
        defaultVariantKey: "default",
        dependsOn: "gate-id",
        variants: {
          default: { value: "default" },
          enabled: { value: "enabled" },
        },
        rules: {
          all: { priority: 0, enabled: true, rolloutPercentage: 100, variantKey: "enabled" },
        },
      },
    },
  });

  const serverResponse = await niceBackendFetch("/api/latest/feature-flags/evaluate", {
    method: "POST",
    accessType: "server",
    body: {
      distinct_id: "u",
      user: { email: "alice@beta.io" },
      flag_keys: ["child"],
    },
  });
  const bootstrapResponse = await niceBackendFetch("/api/latest/feature-flags/bootstrap", {
    method: "GET",
    accessType: "client",
  });

  const bootstrappedConfig: FeatureFlagsConfig = {
    flags: bootstrapResponse.body.flags,
    holdouts: bootstrapResponse.body.holdouts,
  };
  const localFlagId = bootstrapResponse.body.flag_ids_by_key.child;
  const localResult = evaluateFlag(localFlagId, bootstrappedConfig, {
    distinctId: "u",
    user: { email: "alice@beta.io" },
  });

  expect(localResult.value).toBe(serverResponse.body.results.child.value);
  expect(localResult.reason).toBe(serverResponse.body.results.child.reason);
});
