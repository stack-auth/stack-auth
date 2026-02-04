"use client";

import { Button, cn, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui";
import {
  type ConditionField,
  type ConditionNode,
  type ConditionOperator,
  createEmptyCondition,
  createEmptyGroup,
  type GroupNode,
  type RuleNode,
} from "@/lib/cel-visual-parser";
import { PlusIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { standardProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import React from "react";

/**
 * Validates whether a string is a valid regular expression.
 * Returns null if valid, or an error message if invalid.
 */
function validateRegex(pattern: string): string | null {
  if (!pattern.trim()) {
    return "Regex pattern cannot be empty";
  }
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    if (e instanceof SyntaxError) {
      return e.message;
    }
    return "Invalid regex pattern";
  }
}

/**
 * Recursively checks if a RuleNode tree has any validation errors.
 * Returns true if the tree is valid, false if there are errors.
 */
export function isConditionTreeValid(node: RuleNode): boolean {
  if (node.type === 'condition') {
    // Check regex validation
    if (node.operator === 'matches') {
      const error = validateRegex(String(node.value));
      if (error !== null) {
        return false;
      }
    }
    return true;
  }

  // Group node - check all children
  return node.children.every(child => isConditionTreeValid(child));
}

// Field options with labels
const FIELD_OPTIONS: { value: ConditionField, label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'emailDomain', label: 'Email Domain' },
  { value: 'authMethod', label: 'Auth Method' },
  { value: 'oauthProvider', label: 'OAuth Provider' },
];

// Operator options with labels
const OPERATOR_OPTIONS: { value: ConditionOperator, label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'matches', label: 'matches regex' },
  { value: 'in_list', label: 'is one of' },
];

// Get available operators for a field
function getOperatorsForField(field: ConditionField): ConditionOperator[] {
  if (field === 'authMethod' || field === 'oauthProvider') {
    return ['equals', 'not_equals', 'in_list'];
  }
  return ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'matches', 'in_list'];
}

// Predefined options for certain fields
const PREDEFINED_VALUES: Partial<Record<ConditionField, string[]>> = {
  authMethod: ['password', 'otp', 'oauth', 'passkey'],
  oauthProvider: Array.from(standardProviders),
};

