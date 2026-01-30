"use client";

import { ConditionBuilder } from "@/components/rule-builder";
import {
  ActionDialog,
  Alert,
  Button,
  cn,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
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
import { ArrowsDownUpIcon, CheckIcon, PencilSimpleIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import type { SignUpRule, SignUpRuleAction } from "@stackframe/stack-shared/dist/interface/crud/sign-up-rules";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import React, { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

// Analytics types
type RuleAnalytics = {
  ruleId: string,
  totalCount: number,
  hourlyCounts: { hour: string, count: number }[],
};

type SignUpRuleEntry = {
  id: string,
  rule: SignUpRule,
};

// Get sorted rules from config
// Type assertion needed because schema changes take effect at build time
type ConfigWithSignUpRules = CompleteConfig & {
  auth: {
    signUpRules?: Record<string, SignUpRule>,
    signUpRulesDefaultAction?: 'allow' | 'reject',
  },
};

// Sparkline component for rule analytics
function RuleSparkline({
  data,
  totalCount,
}: {
  data: { hour: string, count: number }[],
  totalCount: number,
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="text-xs">No activity</span>
      </div>
    );
  }

  // Use full 48h window for accurate per-hour rate
  const avgPerHour = totalCount / 48;
  const rateLabel = avgPerHour < 1
    ? `${totalCount}/48h`
    : `${avgPerHour.toFixed(1)}/h`;

  return (
    <div className="flex items-center gap-2">
      <ResponsiveContainer width={60} height={24}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Area
            type="monotone"
            dataKey="count"
            stroke="currentColor"
            strokeWidth={1.5}
            fill="currentColor"
            fillOpacity={0.1}
            className="text-primary"
          />
        </AreaChart>
      </ResponsiveContainer>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{rateLabel}</span>
    </div>
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

  const handleSave = async () => {
    if (!displayName.trim()) return;

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
              disabled={!displayName.trim() || isSaving}
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
  isEditing,
  onEdit,
  onDelete,
  onToggleEnabled,
  onSave,
  onCancelEdit,
}: {
  entry: SignUpRuleEntry,
  analytics?: RuleAnalytics,
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
  const actionLabel = actionLabels[actionType] ?? actionType;

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

      {/* Sparkline chart for analytics */}
      {analytics && (
        <div className="hidden sm:block w-28">
          <RuleSparkline
            data={analytics.hourlyCounts}
            totalCount={analytics.totalCount}
          />
        </div>
      )}

      {/* Actions - edit and delete */}
      <div
        className="flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
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

  React.useEffect(() => {
    let cancelled = false;

    const fetchAnalytics = async () => {
      const response = await (stackAdminApp as any)[stackAppInternalsSymbol].sendRequest(
        '/internal/sign-up-rules',
        { method: 'GET' },
        'admin' // Required for internal endpoints
      );
      if (cancelled) return;

      const data = await response.json();

      const analyticsMap = new Map<string, RuleAnalytics>();
      for (const trigger of data.rule_triggers ?? []) {
        analyticsMap.set(trigger.rule_id, {
          ruleId: trigger.rule_id,
          totalCount: trigger.total_count,
          hourlyCounts: trigger.hourly_counts,
        });
      }

      setAnalytics(analyticsMap);
    };

    runAsynchronouslyWithAlert(fetchAnalytics);

    return () => {
      cancelled = true;
    };
  }, [stackAdminApp]);

  return { analytics };
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
  const { analytics: ruleAnalytics } = useSignUpRulesAnalytics();

  // Type assertion needed because schema changes take effect at build time
  const configWithRules = config as ConfigWithSignUpRules;

  // Server state (source of truth)
  const serverRules = useMemo(() =>
    typedEntries(configWithRules.auth.signUpRules ?? {}).map(([id, rule]) => ({ id, rule })),
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
          <Button
            onClick={handleAddRule}
            disabled={isAnyEditing || hasOrderChanges}
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add rule
          </Button>
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
