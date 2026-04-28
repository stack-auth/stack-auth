"use client";

import {
  DesignButton,
  DesignInput,
} from "@/components/design-components";
import {
  ActionDialog,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
  Typography,
} from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { ArrowLeftIcon, TrashIcon } from "@phosphor-icons/react";
import type { EnvironmentConfigOverrideOverride } from "@stackframe/stack-shared/dist/config/schema";
import { evaluateFlag } from "@stackframe/stack-shared/dist/feature-flags/evaluator";
import { featureFlagConditionOperators, type ConditionOperator, type EvalContext, type FeatureFlagsConfig, type FlagCondition, type FlagDef, type FlagRule, type FlagVariant } from "@stackframe/stack-shared/dist/feature-flags/types";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useRouter } from "../../../../../../../components/router";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

function tryParseJson(text: string): { ok: true, value: unknown } | { ok: false, error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function configUpdate(path: string, value: unknown): EnvironmentConfigOverrideOverride {
  // Dynamic dotted config paths are validated by the config schema before saving, but TS cannot
  // express arbitrary `featureFlags.flags.${flagId}...` keys. Keep the escape hatch narrow.
  return { [path]: value } as EnvironmentConfigOverrideOverride;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isConditionOperator(value: unknown): value is ConditionOperator {
  return featureFlagConditionOperators.some(operator => operator === value);
}

function validateVariants(value: unknown): { ok: true, value: Record<string, FlagVariant> } | { ok: false, error: string } {
  if (!isRecord(value)) return { ok: false, error: "Variants must be a JSON object keyed by variant id" };
  const variants: Record<string, FlagVariant> = {};
  for (const [variantKey, variant] of Object.entries(value)) {
    if (!isRecord(variant)) return { ok: false, error: `Variant "${variantKey}" must be an object` };
    variants[variantKey] = { value: variant.value };
  }
  return { ok: true, value: variants };
}

function validateRules(value: unknown): { ok: true, value: Record<string, FlagRule> } | { ok: false, error: string } {
  if (!isRecord(value)) return { ok: false, error: "Rules must be a JSON object keyed by rule id" };
  const rules: Record<string, FlagRule> = {};
  for (const [ruleKey, rule] of Object.entries(value)) {
    if (!isRecord(rule)) return { ok: false, error: `Rule "${ruleKey}" must be an object` };
    const outputRule: FlagRule = {};
    const priority = rule.priority;
    if (priority !== undefined) {
      if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0) {
        return { ok: false, error: `Rule "${ruleKey}" priority must be a non-negative integer` };
      }
      outputRule.priority = priority;
    }
    const enabled = rule.enabled;
    if (enabled !== undefined) {
      if (typeof enabled !== "boolean") return { ok: false, error: `Rule "${ruleKey}" enabled must be a boolean` };
      outputRule.enabled = enabled;
    }
    const rolloutPercentage = rule.rolloutPercentage;
    if (rolloutPercentage !== undefined) {
      if (typeof rolloutPercentage !== "number" || rolloutPercentage < 0 || rolloutPercentage > 100) {
        return { ok: false, error: `Rule "${ruleKey}" rolloutPercentage must be a number from 0 to 100` };
      }
      outputRule.rolloutPercentage = rolloutPercentage;
    }
    const rolloutSeed = rule.rolloutSeed;
    if (rolloutSeed !== undefined) {
      if (typeof rolloutSeed !== "string") return { ok: false, error: `Rule "${ruleKey}" rolloutSeed must be a string` };
      outputRule.rolloutSeed = rolloutSeed;
    }
    const stickyBy = rule.stickyBy;
    if (stickyBy !== undefined) {
      if (stickyBy !== "userId" && stickyBy !== "teamId" && stickyBy !== "distinctId") {
        return { ok: false, error: `Rule "${ruleKey}" stickyBy must be userId, teamId, or distinctId` };
      }
      outputRule.stickyBy = stickyBy;
    }
    const variantKey = rule.variantKey;
    if (variantKey !== undefined) {
      if (typeof variantKey !== "string") return { ok: false, error: `Rule "${ruleKey}" variantKey must be a string` };
      outputRule.variantKey = variantKey;
    }
    const variantWeights = rule.variantWeights;
    if (variantWeights !== undefined) {
      if (!isRecord(variantWeights)) return { ok: false, error: `Rule "${ruleKey}" variantWeights must be an object` };
      const outputVariantWeights: Record<string, number> = {};
      for (const [variantWeightKey, weight] of Object.entries(variantWeights)) {
        if (typeof weight !== "number" || weight < 0 || weight > 1) {
          return { ok: false, error: `Rule "${ruleKey}" variantWeights.${variantWeightKey} must be a number from 0 to 1` };
        }
        outputVariantWeights[variantWeightKey] = weight;
      }
      if (Object.values(outputVariantWeights).length === 0 || !Object.values(outputVariantWeights).some(weight => weight > 0)) {
        return { ok: false, error: `Rule "${ruleKey}" variantWeights must include at least one positive weight` };
      }
      outputRule.variantWeights = outputVariantWeights;
    }
    if ((outputRule.variantKey !== undefined) === (outputRule.variantWeights !== undefined)) {
      return { ok: false, error: `Rule "${ruleKey}" must specify exactly one of variantKey or variantWeights` };
    }
    const conditions = rule.conditions;
    if (conditions !== undefined) {
      if (!isRecord(conditions)) return { ok: false, error: `Rule "${ruleKey}" conditions must be an object` };
      const outputConditions: Record<string, FlagCondition> = {};
      for (const [conditionKey, condition] of Object.entries(conditions)) {
        if (!isRecord(condition)) return { ok: false, error: `Condition "${conditionKey}" in rule "${ruleKey}" must be an object` };
        if (typeof condition.attribute !== "string") return { ok: false, error: `Condition "${conditionKey}" in rule "${ruleKey}" needs a string attribute` };
        if (!isConditionOperator(condition.operator)) return { ok: false, error: `Condition "${conditionKey}" in rule "${ruleKey}" has an invalid operator` };
        outputConditions[conditionKey] = {
          attribute: condition.attribute,
          operator: condition.operator,
          value: condition.value,
        };
      }
      outputRule.conditions = outputConditions;
    }
    rules[ruleKey] = outputRule;
  }
  return { ok: true, value: rules };
}

function validateEvalContext(value: unknown): { ok: true, value: EvalContext } | { ok: false, error: string } {
  if (!isRecord(value)) return { ok: false, error: "Context must be a JSON object" };
  for (const key of ["distinctId", "userId", "teamId"]) {
    if (key in value && value[key] !== undefined && typeof value[key] !== "string") {
      return { ok: false, error: `${key} must be a string` };
    }
  }
  for (const key of ["user", "team", "context"]) {
    if (key in value && value[key] !== undefined && !isRecord(value[key])) {
      return { ok: false, error: `${key} must be an object` };
    }
  }
  if ("cohorts" in value && value.cohorts !== undefined) {
    if (!isRecord(value.cohorts)) return { ok: false, error: "cohorts must be an object" };
    for (const [cohortKey, isMember] of Object.entries(value.cohorts)) {
      if (typeof isMember !== "boolean") return { ok: false, error: `cohorts.${cohortKey} must be a boolean` };
    }
  }
  return { ok: true, value };
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const router = useRouter();
  const updateConfig = useUpdateConfig();
  const { flagId } = useParams<{ flagId: string }>();

  const config = project.useConfig();
  const flag = config.featureFlags.flags[flagId] as FlagDef | undefined;

  // Local edit buffers — variants and rules round-trip as JSON in v1; the visual rule builder lives
  // in a follow-up. State is initialized lazily from the canonical config and the operator hits
  // "Save" to push.
  const initialVariantsJson = useMemo(() => JSON.stringify(flag?.variants ?? {}, null, 2), [flag?.variants]);
  const initialRulesJson = useMemo(() => JSON.stringify(flag?.rules ?? {}, null, 2), [flag?.rules]);

  const [description, setDescription] = useState(flag?.description ?? "");
  const [defaultVariantKey, setDefaultVariantKey] = useState(flag?.defaultVariantKey ?? "");
  const [variantsJson, setVariantsJson] = useState(initialVariantsJson);
  const [rulesJson, setRulesJson] = useState(initialRulesJson);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Debug evaluator panel.
  const [debugContextJson, setDebugContextJson] = useState('{\n  "distinctId": "test-user",\n  "user": { "email": "alice@example.com" }\n}');

  if (!flag) {
    return (
      <AppEnabledGuard appId="feature-flags">
        <PageLayout title="Flag not found" description="This flag does not exist or was deleted.">
          <DesignButton variant="outline" onClick={() => router.push(`/projects/${project.id}/feature-flags`)}>
            <ArrowLeftIcon className="h-4 w-4 mr-2" /> Back to flags
          </DesignButton>
        </PageLayout>
      </AppEnabledGuard>
    );
  }

  const handleToggleEnabled = async (next: boolean) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: { [`featureFlags.flags.${flagId}.enabled`]: next },
      pushable: true,
    });
  };

  const handleToggleKillSwitch = async (next: boolean) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: { [`featureFlags.flags.${flagId}.killSwitch`]: next },
      pushable: true,
    });
  };

  const handleSaveMetadata = async () => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        ...configUpdate(`featureFlags.flags.${flagId}.description`, description.trim() || null),
        ...configUpdate(`featureFlags.flags.${flagId}.defaultVariantKey`, defaultVariantKey.trim() || null),
      },
      pushable: true,
    });
    toast({ title: "Saved" });
  };

  const handleSaveVariants = async () => {
    const parsed = tryParseJson(variantsJson);
    if (!parsed.ok) {
      alert(`Invalid JSON: ${parsed.error}`);
      return;
    }
    const variants = validateVariants(parsed.value);
    if (!variants.ok) {
      alert(variants.error);
      return;
    }
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: configUpdate(`featureFlags.flags.${flagId}.variants`, variants.value),
      pushable: true,
    });
    toast({ title: "Variants saved" });
  };

  const handleSaveRules = async () => {
    const parsed = tryParseJson(rulesJson);
    if (!parsed.ok) {
      alert(`Invalid JSON: ${parsed.error}`);
      return;
    }
    const rules = validateRules(parsed.value);
    if (!rules.ok) {
      alert(rules.error);
      return;
    }
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: configUpdate(`featureFlags.flags.${flagId}.rules`, rules.value),
      pushable: true,
    });
    toast({ title: "Rules saved" });
  };

  const handleDelete = async () => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: { [`featureFlags.flags.${flagId}`]: null },
      pushable: true,
    });
    toast({ title: "Flag deleted" });
    router.push(`/projects/${project.id}/feature-flags`);
  };

  // Live evaluation against current config + the JSON-edited debug context.
  const debugResult = (() => {
    const parsed = tryParseJson(debugContextJson);
    if (!parsed.ok) return { error: parsed.error };
    const ctx = validateEvalContext(parsed.value);
    if (!ctx.ok) return { error: ctx.error };
    const cfg: FeatureFlagsConfig = config.featureFlags;
    return { result: evaluateFlag(flagId, cfg, ctx.value) };
  })();

  const variantOptions = typedEntries(flag.variants ?? {}).map(([key]) => key);

  return (
    <AppEnabledGuard appId="feature-flags">
      <PageLayout
        title={flag.key || flagId}
        description={`${flag.type ?? "boolean"} flag · id ${flagId}`}
        actions={
          <DesignButton variant="destructive" onClick={() => setIsDeleteOpen(true)}>
            <TrashIcon className="h-4 w-4 mr-2" /> Delete
          </DesignButton>
        }
      >
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Kill switch overrides everything; disabled hides the flag from rules.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enabled</Label>
                  <Typography type="footnote" variant="secondary">When off, the flag returns its default variant.</Typography>
                </div>
                <Switch checked={flag.enabled !== false} onCheckedChange={handleToggleEnabled} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Kill switch</Label>
                  <Typography type="footnote" variant="secondary">Force the default for everyone, ignoring rules.</Typography>
                </div>
                <Switch checked={Boolean(flag.killSwitch)} onCheckedChange={handleToggleKillSwitch} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <DesignInput
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this flag control?"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultVariantKey">Default variant</Label>
                {variantOptions.length > 0 ? (
                  <Select value={defaultVariantKey} onValueChange={setDefaultVariantKey}>
                    <SelectTrigger id="defaultVariantKey">
                      <SelectValue placeholder="Pick a variant" />
                    </SelectTrigger>
                    <SelectContent>
                      {variantOptions.map(key => (
                        <SelectItem key={key} value={key!}>{key}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <DesignInput
                    id="defaultVariantKey"
                    value={defaultVariantKey}
                    onChange={(e) => setDefaultVariantKey(e.target.value)}
                    placeholder="e.g., off"
                  />
                )}
                <Typography type="footnote" variant="secondary">
                  Returned when no rule matches, when the flag is disabled, or when the kill switch is on.
                </Typography>
              </div>
              <DesignButton onClick={handleSaveMetadata}>Save metadata</DesignButton>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Variants</CardTitle>
              <CardDescription>JSON keyed by variant id. Each variant has a `value`; split weights live on rules as `variantWeights`.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={10}
                value={variantsJson}
                onChange={(e) => setVariantsJson(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <DesignButton onClick={handleSaveVariants}>Save variants</DesignButton>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rules</CardTitle>
              <CardDescription>JSON keyed by rule id. Higher `priority` evaluates first; the first matching rule whose rollout bucket contains the user wins.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={14}
                value={rulesJson}
                onChange={(e) => setRulesJson(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <DesignButton onClick={handleSaveRules}>Save rules</DesignButton>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evaluate as user</CardTitle>
              <CardDescription>
                Runs the same evaluator the API and SDKs use, against unsaved config in this branch. Edit the context JSON below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={6}
                value={debugContextJson}
                onChange={(e) => setDebugContextJson(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <pre className="text-xs bg-foreground/[0.04] rounded p-3 overflow-auto">
                {"error" in debugResult
                  ? `Invalid context JSON: ${debugResult.error}`
                  : JSON.stringify(debugResult.result, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>

        <ActionDialog
          open={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
          title="Delete feature flag"
          description={`Permanently delete the flag "${flag.key || flagId}"? Code that calls this flag will start receiving the missing-flag fallback.`}
          okButton={{ label: "Delete", onClick: handleDelete }}
          cancelButton
          danger
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
