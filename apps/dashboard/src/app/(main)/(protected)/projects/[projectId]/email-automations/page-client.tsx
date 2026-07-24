"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignDialogClose,
  DesignEmptyState,
  DesignInput,
  DesignMenu,
  DesignPillToggle,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { StyledLink } from "@/components/link";
import { Label, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/components/config-update";
import { sendAdminInternalRequestOrThrow } from "@/lib/hexclave-app-internals";
import { cn } from "@/lib/utils";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridState,
} from "@hexclave/dashboard-ui-components";
import {
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  LightningIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlayIcon,
  TrashIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { getUserSpecifiedIdErrorMessage, isValidUserSpecifiedId, sanitizeUserSpecifiedId } from "@hexclave/shared/dist/schema-fields";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const THEME_DEFAULT_VALUE = "__project_default__";
const CADENCE_DEFAULT_VALUE = "__scheduler_default__";
const DEFAULT_LIMIT = 100;

type AutomationCadence = "every-15-minutes" | "hourly" | "every-6-hours" | "daily";

const cadenceOptions: SelectorOption[] = [
  { value: CADENCE_DEFAULT_VALUE, label: "Default (every scheduler cycle)" },
  { value: "every-15-minutes", label: "Every 15 minutes" },
  { value: "hourly", label: "Every hour" },
  { value: "every-6-hours", label: "Every 6 hours" },
  { value: "daily", label: "Daily" },
];

type UsageEmailAutomationRule = {
  displayName?: string,
  enabled: boolean,
  source: {
    type: "payments-item-quota",
    itemId: string,
    customerType: "user",
    thresholds: {
      nearRemainingRatio?: number,
      nearRemainingQuantity?: number,
      overLimitQuantity?: number,
    },
  },
  action: {
    type: "send-email",
    templateId: string,
    themeId?: string | null,
    subject?: string,
    notificationCategoryName?: "Marketing",
  },
  cooldown: {
    days: number,
  },
  schedule?: {
    cadence?: AutomationCadence,
  },
};

type ConfigUpdater<TAdminApp> = (options: {
  adminApp: TAdminApp,
  configUpdate: Parameters<ReturnType<typeof useUpdateConfig>>[0]["configUpdate"],
  pushable: boolean,
}) => Promise<unknown>;

type RuleEntry = {
  ruleId: string,
  rule: UsageEmailAutomationRule,
};

type SelectorOption = {
  value: string,
  label: string,
};

type RuleEditorDraft = {
  ruleId: string,
  displayName: string,
  enabled: boolean,
  itemId: string,
  nearRemainingRatio: string,
  nearRemainingQuantity: string,
  overLimitQuantity: string,
  templateId: string,
  themeId: string,
  subject: string,
  cooldownDays: string,
  cadence?: string,
};

type MissingPrerequisite = "paymentsItem" | "emailTemplate";

type AutomationDecision = {
  subjectType: "user",
  subjectId: string,
  thresholdKind: "near" | "over",
  currentQuantity: number,
  entitlementQuantity: number | null,
  blocked: boolean,
  sent?: boolean,
  outcome?: "sent" | "suppressed" | "deferred",
  skipReason?: string,
  deferredStage?: "enqueue" | "completion",
  retryAtMillis?: number,
  hasPrimaryEmail?: boolean,
};

type AutomationRouteResult = {
  ruleId: string,
  mode: "dry-run" | "run",
  evaluatedCount: number,
  eligibleCount: number,
  suppressedCount: number,
  sentCount?: number,
  deferredCount?: number,
  nextCursor: string | null,
  decisions: AutomationDecision[],
};

type DialogMode =
  | { type: "create" }
  | { type: "edit", entry: RuleEntry };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readAutomationCadence(value: unknown): AutomationCadence | undefined {
  return value === "every-15-minutes"
    || value === "hourly"
    || value === "every-6-hours"
    || value === "daily"
    ? value
    : undefined;
}

export function readRules(config: unknown): RuleEntry[] {
  if (!isRecord(config)) return [];
  const automations = isRecord(config.automations) ? config.automations : undefined;
  const rules = isRecord(automations?.rules) ? automations.rules : undefined;
  if (rules === undefined) return [];

  return Object.entries(rules).flatMap(([ruleId, rawRule]) => {
    const rule = parseRule(rawRule);
    return rule === undefined ? [] : [{ ruleId, rule }];
  });
}

function parseRule(rawRule: unknown): UsageEmailAutomationRule | undefined {
  if (!isRecord(rawRule)) return undefined;
  const source = isRecord(rawRule.source) ? rawRule.source : undefined;
  const action = isRecord(rawRule.action) ? rawRule.action : undefined;
  const cooldown = isRecord(rawRule.cooldown) ? rawRule.cooldown : undefined;
  const schedule = rawRule.schedule === undefined
    ? undefined
    : isRecord(rawRule.schedule)
      ? rawRule.schedule
      : undefined;
  const thresholds = isRecord(source?.thresholds) ? source.thresholds : undefined;
  if (
    source === undefined
    || action === undefined
    || cooldown === undefined
    || thresholds === undefined
    || readString(source.type) !== "payments-item-quota"
    || readString(source.customerType) !== "user"
    || readString(action.type) !== "send-email"
  ) {
    return undefined;
  }

  const itemId = readString(source.itemId);
  const templateId = readString(action.templateId);
  const cooldownDays = readNumber(cooldown.days);
  const cadence = schedule === undefined ? undefined : readAutomationCadence(schedule.cadence);
  if (
    itemId === undefined
    || templateId === undefined
    || cooldownDays === undefined
    || (rawRule.schedule !== undefined && schedule === undefined)
    || (schedule !== undefined && schedule.cadence !== undefined && cadence === undefined)
  ) {
    return undefined;
  }

  return {
    ...(readString(rawRule.displayName) === undefined ? {} : { displayName: readString(rawRule.displayName) }),
    enabled: readBoolean(rawRule.enabled) ?? false,
    source: {
      type: "payments-item-quota",
      itemId,
      customerType: "user",
      thresholds: {
        ...(readNumber(thresholds.nearRemainingRatio) === undefined ? {} : { nearRemainingRatio: readNumber(thresholds.nearRemainingRatio) }),
        ...(readNumber(thresholds.nearRemainingQuantity) === undefined ? {} : { nearRemainingQuantity: readNumber(thresholds.nearRemainingQuantity) }),
        ...(readNumber(thresholds.overLimitQuantity) === undefined ? {} : { overLimitQuantity: readNumber(thresholds.overLimitQuantity) }),
      },
    },
    action: {
      type: "send-email",
      templateId,
      ...(readString(action.themeId) === undefined && action.themeId !== null ? {} : { themeId: action.themeId === null ? null : readString(action.themeId) }),
      ...(readString(action.subject) === undefined ? {} : { subject: readString(action.subject) }),
      notificationCategoryName: "Marketing",
    },
    cooldown: {
      days: cooldownDays,
    },
    ...(cadence === undefined ? {} : { schedule: { cadence } }),
  };
}

export function readUserItemOptions(config: unknown): SelectorOption[] {
  if (!isRecord(config)) return [];
  const payments = isRecord(config.payments) ? config.payments : undefined;
  const items = isRecord(payments?.items) ? payments.items : undefined;
  if (items === undefined) return [];

  return Object.entries(items).flatMap(([itemId, rawItem]) => {
    if (!isRecord(rawItem) || readString(rawItem.customerType) !== "user") {
      return [];
    }
    return [{
      value: itemId,
      label: readString(rawItem.displayName) ?? itemId,
    }];
  });
}

function readTemplateOptions(rawTemplates: unknown): SelectorOption[] {
  if (!Array.isArray(rawTemplates)) return [];
  return rawTemplates.flatMap((rawTemplate) => {
    if (!isRecord(rawTemplate)) return [];
    const id = readString(rawTemplate.id);
    if (id === undefined) return [];
    return [{
      value: id,
      label: readString(rawTemplate.displayName) ?? id,
    }];
  });
}

function readThemeOptions(rawThemes: unknown): SelectorOption[] {
  if (!Array.isArray(rawThemes)) return [];
  return rawThemes.flatMap((rawTheme) => {
    if (!isRecord(rawTheme)) return [];
    const id = readString(rawTheme.id);
    if (id === undefined) return [];
    return [{
      value: id,
      label: readString(rawTheme.displayName) ?? id,
    }];
  });
}

function createDraft(mode: DialogMode, existingRuleIds: string[], itemOptions: SelectorOption[], templateOptions: SelectorOption[], themeOptions: SelectorOption[]): RuleEditorDraft {
  if (mode.type === "edit") {
    const { ruleId, rule } = mode.entry;
    return {
      ruleId,
      displayName: rule.displayName ?? ruleId,
      enabled: rule.enabled,
      itemId: rule.source.itemId,
      nearRemainingRatio: rule.source.thresholds.nearRemainingRatio === undefined ? "" : String(rule.source.thresholds.nearRemainingRatio),
      nearRemainingQuantity: rule.source.thresholds.nearRemainingQuantity === undefined ? "" : String(rule.source.thresholds.nearRemainingQuantity),
      overLimitQuantity: rule.source.thresholds.overLimitQuantity === undefined ? "" : String(rule.source.thresholds.overLimitQuantity),
      templateId: rule.action.templateId,
      themeId: rule.action.themeId ?? THEME_DEFAULT_VALUE,
      subject: rule.action.subject ?? "",
      cooldownDays: String(rule.cooldown.days),
      cadence: rule.schedule?.cadence ?? CADENCE_DEFAULT_VALUE,
    };
  }

  return {
    ruleId: nextRuleId(existingRuleIds),
    displayName: "Usage upgrade email",
    enabled: true,
    itemId: itemOptions[0]?.value ?? "",
    nearRemainingRatio: "",
    nearRemainingQuantity: "",
    overLimitQuantity: "",
    templateId: templateOptions[0]?.value ?? "",
    themeId: themeOptions[0]?.value ?? THEME_DEFAULT_VALUE,
    subject: "",
    cooldownDays: "7",
    cadence: CADENCE_DEFAULT_VALUE,
  };
}

function nextRuleId(existingRuleIds: string[]) {
  const base = "usage-upgrade-email";
  if (!existingRuleIds.includes(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingRuleIds.includes(candidate)) return candidate;
  }
  throw new Error("Could not find an available usage email automation rule ID");
}

function parseOptionalNonNegativeNumber(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return parsed;
}

export function buildRuleFromDraft(draft: RuleEditorDraft): UsageEmailAutomationRule {
  const nearRemainingRatio = parseOptionalNonNegativeNumber(draft.nearRemainingRatio, "Near remaining ratio");
  if (nearRemainingRatio !== undefined && (nearRemainingRatio <= 0 || nearRemainingRatio > 1)) {
    throw new Error("Near remaining ratio must be greater than 0 and less than or equal to 1");
  }
  const nearRemainingQuantity = parseOptionalNonNegativeNumber(draft.nearRemainingQuantity, "Near remaining quantity");
  const overLimitQuantity = parseOptionalNonNegativeNumber(draft.overLimitQuantity, "Over-limit quantity");
  if (nearRemainingRatio === undefined && nearRemainingQuantity === undefined && overLimitQuantity === undefined) {
    throw new Error("At least one threshold is required");
  }

  const cooldownDays = Number(draft.cooldownDays);
  if (!Number.isInteger(cooldownDays) || cooldownDays < 1) {
    throw new Error("Cooldown days must be a positive integer");
  }
  if (draft.itemId.trim() === "") {
    throw new Error("A Payments item is required");
  }
  if (draft.templateId.trim() === "") {
    throw new Error("An email template is required");
  }

  return {
    ...(draft.displayName.trim() === "" ? {} : { displayName: draft.displayName.trim() }),
    enabled: draft.enabled,
    source: {
      type: "payments-item-quota",
      itemId: draft.itemId,
      customerType: "user",
      thresholds: {
        ...(nearRemainingRatio === undefined ? {} : { nearRemainingRatio }),
        ...(nearRemainingQuantity === undefined ? {} : { nearRemainingQuantity }),
        ...(overLimitQuantity === undefined ? {} : { overLimitQuantity }),
      },
    },
    action: {
      type: "send-email",
      templateId: draft.templateId,
      ...(draft.themeId === THEME_DEFAULT_VALUE ? {} : { themeId: draft.themeId }),
      ...(draft.subject.trim() === "" ? {} : { subject: draft.subject.trim() }),
      notificationCategoryName: "Marketing",
    },
    cooldown: {
      days: cooldownDays,
    },
    ...((draft.cadence ?? CADENCE_DEFAULT_VALUE) === CADENCE_DEFAULT_VALUE ? {} : {
      schedule: {
        cadence: readAutomationCadence(draft.cadence) ?? throwErr(`Unsupported automation cadence "${draft.cadence ?? "<missing>"}"`),
      },
    }),
  };
}

export function getMissingPrerequisites(itemOptions: SelectorOption[], templateOptions: SelectorOption[]): MissingPrerequisite[] {
  const missingPrerequisites: MissingPrerequisite[] = [];
  if (itemOptions.length === 0) {
    missingPrerequisites.push("paymentsItem");
  }
  if (templateOptions.length === 0) {
    missingPrerequisites.push("emailTemplate");
  }
  return missingPrerequisites;
}

function formatThresholds(rule: UsageEmailAutomationRule) {
  const thresholds = rule.source.thresholds;
  const limitsParts = [
    thresholds.nearRemainingRatio === undefined ? undefined : `${Math.round(thresholds.nearRemainingRatio * 100)}%`,
    thresholds.nearRemainingQuantity === undefined ? undefined : `${thresholds.nearRemainingQuantity}`,
  ].filter((part) => part !== undefined);

  const parts: string[] = [];
  if (limitsParts.length > 0) {
    parts.push(`Limits: ${limitsParts.join(" or ")}`);
  }
  if (thresholds.overLimitQuantity !== undefined) {
    parts.push(`Cutoff: ${thresholds.overLimitQuantity}`);
  }
  return parts.join(", ");
}

export function formatAutomationCadence(cadence: AutomationCadence | undefined) {
  if (cadence === undefined) return "Every Scheduler Cycle";
  return cadenceOptions.find((option) => option.value === cadence)?.label
    ?? throwErr(`Unsupported automation cadence "${cadence}"`);
}

function formatItem(itemOptions: SelectorOption[], itemId: string) {
  return itemOptions.find((item) => item.value === itemId)?.label ?? itemId;
}

function formatTemplate(templateOptions: SelectorOption[], templateId: string) {
  return templateOptions.find((template) => template.value === templateId)?.label ?? templateId;
}

const unsafeAutomationRuleConfigPathKeys = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeAutomationRuleConfigPathId(ruleId: string) {
  if (!isValidUserSpecifiedId(ruleId) || unsafeAutomationRuleConfigPathKeys.has(ruleId)) {
    throw new Error(`Unsafe usage email rule ID "${ruleId}" cannot be used in a config path.`);
  }
}

export async function saveUsageEmailAutomationRule<TAdminApp>(options: {
  applyConfigUpdate: ConfigUpdater<TAdminApp>,
  adminApp: TAdminApp,
  ruleId: string,
  rule: UsageEmailAutomationRule,
}) {
  assertSafeAutomationRuleConfigPathId(options.ruleId);
  await options.applyConfigUpdate({
    adminApp: options.adminApp,
    configUpdate: { [`automations.rules.${options.ruleId}`]: options.rule },
    pushable: true,
  });
}

export async function deleteUsageEmailAutomationRule<TAdminApp>(options: {
  applyConfigUpdate: ConfigUpdater<TAdminApp>,
  adminApp: TAdminApp,
  ruleId: string,
}) {
  assertSafeAutomationRuleConfigPathId(options.ruleId);
  await options.applyConfigUpdate({
    adminApp: options.adminApp,
    configUpdate: { [`automations.rules.${options.ruleId}`]: null },
    pushable: true,
  });
}

function requireStringFromRecord(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Automation response is missing string field "${key}"`);
  }
  return value;
}

function requireNumberFromRecord(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Automation response is missing number field "${key}"`);
  }
  return value;
}

