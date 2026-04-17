/**
 * CEL Visual Parser
 *
 * Converts simple CEL expressions (with AND/OR) to a visual tree structure
 * and back to CEL strings. Supports nested AND/OR groups.
 *
 * Supported condition types:
 * - email == "value" / email != "value"
 * - email.endsWith("@domain.com")
 * - email.matches("regex")
 * - countryCode == "US" / countryCode in ["US", "CA"]
 * - emailDomain == "domain.com" / emailDomain in ["d1", "d2"]
 * - authMethod == "password" / authMethod in ["password", "otp"]
 * - oauthProvider == "google" / oauthProvider in ["google", "github"]
 * - riskScores.bot > 80 / riskScores.free_trial_abuse >= 60
 */

import { normalizeCountryCode } from "@stackframe/stack-shared/dist/schema-fields";
import { type ConditionField, type ConditionOperator, conditionFields, escapeCelString, fieldMetadata, isNumericField, unescapeCelString, validateNumericFieldValue } from "@stackframe/stack-shared/dist/utils/cel-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export type { ConditionField, ConditionOperator } from "@stackframe/stack-shared/dist/utils/cel-fields";

export type ConditionNode = {
  type: 'condition',
  id: string,
  field: ConditionField,
  operator: ConditionOperator,
  value: string | number | string[],
};

export type GroupNode = {
  type: 'group',
  id: string,
  operator: 'and' | 'or',
  children: (ConditionNode | GroupNode)[],
};

export type RuleNode = ConditionNode | GroupNode;


// ── Node factories ─────────────────────────────────────────────────────

function generateNodeId(): string {
  return `node-${Math.random().toString(36).slice(2, 11)}`;
}

export function createEmptyCondition(): ConditionNode {
  return { type: 'condition', id: generateNodeId(), field: 'email', operator: 'equals', value: '' };
}

export function createEmptyGroup(operator: 'and' | 'or' = 'and'): GroupNode {
  return { type: 'group', id: generateNodeId(), operator, children: [] };
}


// ── Tree → CEL ─────────────────────────────────────────────────────────

const comparisonSymbols: Record<string, string> = {
  equals: '==',
  not_equals: '!=',
  greater_than: '>',
  greater_or_equal: '>=',
  less_than: '<',
  less_or_equal: '<=',
};

const stringMethodNames: Record<string, string> = {
  matches: 'matches',
  ends_with: 'endsWith',
  starts_with: 'startsWith',
  contains: 'contains',
};

export function visualTreeToCel(node: RuleNode): string {
  return node.type === 'condition' ? conditionToCel(node) : groupToCel(node);
}

function normalizeConditionValue(condition: ConditionNode): ConditionNode['value'] {
  if (condition.field !== 'countryCode') return condition.value;
  if (typeof condition.value === 'number') {
    throw new StackAssertionError(`Invalid numeric value for countryCode: ${condition.value}. Country codes must be strings.`);
  }
  return Array.isArray(condition.value)
    ? condition.value.map(normalizeCountryCode)
    : normalizeCountryCode(condition.value);
}

function conditionToCel(condition: ConditionNode): string {
  const { field, operator } = condition;
  const value = normalizeConditionValue(condition);

  // Numeric comparisons: field >= 42
  if (operator in comparisonSymbols && isNumericField(field)) {
    const err = validateNumericFieldValue(field, String(value));
    if (err) throw new StackAssertionError(err);
    return `${field} ${comparisonSymbols[operator]} ${typeof value === 'number' ? value : Number(value)}`;
  }

  // String equality/inequality: field == "value"
  if (operator === 'equals' || operator === 'not_equals') {
    const symbol = comparisonSymbols[operator];
    return `${field} ${symbol} "${escapeCelString(String(value))}"`;
  }

  // String methods: field.contains("value")
  if (operator in stringMethodNames) {
    return `${field}.${stringMethodNames[operator]}("${escapeCelString(String(value))}")`;
  }

  // In-list: field in ["a", "b"]
  if (operator === 'in_list') {
    if (Array.isArray(value)) {
      const items = value.map(v => `"${escapeCelString(String(v))}"`).join(', ');
      return `${field} in [${items}]`;
    }
    return `${field} == "${escapeCelString(String(value))}"`;
  }

  // Fallback
  return `${field} == "${escapeCelString(String(value))}"`;
}

function groupToCel(group: GroupNode): string {
  if (group.children.length === 0) return 'true';
  if (group.children.length === 1) return visualTreeToCel(group.children[0]);

  const celOperator = group.operator === 'and' ? ' && ' : ' || ';
  return group.children.map(child => {
    const expr = visualTreeToCel(child);
    return child.type === 'group' && child.operator !== group.operator ? `(${expr})` : expr;
  }).join(celOperator);
}


// ── CEL → Tree ─────────────────────────────────────────────────────────

