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
 * - emailDomain == "domain.com" / emailDomain in ["d1", "d2"]
 * - authMethod == "password" / authMethod in ["password", "otp"]
 * - oauthProvider == "google" / oauthProvider in ["google", "github"]
 */

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'matches'  // regex
  | 'ends_with'
  | 'starts_with'
  | 'contains'
  | 'in_list';

export type ConditionField =
  | 'email'
  | 'emailDomain'
  | 'authMethod'
  | 'oauthProvider';

export type ConditionNode = {
  type: 'condition',
  id: string,
  field: ConditionField,
  operator: ConditionOperator,
  value: string | string[],
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

/**
 * Escapes special characters in string values for use in CEL expressions.
 * Backslashes must be escaped first to avoid double-escaping.
 */
function escapeCelString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function conditionToCel(condition: ConditionNode): string {
  const { field, operator, value } = condition;

  switch (operator) {
    case 'equals': {
      return `${field} == "${escapeCelString(String(value))}"`;
    }
    case 'not_equals': {
      return `${field} != "${escapeCelString(String(value))}"`;
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
    // Wrap child groups in parentheses if they have a different operator
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

function parseCondition(expr: string): ConditionNode | null {
  const trimmed = expr.trim();

  // Match patterns like: field == "value"
  const equalsMatch = trimmed.match(/^(\w+)\s*==\s*"([^"]*)"$/);
  if (equalsMatch) {
    return {
      type: 'condition',
      id: generateNodeId(),
      field: equalsMatch[1] as ConditionField,
      operator: 'equals',
      value: equalsMatch[2],
    };
  }

  // Match patterns like: field != "value"
  const notEqualsMatch = trimmed.match(/^(\w+)\s*!=\s*"([^"]*)"$/);
  if (notEqualsMatch) {
    return {
      type: 'condition',
      id: generateNodeId(),
      field: notEqualsMatch[1] as ConditionField,
      operator: 'not_equals',
      value: notEqualsMatch[2],
    };
  }

  // Match patterns like: field.matches("regex")
  const matchesMatch = trimmed.match(/^(\w+)\.matches\("([^"]*)"\)$/);
  if (matchesMatch) {
    return {
      type: 'condition',
      id: generateNodeId(),
      field: matchesMatch[1] as ConditionField,
      operator: 'matches',
      value: matchesMatch[2],
    };
  }

  // Match patterns like: field.endsWith("value")
  const endsWithMatch = trimmed.match(/^(\w+)\.endsWith\("([^"]*)"\)$/);
  if (endsWithMatch) {
    return {
      type: 'condition',
      id: generateNodeId(),
      field: endsWithMatch[1] as ConditionField,
      operator: 'ends_with',
      value: endsWithMatch[2],
    };
  }

  // Match patterns like: field.startsWith("value")
  const startsWithMatch = trimmed.match(/^(\w+)\.startsWith\("([^"]*)"\)$/);
  if (startsWithMatch) {
    return {
      type: 'condition',
      id: generateNodeId(),
      field: startsWithMatch[1] as ConditionField,
      operator: 'starts_with',
      value: startsWithMatch[2],
    };
  }

  // Match patterns like: field.contains("value")
  const containsMatch = trimmed.match(/^(\w+)\.contains\("([^"]*)"\)$/);
  if (containsMatch) {
    return {
      type: 'condition',
      id: generateNodeId(),
      field: containsMatch[1] as ConditionField,
      operator: 'contains',
      value: containsMatch[2],
    };
  }

  // Match patterns like: field in ["a", "b", "c"]
  const inListMatch = trimmed.match(/^(\w+)\s+in\s+\[([^\]]*)\]$/);
  if (inListMatch) {
    const listStr = inListMatch[2];
    const items = listStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s)
      .map(s => {
        // Remove surrounding quotes
        const match = s.match(/^["'](.*)["']$/);
        return match ? match[1] : s;
      });
    return {
      type: 'condition',
      id: generateNodeId(),
      field: inListMatch[1] as ConditionField,
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

/**
 * Adds a child to a group node (returns a new group)
 */
export function addChildToGroup(group: GroupNode, child: RuleNode): GroupNode {
  return {
    ...group,
    children: [...group.children, child],
  };
}

/**
 * Removes a child from a group by ID (returns a new group)
 */
export function removeChildFromGroup(group: GroupNode, childId: string): GroupNode {
  return {
    ...group,
    children: group.children.filter(c => c.id !== childId),
  };
}

/**
 * Updates a node in the tree by ID
 */
export function updateNodeInTree(tree: RuleNode, nodeId: string, updates: Partial<RuleNode>): RuleNode {
  if (tree.id === nodeId) {
    return { ...tree, ...updates } as RuleNode;
  }

  if (tree.type === 'group') {
    return {
      ...tree,
      children: tree.children.map(child => updateNodeInTree(child, nodeId, updates)),
    };
  }

  return tree;
}

/**
 * Checks if a CEL expression can be represented visually
 */
export function isSimpleCel(cel: string): boolean {
  return parseCelToVisualTree(cel) !== null;
}