function requireBooleanFromRecord(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Automation response is missing boolean field "${key}"`);
  }
  return value;
}

export function parseAutomationRouteResult(value: unknown): AutomationRouteResult {
  if (!isRecord(value) || !Array.isArray(value.decisions)) {
    throw new Error("Automation response did not match the expected shape");
  }
  const mode = requireStringFromRecord(value, "mode");
  if (mode !== "dry-run" && mode !== "run") {
    throw new Error(`Automation response mode "${mode}" is unsupported`);
  }

  return {
    ruleId: requireStringFromRecord(value, "rule_id"),
    mode,
    evaluatedCount: requireNumberFromRecord(value, "evaluated_count"),
    eligibleCount: requireNumberFromRecord(value, "eligible_count"),
    suppressedCount: requireNumberFromRecord(value, "suppressed_count"),
    sentCount: readNumber(value.sent_count),
    deferredCount: readNumber(value.deferred_count),
    nextCursor: value.next_cursor === null ? null : requireStringFromRecord(value, "next_cursor"),
    decisions: value.decisions.map((rawDecision) => parseDecision(rawDecision)),
  };
}

function parseDecision(rawDecision: unknown): AutomationDecision {
  if (!isRecord(rawDecision)) {
    throw new Error("Automation response decision did not match the expected shape");
  }
  const source = isRecord(rawDecision.source) ? rawDecision.source : undefined;
  const cooldown = isRecord(rawDecision.cooldown) ? rawDecision.cooldown : undefined;
  const recipient = isRecord(rawDecision.recipient) ? rawDecision.recipient : undefined;
  const deferred = rawDecision.deferred === undefined
    ? undefined
    : isRecord(rawDecision.deferred)
      ? rawDecision.deferred
      : throwErr("Automation response deferred metadata did not match the expected shape");
  if (source === undefined || cooldown === undefined) {
    throw new Error("Automation response decision did not match the expected shape");
  }
  const subjectType = requireStringFromRecord(rawDecision, "subject_type");
  if (subjectType !== "user") {
    throw new Error(`Automation response subject_type "${subjectType}" is unsupported`);
  }
  const thresholdKind = requireStringFromRecord(source, "threshold_kind");
  if (thresholdKind !== "near" && thresholdKind !== "over") {
    throw new Error(`Automation response threshold_kind "${thresholdKind}" is unsupported`);
  }
  const rawOutcome = readString(rawDecision.outcome);
  const outcome = rawOutcome === undefined
    ? undefined
    : rawOutcome === "sent" || rawOutcome === "suppressed" || rawOutcome === "deferred"
      ? rawOutcome
      : throwErr(`Automation response outcome "${rawOutcome}" is unsupported`);
  if (outcome === "deferred" && deferred === undefined) {
    throw new Error("Automation response deferred outcome is missing deferred metadata");
  }
  if (outcome !== "deferred" && deferred !== undefined) {
    throw new Error(`Automation response outcome "${outcome ?? "<missing>"}" must not include deferred metadata`);
  }
  const rawDeferredStage = deferred === undefined ? undefined : requireStringFromRecord(deferred, "stage");
  const deferredStage = rawDeferredStage === undefined
    ? undefined
    : rawDeferredStage === "enqueue" || rawDeferredStage === "completion"
      ? rawDeferredStage
      : throwErr(`Automation response deferred stage "${rawDeferredStage}" is unsupported`);

  return {
    subjectType,
    subjectId: requireStringFromRecord(rawDecision, "subject_id"),
    thresholdKind,
    currentQuantity: requireNumberFromRecord(source, "current_quantity"),
    entitlementQuantity: source.entitlement_quantity === null ? null : requireNumberFromRecord(source, "entitlement_quantity"),
    blocked: requireBooleanFromRecord(cooldown, "blocked"),
    sent: readBoolean(rawDecision.sent),
    outcome,
    skipReason: readString(rawDecision.skip_reason),
    deferredStage,
    retryAtMillis: deferred === undefined ? undefined : requireNumberFromRecord(deferred, "retry_at_millis"),
    hasPrimaryEmail: recipient === undefined ? undefined : readBoolean(recipient.has_primary_email),
  };
}

async function requestAutomationRun(adminApp: object, ruleId: string, mode: "dry-run" | "run"): Promise<AutomationRouteResult> {
  const response = await sendAdminInternalRequestOrThrow(
    adminApp,
    `/internal/automations/rules/${encodeURIComponent(ruleId)}/${mode}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: DEFAULT_LIMIT }),
    },
  );
  if (!response.ok) {
    throw new Error(`Automation ${mode} failed with status ${response.status}`);
  }
  return parseAutomationRouteResult(await response.json());
}

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const config = project.useConfig();
  const emailTemplates = hexclaveAdminApp.useEmailTemplates();
  const emailThemes = hexclaveAdminApp.useEmailThemes();
  const updateConfig = useUpdateConfig();
  const rules = useMemo(() => readRules(config), [config]);
  const itemOptions = useMemo(() => readUserItemOptions(config), [config]);
  const templateOptions = useMemo(() => readTemplateOptions(emailTemplates), [emailTemplates]);
  const themeOptions = useMemo(() => [
    { value: THEME_DEFAULT_VALUE, label: "Project default" },
    ...readThemeOptions(emailThemes),
  ], [emailThemes]);
  const [editorMode, setEditorMode] = useState<DialogMode | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<RuleEntry | null>(null);
  const [dryRunEntry, setDryRunEntry] = useState<RuleEntry | null>(null);
  const [sendEntry, setSendEntry] = useState<RuleEntry | null>(null);
  const paymentsItemsHref = urlString`/projects/${hexclaveAdminApp.projectId}/payments/products`;

  const saveRule = async (ruleId: string, rule: UsageEmailAutomationRule) => {
    await saveUsageEmailAutomationRule({
      applyConfigUpdate: updateConfig,
      adminApp: hexclaveAdminApp,
      ruleId,
      rule,
    });
  };

  const deleteRule = async (ruleId: string) => {
    await deleteUsageEmailAutomationRule({
      applyConfigUpdate: updateConfig,
      adminApp: hexclaveAdminApp,
      ruleId,
    });
  };

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Automations"
        description="Automatically notify your customers when their product limits or credits are running low."
        actions={(
          <DesignButton size="sm" onClick={() => setEditorMode({ type: "create" })}>
            New Email Rule
          </DesignButton>
        )}
      >
        <div className="space-y-4">
          <DesignAlert
            variant="info"
            title="Trigger Source Setup"
            description="This automation relies on your hexclave payments products and user quotas to monitor limits. Make sure you have configured your product offerings in the Payments section to enable these triggers."
          />

          <DesignCard
            title="Email Rules"
            subtitle="Define when and how emails are automatically triggered based on your users' remaining limits and credits."
            icon={LightningIcon}
            glassmorphic
          >
            {rules.length === 0 ? (
              <DesignEmptyState
                icon={EnvelopeSimpleIcon}
                title="No email rules defined yet"
                description="Create an email rule to automatically notify users when they are close to running out of credits or limits."
              >
                <DesignButton size="sm" onClick={() => setEditorMode({ type: "create" })}>
                  New Email Rule
                </DesignButton>
              </DesignEmptyState>
            ) : (
              <div className="space-y-3">
                {rules.map((entry) => (
                  <div
                    key={entry.ruleId}
                    className={cn(
                      "w-full group relative flex flex-col lg:flex-row lg:items-center justify-between p-4 rounded-2xl transition-all duration-150 hover:transition-none text-left gap-4",
                      "bg-white/90 dark:bg-background/60 backdrop-blur-xl ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
                      "shadow-sm hover:shadow-md"
                    )}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
                    <div className="relative flex items-center gap-4">
                      <div className="p-2.5 rounded-xl bg-black/[0.08] dark:bg-white/[0.04] ring-1 ring-black/[0.1] dark:ring-white/[0.06] transition-colors duration-150 group-hover:bg-black/[0.12] dark:group-hover:bg-white/[0.08] group-hover:transition-none">
                        <EnvelopeSimpleIcon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground">{entry.rule.displayName ?? entry.ruleId}</span>
                        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
                          {entry.rule.enabled ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Enabled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              Disabled
                            </span>
                          )}
                          <span className="text-muted-foreground/40">·</span>
                          <span>{formatItem(itemOptions, entry.rule.source.itemId)}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span>{formatThresholds(entry.rule)}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span>{entry.rule.cooldown.days}-Day Cooldown</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span>{formatAutomationCadence(entry.rule.schedule?.cadence)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="relative flex flex-wrap items-center gap-1.5 lg:ml-auto justify-end shrink-0" onClick={(e) => e.stopPropagation()}>
                      <DesignButton
                        size="sm"
                        onClick={() => setDryRunEntry(entry)}
                        className="gap-1 h-7 px-2.5 text-[11px] rounded-lg font-medium"
                      >
                        <PlayIcon className="h-3 w-3 shrink-0" />
                        Preview
                      </DesignButton>
                      <DesignButton
                        size="sm"
                        variant="secondary"
                        disabled={!entry.rule.enabled}
                        onClick={() => setSendEntry(entry)}
                        className="gap-1 h-7 px-2.5 text-[11px] rounded-lg font-medium"
                      >
                        <PaperPlaneTiltIcon className="h-3 w-3 shrink-0" />
                        Send Now
                      </DesignButton>
                      <DesignMenu
                        variant="actions"
                        trigger="icon"
                        align="end"
                        withIcons
                        triggerClassName="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
                        contentClassName="min-w-[120px]"
                        items={[
                          {
                            id: "edit",
                            label: "Edit",
                            icon: <PencilSimpleIcon className="h-4 w-4" />,
                            onClick: () => setEditorMode({ type: "edit", entry }),
                          },
                          {
                            id: "delete",
                            label: "Delete",
                            icon: <TrashIcon className="h-4 w-4" />,
                            itemVariant: "destructive",
                            onClick: () => setDeleteEntry(entry),
                          },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DesignCard>

          {itemOptions.length === 0 ? (
            <DesignAlert
              variant="warning"
              title="No user Payments items"
              description="Usage email automation needs at least one Payments item with customerType=user."
            />
          ) : null}

          {templateOptions.length === 0 ? (
            <DesignAlert
              variant="warning"
              title="No email templates"
              description="Create an email template before enabling send-email automation actions."
            />
          ) : null}
        </div>

        {editorMode !== null ? (
          <RuleEditorDialog
            mode={editorMode}
            existingRuleIds={rules.map((rule) => rule.ruleId)}
            itemOptions={itemOptions}
            templateOptions={templateOptions}
            themeOptions={themeOptions}
            paymentsItemsHref={paymentsItemsHref}
            onSave={saveRule}
            onOpenChange={(open) => {
              if (!open) setEditorMode(null);
            }}
          />
        ) : null}

        {deleteEntry !== null ? (
          <DeleteRuleDialog
            entry={deleteEntry}
            onDelete={deleteRule}
            onOpenChange={(open) => {
              if (!open) setDeleteEntry(null);
            }}
          />
        ) : null}

        {dryRunEntry !== null ? (
          <RunPreviewDialog
            entry={dryRunEntry}
            mode="dry-run"
            adminApp={hexclaveAdminApp}
            onOpenChange={(open) => {
              if (!open) setDryRunEntry(null);
            }}
          />
        ) : null}

        {sendEntry !== null ? (
          <RunPreviewDialog
            entry={sendEntry}
            mode="run"
            adminApp={hexclaveAdminApp}
            onOpenChange={(open) => {
              if (!open) setSendEntry(null);
            }}
          />
        ) : null}
      </PageLayout>
    </AppEnabledGuard>
  );
}

function RuleEditorDialog(props: {
  mode: DialogMode,
  existingRuleIds: string[],
  itemOptions: SelectorOption[],
  templateOptions: SelectorOption[],
  themeOptions: SelectorOption[],
  paymentsItemsHref: string,
  onSave: (ruleId: string, rule: UsageEmailAutomationRule) => Promise<void>,
  onOpenChange: (open: boolean) => void,
}) {
  const [draft, setDraft] = useState(() => createDraft(props.mode, props.existingRuleIds, props.itemOptions, props.templateOptions, props.themeOptions));
  const [error, setError] = useState<string | null>(null);
  const isEditing = props.mode.type === "edit";
  const missingPrerequisites = getMissingPrerequisites(props.itemOptions, props.templateOptions);
  const hasMissingPrerequisites = missingPrerequisites.length > 0;

  const save = async () => {
    setError(null);
    const ruleId = draft.ruleId.trim();
    if (!isValidUserSpecifiedId(ruleId)) {
      setError(getUserSpecifiedIdErrorMessage("automationRuleId"));
      return;
    }
    if (!isEditing && props.existingRuleIds.includes(ruleId)) {
      setError("A usage email rule with this ID already exists");
      return;
    }

    try {
      await props.onSave(ruleId, buildRuleFromDraft(draft));
      props.onOpenChange(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not save usage email automation");
    }
  };

  const setDraftField = (field: keyof RuleEditorDraft, value: string | boolean) => {
    setDraft((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  return (
    <DesignDialog
      open
      onOpenChange={props.onOpenChange}
      size="3xl"
      icon={EnvelopeSimpleIcon}
      title={isEditing ? "Edit Email Rule" : "New Email Rule"}
      description="Set up a trigger condition and specify the email notification to send."
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">Cancel</DesignButton>
          </DesignDialogClose>
          <DesignButton size="sm" onClick={save} disabled={hasMissingPrerequisites}>
            {isEditing ? "Save Changes" : "Create Rule"}
          </DesignButton>
        </>
      )}
    >
      <div className="space-y-6">
        {error !== null ? (
          <DesignAlert variant="error" description={error} />
        ) : null}

        {props.itemOptions.length === 0 ? (
          <DesignAlert
            variant="warning"
            title="User Payments item required"
            description={(
              <>
                Usage Emails require a Payments item with <span className="font-mono">customerType=user</span>. Configure one in{" "}
                <StyledLink href={props.paymentsItemsHref}>
                  Payments products
                </StyledLink>
                , then return here to create this rule.
              </>
            )}
          />
        ) : null}

        {props.templateOptions.length === 0 ? (
          <DesignAlert
            variant="warning"
            title="Email template required"
            description="Usage Emails require an email template before a send-email action can be saved."
          />
        ) : null}

        {/* SECTION 0: General Identity Block */}
        <div className="grid gap-4 sm:grid-cols-12 items-end bg-foreground/[0.01] dark:bg-white/[0.01] border border-foreground/[0.05] rounded-2xl p-4">
          <div className="sm:col-span-4">
            <Field label="Rule ID">{(fieldId) => (
              <DesignInput
                id={fieldId}
                value={draft.ruleId}
                disabled={isEditing}
                onChange={(event) => setDraftField("ruleId", sanitizeUserSpecifiedId(event.target.value))}
                size="md"
                className="font-mono text-xs h-9"
              />
            )}</Field>
          </div>
          <div className="sm:col-span-5">
            <Field label="Display Name">{(fieldId) => (
              <DesignInput
                id={fieldId}
                value={draft.displayName}
                onChange={(event) => setDraftField("displayName", event.target.value)}
                size="md"
                className="h-9"
              />
            )}</Field>
          </div>
          <div className="sm:col-span-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Rule Status</span>
              <DesignPillToggle
                options={[
                  { id: "enabled", label: "Enabled" },
                  { id: "disabled", label: "Disabled" },
                ]}
                selected={draft.enabled ? "enabled" : "disabled"}
                onSelect={(id) => setDraftField("enabled", id === "enabled")}
                size="sm"
                className="w-full h-9"
              />
            </div>
          </div>
        </div>

        {/* SECTION 1: Stepper Flow */}
        <div className="relative pl-9 sm:pl-11 space-y-8 before:absolute before:left-[14px] before:top-2.5 before:bottom-6 before:w-0.5 before:bg-foreground/[0.08] dark:before:bg-white/[0.08]">

          {/* STEP 1: MONITOR TRIGGER SOURCE */}
          <div className="relative space-y-3">
            <div className="absolute left-[-35px] top-0 flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 ring-4 ring-background z-10 shadow-sm">
              <LightningIcon className="h-4 w-4" />
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 h-7">
                <Typography className="text-sm font-semibold text-foreground">1. Trigger Source</Typography>
                <DesignBadge label="Payments Users Only" color="blue" size="sm" />
              </div>
              <Typography type="label" className="text-xs text-muted-foreground block">
                Select the Payments item you want to monitor for account limits.
              </Typography>
            </div>

            <div className="bg-white/50 dark:bg-background/40 backdrop-blur-md rounded-2xl border border-foreground/[0.06] p-4 hover:border-foreground/[0.1] transition-all duration-150 hover:transition-none">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Item to Monitor">{(fieldId) => (
                  <DesignSelectorDropdown
                    triggerId={fieldId}
                    value={draft.itemId}
                    onValueChange={(value) => setDraftField("itemId", value)}
                    options={props.itemOptions}
                    placeholder="Select item"
                    disabled={props.itemOptions.length === 0}
                    size="md"
                  />
                )}</Field>
                <Field label="Cooldown Period" helper="Days">{(fieldId) => (
                  <DesignInput
                    id={fieldId}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={draft.cooldownDays}
                    onChange={(event) => setDraftField("cooldownDays", event.target.value)}
                    size="md"
                    placeholder="e.g. 7"
                  />
                )}</Field>
                <Field label="Scheduled Cadence">{(fieldId) => (
                  <DesignSelectorDropdown
                    triggerId={fieldId}
                    value={draft.cadence ?? CADENCE_DEFAULT_VALUE}
                    onValueChange={(value) => setDraftField("cadence", value)}
                    options={cadenceOptions}
                    size="md"
                  />
                )}</Field>
              </div>
              <Typography type="label" className="mt-3 block text-xs text-muted-foreground">
                Cadence applies to automatic evaluation only. Preview and Send Now remain available immediately.
              </Typography>
            </div>
          </div>

          {/* STEP 2: THRESHOLD CONDITIONS */}
          <div className="relative space-y-3">
            <div className="absolute left-[-35px] top-0 flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-4 ring-background z-10 shadow-sm">
              <WarningCircleIcon className="h-4 w-4" />
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 h-7">
                <Typography className="text-sm font-semibold text-foreground">2. Define Thresholds</Typography>
              </div>
              <Typography type="label" className="text-xs text-muted-foreground block">
                Specify the conditions under which notifications are fired. Leave a field blank to ignore it.
              </Typography>
            </div>

            <div className="bg-white/50 dark:bg-background/40 backdrop-blur-md rounded-2xl border border-foreground/[0.06] p-4 hover:border-foreground/[0.1] transition-all duration-150 hover:transition-none">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Remaining Ratio">{(fieldId) => (
                  <DesignInput
                    id={fieldId}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    max="1"
                    value={draft.nearRemainingRatio}
                    onChange={(event) => setDraftField("nearRemainingRatio", event.target.value)}
                    size="md"
                    placeholder="Between 0.0 and 1.0"
                  />
                )}</Field>
                <Field label="Remaining Quantity">{(fieldId) => (
                  <DesignInput
                    id={fieldId}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={draft.nearRemainingQuantity}
                    onChange={(event) => setDraftField("nearRemainingQuantity", event.target.value)}
                    size="md"
                    placeholder="e.g. 10"
                  />
                )}</Field>
                <Field label="Over-Limit Quantity">{(fieldId) => (
                  <DesignInput
                    id={fieldId}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={draft.overLimitQuantity}
                    onChange={(event) => setDraftField("overLimitQuantity", event.target.value)}
                    size="md"
                    placeholder="e.g. 0"
                  />
                )}</Field>
              </div>
            </div>
          </div>

          {/* STEP 3: CONFIGURE ACTION */}
          <div className="relative space-y-3">
            <div className="absolute left-[-35px] top-0 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 ring-4 ring-background z-10 shadow-sm">
              <EnvelopeSimpleIcon className="h-4 w-4" />
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 h-7">
                <Typography className="text-sm font-semibold text-foreground">3. Email Notification Action</Typography>
              </div>
              <Typography type="label" className="text-xs text-muted-foreground block">
                Design the custom email notification sent automatically to qualifying accounts.
              </Typography>
            </div>

            <div className="bg-white/50 dark:bg-background/40 backdrop-blur-md rounded-2xl border border-foreground/[0.06] p-4 hover:border-foreground/[0.1] transition-all duration-150 hover:transition-none">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Email Template">{(fieldId) => (
                  <DesignSelectorDropdown
                    triggerId={fieldId}
                    value={draft.templateId}
                    onValueChange={(value) => setDraftField("templateId", value)}
                    options={props.templateOptions}
                    placeholder="Select template"
                    disabled={props.templateOptions.length === 0}
                    size="md"
                  />
                )}</Field>
                <Field label="Theme">{(fieldId) => (
                  <DesignSelectorDropdown
                    triggerId={fieldId}
                    value={draft.themeId}
                    onValueChange={(value) => setDraftField("themeId", value)}
                    options={props.themeOptions}
                    size="md"
                  />
                )}</Field>
                <Field label="Subject Override" helper="Optional">{(fieldId) => (
                  <DesignInput
                    id={fieldId}
                    value={draft.subject}
                    onChange={(event) => setDraftField("subject", event.target.value)}
                    size="md"
                    placeholder="e.g. Action Required: Your quota is low"
                  />
                )}</Field>
                <Field label="Notification Category">{(fieldId) => (
                  <div id={fieldId} className="flex items-center justify-between rounded-xl bg-foreground/[0.02] dark:bg-white/[0.01] border border-foreground/[0.06] px-3.5 h-9">
                    <span className="text-xs text-muted-foreground">Category</span>
                    <DesignBadge label="Marketing" color="green" size="sm" />
                  </div>
                )}</Field>
              </div>
            </div>
          </div>

        </div>
      </div>
    </DesignDialog>
  );
}

function DeleteRuleDialog(props: {
  entry: RuleEntry,
  onDelete: (ruleId: string) => Promise<void>,
  onOpenChange: (open: boolean) => void,
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <DesignDialog
      open
      onOpenChange={props.onOpenChange}
      size="md"
      icon={WarningCircleIcon}
      title="Delete usage email"
      description={`Delete ${props.entry.rule.displayName ?? props.entry.ruleId} from automations.rules.`}
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">Cancel</DesignButton>
          </DesignDialogClose>
          <DesignButton
            variant="destructive"
            size="sm"
            onClick={async () => {
              setError(null);
              try {
                await props.onDelete(props.entry.ruleId);
                props.onOpenChange(false);
              } catch (caughtError) {
                setError(caughtError instanceof Error ? caughtError.message : "Could not delete usage email automation");
              }
            }}
          >
            Delete
          </DesignButton>
        </>
      )}
    >
      {error !== null ? (
        <DesignAlert variant="error" description={error} />
      ) : (
        <Typography className="text-sm text-muted-foreground">
          This removes the rule configuration only. Existing EmailOutbox delivery history is not changed.
        </Typography>
      )}
    </DesignDialog>
  );
}

