"use client";

import type { ServerUser } from "@hexclave/next";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import {
  BellRingingIcon,
  CheckCircleIcon,
  PauseIcon,
  PencilSimpleIcon,
  PaperPlaneTiltIcon,
  PlayIcon,
  PlusIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignInput,
  type DesignListItemButton,
  DesignListItemRow,
  DesignMenu,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { Link } from "@/components/link";
import { Label, Textarea, Typography } from "@/components/ui";
import { AppEnabledGuard } from "../../../app-enabled-guard";
import { PageLayout } from "../../../page-layout";
import { useAdminApp } from "../../../use-admin-app";
import { issuesListHref } from "../issue-links";
import {
  buildIssueAlertRule,
  DEFAULT_ALERT_RULE_DRAFT,
  getSupportedAlertRuleDraft,
  issueAlertRuleToPayload,
  issueAlertTriggerLabel,
  type AlertRuleDraft,
  type AlertRuleTrigger,
} from "./alert-rule-form";
import {
  ISSUE_ALERT_DELIVERY_LIMIT,
  fetchIssueAlertDeliveries,
  fetchIssueAlertRules,
  saveIssueAlertRule,
  type IssueAlertDelivery,
  type IssueAlertRulePayload,
  type IssueAlertRuleResponse,
} from "./issue-alerts-data";

type AlertRecipient = Pick<ServerUser, "id" | "displayName" | "primaryEmail">;

const TRIGGER_OPTIONS: { value: AlertRuleTrigger, label: string }[] = [
  { value: "new_or_regression", label: "New or regressed issue" },
  { value: "new", label: "New issue" },
  { value: "regression", label: "Regression" },
  { value: "frequency", label: "Frequency threshold" },
];

const COOLDOWN_OPTIONS: { value: AlertRuleDraft["cooldownKeyBy"], label: string }[] = [
  { value: "issue", label: "Per issue" },
  { value: "issue_environment", label: "Per issue + environment" },
  { value: "issue_release", label: "Per issue + release" },
  { value: "issue_environment_release", label: "Per issue + environment + release" },
];

const DESTINATION_OPTIONS: { value: AlertRuleDraft["destination"], label: string }[] = [
  { value: "email", label: "Email via Workflows" },
  { value: "webhook", label: "Webhook reference" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recipientLabel(user: AlertRecipient): string {
  return user.displayName ?? user.primaryEmail ?? user.id;
}

function deliveryStatusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (character) => character.toUpperCase());
}

function deliveryBadgeColor(state: string): "blue" | "green" | "orange" | "red" | "zinc" {
  if (state === "delivered") return "green";
  if (state === "failed" || state === "dropped") return "red";
  if (state === "suppressed") return "orange";
  if (state === "claimed" || state === "enqueued") return "blue";
  return "zinc";
}

function deliveryTimestamp(millis: number): string {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) throw new Error("Issue alert delivery returned an invalid timestamp");
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function FormField(props: { label: string, htmlFor?: string, description?: string, children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.htmlFor} className="text-xs font-medium">{props.label}</Label>
      {props.description != null && <Typography variant="secondary" className="text-xs">{props.description}</Typography>}
      {props.children}
    </div>
  );
}

function DeliveryStatusRow(props: { delivery: IssueAlertDelivery, ruleLabel: string }) {
  const { delivery } = props;
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-foreground/[0.02] p-2.5">
      <div className="min-w-0">
        <Typography className="truncate text-xs font-medium">{props.ruleLabel}</Typography>
        <Typography variant="secondary" className="mt-0.5 text-[11px]">
          {deliveryStatusLabel(delivery.event_kind)} · {deliveryTimestamp(delivery.updated_at_millis)} · {delivery.attempt_count} attempt{delivery.attempt_count === 1 ? "" : "s"}
        </Typography>
        {delivery.last_error != null && (
          <Typography variant="secondary" className="mt-1 line-clamp-2 text-[11px] text-red-600 dark:text-red-400">
            {delivery.last_error}
          </Typography>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <DesignBadge label={deliveryStatusLabel(delivery.state)} color={deliveryBadgeColor(delivery.state)} size="sm" />
        <Typography variant="secondary" className="text-right text-[10px]">{deliveryStatusLabel(delivery.outcome)}</Typography>
      </div>
    </div>
  );
}

type RuleEditorDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  existingRule: IssueAlertRuleResponse | null,
  initialDraft: AlertRuleDraft,
  recipients: readonly AlertRecipient[],
  recipientsLoading: boolean,
  recipientsError: string | null,
  recipientsTruncated: boolean,
  onSave: (rule: IssueAlertRulePayload) => Promise<void>,
};

