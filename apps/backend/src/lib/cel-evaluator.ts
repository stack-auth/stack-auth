import { evaluate } from "cel-js";
import RE2 from "re2";

/**
 * Context variables available for sign-up rule CEL expressions.
 */
export type SignUpRuleContext = {
  /** User's email address */
  email: string,
  /** Domain part of email (after @) */
  emailDomain: string,
  /** Authentication method: "password", "otp", "oauth", "passkey" */
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  /** OAuth provider ID if authMethod is "oauth", empty string otherwise */
  oauthProvider: string,
};

/**
 * Pre-processes a CEL expression to transform method calls into function calls
 * that cel-js can evaluate.
 *
 * Transforms:
 * - `str.contains("x")` → `_method_0` (pre-computed in context)
 * - `str.startsWith("x")` → `_method_1` (pre-computed in context)
 * - etc.
 *
 * Since cel-js doesn't support method calls, we pre-compute these values
 * and add them to the context with unique keys to avoid collisions.
 */
function unescapeCelString(escaped: string): string {
  return escaped.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

function preprocessExpression(
  expression: string,
  context: SignUpRuleContext
): { expression: string, context: Record<string, unknown> } {
  const extendedContext: Record<string, unknown> = { ...context };

  // Pattern to match method calls: identifier.method("literal with optional escaped quotes")
  // We handle: contains, startsWith, endsWith, matches
  const methodPattern = /(\w+)\.(contains|startsWith|endsWith|matches)\s*\(\s*"((?:\\.|[^"\\])*)"\s*\)/g;

  let counter = 0;

  // Use replace with a callback to handle each match uniquely
  // This ensures each occurrence gets a unique key, even if the same expression appears multiple times
  const transformedExpr = expression.replace(methodPattern, (fullMatch, varName, method, arg) => {
    // Get the variable value from context
    const varValue = context[varName as keyof SignUpRuleContext];
    if (typeof varValue !== 'string') {
      // Return unchanged if variable is not a string
      return fullMatch;
    }

    const unescapedArg = unescapeCelString(arg);

    // Use a counter-based key to avoid collisions between different arguments
    // that would otherwise sanitize to the same key (e.g., "test+1" and "test-1")
    const resultKey = `_method_${counter++}`;
    let result: boolean;

    switch (method) {
      case 'contains': {
        result = varValue.includes(unescapedArg);
        break;
      }
      case 'startsWith': {
        result = varValue.startsWith(unescapedArg);
        break;
      }
      case 'endsWith': {
        result = varValue.endsWith(unescapedArg);
        break;
      }
      case 'matches': {
        try {
          // Use RE2 for regex matching to prevent ReDoS attacks
          // RE2 uses a linear-time matching algorithm, preventing catastrophic backtracking
          const regex = new RE2(unescapedArg);
          result = regex.test(varValue);
        } catch {
          // Invalid regex pattern - treat as non-match
          result = false;
        }
        break;
      }
      default: {
        return fullMatch;
      }
    }

    extendedContext[resultKey] = result;
    return resultKey;
  });

  return { expression: transformedExpr, context: extendedContext };
}

/**
 * Evaluates a CEL expression against a signup context.
 * Returns true if the expression matches, false otherwise.
 *
 * Supports standard CEL operators plus string methods:
 * - contains("substring")
 * - startsWith("prefix")
 * - endsWith("suffix")
 * - matches("regex")
 *
 * @param expression - The CEL expression string to evaluate
 * @param context - The signup context with variables like email, authMethod, etc.
 * @returns boolean result of the expression evaluation
 */
export function evaluateCelExpression(
  expression: string,
  context: SignUpRuleContext
): boolean {
  try {
    // Pre-process to handle method calls
    const { expression: transformedExpr, context: extendedContext } = preprocessExpression(expression, context);

    const result = evaluate(transformedExpr, extendedContext);
    return Boolean(result);
  } catch (e) {
    // Log the error but return false for safety
    console.error('CEL evaluation error:', e);
    return false;
  }
}

/**
 * Creates a SignUpRuleContext from raw request data.
 * This helper extracts and derives the context variables needed for rule evaluation.
 *
 * @param params - Raw parameters from the signup request
 * @returns SignUpRuleContext ready for CEL evaluation
 */
export function createSignUpRuleContext(params: {
  email: string,
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider?: string,
}): SignUpRuleContext {
  const email = params.email;
  const emailDomain = email.includes('@') ? (email.split('@').pop() ?? '').toLowerCase() : '';

  return {
    email,
    emailDomain,
    authMethod: params.authMethod,
    oauthProvider: params.oauthProvider ?? '',
  };
}