function RunPreviewDialog(props: {
  entry: RuleEntry,
  mode: "dry-run" | "run",
  adminApp: object,
  onOpenChange: (open: boolean) => void,
}) {
  const [result, setResult] = useState<AutomationRouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = props.mode === "dry-run" ? "Email Rule Preview" : "Send Email Rule";
  const description = props.mode === "dry-run"
    ? "Preview which users currently qualify for this rule without sending any emails or updating their cooldown tracking."
    : "Trigger this email rule immediately. This will send real notification emails to qualifying users and update their cooldown tracking.";

  const execute = async () => {
    setError(null);
    setResult(null);
    try {
      setResult(await requestAutomationRun(props.adminApp, props.entry.ruleId, props.mode));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Automation request failed");
    }
  };

  return (
    <DesignDialog
      open
      onOpenChange={props.onOpenChange}
      size="5xl"
      icon={props.mode === "dry-run" ? PlayIcon : PaperPlaneTiltIcon}
      title={title}
      description={description}
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">Close</DesignButton>
          </DesignDialogClose>
          <DesignButton size="sm" onClick={execute}>
            {props.mode === "dry-run" ? "Run Preview" : "Send Now"}
          </DesignButton>
        </>
      )}
    >
      <div className="space-y-4">
        {props.mode === "run" ? (
          <DesignAlert
            variant="warning"
            title="Confirm Manual Trigger"
            description="This action will queue real emails for all eligible users and set their cooldown periods. Please confirm before proceeding."
          />
        ) : null}
        {error !== null ? (
          <DesignAlert variant="error" description={error} />
        ) : null}
        {result === null ? (
          <DesignEmptyState
            icon={props.mode === "dry-run" ? PlayIcon : PaperPlaneTiltIcon}
            title="Ready to Evaluate"
            description={`Click ${props.mode === "dry-run" ? "Run Preview" : "Send Now"} to evaluate up to ${DEFAULT_LIMIT} users based on current quotas.`}
          />
        ) : (
          <AutomationResult result={result} />
        )}
      </div>
    </DesignDialog>
  );
}