function RuleEditorDialog(props: RuleEditorDialogProps) {
  const [draft, setDraft] = useState<AlertRuleDraft>(props.initialDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setDraft(props.initialDraft);
    setFormError(null);
  }, [props.initialDraft, props.open]);

  const recipientOptions = useMemo(
    () => props.recipients.map((user) => ({
      id: user.id,
      label: recipientLabel(user),
      checked: draft.userIds.includes(user.id),
    })),
    [draft.userIds, props.recipients],
  );
  const recipientById = useMemo(
    () => new Map(props.recipients.map((user) => [user.id, user])),
    [props.recipients],
  );

  const submit = useCallback(async () => {
    setFormError(null);
    const result = buildIssueAlertRule(draft, props.existingRule);
    if (result.status === "error") {
      setFormError(result.message);
      return;
    }
    setSaving(true);
    try {
      await props.onSave(result.rule);
      props.onOpenChange(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [draft, props]);

  const selectedRecipientLabels = draft.userIds.map((userId) => {
    const user = recipientById.get(userId);
    return user == null ? `Unknown user ${userId}` : recipientLabel(user);
  });

  return (
    <DesignDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="4xl"
      icon={BellRingingIcon}
      title={props.existingRule == null ? "Create issue-alert rule" : `Update ${props.existingRule.id}`}
      description={draft.destination === "email"
        ? "Route new, regressed, or high-frequency issues through Workflows into the email outbox."
        : "Persist a provider-safe webhook reference through Workflows without storing credentials or arbitrary URLs."}
      footer={(
        <div className="flex w-full justify-end gap-2">
          <DesignButton variant="secondary" size="sm" type="button" onClick={() => props.onOpenChange(false)}>
            Cancel
          </DesignButton>
          <DesignButton variant="default" size="sm" type="button" loading={saving} onClick={submit}>
            {props.existingRule == null ? "Create rule" : "Save changes"}
          </DesignButton>
        </div>
      )}
    >
      <div className="space-y-5">
        {formError != null && <DesignAlert variant="error" title="Rule was not saved" description={formError} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Rule key"
            htmlFor="issue-alert-rule-id"
            description="Stable lowercase key used for versioned updates."
          >
            <DesignInput
              id="issue-alert-rule-id"
              size="sm"
              value={draft.id}
              disabled={props.existingRule != null}
              onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))}
            />
          </FormField>
          <FormField label="Trigger">
            <DesignSelectorDropdown
              value={draft.trigger}
              onValueChange={(value) => {
                const next = TRIGGER_OPTIONS.find((option) => option.value === value)?.value;
                if (next == null) throw new Error(`Unknown issue alert trigger: ${value}`);
                setDraft((current) => ({ ...current, trigger: next }));
              }}
              options={TRIGGER_OPTIONS}
              size="sm"
            />
          </FormField>
          <FormField
            label="Destination"
            description="Email is executable today; webhook references fail closed until an integration provider is configured."
          >
            <DesignSelectorDropdown
              value={draft.destination}
              onValueChange={(value) => {
                const next = DESTINATION_OPTIONS.find((option) => option.value === value)?.value;
                if (next == null) throw new Error(`Unknown issue alert destination: ${value}`);
                setDraft((current) => ({ ...current, destination: next }));
              }}
              options={DESTINATION_OPTIONS}
              size="sm"
            />
          </FormField>
        </div>

        {draft.destination === "webhook" && (
          <DesignCard gradient="default" className="border-amber-500/20 bg-amber-500/[0.04]">
            <FormField
              label="Webhook integration reference"
              htmlFor="issue-alert-webhook-integration-id"
              description="Use an opaque integration ID managed by the provider registry. URLs, tokens, and credentials are rejected."
            >
              <DesignInput
                id="issue-alert-webhook-integration-id"
                size="sm"
                value={draft.webhookIntegrationId}
                onChange={(event) => setDraft((current) => ({ ...current, webhookIntegrationId: event.target.value }))}
                placeholder="integration-prod-errors"
              />
            </FormField>
            <DesignAlert
              variant="warning"
              title="Provider not configured"
              description="The rule can be saved and audited, but Workflows will record a non-retryable provider-not-configured outcome until the integration is registered."
              className="mt-3"
            />
          </DesignCard>
        )}

        {draft.trigger === "frequency" && (
          <div className="grid gap-4 rounded-xl border border-border/60 bg-foreground/[0.02] p-3 sm:grid-cols-2">
            <FormField label="Minimum events" htmlFor="issue-alert-frequency-count">
              <DesignInput
                id="issue-alert-frequency-count"
                size="sm"
                type="number"
                min={1}
                inputMode="numeric"
                value={draft.frequencyCount}
                onChange={(event) => setDraft((current) => ({ ...current, frequencyCount: event.target.value }))}
              />
            </FormField>
            <FormField label="Window (seconds)" htmlFor="issue-alert-frequency-window">
              <DesignInput
                id="issue-alert-frequency-window"
                size="sm"
                type="number"
                min={1}
                inputMode="numeric"
                value={draft.frequencyWindowSeconds}
                onChange={(event) => setDraft((current) => ({ ...current, frequencyWindowSeconds: event.target.value }))}
              />
            </FormField>
          </div>
        )}

        <div className="grid gap-4 rounded-xl border border-border/60 bg-foreground/[0.02] p-3 sm:grid-cols-2">
          <FormField label="Cooldown (seconds)" htmlFor="issue-alert-cooldown">
            <DesignInput
              id="issue-alert-cooldown"
              size="sm"
              type="number"
              min={0}
              inputMode="numeric"
              value={draft.cooldownDurationSeconds}
              onChange={(event) => setDraft((current) => ({ ...current, cooldownDurationSeconds: event.target.value }))}
            />
          </FormField>
          <FormField label="Cooldown scope">
            <DesignSelectorDropdown
              value={draft.cooldownKeyBy}
              onValueChange={(value) => {
                const next = COOLDOWN_OPTIONS.find((option) => option.value === value)?.value;
                if (next == null) throw new Error(`Unknown issue alert cooldown scope: ${value}`);
                setDraft((current) => ({ ...current, cooldownKeyBy: next }));
              }}
              options={COOLDOWN_OPTIONS}
              size="sm"
            />
          </FormField>
        </div>

        {draft.destination === "email" && <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Typography className="text-xs font-medium">Recipients</Typography>
              <Typography variant="secondary" className="text-xs">Only project users can receive issue-alert email.</Typography>
            </div>
            {!props.recipientsLoading && props.recipientsError == null && (
              <DesignMenu
                variant="toggles"
                trigger="button"
                triggerLabel={draft.userIds.length === 0 ? "Choose recipients" : `${draft.userIds.length} selected`}
                label="Project users"
                options={recipientOptions}
                onToggleChange={(id, checked) => setDraft((current) => ({
                  ...current,
                  userIds: checked
                    ? (current.userIds.includes(id) ? current.userIds : [...current.userIds, id])
                    : current.userIds.filter((userId) => userId !== id),
                }))}
              />
            )}
          </div>
          {props.recipientsLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <SpinnerGapIcon className="h-3.5 w-3.5 animate-spin" /> Loading project users…
            </div>
          )}
          {props.recipientsError != null && (
            <DesignAlert
              variant="error"
              title="Recipients couldn't be loaded"
              description="Refresh the page before saving an alert rule so the server can verify project-user recipients."
            />
          )}
          {props.recipientsTruncated && (
            <DesignAlert
              variant="warning"
              title="Recipient list is capped"
              description="Only the first 1,000 project users are available in this editor. Existing recipients remain preserved, but new users beyond that page cannot be selected here."
            />
          )}
          {selectedRecipientLabels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedRecipientLabels.map((label, index) => (
                <DesignBadge key={`${label}-${index}`} label={label} color="zinc" size="sm" />
              ))}
            </div>
          ) : (
            <Typography variant="secondary" className="text-xs">No recipients selected.</Typography>
          )}
        </div>}

        {draft.destination === "email" && <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Email subject" htmlFor="issue-alert-subject">
            <DesignInput
              id="issue-alert-subject"
              size="sm"
              value={draft.subject}
              onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))}
            />
          </FormField>
          <FormField
            label="Notification category (optional)"
            htmlFor="issue-alert-category"
            description="Used by the existing notification preference system."
          >
            <DesignInput
              id="issue-alert-category"
              size="sm"
              value={draft.notificationCategoryName}
              onChange={(event) => setDraft((current) => ({ ...current, notificationCategoryName: event.target.value }))}
            />
          </FormField>
        </div>}

        {draft.destination === "email" && <FormField
          label="Email HTML"
          htmlFor="issue-alert-html"
          description="Keep this bounded and single-line; the workflow sends it through the existing email outbox."
        >
          <Textarea
            id="issue-alert-html"
            value={draft.html}
            onChange={(event) => setDraft((current) => ({ ...current, html: event.target.value }))}
            rows={4}
            className="resize-y text-xs"
          />
        </FormField>}
      </div>
    </DesignDialog>
  );
}

