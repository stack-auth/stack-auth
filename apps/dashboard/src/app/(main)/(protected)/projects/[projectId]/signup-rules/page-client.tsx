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
  Spinner,
  Switch,
  Typography,
} from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import {
  createEmptyCondition,
  createEmptyGroup,
  parseCelToVisualTree,
  visualTreeToCel,
  type RuleNode,
} from "@/lib/cel-visual-parser";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckIcon, PencilSimpleIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import React, { useState, useMemo } from "react";
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

// Types for signup rules from config
type SignupRuleMetadataEntry = {
  value: string | number | boolean,
  target: 'client' | 'client_read_only' | 'server',
};

type SignupRuleAction = {
  type: 'allow' | 'reject' | 'restrict' | 'log' | 'add_metadata',
  metadata?: Record<string, SignupRuleMetadataEntry>,
  message?: string,
};

type SignupRule = {
  enabled: boolean,
  displayName: string,
  priority: number,
  condition: string,
  action: SignupRuleAction,
};

type SignupRuleEntry = {
  id: string,
  rule: SignupRule,
};

// Get sorted rules from config
// Type assertion needed because schema changes take effect at build time
type ConfigWithSignupRules = CompleteConfig & {
  auth: {
    signupRules?: Record<string, SignupRule>,
    signupRulesDefaultAction?: 'allow' | 'reject',
  },
};

function getSortedRules(config: CompleteConfig): SignupRuleEntry[] {
  const configWithRules = config as ConfigWithSignupRules;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript may not see these as optional due to type assertion
  const rules = configWithRules.auth.signupRules ?? {};
  return Object.entries(rules)
    .map(([id, rule]) => ({ id, rule: rule as SignupRule }))
    .sort((a, b) => {
      const priorityA = a.rule.priority;
      const priorityB = b.rule.priority;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return stringCompare(a.id, b.id);
    });
}

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

  const avgPerHour = totalCount / Math.max(data.length, 1);
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

// Individual metadata entry for the editor
type MetadataEditorEntry = {
  key: string,
  value: string,
  target: 'client' | 'client_read_only' | 'server',
};