function AutomationResult(props: { result: AutomationRouteResult }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-5">
        <Metric label="Evaluated" value={props.result.evaluatedCount} />
        <Metric label="Eligible" value={props.result.eligibleCount} />
        <Metric label="Suppressed" value={props.result.suppressedCount} />
        <Metric label="Sent" value={props.result.sentCount ?? 0} />
        <Metric label="Deferred" value={props.result.deferredCount ?? 0} />
      </div>
      {(props.result.deferredCount ?? 0) > 0 ? (
        <DesignAlert variant="warning" description="Some email decisions could not be completed and were safely deferred for retry." />
      ) : null}
      {props.result.nextCursor !== null ? (
        <DesignAlert variant="info" description="More matching customers exist beyond this page. Scheduled workers continue pagination automatically." />
      ) : null}
      <AutomationDecisionGrid decisions={props.result.decisions} />
    </div>
  );
}

function AutomationDecisionGrid(props: { decisions: AutomationDecision[] }) {
  const columns = useMemo<DataGridColumnDef<AutomationDecision>[]>(() => [
    {
      id: "subjectId",
      header: "User ID",
      accessor: "subjectId",
      width: 220,
      flex: 1,
      type: "string",
      renderCell: ({ value }) => <span className="font-mono text-xs">{String(value)}</span>,
    },
    {
      id: "thresholdKind",
      header: "Threshold",
      accessor: "thresholdKind",
      width: 110,
      type: "string",
      renderCell: ({ row }) => <DesignBadge label={row.thresholdKind} color={row.thresholdKind === "over" ? "red" : "orange"} size="sm" />,
    },
    {
      id: "quantity",
      header: "Quantity",
      width: 140,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.currentQuantity} / {row.entitlementQuantity ?? "no limit"}
        </span>
      ),
    },
    {
      id: "recipient",
      header: "Recipient",
      width: 130,
      sortable: false,
      renderCell: ({ row }) => {
        if (row.hasPrimaryEmail === undefined) return <span className="text-xs text-muted-foreground">not checked</span>;
        return row.hasPrimaryEmail
          ? <DesignBadge label="email found" color="green" icon={CheckCircleIcon} size="sm" />
          : <DesignBadge label="no email" color="red" icon={XCircleIcon} size="sm" />;
      },
    },
    {
      id: "status",
      header: "Status",
      width: 130,
      sortable: false,
      renderCell: ({ row }) => {
        if (row.sent === true) return <DesignBadge label="sent" color="green" size="sm" />;
        if (row.outcome === "deferred") return <DesignBadge label="deferred" color="orange" size="sm" />;
        if (row.skipReason !== undefined) return <DesignBadge label={row.skipReason} color="orange" size="sm" />;
        if (row.blocked) return <DesignBadge label="cooldown" color="orange" size="sm" />;
        return <DesignBadge label="eligible" color="blue" size="sm" />;
      },
    },
  ], []);
  const [gridState, setGridState] = useState<DataGridState>(() => createDefaultDataGridState(columns));
  const gridData = useDataSource({
    data: props.decisions,
    columns,
    getRowId: (row) => `${row.subjectType}:${row.subjectId}:${row.thresholdKind}`,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "client",
  });

  return (
    <DataGrid
      columns={columns}
      rows={gridData.rows}
      getRowId={(row) => `${row.subjectType}:${row.subjectId}:${row.thresholdKind}`}
      totalRowCount={gridData.totalRowCount}
      isLoading={gridData.isLoading}
      state={gridState}
      onChange={setGridState}
      paginationMode="paginated"
      footer={false}
      fillHeight={false}
      maxHeight={360}
      emptyState={<DesignEmptyState title="No decisions" description="No users matched this run." />}
    />
  );
}

function Metric(props: { label: string, value: number }) {
  return (
    <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-3">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{props.value}</div>
    </div>
  );
}

function Field(props: { label: string, helper?: string, children: (id: string) => React.ReactNode }) {
  const id = `usage-email-field-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {props.label}
        {props.helper !== undefined ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            ({props.helper})
          </span>
        ) : null}
      </Label>
      <div className={cn("[&_input]:w-full [&_button]:w-full")}>{props.children(id)}</div>
    </div>
  );
}