function updateRuleInList(rules: readonly IssueAlertRuleResponse[], saved: IssueAlertRuleResponse): IssueAlertRuleResponse[] {
  const existing = rules.find((rule) => rule.id === saved.id);
  if (existing == null) return [...rules, saved].sort((left, right) => stringCompare(left.id, right.id));
  return rules.map((rule) => rule.id === saved.id ? saved : rule);
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const [rules, setRules] = useState<IssueAlertRuleResponse[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesReloadToken, setRulesReloadToken] = useState(0);
  const [deliveries, setDeliveries] = useState<IssueAlertDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [deliveriesTruncated, setDeliveriesTruncated] = useState(false);
  const [deliveriesReloadToken, setDeliveriesReloadToken] = useState(0);
  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [recipientsTruncated, setRecipientsTruncated] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<IssueAlertRuleResponse | null>(null);
  const [editorDraft, setEditorDraft] = useState<AlertRuleDraft>(DEFAULT_ALERT_RULE_DRAFT);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRulesLoading(true);
    setRulesError(null);
    runAsynchronously(async () => {
      try {
        const nextRules = await fetchIssueAlertRules(adminApp);
        if (cancelled) return;
        setRules(nextRules);
      } catch (error) {
        if (cancelled) return;
        setRulesError(errorMessage(error));
      } finally {
        if (!cancelled) setRulesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adminApp, rulesReloadToken]);

  useEffect(() => {
    let cancelled = false;
    setDeliveriesLoading(true);
    setDeliveriesError(null);
    runAsynchronously(async () => {
      try {
        const page = await fetchIssueAlertDeliveries(adminApp);
        if (cancelled) return;
        setDeliveries(page.deliveries);
        setDeliveriesTruncated(page.truncated);
      } catch (error) {
        if (cancelled) return;
        setDeliveriesError(errorMessage(error));
      } finally {
        if (!cancelled) setDeliveriesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adminApp, deliveriesReloadToken]);

  useEffect(() => {
    let cancelled = false;
    setRecipientsLoading(true);
    setRecipientsError(null);
    runAsynchronously(async () => {
      try {
        const page = await adminApp.listUsers({
          limit: 1_000,
          orderBy: "signedUpAt",
          desc: false,
          includeAnonymous: false,
          includeRestricted: false,
        });
        if (cancelled) return;
        setRecipients(page);
        setRecipientsTruncated(page.nextCursor != null);
      } catch (error) {
        if (cancelled) return;
        setRecipientsError(errorMessage(error));
      } finally {
        if (!cancelled) setRecipientsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adminApp]);

  const activeRuleCount = rules.filter((rule) => rule.enabled).length;
  const ruleLabelByDatabaseId = useMemo(
    () => new Map(rules.map((rule) => [rule.database_id, rule.id])),
    [rules],
  );
  const supportedEditorDraft = useMemo(
    () => editingRule == null ? editorDraft : getSupportedAlertRuleDraft(editingRule),
    [editingRule, editorDraft],
  );

  const openCreate = useCallback(() => {
    setOperationError(null);
    setNotice(null);
    setEditingRule(null);
    setEditorDraft({ ...DEFAULT_ALERT_RULE_DRAFT });
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((rule: IssueAlertRuleResponse) => {
    const draft = getSupportedAlertRuleDraft(rule);
    if (draft == null) {
      setOperationError(`Rule "${rule.id}" uses conditions this concise editor cannot round-trip safely. It remains visible but read-only.`);
      return;
    }
    setOperationError(null);
    setNotice(null);
    setEditingRule(rule);
    setEditorDraft(draft);
    setEditorOpen(true);
  }, []);

  const saveRule = useCallback(async (rule: IssueAlertRulePayload) => {
    setOperationError(null);
    setNotice(null);
    try {
      const saved = await saveIssueAlertRule(adminApp, rule);
      setRules((current) => updateRuleInList(current, saved));
      setNotice(`${saved.id} saved as version ${saved.version}.`);
    } catch (error) {
      setOperationError(errorMessage(error));
      throw error;
    }
  }, [adminApp]);

  const toggleRule = useCallback(async (rule: IssueAlertRuleResponse) => {
    if (rule.version >= Number.MAX_SAFE_INTEGER) {
      setOperationError(`Rule "${rule.id}" has reached the maximum supported version and cannot be toggled safely.`);
      return;
    }
    setOperationError(null);
    setNotice(null);
    const nextRule: IssueAlertRuleResponse = {
      ...rule,
      version: rule.version + 1,
      enabled: !rule.enabled,
    };
    const saved = await saveIssueAlertRule(adminApp, issueAlertRuleToPayload(nextRule));
    setRules((current) => updateRuleInList(current, saved));
    setNotice(`${saved.id} ${saved.enabled ? "enabled" : "disabled"}.`);
  }, [adminApp]);

  const closeEditor = useCallback((open: boolean) => {
    setEditorOpen(open);
    if (!open) setEditingRule(null);
  }, []);

  return (
    <AppEnabledGuard appId="observability">
      <PageLayout
        title="Issue alerts"
        description="Route new, regressed, or high-frequency issues to project users through the durable email workflow."
        actions={(
          <div className="flex items-center gap-2">
            <DesignButton variant="secondary" size="sm" asChild>
              <Link href={issuesListHref(adminApp.projectId)}>Back to issues</Link>
            </DesignButton>
            <DesignButton variant="default" size="sm" onClick={openCreate}>
              <PlusIcon className="mr-1.5 h-3.5 w-3.5" /> New rule
            </DesignButton>
          </div>
        )}
        scrollMain
      >
        {operationError != null && (
          <DesignAlert variant="error" title="Alert rule action failed" description={operationError} />
        )}
        {notice != null && (
          <DesignAlert variant="success" title="Alert rule updated" description={notice} />
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
          <DesignCard
            title="Rules"
            subtitle={`${activeRuleCount} active${rules.length === activeRuleCount ? "" : ` · ${rules.length} visible`}`}
            icon={BellRingingIcon}
            gradient="default"
          >
            {rulesLoading && rules.length === 0 && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <SpinnerGapIcon className="h-4 w-4 animate-spin" /> Loading active rules…
              </div>
            )}
            {rulesError != null && (
              <DesignAlert variant="error" title="Couldn't load alert rules" description={rulesError}>
                <DesignButton
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => setRulesReloadToken((current) => current + 1)}
                >
                  Retry
                </DesignButton>
              </DesignAlert>
            )}
            {!rulesLoading && rulesError == null && rules.length === 0 && (
              <div className="py-8 text-center">
                <Typography className="text-sm font-medium">No active issue-alert rules</Typography>
                <Typography variant="secondary" className="mt-1 text-xs">Create one to route the next issue signal through the Workflows delivery boundary.</Typography>
              </div>
            )}
            {rules.length > 0 && (
              <div className="-mx-2 divide-y divide-border/50">
                {rules.map((rule) => {
                  const editable = getSupportedAlertRuleDraft(rule) != null;
                  const statusLabel = rule.enabled ? "Active" : "Disabled";
                  const trigger = issueAlertTriggerLabel(rule);
                  const destination = rule.action.type === "email"
                    ? `${rule.action.userIds.length} recipient${rule.action.userIds.length === 1 ? "" : "s"}`
                    : `webhook ${rule.action.integrationId}`;
                  const subtitle = `${statusLabel} · ${trigger} · ${destination} · v${rule.version}`;
                  const toggleButton: DesignListItemButton = {
                    id: "toggle",
                    label: rule.enabled ? "Disable" : "Enable",
                    icon: rule.enabled ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />,
                    display: "text",
                    onClick: async () => {
                      try {
                        await toggleRule(rule);
                      } catch (error) {
                        setOperationError(errorMessage(error));
                      }
                    },
                  };
                  const buttons: DesignListItemButton[] = editable
                    ? [{
                      id: "edit",
                      label: "Edit",
                      icon: <PencilSimpleIcon className="h-3.5 w-3.5" />,
                      display: "text",
                      onClick: () => openEdit(rule),
                    }, toggleButton]
                    : [toggleButton];
                  return (
                    <DesignListItemRow
                      key={`${rule.id}-${rule.version}`}
                      size="sm"
                      icon={rule.enabled ? CheckCircleIcon : BellRingingIcon}
                      title={rule.id}
                      subtitle={editable ? subtitle : `${subtitle} · advanced / read-only`}
                      buttons={buttons}
                    />
                  );
                })}
              </div>
            )}
          </DesignCard>

          <DesignCard
            title="Recent delivery status"
            subtitle="Workflow and email-outbox outcomes"
            icon={PaperPlaneTiltIcon}
            gradient="default"
          >
            {deliveriesLoading && deliveries.length === 0 && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <SpinnerGapIcon className="h-4 w-4 animate-spin" /> Loading recent deliveries…
              </div>
            )}
            {deliveriesError != null && (
              <DesignAlert variant="error" title="Couldn't load delivery history" description={deliveriesError}>
                <DesignButton
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => setDeliveriesReloadToken((current) => current + 1)}
                >
                  Retry
                </DesignButton>
              </DesignAlert>
            )}
            {deliveriesLoading && deliveries.length > 0 && (
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <SpinnerGapIcon className="h-3.5 w-3.5 animate-spin" /> Refreshing delivery history…
              </div>
            )}
            {!deliveriesLoading && deliveriesError == null && deliveries.length === 0 && (
              <div className="py-8 text-center">
                <Typography className="text-sm font-medium">No delivery attempts yet</Typography>
                <Typography variant="secondary" className="mt-1 text-xs">Delivery outcomes will appear here after an issue-alert rule matches.</Typography>
              </div>
            )}
            {deliveries.length > 0 && (
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {deliveries.map((delivery) => (
                  <DeliveryStatusRow
                    key={delivery.id}
                    delivery={delivery}
                    ruleLabel={ruleLabelByDatabaseId.get(delivery.rule_id) ?? `Rule ${delivery.rule_id}`}
                  />
                ))}
              </div>
            )}
            {deliveriesTruncated && (
              <Typography variant="secondary" className="mt-2 text-[11px]">
                Showing the latest {ISSUE_ALERT_DELIVERY_LIMIT} deliveries.
              </Typography>
            )}
          </DesignCard>
        </div>

        <RuleEditorDialog
          open={editorOpen}
          onOpenChange={closeEditor}
          existingRule={editingRule}
          initialDraft={supportedEditorDraft ?? DEFAULT_ALERT_RULE_DRAFT}
          recipients={recipients}
          recipientsLoading={recipientsLoading}
          recipientsError={recipientsError}
          recipientsTruncated={recipientsTruncated}
          onSave={saveRule}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