// Single condition row component
function ConditionRow({
  condition,
  onChange,
  onRemove,
  showRemove,
}: {
  condition: ConditionNode,
  onChange: (updated: ConditionNode) => void,
  onRemove: () => void,
  showRemove: boolean,
}) {
  const availableOperators = getOperatorsForField(condition.field);
  const predefinedValues = PREDEFINED_VALUES[condition.field];

  // Validate regex when operator is 'matches'
  const regexError = condition.operator === 'matches'
    ? validateRegex(String(condition.value))
    : null;

  const handleFieldChange = (field: ConditionField) => {
    const newOperators = getOperatorsForField(field);
    const operator = newOperators.includes(condition.operator) ? condition.operator : newOperators[0];

    // Reset value - use array for in_list, string otherwise
    const value: string | string[] = operator === 'in_list' ? [] : '';

    onChange({ ...condition, field, operator, value });
  };

  const handleOperatorChange = (operator: ConditionOperator) => {
    let value = condition.value;
    // Convert between single value and array for in_list
    if (operator === 'in_list' && !Array.isArray(value)) {
      value = value ? [String(value)] : [];
    } else if (operator !== 'in_list' && Array.isArray(value)) {
      value = value[0] ?? '';
    }
    onChange({ ...condition, operator, value });
  };

  const handleValueChange = (value: string | string[]) => {
    onChange({ ...condition, value });
  };

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-background/40 ring-1 ring-foreground/[0.04]">
      {/* Field selector */}
      <select
        value={condition.field}
        onChange={(e) => handleFieldChange(e.target.value as ConditionField)}
        className="h-8 px-2 text-sm bg-background/60 border border-border/50 rounded-md min-w-[120px]"
      >
        {FIELD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Operator selector */}
      <select
        value={condition.operator}
        onChange={(e) => handleOperatorChange(e.target.value as ConditionOperator)}
        className="h-8 px-2 text-sm bg-background/60 border border-border/50 rounded-md min-w-[120px]"
      >
        {OPERATOR_OPTIONS.filter(opt => availableOperators.includes(opt.value)).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Value input */}
      {condition.operator === 'in_list' ? (
        <input
          type="text"
          value={Array.isArray(condition.value) ? condition.value.join(', ') : condition.value}
          onChange={(e) => {
            const items = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
            handleValueChange(items);
          }}
          placeholder="value1, value2, ..."
          className="h-8 px-2 text-sm bg-background/60 border border-border/50 rounded-md flex-1"
        />
      ) : predefinedValues ? (
        <select
          value={String(condition.value)}
          onChange={(e) => handleValueChange(e.target.value)}
          className="h-8 px-2 text-sm bg-background/60 border border-border/50 rounded-md flex-1"
        >
          <option value="">Select...</option>
          {predefinedValues.map((val) => (
            <option key={val} value={val}>{val}</option>
          ))}
        </select>
      ) : (
        <div className="flex-1 flex items-center gap-1">
          <input
            type="text"
            value={String(condition.value)}
            onChange={(e) => handleValueChange(e.target.value)}
            placeholder={condition.operator === 'matches' ? "Enter regex pattern..." : "Enter value..."}
            className={cn(
              "h-8 px-2 text-sm bg-background/60 border rounded-md flex-1",
              regexError
                ? "border-destructive ring-1 ring-destructive/30"
                : "border-border/50"
            )}
          />
          {regexError && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-destructive flex-shrink-0">
                    <WarningCircleIcon className="h-4 w-4" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[300px]">
                  <p className="text-xs">{regexError}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}

      {/* Remove button */}
      {showRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          aria-label="Remove condition"
          title="Remove condition"
          onClick={onRemove}
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// Condition group component (AND/OR)
function ConditionGroup({
  group,
  onChange,
  onRemove,
  depth = 0,
  showRemove,
}: {
  group: GroupNode,
  onChange: (updated: GroupNode) => void,
  onRemove?: () => void,
  depth?: number,
  showRemove?: boolean,
}) {
  const handleChildChange = (index: number, updated: RuleNode) => {
    const newChildren = [...group.children];
    newChildren[index] = updated;
    onChange({ ...group, children: newChildren });
  };

  const handleRemoveChild = (index: number) => {
    const newChildren = group.children.filter((_, i) => i !== index);
    onChange({ ...group, children: newChildren });
  };

  const handleAddCondition = () => {
    onChange({
      ...group,
      children: [...group.children, createEmptyCondition()],
    });
  };

  const handleAddGroup = () => {
    const newGroup = createEmptyGroup(group.operator === 'and' ? 'or' : 'and');
    newGroup.children = [createEmptyCondition()];
    onChange({
      ...group,
      children: [...group.children, newGroup],
    });
  };

  const handleOperatorToggle = () => {
    onChange({
      ...group,
      operator: group.operator === 'and' ? 'or' : 'and',
    });
  };

  const isRoot = depth === 0;

  return (
    <div className={cn(
      "space-y-2",
      !isRoot && "p-3 rounded-lg ring-1",
      !isRoot && group.operator === 'and' && "bg-blue-500/5 ring-blue-500/10",
      !isRoot && group.operator === 'or' && "bg-amber-500/5 ring-amber-500/10",
    )}>
      {/* Group header */}
      <div className="flex items-center gap-2">
        {!isRoot && showRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            aria-label="Remove group"
            title="Remove group"
            onClick={onRemove}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
        )}
        <button
          onClick={handleOperatorToggle}
          className={cn(
            "text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded",
            "transition-colors duration-150 hover:transition-none cursor-pointer",
            group.operator === 'and' && "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20",
            group.operator === 'or' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20",
          )}
        >
          {group.operator.toUpperCase()}
        </button>
        <span className="text-xs text-muted-foreground">
          {group.operator === 'and' ? 'Match all conditions' : 'Match any condition'}
        </span>
      </div>

      {/* Children */}
      <div className="space-y-2 pl-2 border-l-2 border-foreground/[0.06]">
        {group.children.map((child, index) => (
          <React.Fragment key={child.id}>
            {child.type === 'condition' ? (
              <ConditionRow
                condition={child}
                onChange={(updated) => handleChildChange(index, updated)}
                onRemove={() => handleRemoveChild(index)}
                showRemove={group.children.length > 1}
              />
            ) : (
              <ConditionGroup
                group={child}
                onChange={(updated) => handleChildChange(index, updated)}
                onRemove={() => handleRemoveChild(index)}
                depth={depth + 1}
                showRemove={true}
              />
            )}
          </React.Fragment>
        ))}

        {/* Add buttons */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleAddCondition}
          >
            <PlusIcon className="h-3.5 w-3.5 mr-1" />
            Add condition
          </Button>
          {depth < 2 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleAddGroup}
            >
              <PlusIcon className="h-3.5 w-3.5 mr-1" />
              Add {group.operator === 'and' ? 'OR' : 'AND'} group
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Main condition builder component
export function ConditionBuilder({
  value,
  onChange,
}: {
  value: RuleNode,
  onChange: (value: RuleNode) => void,
}) {
  // Ensure we have a group at the root
  const rootGroup: GroupNode = value.type === 'group'
    ? value
    : {
      type: 'group',
      id: 'root',
      operator: 'and',
      children: [value],
    };

  const normalizedGroup = rootGroup.children.length > 0
    ? rootGroup
    : { ...rootGroup, children: [createEmptyCondition()] };

  return (
    <div className="space-y-3">
      <ConditionGroup
        group={normalizedGroup}
        onChange={(updated) => onChange(updated)}
        depth={0}
      />
    </div>
  );
}