export function parseCelToVisualTree(cel: string): RuleNode | null {
  try {
    const trimmed = cel.trim();
    if (!trimmed || trimmed === 'true') {
      return { type: 'group', id: generateNodeId(), operator: 'and', children: [] };
    }
    return parseExpression(trimmed);
  } catch (e) {
    console.warn('Failed to parse CEL expression:', e);
    return null;
  }
}

function parseExpression(expr: string): RuleNode | null {
  const trimmed = expr.trim();

  // Unwrap fully-parenthesized expressions
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    let depth = 0;
    let isWrapped = true;
    for (let i = 0; i < trimmed.length - 1; i++) {
      if (trimmed[i] === '(') depth++;
      if (trimmed[i] === ')') depth--;
      if (depth === 0 && i < trimmed.length - 1) {
        isWrapped = false;
        break;
      }
    }
    if (isWrapped) return parseExpression(trimmed.slice(1, -1));
  }

  // Try OR then AND at top level
  for (const [op, logicalOp] of [['||', 'or'], ['&&', 'and']] as const) {
    const parts = splitByOperator(trimmed, op);
    if (parts.length > 1) {
      const children = parts.map(p => parseExpression(p));
      if (children.some(c => c === null)) return null;
      return { type: 'group', id: generateNodeId(), operator: logicalOp, children: children as RuleNode[] };
    }
  }

  return parseCondition(trimmed);
}

function splitByOperator(expr: string, operator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];

    if ((char === '"' || char === "'") && (i === 0 || expr[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
    }

    if (!inString) {
      if (char === '(' || char === '[') depth++;
      if (char === ')' || char === ']') depth--;

      if (depth === 0 && expr.slice(i, i + operator.length) === operator) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        i += operator.length - 1;
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isConditionField(field: string): field is ConditionField {
  return (conditionFields as string[]).includes(field);
}

function isValidFieldOperator(field: string, operator: ConditionOperator): field is ConditionField {
  return isConditionField(field) && fieldMetadata[field].operators.includes(operator);
}

// Regex patterns for parsing conditions. Order matters: >= before >, <= before <
const numericComparisonParsers = [
  { re: /^([\w.]+)\s*>=\s*(-?\d+(?:\.\d+)?)$/, op: 'greater_or_equal' },
  { re: /^([\w.]+)\s*<=\s*(-?\d+(?:\.\d+)?)$/, op: 'less_or_equal' },
  { re: /^([\w.]+)\s*>\s*(-?\d+(?:\.\d+)?)$/, op: 'greater_than' },
  { re: /^([\w.]+)\s*<\s*(-?\d+(?:\.\d+)?)$/, op: 'less_than' },
  { re: /^([\w.]+)\s*==\s*(-?\d+(?:\.\d+)?)$/, op: 'equals' },
  { re: /^([\w.]+)\s*!=\s*(-?\d+(?:\.\d+)?)$/, op: 'not_equals' },
] as const;

const stringConditionParsers = [
  { re: /^([\w.]+)\s*==\s*"((?:\\.|[^"\\])*)"$/, op: 'equals' },
  { re: /^([\w.]+)\s*!=\s*"((?:\\.|[^"\\])*)"$/, op: 'not_equals' },
  { re: /^([\w.]+)\.matches\("((?:\\.|[^"\\])*)"\)$/, op: 'matches' },
  { re: /^([\w.]+)\.endsWith\("((?:\\.|[^"\\])*)"\)$/, op: 'ends_with' },
  { re: /^([\w.]+)\.startsWith\("((?:\\.|[^"\\])*)"\)$/, op: 'starts_with' },
  { re: /^([\w.]+)\.contains\("((?:\\.|[^"\\])*)"\)$/, op: 'contains' },
] as const;

function parseCondition(expr: string): ConditionNode | null {
  const trimmed = expr.trim();

  // Numeric comparisons: field >= 42
  for (const { re, op } of numericComparisonParsers) {
    const m = trimmed.match(re);
    if (m && isConditionField(m[1]) && isNumericField(m[1]) && isValidFieldOperator(m[1], op)) {
      return { type: 'condition', id: generateNodeId(), field: m[1], operator: op, value: Number(m[2]) };
    }
  }

  // String conditions: field == "value", field.contains("value"), etc.
  for (const { re, op } of stringConditionParsers) {
    const m = trimmed.match(re);
    if (m && isValidFieldOperator(m[1], op)) {
      return { type: 'condition', id: generateNodeId(), field: m[1], operator: op, value: unescapeCelString(m[2]) };
    }
  }

  // In-list: field in ["a", "b"]
  const inListMatch = trimmed.match(/^([\w.]+)\s+in\s+\[([^\]]*)\]$/);
  if (inListMatch && isValidFieldOperator(inListMatch[1], 'in_list')) {
    const items = inListMatch[2].split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.match(/^["']((?:\\.|[^"\\])*)["']$/);
      return m ? unescapeCelString(m[1]) : s;
    });
    return { type: 'condition', id: generateNodeId(), field: inListMatch[1], operator: 'in_list', value: items };
  }

  return null;
}
