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

/**
 * Generates a unique ID for nodes
 */
function generateNodeId(): string {
  return `node-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Converts a visual tree back to a CEL expression string
 */
export function visualTreeToCel(node: RuleNode): string {
  if (node.type === 'condition') {
    return conditionToCel(node);
  } else {
    return groupToCel(node);
  }
}

function normalizeConditionValue(condition: ConditionNode): ConditionNode['value'] {
  if (condition.field !== 'countryCode') {
    return condition.value;
  }

  if (Array.isArray(condition.value)) {
    return condition.value.map(normalizeCountryCode);
  }

  if (typeof condition.value === 'number') {
    throw new Error(`Invalid numeric value for countryCode: ${condition.value}. Country codes must be strings.`);
  }

  return normalizeCountryCode(condition.value);
}

function conditionToCel(condition: ConditionNode): string {
  const { field, operator } = condition;
  const value = normalizeConditionValue(condition);
  const valueAsNumber = typeof value === 'number' ? value : Number(value);

  switch (operator) {
    case 'equals': {
      if (isNumericField(field)) {
        const err = validateNumericFieldValue(field, String(value));
        if (err) throw new Error(err);
        return `${field} == ${valueAsNumber}`;
      }
      return `${field} == "${escapeCelString(String(value))}"`;
    }
    case 'not_equals': {
      if (isNumericField(field)) {
        const err = validateNumericFieldValue(field, String(value));
        if (err) throw new Error(err);
        return `${field} != ${valueAsNumber}`;
      }
      return `${field} != "${escapeCelString(String(value))}"`;
    }
    case 'greater_than': {
      if (!isNumericField(field)) {
        throw new Error(`Operator 'greater_than' not allowed on non-numeric field '${field}'`);
      }
      const err = validateNumericFieldValue(field, String(value));
      if (err) throw new Error(err);
      return `${field} > ${valueAsNumber}`;
    }
    case 'greater_or_equal': {
      if (!isNumericField(field)) {
        throw new Error(`Operator 'greater_or_equal' not allowed on non-numeric field '${field}'`);
      }
      const err = validateNumericFieldValue(field, String(value));
      if (err) throw new Error(err);
      return `${field} >= ${valueAsNumber}`;
    }
    case 'less_than': {
      if (!isNumericField(field)) {
        throw new Error(`Operator 'less_than' not allowed on non-numeric field '${field}'`);
      }
      const err = validateNumericFieldValue(field, String(value));
      if (err) throw new Error(err);
      return `${field} < ${valueAsNumber}`;
    }
    case 'less_or_equal': {
      if (!isNumericField(field)) {
        throw new Error(`Operator 'less_or_equal' not allowed on non-numeric field '${field}'`);
      }
      const err = validateNumericFieldValue(field, String(value));
      if (err) throw new Error(err);
      return `${field} <= ${valueAsNumber}`;
    }
    case 'matches': {
      return `${field}.matches("${escapeCelString(String(value))}")`;
    }
    case 'ends_with': {
      return `${field}.endsWith("${escapeCelString(String(value))}")`;
    }
    case 'starts_with': {
      return `${field}.startsWith("${escapeCelString(String(value))}")`;
    }
    case 'contains': {
      return `${field}.contains("${escapeCelString(String(value))}")`;
    }
    case 'in_list': {
      if (Array.isArray(value)) {
        const items = value.map(v => `"${escapeCelString(String(v))}"`).join(', ');
        return `${field} in [${items}]`;
      }
      return `${field} == "${escapeCelString(String(value))}"`;
    }
    default: {
      return `${field} == "${escapeCelString(String(value))}"`;
    }
  }
}

function groupToCel(group: GroupNode): string {
  if (group.children.length === 0) {
    return 'true';
  }

  if (group.children.length === 1) {
    return visualTreeToCel(group.children[0]);
  }

  const celOperator = group.operator === 'and' ? ' && ' : ' || ';
  const childExpressions = group.children.map(child => {
    const expr = visualTreeToCel(child);
    if (child.type === 'group' && child.operator !== group.operator) {
      return `(${expr})`;
    }
    return expr;
  });

  return childExpressions.join(celOperator);
}

/**
 * Attempts to parse a CEL expression into a visual tree.
 * Returns null if the expression is too complex to be represented visually.
 */
export function parseCelToVisualTree(cel: string): RuleNode | null {
  try {
    const trimmed = cel.trim();
    if (!trimmed || trimmed === 'true') {
      return {
        type: 'group',
        id: generateNodeId(),
        operator: 'and',
        children: [],
      };
    }

    // Try to parse as a group or single condition
    return parseExpression(trimmed);
  } catch (e) {
    console.warn('Failed to parse CEL expression:', e);
    return null;
  }
}

function parseExpression(expr: string): RuleNode | null {
  const trimmed = expr.trim();

  // Check if it's a parenthesized expression
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    // Check if the outer parentheses wrap the entire expression
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
    if (isWrapped) {
      return parseExpression(trimmed.slice(1, -1));
    }
  }

  // Try to split by || (OR) at the top level
  const orParts = splitByOperator(trimmed, '||');
  if (orParts.length > 1) {
    const children = orParts.map(part => parseExpression(part)).filter((n): n is RuleNode => n !== null);
    if (children.length !== orParts.length) {
      return null; // Some parts couldn't be parsed
    }
    return {
      type: 'group',
      id: generateNodeId(),
      operator: 'or',
      children,
    };
  }

  // Try to split by && (AND) at the top level
  const andParts = splitByOperator(trimmed, '&&');
  if (andParts.length > 1) {
    const children = andParts.map(part => parseExpression(part)).filter((n): n is RuleNode => n !== null);
    if (children.length !== andParts.length) {
      return null; // Some parts couldn't be parsed
    }
    return {
      type: 'group',
      id: generateNodeId(),
      operator: 'and',
      children,
    };
  }

  // Try to parse as a single condition
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
    const nextChars = expr.slice(i, i + operator.length);

    // Handle string literals
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

      // Split at operator when not inside parentheses/brackets/strings
      if (depth === 0 && nextChars === operator) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
        i += operator.length - 1; // Skip the operator
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function isConditionField(field: string): field is ConditionField {
  return (conditionFields as string[]).includes(field);
}

function isValidFieldOperator(field: string, operator: ConditionOperator): field is ConditionField {
  if (!isConditionField(field)) return false;
  return fieldMetadata[field].operators.includes(operator);
}

function parseCondition(expr: string): ConditionNode | null {
  const trimmed = expr.trim();

  // Match numeric comparison patterns like: field >= 42, field < 10, field == 5
  // Order matters: >= before >, <= before <
  const numericOperators = [
    { symbol: '>=', operator: 'greater_or_equal' },
    { symbol: '<=', operator: 'less_or_equal' },
    { symbol: '>', operator: 'greater_than' },
    { symbol: '<', operator: 'less_than' },
    { symbol: '==', operator: 'equals' },
    { symbol: '!=', operator: 'not_equals' },
  ] as const;

  for (const { symbol, operator } of numericOperators) {
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = trimmed.match(new RegExp(`^([\\w.]+)\\s*${escapedSymbol}\\s*(-?\\d+(?:\\.\\d+)?)$`));
    if (match) {
      if (!isConditionField(match[1])) return null;
      const field = match[1];
      if (!isNumericField(field)) return null;
      if (!isValidFieldOperator(field, operator)) return null;
      return {
        type: 'condition',
        id: generateNodeId(),
        field,
        operator,
        value: Number(match[2]),
      };
    }
  }

  // Match patterns like: field == "value"
  const equalsMatch = trimmed.match(/^([\w.]+)\s*==\s*"((?:\\.|[^"\\])*)"$/);
  if (equalsMatch) {
    if (!isConditionField(equalsMatch[1])) return null;
    const field = equalsMatch[1];
    if (!isValidFieldOperator(field, 'equals')) return null;
    return {
      type: 'condition',
      id: generateNodeId(),
      field,
      operator: 'equals',
      value: unescapeCelString(equalsMatch[2]),
    };
  }

  // Match patterns like: field != "value"
  const notEqualsMatch = trimmed.match(/^([\w.]+)\s*!=\s*"((?:\\.|[^"\\])*)"$/);
  if (notEqualsMatch) {
    if (!isConditionField(notEqualsMatch[1])) return null;
    const field = notEqualsMatch[1];
    if (!isValidFieldOperator(field, 'not_equals')) return null;
    return {
      type: 'condition',
      id: generateNodeId(),
      field,
      operator: 'not_equals',
      value: unescapeCelString(notEqualsMatch[2]),
    };
  }

  // Match patterns like: field.matches("regex")
  const matchesMatch = trimmed.match(/^([\w.]+)\.matches\("((?:\\.|[^"\\])*)"\)$/);
  if (matchesMatch) {
    if (!isConditionField(matchesMatch[1])) return null;
    const field = matchesMatch[1];
    if (!isValidFieldOperator(field, 'matches')) return null;
    return {
      type: 'condition',
      id: generateNodeId(),
      field,
      operator: 'matches',
      value: unescapeCelString(matchesMatch[2]),
    };
  }

  // Match patterns like: field.endsWith("value")
  const endsWithMatch = trimmed.match(/^([\w.]+)\.endsWith\("((?:\\.|[^"\\])*)"\)$/);
  if (endsWithMatch) {
    if (!isConditionField(endsWithMatch[1])) return null;
    const field = endsWithMatch[1];
    if (!isValidFieldOperator(field, 'ends_with')) return null;
    return {
      type: 'condition',
      id: generateNodeId(),
      field,
      operator: 'ends_with',
      value: unescapeCelString(endsWithMatch[2]),
    };
  }

  // Match patterns like: field.startsWith("value")
  const startsWithMatch = trimmed.match(/^([\w.]+)\.startsWith\("((?:\\.|[^"\\])*)"\)$/);
  if (startsWithMatch) {
    if (!isConditionField(startsWithMatch[1])) return null;
    const field = startsWithMatch[1];
    if (!isValidFieldOperator(field, 'starts_with')) return null;
    return {
      type: 'condition',
      id: generateNodeId(),
      field,
      operator: 'starts_with',
      value: unescapeCelString(startsWithMatch[2]),
    };
  }

  // Match patterns like: field.contains("value")
  const containsMatch = trimmed.match(/^([\w.]+)\.contains\("((?:\\.|[^"\\])*)"\)$/);
  if (containsMatch) {
    if (!isConditionField(containsMatch[1])) return null;
    const field = containsMatch[1];
    if (!isValidFieldOperator(field, 'contains')) return null;
    return {
      type: 'condition',
      id: generateNodeId(),
      field,
      operator: 'contains',
      value: unescapeCelString(containsMatch[2]),
    };
  }

  // Match patterns like: field in ["a", "b", "c"]
  const inListMatch = trimmed.match(/^([\w.]+)\s+in\s+\[([^\]]*)\]$/);
  if (inListMatch) {
    const listStr = inListMatch[2];
    const items = listStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s)
      .map(s => {
        // Remove surrounding quotes
        const match = s.match(/^["']((?:\\.|[^"\\])*)["']$/);
        return match ? unescapeCelString(match[1]) : s;
      });
    if (!isConditionField(inListMatch[1])) return null;
    const field = inListMatch[1];
    if (!isValidFieldOperator(field, 'in_list')) return null;
    return {
      type: 'condition',
      id: generateNodeId(),
      field,
      operator: 'in_list',
      value: items,
    };
  }

  // Could not parse as a simple condition
  return null;
}

/**
 * Creates an empty condition node with default values
 */
export function createEmptyCondition(): ConditionNode {
  return {
    type: 'condition',
    id: generateNodeId(),
    field: 'email',
    operator: 'equals',
    value: '',
  };
}

/**
 * Creates an empty group node
 */
export function createEmptyGroup(operator: 'and' | 'or' = 'and'): GroupNode {
  return {
    type: 'group',
    id: generateNodeId(),
    operator,
    children: [],
  };
}
