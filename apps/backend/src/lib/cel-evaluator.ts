import { evaluate, parse, CelEvaluationError, CelParseError, CelTypeError } from "cel-js";

/**
 * Context variables available for signup rule CEL expressions.
 */
export type SignupRuleContext = {
  /** User's email address */
  email: string,
  /** Domain part of email (after @) */
  emailDomain: string,
  /** Authentication method: "password", "otp", "oauth", "passkey" */
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  /** OAuth provider ID if authMethod is "oauth", empty string otherwise */
  oauthProvider: string,
};

// Extended context with helper functions for string operations
type ExtendedContext = SignupRuleContext & {
  // Pre-computed helpers for common patterns
  _email_lower: string,
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
function preprocessExpression(
  expression: string,
  context: SignupRuleContext
): { expression: string, context: Record<string, unknown> } {
  const extendedContext: Record<string, unknown> = { ...context };

  // Pattern to match method calls: identifier.method("literal")
  // We handle: contains, startsWith, endsWith, matches
  const methodPattern = /(\w+)\.(contains|startsWith|endsWith|matches)\s*\(\s*"([^"]+)"\s*\)/g;

  let transformedExpr = expression;
  let counter = 0;

  // Use replaceAll with a callback to handle each match uniquely
  // This ensures each occurrence gets a unique key, even if the same expression appears multiple times
  transformedExpr = expression.replace(methodPattern, (fullMatch, varName, method, arg) => {
    // Get the variable value from context
    const varValue = context[varName as keyof SignupRuleContext];
    if (typeof varValue !== 'string') {
      // Return unchanged if variable is not a string
      return fullMatch;
    }

    // Use a counter-based key to avoid collisions between different arguments
    // that would otherwise sanitize to the same key (e.g., "test+1" and "test-1")
    const resultKey = `_method_${counter++}`;
    let result: boolean;

    switch (method) {
      case 'contains': {
        result = varValue.includes(arg);
        break;
      }
      case 'startsWith': {
        result = varValue.startsWith(arg);
        break;
      }
      case 'endsWith': {
        result = varValue.endsWith(arg);
        break;
      }
      case 'matches': {
        try {
          result = new RegExp(arg).test(varValue);
        } catch {
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
  context: SignupRuleContext
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
 * Validates a CEL expression without evaluating it.
 * This is useful for checking if an expression is syntactically correct
 * before saving it.
 *
 * @param expression - The CEL expression string to validate
 * @returns Object with valid: true if expression is valid, or valid: false with error message
 */
export function validateCelExpression(expression: string): { valid: true } | { valid: false, error: string } {
  try {
    // First, transform the expression as we would during evaluation
    // Use dummy context for validation
    const dummyContext: SignupRuleContext = {
      email: 'test@example.com',
      emailDomain: 'example.com',
      authMethod: 'password',
      oauthProvider: '',
    };

    const { expression: transformedExpr, context } = preprocessExpression(expression, dummyContext);

    // Try to parse the transformed expression
    parse(transformedExpr);

    // Also try to evaluate it to catch type errors
    evaluate(transformedExpr, context);

    return { valid: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Provide a user-friendly error message
    if (e instanceof CelParseError) {
      return { valid: false, error: `Invalid expression syntax: ${message}` };
    }
    if (e instanceof CelTypeError) {
      return { valid: false, error: `Type error in expression: ${message}` };
    }
    if (e instanceof CelEvaluationError) {
      return { valid: false, error: `Expression evaluation error: ${message}` };
    }
    return { valid: false, error: message };
  }
}

/**
 * Creates a SignupRuleContext from raw request data.
 * This helper extracts and derives the context variables needed for rule evaluation.
 *
 * @param params - Raw parameters from the signup request
 * @returns SignupRuleContext ready for CEL evaluation
 */
export function createSignupRuleContext(params: {
  email: string,
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider?: string,
}): SignupRuleContext {
  const email = params.email;
  const emailDomain = email.includes('@') ? email.split('@').pop() ?? '' : '';

  return {
    email,
    emailDomain,
    authMethod: params.authMethod,
    oauthProvider: params.oauthProvider ?? '',
  };
}
