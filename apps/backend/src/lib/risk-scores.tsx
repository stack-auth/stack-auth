import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Tenancy } from "./tenancies";

function parseWeight(envName: string, defaultValue: number): number {
  const raw = getEnvVariable(envName, String(defaultValue));
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new StackAssertionError(`Invalid ${envName}: expected integer 0-100, got "${raw}"`);
  }
  return parsed;
}

export type SignUpRiskScores = {
  bot: number,
  freeTrialAbuse: number,
};

export type SignUpRiskScoreContext = {
  primaryEmail: string | null,
  primaryEmailVerified: boolean,
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider: string | null,
  ipAddress: string | null,
};

type SignUpRiskHeuristic = {
  id: string,
  weight: number,
  matches: (context: SignUpRiskScoreContext) => boolean,
};

const disposableEmailDomainPatterns = [
  /(?:^|[-.])(?:10|20)minute(?:s)?mail(?:$|[-.])/,
  /(?:^|[-.])temp(?:[-.]?(?:mail|ail)|mailo|mailninja)(?:$|[-.])/,
  /(?:^|[-.])throwaway(?:$|[-.])/,
  /(?:^|[-.])guerrilla(?:[-.]?mail)?(?:$|[-.])/,
  /(?:^|[-.])mailinator(?:$|[-.])/,
  /(?:^|[-.])yopmail(?:$|[-.])/,
  /(?:^|[-.])trashmail(?:$|[-.])/,
  /(?:^|[-.])dropmail(?:$|[-.])/,
  /(?:^|[-.])mailnesia(?:$|[-.])/,
  /(?:^|[-.])getnada(?:$|[-.])/,
  /(?:^|[-.])emailnator(?:$|[-.])/,
  /(?:^|[-.])emailondeck(?:$|[-.])/,
  /(?:^|[-.])emailtemporanea(?:$|[-.])/,
  /(?:^|[-.])fakeinbox(?:$|[-.])/,
  /(?:^|[-.])mintemail(?:$|[-.])/,
  /(?:^|[-.])sharklasers(?:$|[-.])/,
  /(?:^|[-.])dispostable(?:$|[-.])/,
  /(?:^|[-.])moakt(?:$|[-.])/,
  /(?:^|[-.])tmpmail(?:$|[-.])/,
] as const;

const botRiskHeuristics: readonly SignUpRiskHeuristic[] = [
  {
    id: "disposable-email-domain",
    weight: parseWeight("STACK_RISK_BOT_DISPOSABLE_EMAIL_WEIGHT", 100),
    matches: (context) => disposableEmailDomainPatterns.some((pattern) => pattern.test(normalizeEmailDomain(context.primaryEmail))),
  },
] as const;

const freeTrialAbuseRiskHeuristics: readonly SignUpRiskHeuristic[] = [
  {
    id: "disposable-email-domain",
    weight: parseWeight("STACK_RISK_FTA_DISPOSABLE_EMAIL_WEIGHT", 100),
    matches: (context) => disposableEmailDomainPatterns.some((pattern) => pattern.test(normalizeEmailDomain(context.primaryEmail))),
  },
] as const;

function normalizeEmailDomain(primaryEmail: string | null): string {
  if (primaryEmail == null) {
    return "";
  }

  const [, emailDomain = ""] = primaryEmail.trim().toLowerCase().split("@");
  return emailDomain.replace(/\.+$/, "");
}

function calculateWeightedRiskScore(
  heuristics: readonly SignUpRiskHeuristic[],
  context: SignUpRiskScoreContext,
): number {
  const raw = heuristics.reduce((sum, heuristic) => {
    return heuristic.matches(context) ? sum + heuristic.weight : sum;
  }, 0);
  return Math.min(100, Math.max(0, raw));
}

function calculateDisposableEmailHeuristicScores(context: SignUpRiskScoreContext): SignUpRiskScores {
  return {
    bot: calculateWeightedRiskScore(botRiskHeuristics, context),
    freeTrialAbuse: calculateWeightedRiskScore(freeTrialAbuseRiskHeuristics, context),
  };
}

export async function calculateSignUpRiskScores(_tenancy: Tenancy, context: SignUpRiskScoreContext): Promise<SignUpRiskScores> {
  return calculateDisposableEmailHeuristicScores(context);
}

import.meta.vitest?.test("calculateDisposableEmailHeuristicScores(...)", ({ expect }) => {
  expect(calculateDisposableEmailHeuristicScores({
    primaryEmail: "user@tempmail.com",
    primaryEmailVerified: false,
    authMethod: "password",
    oauthProvider: null,
    ipAddress: null,
  })).toEqual({
    bot: 100,
    freeTrialAbuse: 100,
  });

  expect(calculateDisposableEmailHeuristicScores({
    primaryEmail: "user@best-tempmail-service.com",
    primaryEmailVerified: false,
    authMethod: "password",
    oauthProvider: null,
    ipAddress: null,
  })).toEqual({
    bot: 100,
    freeTrialAbuse: 100,
  });

  expect(calculateDisposableEmailHeuristicScores({
    primaryEmail: "user@example.com",
    primaryEmailVerified: false,
    authMethod: "password",
    oauthProvider: null,
    ipAddress: null,
  })).toEqual({
    bot: 0,
    freeTrialAbuse: 0,
  });
});
