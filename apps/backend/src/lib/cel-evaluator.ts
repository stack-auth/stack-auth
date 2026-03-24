import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { normalizeCountryCode } from "@stackframe/stack-shared/dist/schema-fields";
import { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { unescapeCelString } from "@stackframe/stack-shared/dist/utils/cel-fields";
import { evaluate } from "cel-js";
import { normalizeEmail } from "./emails";
import { SignUpRiskScores } from "./risk-scores";


// ── Error ──────────────────────────────────────────────────────────────

export class CelEvaluationError extends Error {
  public readonly customCaptureExtraArgs: unknown[];

  constructor(
    message: string,
    public readonly expression: string,
    public readonly cause: unknown | null = null,
  ) {
    super(message);
    this.name = 'CelEvaluationError';
    this.customCaptureExtraArgs = [{ expression, cause }];
  }
}


// ── Context ────────────────────────────────────────────────────────────

export type SignUpRuleContext = {
  email: string,
  emailDomain: string,
  /** Best-effort ISO 3166-1 alpha-2 country code. Empty string when unavailable (never null/undefined). */
  countryCode: string,
  authMethod: SignUpAuthMethod,
  oauthProvider: string,
  riskScores: { bot: number, free_trial_abuse: number },
};

export function createSignUpRuleContext(params: {
  email: string | null,
  countryCode: string | null,
  authMethod: SignUpAuthMethod,
  oauthProvider: string | null,
  riskScores: SignUpRiskScoresCrud,
}): SignUpRuleContext {
  let email = '';
  let emailDomain = '';

  if (params.email) {
    email = normalizeEmail(params.email);
    emailDomain = email.includes('@') ? (email.split('@').pop() ?? '') : '';
  }

  return {
    email,
    emailDomain,
    countryCode: params.countryCode === null ? '' : normalizeCountryCode(params.countryCode),
    authMethod: params.authMethod,
    oauthProvider: params.oauthProvider ?? '',
    riskScores: { bot: params.riskScores.bot, free_trial_abuse: params.riskScores.free_trial_abuse },
  };
}


// ── Preprocessing ──────────────────────────────────────────────────────

// cel-js doesn't support method calls, so we pre-compute string methods
// and replace them with pre-evaluated boolean placeholders in the context.
const METHOD_PATTERN = /(\w+)\.(contains|startsWith|endsWith|matches)\s*\(\s*"((?:\\.|[^"\\])*)"\s*\)/g;

const stringMethodEvaluators: Partial<Record<string, (str: string, arg: string) => boolean>> = {
  contains: (s, a) => s.includes(a),
  startsWith: (s, a) => s.startsWith(a),
  endsWith: (s, a) => s.endsWith(a),
  matches: (s, a) => new RegExp(a).test(s),
};

function preprocessExpression(
  expression: string,
  context: SignUpRuleContext,
): { expression: string, context: Record<string, unknown> } {
  const extendedContext: Record<string, unknown> = { ...context };
  let counter = 0;

  const transformedExpr = expression.replace(METHOD_PATTERN, (fullMatch, varName, method, arg) => {
    const varValue = context[varName as keyof SignUpRuleContext];
    if (typeof varValue !== 'string') return fullMatch;

    const evaluator = stringMethodEvaluators[method];
    if (!evaluator) return fullMatch;

    const unescapedArg = unescapeCelString(arg);
    const resultKey = `_method_${counter++}`;

    try {
      extendedContext[resultKey] = evaluator(varValue, unescapedArg);
    } catch (e) {
      throw new CelEvaluationError(`Invalid regex pattern in matches(): "${unescapedArg}"`, expression, e);
    }

    return resultKey;
  });

  return { expression: transformedExpr, context: extendedContext };
}


// ── Evaluation ─────────────────────────────────────────────────────────

