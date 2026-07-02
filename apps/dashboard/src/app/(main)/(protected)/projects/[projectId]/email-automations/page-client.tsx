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
  DesignListItemRow,
  DesignPillToggle,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { StyledLink } from "@/components/link";
import { Label, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
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
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { getUserSpecifiedIdErrorMessage, isValidUserSpecifiedId, sanitizeUserSpecifiedId } from "@hexclave/shared/dist/schema-fields";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const THEME_DEFAULT_VALUE = "__project_default__";
const DEFAULT_LIMIT = 100;

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
};

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
  skipReason?: string,
  hasPrimaryEmail?: boolean,
};

type AutomationRouteResult = {
  ruleId: string,
  mode: "dry-run" | "run",
  evaluatedCount: number,
  eligibleCount: number,
  suppressedCount: number,
  sentCount?: number,
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
  if (itemId === undefined || templateId === undefined || cooldownDays === undefined) {
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
    };
  }

  return {
    ruleId: nextRuleId(existingRuleIds),
    displayName: "Usage upgrade email",
    enabled: true,
    itemId: itemOptions[0]?.value ?? "",
    nearRemainingRatio: "0.2",
    nearRemainingQuantity: "",
    overLimitQuantity: "0",
    templateId: templateOptions[0]?.value ?? "",
    themeId: themeOptions[0]?.value ?? THEME_DEFAULT_VALUE,
    subject: "",
    cooldownDays: "7",
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
  const parts = [
    thresholds.nearRemainingRatio === undefined ? undefined : `remaining <= ${Math.round(thresholds.nearRemainingRatio * 100)}%`,
    thresholds.nearRemainingQuantity === undefined ? undefined : `remaining <= ${thresholds.nearRemainingQuantity}`,
    thresholds.overLimitQuantity === undefined ? undefined : `over cutoff <= ${thresholds.overLimitQuantity}`,
  ].filter((part) => part !== undefined);
  return parts.join(" or ");
}

function formatItem(itemOptions: SelectorOption[], itemId: string) {
  return itemOptions.find((item) => item.value === itemId)?.label ?? itemId;
}

function formatTemplate(templateOptions: SelectorOption[], templateId: string) {
  return templateOptions.find((template) => template.value === templateId)?.label ?? templateId;
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
    nextCursor: value.next_cursor === null ? null : requireStringFromRecord(value, "next_cursor"),
    decisions: value.decisions.flatMap((rawDecision) => parseDecision(rawDecision)),
  };
}

