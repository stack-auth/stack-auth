"use client";

import { CountryCodeInput } from "@/components/country-code-select";
import { ConditionBuilder, isConditionTreeValid } from "@/components/rule-builder";
import {
  ActionDialog,
  Alert,
  Button,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Typography,
} from "@/components/ui";
import {
  createEmptyCondition,
  createEmptyGroup,
  parseCelToVisualTree,
  visualTreeToCel,
  type RuleNode,
} from "@/lib/cel-visual-parser";
import { useUpdateConfig } from "@/lib/config-update";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowsDownUpIcon, CaretDownIcon, CaretRightIcon, CheckIcon, CheckCircleIcon, CircleNotchIcon, PencilSimpleIcon, PlusIcon, SlidersIcon, TrashIcon, XCircleIcon, XIcon } from "@phosphor-icons/react";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import type { SignUpRule, SignUpRuleAction } from "@stackframe/stack-shared/dist/interface/crud/sign-up-rules";
import { isValidCountryCode, normalizeCountryCode } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { standardProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import React, { useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { validateRiskScore } from "@/lib/risk-score-utils";
import { parseClickHouseDate } from "../analytics/shared";

// Analytics types
type RuleAnalytics = {
  ruleId: string,
  countInTimespan: number,
  allTimeCount: number,
  hourlyCounts: { hour: string, count: number }[],
};

type RuleTriggerListItem = {
  id: string,
  triggeredAt: string,
  email: string | null,
};

type SignUpRuleEntry = {
  id: string,
  rule: SignUpRule,
};

type SignUpRulesTestEvaluationStatus =
  | 'matched'
  | 'not_matched'
  | 'disabled'
  | 'missing_condition'
  | 'error';

type SignUpRulesTestEvaluation = {
  rule_id: string,
  display_name: string,
  enabled: boolean,
  condition: string,
  status: SignUpRulesTestEvaluationStatus,
  action: {
    type: 'allow' | 'reject' | 'restrict' | 'log',
    message?: string,
  },
  error?: string,
};

type SignUpRulesTestResult = {
  context: {
    email: string,
    email_domain: string,
    country_code: string,
    auth_method: 'password' | 'otp' | 'oauth' | 'passkey',
    oauth_provider: string,
    turnstile_result: 'ok' | 'invalid' | 'error',
    risk_scores: {
      bot: number,
      free_trial_abuse: number,
    },
  },
  evaluations: SignUpRulesTestEvaluation[],
  outcome: {
    should_allow: boolean,
    decision: 'allow' | 'reject' | 'default-allow' | 'default-reject',
    decision_rule_id: string | null,
    restricted_because_of_rule_id: string | null,
  },
};

const OAUTH_PROVIDER_OPTIONS = Array.from(standardProviders);
const RULE_TRIGGER_EVENTS_PAGE_SIZE = 50;
const RULE_TRIGGER_EVENTS_QUERY = `
SELECT
  event_at AS triggered_at,
  CAST(data.email, 'Nullable(String)') AS email
FROM events
WHERE event_type = '$sign-up-rule-trigger'
  AND COALESCE(
    NULLIF(CAST(data.rule_id, 'Nullable(String)'), ''),
    NULLIF(CAST(data.ruleId, 'Nullable(String)'), '')
  ) = {rule_id:String}
ORDER BY event_at DESC
LIMIT {limit:UInt32}
OFFSET {offset:UInt32}
`;

// Get sorted rules from config
// Type assertion needed because schema changes take effect at build time
type ConfigWithSignUpRules = CompleteConfig & {
  auth: {
    signUpRules?: Record<string, SignUpRule>,
    signUpRulesDefaultAction?: 'allow' | 'reject',
  },
};

// Compact sparkline component for rule analytics (inline next to buttons)
function RuleSparkline({
  data,
  countInTimespan,
  allTimeCount,
  timespanHours,
  isLoading,
}: {
  data: { hour: string, count: number }[],
  countInTimespan: number,
  allTimeCount: number,
  timespanHours: number,
  isLoading: boolean,
}) {
  // Show skeleton while loading
  if (isLoading) {
    return (
      <div className="flex items-center gap-1">
        <div className="w-10 h-4 bg-muted animate-pulse rounded" />
        <div className="w-4 h-3 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  // Ensure we have at least 2 data points for the chart to render a line
  const chartData = data.length >= 2 ? data : [{ hour: '0', count: 0 }, { hour: '1', count: 0 }];
  // Calculate max for Y domain - use at least 1 to avoid divide-by-zero
  const maxCount = Math.max(1, ...chartData.map(d => d.count));
  const timespanLabel = `Last ${timespanHours}h`;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 cursor-help">
          <ResponsiveContainer width={40} height={16}>
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
              <YAxis hide domain={[0, maxCount]} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="currentColor"
                strokeWidth={1}
                fill="currentColor"
                fillOpacity={0.15}
                className="text-muted-foreground"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <span className="text-[10px] text-muted-foreground tabular-nums">{countInTimespan}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        <div className="space-y-0.5">
          <div>{timespanLabel}: {countInTimespan.toLocaleString()}</div>
          <div>All-time: {allTimeCount.toLocaleString()}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function parseRuleTriggerRows(resultRows: Record<string, unknown>[]): RuleTriggerListItem[] {
  return resultRows.map((row) => {
    const triggeredAt = row.triggered_at;
    if (typeof triggeredAt !== "string") {
      throw new StackAssertionError("Expected sign-up rule trigger row to include triggered_at:string", { row });
    }

    const emailRaw = row.email;
    if (emailRaw == null) {
      return { id: generateUuid(), triggeredAt, email: null };
    }
    if (typeof emailRaw === "string") {
      return { id: generateUuid(), triggeredAt, email: emailRaw };
    }

    throw new StackAssertionError("Expected sign-up rule trigger row to include email:null|string", { row });
  });
}

function RuleTriggerHistoryDialog({
  ruleId,
  ruleDisplayName,
  sparklineData,
  countInTimespan,
  allTimeCount,
  timespanHours,
  isSparklineLoading,
}: {
  ruleId: string,
  ruleDisplayName: string,
  sparklineData: { hour: string, count: number }[],
  countInTimespan: number,
  allTimeCount: number,
  timespanHours: number,
  isSparklineLoading: boolean,
}) {
  const stackAdminApp = useAdminApp();
  const [open, setOpen] = useState(false);
  const [triggers, setTriggers] = useState<RuleTriggerListItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const latestRequestIdRef = useRef(0);

  const fetchTriggerPage = async ({ offset, reset }: { offset: number, reset: boolean }) => {
    if (!reset && (!hasMore || isLoadingMore || isInitialLoading)) {
      return;
    }

    const nextRequestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = nextRequestId;
    if (reset) {
      setIsInitialLoading(true);
      setLoadingError(null);
      setHasMore(true);
      setTriggers([]);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const response = await stackAdminApp.queryAnalytics({
        query: RULE_TRIGGER_EVENTS_QUERY,
        params: {
          rule_id: ruleId,
          limit: RULE_TRIGGER_EVENTS_PAGE_SIZE,
          offset,
        },
        timeout_ms: 30_000,
        include_all_branches: false,
      });

      // Drop stale responses if a newer request started after this one.
      if (nextRequestId !== latestRequestIdRef.current) {
        return;
      }

      const parsedRows = parseRuleTriggerRows(response.result);
      setTriggers((current) => reset ? parsedRows : [...current, ...parsedRows]);
      setHasMore(parsedRows.length === RULE_TRIGGER_EVENTS_PAGE_SIZE);
    } catch (error) {
      if (nextRequestId !== latestRequestIdRef.current) {
        return;
      }
      setLoadingError(error instanceof Error ? error.message : "Failed to load triggers");
    } finally {
      if (nextRequestId !== latestRequestIdRef.current) {
        return;
      }
      if (reset) {
        setIsInitialLoading(false);
      } else {
        setIsLoadingMore(false);
      }
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      latestRequestIdRef.current += 1;
      return;
    }
    runAsynchronouslyWithAlert(() => fetchTriggerPage({ offset: 0, reset: true }));
  };

  const handleScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    if (!hasMore || isInitialLoading || isLoadingMore) {
      return;
    }

    const target = event.currentTarget;
    const remainingScrollPx = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remainingScrollPx > 120) {
      return;
    }

    runAsynchronouslyWithAlert(() => fetchTriggerPage({ offset: triggers.length, reset: false }));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-sm hover:bg-muted/40 px-1 py-0.5 transition-colors hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`View trigger history for ${ruleDisplayName}`}
          title={`View trigger history for ${ruleDisplayName}`}
        >
          <RuleSparkline
            data={sparklineData}
            countInTimespan={countInTimespan}
            allTimeCount={allTimeCount}
            timespanHours={timespanHours}
            isLoading={isSparklineLoading}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rule trigger history</DialogTitle>
          <DialogDescription>
            {ruleDisplayName} triggered {allTimeCount.toLocaleString()} time{allTimeCount === 1 ? "" : "s"} all-time.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loadingError ? (
            <Alert variant="destructive">{loadingError}</Alert>
          ) : null}

          <div
            className="max-h-[420px] overflow-auto rounded-lg border bg-background/40"
            onScroll={handleScroll}
          >
            {isInitialLoading ? (
              <div className="space-y-2 p-3">
                {["one", "two", "three", "four", "five", "six"].map((skeletonId) => (
                  <div key={skeletonId} className="h-11 rounded-md bg-muted animate-pulse" />
                ))}
              </div>
            ) : triggers.length === 0 ? (
              <div className="p-6 text-center">
                <Typography variant="secondary" className="text-xs">
                  No trigger events found for this rule.
                </Typography>
              </div>
            ) : (
              <div className="divide-y">
                {triggers.map((trigger) => (
                  <div key={trigger.id} className="px-3 py-2.5">
                    <Typography className="text-xs font-medium tabular-nums">
                      {parseClickHouseDate(trigger.triggeredAt).toLocaleString()}
                    </Typography>
                    <Typography variant="secondary" className="text-xs font-mono">
                      {trigger.email ?? "(no email)"}
                    </Typography>
                  </div>
                ))}
              </div>
            )}
            {isLoadingMore ? (
              <div className="p-3">
                <div className="h-9 rounded-md bg-muted animate-pulse" />
              </div>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// Base card style for rules (without transition - added conditionally per component)
const ruleCardClassName = cn(
  "rounded-xl",
  "bg-background/60 backdrop-blur-xl ring-1 ring-foreground/[0.06]",
);

// Inline rule editor component
function RuleEditor({
  rule,
  ruleId,
  isNew,
  onSave,
  onCancel,
}: {
  rule?: SignUpRule,
  ruleId: string,
  isNew: boolean,
  onSave: (ruleId: string, rule: SignUpRule) => Promise<void>,
  onCancel: () => void,
}) {
  const ruleAction = rule?.action;
  const [displayName, setDisplayName] = useState(rule?.displayName ?? '');
  const [actionType, setActionType] = useState<SignUpRuleAction['type']>(ruleAction?.type ?? 'allow');
  const [actionMessage, setActionMessage] = useState(ruleAction?.message ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [isSaving, setIsSaving] = useState(false);

  // Parse existing condition or create empty group
  const initialConditionTree = useMemo((): RuleNode => {
    if (rule?.condition) {
      const parsed = parseCelToVisualTree(rule.condition);
      if (parsed) return parsed;
    }
    const group = createEmptyGroup('and');
    group.children = [createEmptyCondition()];
    return group;
  }, [rule?.condition]);

  const [conditionTree, setConditionTree] = useState<RuleNode>(initialConditionTree);

  // Validate the condition tree
  const isTreeValid = isConditionTreeValid(conditionTree);

  const handleSave = async () => {
    if (!displayName.trim() || !isTreeValid) return;

    setIsSaving(true);
    try {
      const normalizedConditionTree = conditionTree.type === 'group' && conditionTree.children.length === 0
        ? { ...conditionTree, children: [createEmptyCondition()] }
        : conditionTree;
      const celCondition = visualTreeToCel(normalizedConditionTree);

      const newRule: SignUpRule = {
        displayName: displayName.trim(),
        condition: celCondition,
        priority: rule?.priority ?? 0,
        enabled,
        action: {
          type: actionType,
          message: actionType === 'reject' ? actionMessage || undefined : undefined,
        },
      };
      await onSave(ruleId, newRule);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={cn(ruleCardClassName, "p-4 ring-primary/50 ring-2 transition-all duration-150 hover:transition-none")}>
      <div className="flex items-start gap-3">
        {/* Enabled toggle on the left */}
        <div className="pt-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {/* Main content */}
        <div className="flex-1 space-y-4">
          {/* Name input */}
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Rule name (e.g., Block disposable emails)"
            autoFocus
          />

          {/* Conditions */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Conditions</label>
            <div className="p-3 rounded-lg bg-muted/30 ring-1 ring-foreground/[0.04]">
              <ConditionBuilder
                value={conditionTree}
                onChange={setConditionTree}
              />
            </div>
          </div>

          {/* Action */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground">Action:</label>
              <Select value={actionType} onValueChange={(v) => setActionType(v as SignUpRuleAction['type'])}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="reject">Reject</SelectItem>
                  <SelectItem value="restrict">Restrict</SelectItem>
                  <SelectItem value="log">Log only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {actionType === 'reject' && (
              <Input
                value={actionMessage}
                onChange={(e) => setActionMessage(e.target.value)}
                placeholder="Internal rejection reason (not shown to user)"
                className="flex-1"
              />
            )}
          </div>

          {/* Save/Cancel buttons */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={!displayName.trim() || !isTreeValid || isSaving}
              size="sm"
            >
              <CheckIcon className="h-4 w-4 mr-1.5" />
              {isNew ? 'Create rule' : 'Save changes'}
            </Button>
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={isSaving}
              size="sm"
            >
              <XIcon className="h-4 w-4 mr-1.5" />
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Sortable rule row component (view mode)
function SortableRuleRow({
  entry,
  analytics,
  analyticsTimespanHours,
  isAnalyticsLoading,
  isEditing,
  onEdit,
  onDelete,
  onToggleEnabled,
  onSave,
  onCancelEdit,
}: {
  entry: SignUpRuleEntry,
  analytics?: RuleAnalytics,
  analyticsTimespanHours: number,
  isAnalyticsLoading: boolean,
  isEditing: boolean,
  onEdit: () => void,
  onDelete: () => void,
  onToggleEnabled: (enabled: boolean) => void,
  onSave: (ruleId: string, rule: SignUpRule) => Promise<void>,
  onCancelEdit: () => void,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled: isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    // Only apply transition when not actively dragging to avoid lag
    transition: isDragging ? undefined : transition,
  };

  const actionType = entry.rule.action.type;
  const actionLabels: Record<string, string> = {
    'allow': 'Allow',
    'reject': 'Reject',
    'restrict': 'Restrict',
    'log': 'Log',
  };
  const actionLabel = actionLabels[actionType];

  const conditionSummary = entry.rule.condition || '(no condition)';
  const isEnabled = entry.rule.enabled !== false;

  // If editing, show the editor
  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style}>
        <RuleEditor
          rule={entry.rule}
          ruleId={entry.id}
          isNew={false}
          onSave={onSave}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  // View mode - entire card is draggable
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        ruleCardClassName,
        "flex items-center gap-3 p-4 cursor-grab active:cursor-grabbing",
        "hover:ring-foreground/[0.1] hover:shadow-md",
        // Only apply CSS transition when not dragging to avoid lag
        !isDragging && "transition-all duration-150 hover:transition-none",
        isDragging && "opacity-50 shadow-lg z-10",
      )}
      {...attributes}
      {...listeners}
    >
      {/* Enable/disable switch - on the left */}
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Switch
          checked={isEnabled}
          onCheckedChange={onToggleEnabled}
        />
      </div>

      {/* Rule info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Typography className={cn(
            "font-medium text-sm truncate",
            !isEnabled && "text-muted-foreground line-through",
          )}>
            {entry.rule.displayName || 'Unnamed rule'}
          </Typography>
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded",
            actionType === 'allow' && "bg-green-500/10 text-green-600 dark:text-green-400",
            actionType === 'reject' && "bg-red-500/10 text-red-600 dark:text-red-400",
            actionType === 'restrict' && "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
            actionType === 'log' && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            !isEnabled && "opacity-50",
          )}>
            {actionLabel}
          </span>
        </div>
        <Typography variant="secondary" className={cn(
          "text-xs truncate mt-0.5",
          !isEnabled && "line-through",
        )}>
          {conditionSummary}
        </Typography>
      </div>

      {/* Actions - sparkline, edit, and delete */}
      <div
        className="flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Sparkline and trigger count */}
        <div className="hidden sm:flex items-center mr-1">
          <RuleTriggerHistoryDialog
            ruleId={entry.id}
            ruleDisplayName={entry.rule.displayName || entry.id}
            sparklineData={analytics?.hourlyCounts ?? []}
            countInTimespan={analytics?.countInTimespan ?? 0}
            allTimeCount={analytics?.allTimeCount ?? 0}
            timespanHours={analyticsTimespanHours}
            isSparklineLoading={isAnalyticsLoading}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={`Edit rule ${entry.rule.displayName || entry.id}`}
          title={`Edit rule ${entry.rule.displayName || entry.id}`}
          onClick={onEdit}
        >
          <PencilSimpleIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          aria-label={`Delete rule ${entry.rule.displayName || entry.id}`}
          title={`Delete rule ${entry.rule.displayName || entry.id}`}
          onClick={onDelete}
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Default action card - looks like a rule but without controls
function DefaultActionCard({
  value,
  onChange,
}: {
  value: 'allow' | 'reject',
  onChange: (value: 'allow' | 'reject') => void,
}) {
  return (
    <div className={cn(ruleCardClassName, "flex items-center gap-3 p-4 border-dashed border border-border/50 ring-0 transition-all duration-150 hover:transition-none")}>
      {/* Spacer to align with switch position in rule cards */}
      <div className="w-9" />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Typography className="font-medium text-sm text-muted-foreground">
            Default action
          </Typography>
        </div>
        <Typography variant="secondary" className="text-xs mt-0.5">
          When no rules match
        </Typography>
      </div>

      {/* Action dropdown */}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-36 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="allow">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Allow
            </span>
          </SelectItem>
          <SelectItem value="reject">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Reject
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

const DEFAULT_TURNSTILE_OVERRIDE = "__default__";


// Shared hook used by every TestRulesCard variant - encapsulates all the state
// and the API call so the variants can focus purely on the UI.
function useTestRulesState(stackAdminApp: ReturnType<typeof useAdminApp>) {
  const [email, setEmail] = useState('');
  const [authMethod, setAuthMethod] = useState<SignUpRulesTestResult['context']['auth_method']>('password');
  const [oauthProvider, setOauthProvider] = useState('');
  const [countryCodeOverride, setCountryCodeOverride] = useState('');
  const [turnstileResultOverride, setTurnstileResultOverride] = useState<'ok' | 'invalid' | 'error' | typeof DEFAULT_TURNSTILE_OVERRIDE>(DEFAULT_TURNSTILE_OVERRIDE);
  const [botRiskScoreOverride, setBotRiskScoreOverride] = useState('');
  const [freeTrialAbuseRiskScoreOverride, setFreeTrialAbuseRiskScoreOverride] = useState('');
  const [result, setResult] = useState<SignUpRulesTestResult | null>(null);

  const [runTest, isRunning] = useAsyncCallback(async () => {
    setResult(null);
    const normalizedCountryCodeOverride = normalizeCountryCode(countryCodeOverride);
    const normalizedBotRiskScoreOverride = botRiskScoreOverride.trim();
    const normalizedFreeTrialAbuseRiskScoreOverride = freeTrialAbuseRiskScoreOverride.trim();
    if (normalizedCountryCodeOverride !== '' && !isValidCountryCode(normalizedCountryCodeOverride)) {
      throw new Error("Country code override must be a 2-letter code.");
    }
    if (!validateRiskScore(normalizedBotRiskScoreOverride)) {
      throw new Error("Bot risk score override must be an integer between 0 and 100.");
    }
    if (!validateRiskScore(normalizedFreeTrialAbuseRiskScoreOverride)) {
      throw new Error("Free trial abuse risk score override must be an integer between 0 and 100.");
    }
    if ((normalizedBotRiskScoreOverride === '') !== (normalizedFreeTrialAbuseRiskScoreOverride === '')) {
      throw new Error("Bot risk score and free trial abuse risk score overrides must both be provided or both be left blank.");
    }

    const response = await (stackAdminApp as any)[stackAppInternalsSymbol].sendRequest(
      '/internal/sign-up-rules-test',
      {
        method: 'POST',
        body: JSON.stringify({
          email: email === '' ? null : email,
          auth_method: authMethod,
          oauth_provider: authMethod === 'oauth'
            ? (oauthProvider === '' ? null : oauthProvider)
            : null,
          country_code: normalizedCountryCodeOverride === '' ? null : normalizedCountryCodeOverride,
          ...(turnstileResultOverride === DEFAULT_TURNSTILE_OVERRIDE
            ? {}
            : {
              turnstile_result: turnstileResultOverride,
            }),
          ...(normalizedBotRiskScoreOverride === ''
            ? {}
            : {
              risk_scores: {
                bot: Number(normalizedBotRiskScoreOverride),
                free_trial_abuse: Number(normalizedFreeTrialAbuseRiskScoreOverride),
              },
            }),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      },
      'admin'
    );

    if (!response.ok) {
      throw new StackAssertionError(`Failed to test sign-up rules: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    setResult(data);
  }, [authMethod, botRiskScoreOverride, countryCodeOverride, email, freeTrialAbuseRiskScoreOverride, oauthProvider, stackAdminApp, turnstileResultOverride]);

  return {
    email, setEmail,
    authMethod, setAuthMethod,
    oauthProvider, setOauthProvider,
    countryCodeOverride, setCountryCodeOverride,
    turnstileResultOverride, setTurnstileResultOverride,
    botRiskScoreOverride, setBotRiskScoreOverride,
    freeTrialAbuseRiskScoreOverride, setFreeTrialAbuseRiskScoreOverride,
    result,
    runTest,
    isRunning,
  };
}

type TestRulesState = ReturnType<typeof useTestRulesState>;

function actionBadgeClassNameFor(type: SignUpRulesTestEvaluation['action']['type']) {
  return cn(
    "text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded",
    type === 'allow' && "bg-green-500/10 text-green-600 dark:text-green-400",
    type === 'reject' && "bg-red-500/10 text-red-600 dark:text-red-400",
    type === 'restrict' && "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    type === 'log' && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  );
}

const DECISION_LABEL: Record<SignUpRulesTestResult['outcome']['decision'], string> = {
  allow: 'Allowed by rule',
  reject: 'Rejected by rule',
  'default-allow': 'Allowed by default',
  'default-reject': 'Rejected by default',
};

const STATUS_LABEL: Record<SignUpRulesTestEvaluationStatus, string> = {
  matched: 'Matched',
  not_matched: 'No match',
  disabled: 'Disabled',
  missing_condition: 'No condition',
  error: 'Error',
};

// Essentials-first test rules card with a collapsible "Advanced" panel
// and an outcome-forward results view. The outcome box mounts as soon as
// a run kicks off so users see a loading indicator before it resolves.
function TestRulesCard({ state }: { state: TestRulesState }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { result, isRunning } = state;

  // Keep the results region mounted across loading -> result transitions
  // so we can animate the color/icon change smoothly.
  const hasRun = isRunning || result !== null;

  const matchedCount = result?.evaluations.filter((e) => e.status === 'matched').length ?? 0;
  const decisionRule = result?.outcome.decision_rule_id
    ? result.evaluations.find((e) => e.rule_id === result.outcome.decision_rule_id)
    : undefined;

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <Input
              value={state.email}
              onChange={(e) => state.setEmail(e.target.value)}
              placeholder="user@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Sign-up method</label>
            <Select value={state.authMethod} onValueChange={(v) => {
              if (v === 'password' || v === 'otp' || v === 'oauth' || v === 'passkey') {
                state.setAuthMethod(v);
                if (v !== 'oauth') state.setOauthProvider('');
              }
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="otp">OTP</SelectItem>
                <SelectItem value="oauth">OAuth</SelectItem>
                <SelectItem value="passkey">Passkey</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdvanced ? <CaretDownIcon className="h-3.5 w-3.5" /> : <CaretRightIcon className="h-3.5 w-3.5" />}
          <SlidersIcon className="h-3.5 w-3.5" />
          Advanced options
          <span className="text-muted-foreground/70">
            (OAuth provider, country, risk scores, turnstile)
          </span>
        </button>

        {showAdvanced && (
          <div className="rounded-lg border border-dashed p-4 space-y-3 bg-muted/20">
            {state.authMethod === 'oauth' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">OAuth provider</label>
                <Input
                  value={state.oauthProvider}
                  onChange={(e) => state.setOauthProvider(e.target.value)}
                  placeholder="google"
                  list="sign-up-rule-test-oauth-providers-v1"
                />
                <datalist id="sign-up-rule-test-oauth-providers-v1">
                  {OAUTH_PROVIDER_OPTIONS.map((p) => <option key={p} value={p} />)}
                </datalist>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Country</label>
                <CountryCodeInput
                  value={state.countryCodeOverride || null}
                  onChange={(val) => state.setCountryCodeOverride(val ?? "")}
                />
                <Typography variant="secondary" className="text-[11px]">Leave blank to use real geolocation.</Typography>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Turnstile result</label>
                <Select value={state.turnstileResultOverride} onValueChange={(v) => {
                  if (v === DEFAULT_TURNSTILE_OVERRIDE || v === "ok" || v === "invalid" || v === "error") {
                    state.setTurnstileResultOverride(v);
                  }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_TURNSTILE_OVERRIDE}>Use real result</SelectItem>
                    <SelectItem value="ok">OK</SelectItem>
                    <SelectItem value="invalid">Invalid</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Bot risk score</label>
                <Input
                  value={state.botRiskScoreOverride}
                  onChange={(e) => state.setBotRiskScoreOverride(e.target.value)}
                  placeholder="0-100 (blank = real)"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Free trial abuse score</label>
                <Input
                  value={state.freeTrialAbuseRiskScoreOverride}
                  onChange={(e) => state.setFreeTrialAbuseRiskScoreOverride(e.target.value)}
                  placeholder="0-100 (blank = real)"
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            size="lg"
            onClick={() => runAsynchronouslyWithAlert(state.runTest)}
            loading={state.isRunning}
          >
            Run test
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
          hasRun ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-3">
            {/* Outcome hero — mounts on run start with neutral/loading style,
                then fades into green/red once the result arrives. */}
            <div
              className={cn(
                "rounded-xl border-2 p-5 flex items-center gap-4 transition-colors duration-500 ease-out",
                !result && "bg-muted/30 border-muted-foreground/20 text-muted-foreground",
                result?.outcome.should_allow && "bg-green-500/5 border-green-500/30 text-green-700 dark:text-green-400",
                result && !result.outcome.should_allow && "bg-red-500/5 border-red-500/30 text-red-700 dark:text-red-400",
              )}
            >
              <div className="relative h-10 w-10 flex-shrink-0">
                <CircleNotchIcon
                  className={cn(
                    "absolute inset-0 h-10 w-10 text-muted-foreground/60 animate-spin transition-opacity duration-200",
                    result ? "opacity-0" : "opacity-100",
                  )}
                />
                <CheckCircleIcon
                  weight="fill"
                  className={cn(
                    "absolute inset-0 h-10 w-10 transition-opacity duration-300",
                    result?.outcome.should_allow ? "opacity-100" : "opacity-0",
                  )}
                />
                <XCircleIcon
                  weight="fill"
                  className={cn(
                    "absolute inset-0 h-10 w-10 transition-opacity duration-300",
                    result && !result.outcome.should_allow ? "opacity-100" : "opacity-0",
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <Typography className="text-xl font-bold">
                  {!result && "Running test…"}
                  {result && `Sign-up would ${result.outcome.should_allow ? 'be allowed' : 'be rejected'}`}
                </Typography>
                <Typography variant="secondary" className="text-sm">
                  {!result && "Evaluating configured rules."}
                  {result && (
                    <>
                      {DECISION_LABEL[result.outcome.decision]}
                      {decisionRule && <> — <span className="font-medium">{decisionRule.display_name || decisionRule.rule_id}</span></>}
                    </>
                  )}
                </Typography>
                {result?.outcome.decision === 'reject' && decisionRule?.action.message && (
                  <Typography variant="secondary" className="text-xs mt-1 italic">
                    Reason: {decisionRule.action.message}
                  </Typography>
                )}
              </div>
            </div>

            {/* Matched rules + context only render once the result arrives; they
                slide in underneath the outcome hero. */}
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                result ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden space-y-3">
                {result && (
                  <>
                    <details className="rounded-lg border bg-background/40">
                      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium flex items-center justify-between">
                        <span>Matched rules</span>
                        <span className="text-xs text-muted-foreground">{matchedCount} of {result.evaluations.length}</span>
                      </summary>
                      <div className="px-4 pb-3 space-y-1">
                        {result.evaluations.map((e) => (
                          <div key={e.rule_id} className="flex items-center gap-2 py-1.5 border-t first:border-t-0">
                            <span className={cn(
                              "h-2 w-2 rounded-full flex-shrink-0",
                              e.status === 'matched' && "bg-emerald-500",
                              e.status === 'not_matched' && "bg-muted-foreground/30",
                              e.status === 'disabled' && "bg-muted-foreground/20",
                              e.status === 'error' && "bg-red-500",
                              e.status === 'missing_condition' && "bg-amber-500",
                            )} />
                            <span className="text-sm font-medium truncate flex-1">{e.display_name || e.rule_id}</span>
                            <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[e.status]}</span>
                            <span className={actionBadgeClassNameFor(e.action.type)}>{e.action.type}</span>
                          </div>
                        ))}
                      </div>
                    </details>

                    <details className="rounded-lg border bg-background/40">
                      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Resolved context</summary>
                      <div className="px-4 pb-3 pt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div><span className="text-muted-foreground">Email: </span>{result.context.email || "(empty)"}</div>
                        <div><span className="text-muted-foreground">Domain: </span>{result.context.email_domain || "(empty)"}</div>
                        <div><span className="text-muted-foreground">Country: </span>{result.context.country_code || "(empty)"}</div>
                        <div><span className="text-muted-foreground">OAuth provider: </span>{result.context.oauth_provider || "(empty)"}</div>
                        <div><span className="text-muted-foreground">Turnstile: </span>{result.context.turnstile_result}</div>
                        <div><span className="text-muted-foreground">Bot score: </span>{result.context.risk_scores.bot}</div>
                        <div><span className="text-muted-foreground">Free-trial abuse: </span>{result.context.risk_scores.free_trial_abuse}</div>
                      </div>
                    </details>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TestRulesDialog({
  stackAdminApp,
}: {
  stackAdminApp: ReturnType<typeof useAdminApp>,
}) {
  const state = useTestRulesState(stackAdminApp);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          Open tester
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Test sign-up rules</DialogTitle>
          <DialogDescription>
            Simulate a sign-up request to see which rules trigger and how the final decision is made.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <TestRulesCard state={state} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// Delete confirmation dialog
function DeleteRuleDialog({
  open,
  onOpenChange,
  ruleName,
  onConfirm,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  ruleName: string,
  onConfirm: () => Promise<void>,
}) {
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Rule"
      danger
      okButton={{
        label: "Delete",
        onClick: onConfirm,
      }}
      cancelButton
    >
      <Typography>
        Are you sure you want to delete the rule <b>{ruleName}</b>? This action cannot be undone.
      </Typography>
    </ActionDialog>
  );
}

// Custom hook to fetch sign-up rules analytics
function useSignUpRulesAnalytics() {
  const stackAdminApp = useAdminApp();
  const [analytics, setAnalytics] = useState<Map<string, RuleAnalytics>>(new Map());
  const [timespanHours, setTimespanHours] = useState(48);
  const [isLoading, setIsLoading] = useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const fetchAnalytics = async () => {
      const response = await (stackAdminApp as any)[stackAppInternalsSymbol].sendRequest(
        '/internal/sign-up-rules-stats',
        { method: 'GET' },
        'admin' // Required for internal endpoints
      );
      if (cancelled) return;

      if (!response.ok) {
        throw new StackAssertionError(`Failed to fetch sign-up rules stats: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setTimespanHours(data.analytics_hours);

      const analyticsMap = new Map<string, RuleAnalytics>();
      for (const trigger of data.rule_triggers ?? []) {
        analyticsMap.set(trigger.rule_id, {
          ruleId: trigger.rule_id,
          countInTimespan: trigger.total_count,
          allTimeCount: trigger.all_time_count,
          hourlyCounts: trigger.hourly_counts ?? [],
        });
      }

      setAnalytics(analyticsMap);
      setIsLoading(false);
    };

    runAsynchronouslyWithAlert(fetchAnalytics);

    return () => {
      cancelled = true;
    };
  }, [stackAdminApp]);

  return { analytics, timespanHours, isLoading };
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newRuleId, setNewRuleId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<SignUpRuleEntry | null>(null);

  // Fetch analytics data
  const {
    analytics: ruleAnalytics,
    timespanHours: analyticsTimespanHours,
    isLoading: isAnalyticsLoading,
  } = useSignUpRulesAnalytics();

  // Type assertion needed because schema changes take effect at build time
  const configWithRules = config as ConfigWithSignUpRules;

  // Server state (source of truth)
  const serverRules = useMemo(() =>
    typedEntries(configWithRules.auth.signUpRules).map(([id, rule]) => ({ id, rule })),
    [configWithRules.auth.signUpRules]
  );
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript may not see these as optional due to type assertion
  const defaultAction = configWithRules.auth.signUpRulesDefaultAction ?? 'allow';

  // ===== LOCAL STATE FOR REORDERING ONLY =====
  // When user drags to reorder, we store the new order locally until they save
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);

  // Compute the displayed rules: if we have a pending order, reorder server rules accordingly
  const signUpRules: SignUpRuleEntry[] = useMemo(() => {
    if (pendingOrder === null) return serverRules;
    // Reorder server rules based on pending order
    const ruleMap = new Map(serverRules.map(r => [r.id, r]));
    const result: SignUpRuleEntry[] = [];
    for (const id of pendingOrder) {
      const rule = ruleMap.get(id);
      if (rule) result.push(rule);
    }
    return result;
  }, [serverRules, pendingOrder]);

  const hasOrderChanges = pendingOrder !== null;

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const currentOrder = pendingOrder ?? serverRules.map(r => r.id);
      const oldIndex = currentOrder.indexOf(active.id as string);
      const newIndex = currentOrder.indexOf(over.id as string);
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
      setPendingOrder(newOrder);
    }
  };

  const handleAddRule = () => {
    const id = generateUuid();
    setNewRuleId(id);
    setIsCreatingNew(true);
    setEditingRuleId(null);
  };

  // Save rule immediately to config
  const handleSaveRule = async (ruleId: string, rule: SignUpRule) => {
    // For new rules, set priority to be at the top (don't mutate the input)
    const ruleToSave: SignUpRule = isCreatingNew
      ? { ...rule, priority: serverRules.length + 1 }
      : rule;

    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`auth.signUpRules.${ruleId}`]: ruleToSave,
      },
      pushable: true,
    });
    setEditingRuleId(null);
    setIsCreatingNew(false);
    setNewRuleId(null);
  };

  const handleCancelEdit = () => {
    setEditingRuleId(null);
    setIsCreatingNew(false);
    setNewRuleId(null);
  };

  // Delete rule immediately
  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`auth.signUpRules.${ruleToDelete.id}`]: null,
      },
      pushable: true,
    });
    // Clear from pending order if present
    if (pendingOrder) {
      setPendingOrder(pendingOrder.filter(id => id !== ruleToDelete.id));
    }
    setDeleteDialogOpen(false);
    setRuleToDelete(null);
  };

  // Toggle enabled immediately
  const handleToggleEnabled = async (ruleId: string, enabled: boolean) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`auth.signUpRules.${ruleId}.enabled`]: enabled,
      },
      pushable: true,
    });
  };

  // Change default action immediately
  const handleDefaultActionChange = async (value: 'allow' | 'reject') => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        'auth.signUpRulesDefaultAction': value,
      },
      pushable: true,
    });
  };

  // Save reorder changes
  const handleSaveOrder = async () => {
    if (!pendingOrder) return;

    const configUpdate: Record<string, number> = {};
    pendingOrder.forEach((ruleId, index) => {
      configUpdate[`auth.signUpRules.${ruleId}.priority`] = pendingOrder.length - index;
    });

    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate,
      pushable: true,
    });

    setPendingOrder(null);
  };

  const handleDiscardOrder = () => {
    setPendingOrder(null);
  };

  const [handleSaveOrderAsync, isSavingOrder] = useAsyncCallback(handleSaveOrder, [handleSaveOrder]);

  const isAnyEditing = editingRuleId !== null || isCreatingNew;

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Sign-up Rules"
        description="Create rules to control who can sign up. Rules are evaluated in order from top to bottom."
        actions={
          <div className="flex items-center gap-2">
            <TestRulesDialog stackAdminApp={stackAdminApp} />
            <Button
              onClick={handleAddRule}
              disabled={isAnyEditing || hasOrderChanges}
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add rule
            </Button>
          </div>
        }
      >
        {/* Rules list and default action */}
        <div className="relative space-y-2">
          {/* New rule editor (at the top when creating) */}
          {isCreatingNew && newRuleId && (
            <RuleEditor
              ruleId={newRuleId}
              isNew
              onSave={handleSaveRule}
              onCancel={handleCancelEdit}
            />
          )}

          {/* Pending order banner */}
          {hasOrderChanges && (
            <div className="rounded-xl border-2 border-primary/50 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <ArrowsDownUpIcon className="h-4 w-4" />
                  <span>Rule order has been changed</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDiscardOrder}
                    disabled={isSavingOrder}
                  >
                    <XIcon className="h-4 w-4 mr-1.5" />
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveOrderAsync}
                    loading={isSavingOrder}
                  >
                    <CheckIcon className="h-4 w-4 mr-1.5" />
                    Save order
                  </Button>
                </div>
              </div>

              {/* Rules list inside the banner */}
              <div className="space-y-2">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={signUpRules.map((r) => r.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {signUpRules.map((entry) => (
                      <SortableRuleRow
                        key={entry.id}
                        entry={entry}
                        analytics={ruleAnalytics.get(entry.id)}
                        analyticsTimespanHours={analyticsTimespanHours}
                        isAnalyticsLoading={isAnalyticsLoading}
                        isEditing={editingRuleId === entry.id}
                        onEdit={() => {
                          setEditingRuleId(entry.id);
                          setIsCreatingNew(false);
                        }}
                        onDelete={() => {
                          setRuleToDelete(entry);
                          setDeleteDialogOpen(true);
                        }}
                        onToggleEnabled={(enabled) => runAsynchronouslyWithAlert(handleToggleEnabled(entry.id, enabled))}
                        onSave={handleSaveRule}
                        onCancelEdit={handleCancelEdit}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          )}

          {/* Normal rules list (when no pending order) */}
          {!hasOrderChanges && signUpRules.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={signUpRules.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                {signUpRules.map((entry) => (
                  <SortableRuleRow
                    key={entry.id}
                    entry={entry}
                    analytics={ruleAnalytics.get(entry.id)}
                    analyticsTimespanHours={analyticsTimespanHours}
                    isAnalyticsLoading={isAnalyticsLoading}
                    isEditing={editingRuleId === entry.id}
                    onEdit={() => {
                      setEditingRuleId(entry.id);
                      setIsCreatingNew(false);
                    }}
                    onDelete={() => {
                      setRuleToDelete(entry);
                      setDeleteDialogOpen(true);
                    }}
                    onToggleEnabled={(enabled) => runAsynchronouslyWithAlert(handleToggleEnabled(entry.id, enabled))}
                    onSave={handleSaveRule}
                    onCancelEdit={handleCancelEdit}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* Empty state */}
          {!hasOrderChanges && signUpRules.length === 0 && !isCreatingNew && (
            <Alert>
              No sign-up rules configured. Click &quot;Add rule&quot; to create your first rule.
            </Alert>
          )}

          {/* Default action card - always at the bottom */}
          <DefaultActionCard
            value={defaultAction}
            onChange={(v) => runAsynchronouslyWithAlert(handleDefaultActionChange(v))}
          />
        </div>

        {/* Delete confirmation dialog */}
        <DeleteRuleDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          ruleName={ruleToDelete?.rule.displayName ?? 'this rule'}
          onConfirm={handleDeleteRule}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