export function evaluateCelExpression(expression: string, context: SignUpRuleContext): boolean {
  try {
    const { expression: transformedExpr, context: extendedContext } = preprocessExpression(expression, context);
    const result = evaluate(transformedExpr, extendedContext);

    if (typeof result !== "boolean") {
      throw new CelEvaluationError(
        `CEL expression must evaluate to a boolean, got ${typeof result}: ${JSON.stringify(result)}`,
        expression,
      );
    }
    return result;
  } catch (e) {
    if (e instanceof CelEvaluationError) throw e;
    throw new CelEvaluationError(`Failed to evaluate CEL expression: ${expression}`, expression, e);
  }
}


// ── Tests ──────────────────────────────────────────────────────────────

import.meta.vitest?.test('createSignUpRuleContext(...)', async ({ expect }) => {
  const ctx = (email: string | null, countryCode: string | null, authMethod: SignUpAuthMethod, oauthProvider: string | null, bot = 0, fta = 0) =>
    createSignUpRuleContext({ email, countryCode, authMethod, oauthProvider, riskScores: { bot, free_trial_abuse: fta } });

  expect(ctx('Test.User@Example.COM', null, 'password', null, 17, 23)).toEqual({
    email: 'test.user@example.com', emailDomain: 'example.com', countryCode: '',
    authMethod: 'password', oauthProvider: '', riskScores: { bot: 17, free_trial_abuse: 23 },
  });

  expect(ctx(null, null, 'oauth', 'discord', 1, 2)).toEqual({
    email: '', emailDomain: '', countryCode: '',
    authMethod: 'oauth', oauthProvider: 'discord', riskScores: { bot: 1, free_trial_abuse: 2 },
  });

  expect(ctx('', null, 'oauth', 'twitter', 10, 20)).toEqual({
    email: '', emailDomain: '', countryCode: '',
    authMethod: 'oauth', oauthProvider: 'twitter', riskScores: { bot: 10, free_trial_abuse: 20 },
  });

  expect(ctx('oauth.user@gmail.com', null, 'oauth', 'google', 8, 9)).toEqual({
    email: 'oauth.user@gmail.com', emailDomain: 'gmail.com', countryCode: '',
    authMethod: 'oauth', oauthProvider: 'google', riskScores: { bot: 8, free_trial_abuse: 9 },
  });

  expect(ctx('user@example.com', 'us', 'password', null, 3, 4)).toEqual({
    email: 'user@example.com', emailDomain: 'example.com', countryCode: 'US',
    authMethod: 'password', oauthProvider: '', riskScores: { bot: 3, free_trial_abuse: 4 },
  });
});

import.meta.vitest?.test('evaluateCelExpression with missing email', async ({ expect }) => {
  const context = createSignUpRuleContext({
    email: null, countryCode: null, authMethod: 'oauth', oauthProvider: 'discord',
    riskScores: { bot: 33, free_trial_abuse: 44 },
  });

  // Email-based conditions should fail
  expect(evaluateCelExpression('email == "test@example.com"', context)).toBe(false);
  expect(evaluateCelExpression('email.contains("@")', context)).toBe(false);
  expect(evaluateCelExpression('emailDomain == "example.com"', context)).toBe(false);
  expect(evaluateCelExpression('email == ""', context)).toBe(true);

  // Non-email conditions should work
  expect(evaluateCelExpression('authMethod == "oauth"', context)).toBe(true);
  expect(evaluateCelExpression('oauthProvider == "discord"', context)).toBe(true);
  expect(evaluateCelExpression('riskScores.bot == 33', context)).toBe(true);
  expect(evaluateCelExpression('riskScores.free_trial_abuse == 44', context)).toBe(true);
  expect(evaluateCelExpression('riskScores.bot > 10 && riskScores.free_trial_abuse < 90', context)).toBe(true);
});

import.meta.vitest?.test('countryCode in_list vs equals', ({ expect }) => {
  const context = createSignUpRuleContext({
    email: 'test@example.com', countryCode: 'US', authMethod: 'password', oauthProvider: null,
    riskScores: { bot: 0, free_trial_abuse: 0 },
  });

  expect(evaluateCelExpression('countryCode in ["US", "CA"]', context)).toBe(true);
  expect(evaluateCelExpression('countryCode in ["CA"]', context)).toBe(false);
  expect(evaluateCelExpression('countryCode == "US"', context)).toBe(true);
});