function parseDecision(rawDecision: unknown): AutomationDecision[] {
  if (!isRecord(rawDecision)) return [];
  const source = isRecord(rawDecision.source) ? rawDecision.source : undefined;
  const cooldown = isRecord(rawDecision.cooldown) ? rawDecision.cooldown : undefined;
  const recipient = isRecord(rawDecision.recipient) ? rawDecision.recipient : undefined;
  if (source === undefined || cooldown === undefined) return [];
  const thresholdKind = requireStringFromRecord(source, "threshold_kind");
  if (thresholdKind !== "near" && thresholdKind !== "over") {
    return [];
  }

  return [{
    subjectType: "user",
    subjectId: requireStringFromRecord(rawDecision, "subject_id"),
    thresholdKind,
    currentQuantity: requireNumberFromRecord(source, "current_quantity"),
    entitlementQuantity: source.entitlement_quantity === null ? null : requireNumberFromRecord(source, "entitlement_quantity"),
    blocked: requireBooleanFromRecord(cooldown, "blocked"),
    sent: readBoolean(rawDecision.sent),
    skipReason: readString(rawDecision.skip_reason),
    hasPrimaryEmail: recipient === undefined ? undefined : readBoolean(recipient.has_primary_email),
  }];
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
    await updateConfig({
      adminApp: hexclaveAdminApp,
      configUpdate: { [`automations.rules.${ruleId}`]: rule },
      pushable: true,
    });
  };

  const deleteRule = async (ruleId: string) => {
    await updateConfig({
      adminApp: hexclaveAdminApp,
      configUpdate: { [`automations.rules.${ruleId}`]: null },
      pushable: true,
    });
  };

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Usage Emails"
        description="Send upgrade emails when user-level Payments item quotas are near or over their limits."
        actions={(
          <DesignButton size="sm" onClick={() => setEditorMode({ type: "create" })}>
            <PlusIcon className="h-4 w-4" />
            New usage email
          </DesignButton>
        )}
      >
        <div className="space-y-4">
          <DesignAlert
            variant="info"
            title="Payments item quota source"
            description="V1 reads Hexclave Payments item balances for user customers and stores configuration under automations.rules."
          />

          <DesignCard
            title="Automations"
            subtitle="Each rule evaluates one user-scoped Payments item and plans one Marketing email action."
            icon={LightningIcon}
            glassmorphic
          >
            {rules.length === 0 ? (
              <DesignEmptyState
                icon={EnvelopeSimpleIcon}
                title="No usage emails yet"
                description="Create a rule to preview which users are near or over a Payments item quota."
              >
                <DesignButton size="sm" onClick={() => setEditorMode({ type: "create" })}>
                  <PlusIcon className="h-4 w-4" />
                  New usage email
                </DesignButton>
              </DesignEmptyState>
            ) : (
              <div className="space-y-3">
                {rules.map((entry) => (
                  <DesignListItemRow
                    key={entry.ruleId}
                    icon={EnvelopeSimpleIcon}
                    title={entry.rule.displayName ?? entry.ruleId}
                    subtitle={`${entry.rule.enabled ? "Enabled" : "Disabled"} · ${formatItem(itemOptions, entry.rule.source.itemId)} · ${formatThresholds(entry.rule)} · ${entry.rule.cooldown.days} day cooldown`}
                    buttons={[
                      {
                        id: "dry-run",
                        label: "Dry run",
                        icon: <PlayIcon className="h-4 w-4" />,
                        onClick: () => setDryRunEntry(entry),
                      },
                      {
                        id: "send",
                        label: "Send",
                        icon: <PaperPlaneTiltIcon className="h-4 w-4" />,
                        onClick: () => setSendEntry(entry),
                      },
                      {
                        id: "more",
                        label: "More",
                        display: "icon",
                        onClick: [
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
                        ],
                      },
                    ]}
                  />
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
      size="2xl"
      icon={EnvelopeSimpleIcon}
      title={isEditing ? "Edit usage email" : "New usage email"}
      description="Configure one Payments item quota trigger and one email action."
      footer={(
        <>
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">Cancel</DesignButton>
          </DesignDialogClose>
          <DesignButton size="sm" onClick={save} disabled={hasMissingPrerequisites}>
            {isEditing ? "Save changes" : "Create rule"}
          </DesignButton>
        </>
      )}
    >
      <div className="space-y-5">
        {error !== null ? (
          <DesignAlert variant="error" description={error} />
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Rule ID" helper="Stored at automations.rules.{ruleId}.">
            <DesignInput
              value={draft.ruleId}
              disabled={isEditing}
              onChange={(event) => setDraftField("ruleId", sanitizeUserSpecifiedId(event.target.value))}
              size="md"
              className="font-mono text-sm"
            />
          </Field>
          <Field label="Display name">
            <DesignInput
              value={draft.displayName}
              onChange={(event) => setDraftField("displayName", event.target.value)}
              size="md"
            />
          </Field>
        </div>

        <div className="rounded-xl border border-foreground/[0.08] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Typography className="text-sm font-semibold">Trigger</Typography>
              <Typography type="label" className="text-xs text-muted-foreground">Payments item quota for user customers</Typography>
            </div>
            <DesignBadge label="payments-item-quota" color="blue" size="sm" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Item">
              <DesignSelectorDropdown
                value={draft.itemId}
                onValueChange={(value) => setDraftField("itemId", value)}
                options={props.itemOptions}
                placeholder="Select item"
                disabled={props.itemOptions.length === 0}
                size="md"
              />
              {props.itemOptions.length === 0 ? (
                <div className="mt-3">
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
                </div>
              ) : null}
            </Field>
            <Field label="Customer type">
              <DesignInput value="user" disabled size="md" />
            </Field>
          </div>
        </div>

        <div className="rounded-xl border border-foreground/[0.08] p-4">
          <Typography className="mb-3 text-sm font-semibold">Thresholds</Typography>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Remaining ratio" helper="Decimal from 0 to 1.">
              <DesignInput
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max="1"
                value={draft.nearRemainingRatio}
                onChange={(event) => setDraftField("nearRemainingRatio", event.target.value)}
                size="md"
              />
            </Field>
            <Field label="Remaining quantity">
              <DesignInput
                type="number"
                inputMode="decimal"
                min="0"
                value={draft.nearRemainingQuantity}
                onChange={(event) => setDraftField("nearRemainingQuantity", event.target.value)}
                size="md"
              />
            </Field>
            <Field label="Over-limit quantity">
              <DesignInput
                type="number"
                inputMode="decimal"
                min="0"
                value={draft.overLimitQuantity}
                onChange={(event) => setDraftField("overLimitQuantity", event.target.value)}
                size="md"
              />
            </Field>
          </div>
        </div>

        <div className="rounded-xl border border-foreground/[0.08] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Typography className="text-sm font-semibold">Action</Typography>
              <Typography type="label" className="text-xs text-muted-foreground">Send one Marketing email through the existing email pipeline</Typography>
            </div>
            <DesignBadge label="send-email" color="green" size="sm" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Template">
              <DesignSelectorDropdown
                value={draft.templateId}
                onValueChange={(value) => setDraftField("templateId", value)}
                options={props.templateOptions}
                placeholder="Select template"
                disabled={props.templateOptions.length === 0}
                size="md"
              />
              {props.templateOptions.length === 0 ? (
                <div className="mt-3">
                  <DesignAlert
                    variant="warning"
                    title="Email template required"
                    description="Usage Emails require an email template before a send-email action can be saved."
                  />
                </div>
              ) : null}
            </Field>
            <Field label="Theme">
              <DesignSelectorDropdown
                value={draft.themeId}
                onValueChange={(value) => setDraftField("themeId", value)}
                options={props.themeOptions}
                size="md"
              />
            </Field>
            <Field label="Subject override" helper="Optional. Leave blank to use the template subject.">
              <DesignInput
                value={draft.subject}
                onChange={(event) => setDraftField("subject", event.target.value)}
                size="md"
              />
            </Field>
            <Field label="Notification category">
              <DesignInput value="Marketing" disabled size="md" />
            </Field>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Cooldown days">
            <DesignInput
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={draft.cooldownDays}
              onChange={(event) => setDraftField("cooldownDays", event.target.value)}
              size="md"
            />
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/[0.08] px-4 py-3">
            <div>
              <Typography className="text-sm font-medium">Enabled</Typography>
              <Typography type="label" className="text-xs text-muted-foreground">Disabled rules can be saved and dry-run later.</Typography>
            </div>
            <DesignPillToggle
              options={[
                { id: "enabled", label: "Enabled" },
                { id: "disabled", label: "Disabled" },
              ]}
              selected={draft.enabled ? "enabled" : "disabled"}
              onSelect={(id) => setDraftField("enabled", id === "enabled")}
              size="sm"
            />
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
  const title = props.mode === "dry-run" ? "Dry run usage email" : "Send usage email";
  const description = props.mode === "dry-run"
    ? "Preview eligible users without writing execution state or enqueueing email."
    : "Run the rule now and enqueue eligible emails through EmailOutbox.";

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
            {props.mode === "dry-run" ? "Run preview" : "Send now"}
          </DesignButton>
        </>
      )}
    >
      <div className="space-y-4">
        {props.mode === "run" ? (
          <DesignAlert
            variant="warning"
            title="Manual send"
            description="This will enqueue real emails for eligible users and update cooldown state."
          />
        ) : null}
        {error !== null ? (
          <DesignAlert variant="error" description={error} />
        ) : null}
        {result === null ? (
          <DesignEmptyState
            icon={props.mode === "dry-run" ? PlayIcon : PaperPlaneTiltIcon}
            title="Ready"
            description={`Click ${props.mode === "dry-run" ? "Run preview" : "Send now"} to evaluate up to ${DEFAULT_LIMIT} users.`}
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
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Evaluated" value={props.result.evaluatedCount} />
        <Metric label="Eligible" value={props.result.eligibleCount} />
        <Metric label="Suppressed" value={props.result.suppressedCount} />
        <Metric label="Sent" value={props.result.sentCount ?? 0} />
      </div>
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
        if (row.blocked) return <DesignBadge label="cooldown" color="orange" size="sm" />;
        if (row.skipReason !== undefined) return <DesignBadge label={row.skipReason} color="orange" size="sm" />;
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

function Field(props: { label: string, helper?: string, children: React.ReactNode }) {
  const id = `usage-email-field-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-sm font-medium">{props.label}</Label>
      <div className={cn("[&_input]:w-full [&_button]:w-full")}>{props.children}</div>
      {props.helper !== undefined ? (
        <Typography type="label" className="text-xs text-muted-foreground">{props.helper}</Typography>
      ) : null}
    </div>
  );
}