// Inline rule editor component
function RuleEditor({
  rule,
  ruleId,
  isNew,
  onSave,
  onCancel,
}: {
  rule?: SignupRule,
  ruleId: string,
  isNew: boolean,
  onSave: (ruleId: string, rule: SignupRule) => Promise<void>,
  onCancel: () => void,
}) {
  const [displayName, setDisplayName] = useState(rule?.displayName ?? '');
  const [actionType, setActionType] = useState<SignupRuleAction['type']>(rule?.action.type ?? 'allow');
  const [actionMessage, setActionMessage] = useState(rule?.action.message ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [isSaving, setIsSaving] = useState(false);

  // Metadata entries for add_metadata action
  const initialMetadata = useMemo((): MetadataEditorEntry[] => {
    if (!rule?.action.metadata) return [{ key: '', value: '', target: 'server' }];
    const entries: MetadataEditorEntry[] = Object.entries(rule.action.metadata).map(([key, entry]) => ({
      key,
      value: String(entry.value),
      target: entry.target,
    }));
    return entries.length > 0 ? entries : [{ key: '', value: '', target: 'server' }];
  }, [rule?.action.metadata]);

  const [metadataEntries, setMetadataEntries] = useState<MetadataEditorEntry[]>(initialMetadata);

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
      const celCondition = visualTreeToCel(conditionTree);

      // Build metadata from entries
      const metadata: Record<string, SignupRuleMetadataEntry> | undefined =
        actionType === 'add_metadata'
          ? metadataEntries
            .filter(e => e.key.trim())
            .reduce((acc, e) => {
              acc[e.key.trim()] = { value: e.value, target: e.target };
              return acc;
            }, {} as Record<string, SignupRuleMetadataEntry>)
          : undefined;

      const newRule: SignupRule = {
        displayName: displayName.trim(),
        condition: celCondition,
        priority: rule?.priority ?? 0,
        enabled,
        action: {
          type: actionType,
          message: actionType === 'reject' ? actionMessage || undefined : undefined,
          metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
        },
      };
      await onSave(ruleId, newRule);
    } finally {
      setIsSaving(false);
    }
  };

  const addMetadataEntry = () => {
    setMetadataEntries([...metadataEntries, { key: '', value: '', target: 'server' }]);
  };

  const removeMetadataEntry = (index: number) => {
    if (metadataEntries.length > 1) {
      setMetadataEntries(metadataEntries.filter((_, i) => i !== index));
    }
  };

  const updateMetadataEntry = (index: number, updates: Partial<MetadataEditorEntry>) => {
    setMetadataEntries(metadataEntries.map((entry, i) =>
      i === index ? { ...entry, ...updates } : entry
    ));
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
              <Select value={actionType} onValueChange={(v) => setActionType(v as SignupRuleAction['type'])}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="reject">Reject</SelectItem>
                  <SelectItem value="restrict">Restrict</SelectItem>
                  <SelectItem value="log">Log only</SelectItem>
                  <SelectItem value="add_metadata">Add metadata</SelectItem>
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

          {/* Metadata entries for add_metadata action */}
          {actionType === 'add_metadata' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Metadata entries</label>
              <div className="space-y-2">
                {metadataEntries.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={entry.key}
                      onChange={(e) => updateMetadataEntry(index, { key: e.target.value })}
                      placeholder="Key"
                      className="flex-1"
                    />
                    <Input
                      value={entry.value}
                      onChange={(e) => updateMetadataEntry(index, { value: e.target.value })}
                      placeholder="Value"
                      className="flex-1"
                    />
                    <Select
                      value={entry.target}
                      onValueChange={(v) => updateMetadataEntry(index, { target: v as 'client' | 'client_read_only' | 'server' })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="client">Client</SelectItem>
                        <SelectItem value="client_read_only">Client (read-only)</SelectItem>
                        <SelectItem value="server">Server</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMetadataEntry(index)}
                      disabled={metadataEntries.length <= 1}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addMetadataEntry}
                  className="text-muted-foreground"
                >
                  <PlusIcon className="h-4 w-4 mr-1.5" />
                  Add entry
                </Button>
              </div>
            </div>
          )}

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
  entry: SignupRuleEntry,
  analytics?: RuleAnalytics,
  isEditing: boolean,
  onEdit: () => void,
  onDelete: () => void,
  onToggleEnabled: (enabled: boolean) => void,
  onSave: (ruleId: string, rule: SignupRule) => Promise<void>,
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

  const actionLabel = {
    'allow': 'Allow',
    'reject': 'Reject',
    'restrict': 'Restrict',
    'log': 'Log',
    'add_metadata': 'Add metadata',
  }[entry.rule.action.type];

  const conditionSummary = entry.rule.condition || '(no condition)';

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
        !entry.rule.enabled && "opacity-40 grayscale",
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
          checked={entry.rule.enabled}
          onCheckedChange={onToggleEnabled}
        />
      </div>

      {/* Rule info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Typography className={cn(
            "font-medium text-sm truncate",
            !entry.rule.enabled && "text-muted-foreground",
          )}>
            {entry.rule.displayName || 'Unnamed rule'}
          </Typography>
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded",
            entry.rule.action.type === 'allow' && "bg-green-500/10 text-green-600 dark:text-green-400",
            entry.rule.action.type === 'reject' && "bg-red-500/10 text-red-600 dark:text-red-400",
            entry.rule.action.type === 'restrict' && "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
            entry.rule.action.type === 'log' && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            entry.rule.action.type === 'add_metadata' && "bg-purple-500/10 text-purple-600 dark:text-purple-400",
          )}>
            {actionLabel}
          </span>
        </div>
        <Typography variant="secondary" className="text-xs truncate mt-0.5">
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
          onClick={onEdit}
        >
          <PencilSimpleIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
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

// Internal symbol for accessing SDK internals
const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

// Custom hook to fetch signup rules analytics
function useSignupRulesAnalytics() {
  const stackAdminApp = useAdminApp();
  const [analytics, setAnalytics] = useState<Map<string, RuleAnalytics>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  React.useEffect(() => {
    let cancelled = false;

    const fetchAnalytics = async () => {
      try {
        const response = await (stackAdminApp as any)[stackAppInternalsSymbol].sendRequest('/internal/signup-rules', {
          method: 'GET',
        });
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
      } catch (e) {
        console.debug('Failed to fetch signup rules analytics:', e);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    runAsynchronously(fetchAnalytics());

    return () => {
      cancelled = true;
    };
  }, [stackAdminApp]);

  return { analytics, isLoading };
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
  const [ruleToDelete, setRuleToDelete] = useState<SignupRuleEntry | null>(null);

  // Reordering loading state
  const [isReordering, setIsReordering] = useState(false);

  // Fetch analytics data
  const { analytics: ruleAnalytics } = useSignupRulesAnalytics();

  // Type assertion needed because schema changes take effect at build time
  const configWithRules = config as ConfigWithSignupRules;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript may not see these as optional due to type assertion
  const defaultAction = configWithRules.auth.signupRulesDefaultAction ?? 'allow';

  const sortedRules = useMemo(() => getSortedRules(config), [config]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sortedRules.findIndex((r) => r.id === active.id);
      const newIndex = sortedRules.findIndex((r) => r.id === over.id);
      const newOrder = arrayMove(sortedRules, oldIndex, newIndex);

      setIsReordering(true);

      const configUpdate: Record<string, number> = {};
      newOrder.forEach((entry, index) => {
        configUpdate[`auth.signupRules.${entry.id}.priority`] = index;
      });

      try {
        await updateConfig({
          adminApp: stackAdminApp,
          configUpdate,
          pushable: true,
        });
      } finally {
        setIsReordering(false);
      }
    }
  };

  const handleAddRule = () => {
    const id = generateUuid();
    setNewRuleId(id);
    setIsCreatingNew(true);
    setEditingRuleId(null);
  };

  const handleSaveRule = async (ruleId: string, rule: SignupRule) => {
    // For new rules, set priority to be at the end
    if (isCreatingNew) {
      rule.priority = sortedRules.length;
    }

    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`auth.signupRules.${ruleId}`]: rule,
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

  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`auth.signupRules.${ruleToDelete.id}`]: null,
      },
      pushable: true,
    });
    setDeleteDialogOpen(false);
    setRuleToDelete(null);
  };

  const handleToggleEnabled = async (ruleId: string, enabled: boolean) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`auth.signupRules.${ruleId}.enabled`]: enabled,
      },
      pushable: true,
    });
  };

  const handleDefaultActionChange = async (value: 'allow' | 'reject') => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        'auth.signupRulesDefaultAction': value,
      },
      pushable: true,
    });
  };

  const isAnyEditing = editingRuleId !== null || isCreatingNew;

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Sign-up Rules"
        description="Create rules to control who can sign up. Rules are evaluated in order from top to bottom."
        actions={
          <Button
            onClick={handleAddRule}
            disabled={isAnyEditing}
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add rule
          </Button>
        }
      >
        {/* Rules list and default action */}
        <div className="relative space-y-2">
          {/* Blocking loading overlay */}
          {isReordering && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-xl">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner size={20} />
                <span>Saving order...</span>
              </div>
            </div>
          )}

          {/* New rule editor (at the top when creating) */}
          {isCreatingNew && newRuleId && (
            <RuleEditor
              ruleId={newRuleId}
              isNew
              onSave={handleSaveRule}
              onCancel={handleCancelEdit}
            />
          )}

          {sortedRules.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => runAsynchronouslyWithAlert(handleDragEnd(e))}
            >
              <SortableContext
                items={sortedRules.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                {sortedRules.map((entry) => (
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
          ) : !isCreatingNew ? (
            <Alert>
              No sign-up rules configured. Click &quot;Add rule&quot; to create your first rule.
            </Alert>
          ) : null}

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
